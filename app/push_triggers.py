# app/push_triggers.py
"""Disparadores de Web Push del Panel del Jugador.

La población objetivo son SOLO las cuentas con suscripción (opt-in explícito
del toggle 🔔). Tres disparadores, decididos con el estudio de retención:

1. Racha en riesgo — cron semanal del jueves por la tarde (GitHub Actions →
   POST /player/push/run-weekly): compute_streak.at_risk con racha >= 2 semanas.
2. Reto casi logrado — mismo cron, SOLO si no hubo aviso de racha (máximo UN
   empujón semanal por jugador, no una ráfaga).
3. "Hoy hay mesa" — hook al abrir la primera mesa del día / publicar anuncio.

Dedupe vía audit_logs (mismo patrón que el throttle de PANEL_OPEN): re-correr
el cron o abrir una segunda mesa el mismo día NO re-envía. Como en
_track_panel_open, dos corridas CONCURRENTES pueden colar un duplicado; es
best-effort y el daño es un aviso repetido, no plata.

Los hooks son fire-and-forget con SESIÓN DB PROPIA: jamás bloquean ni
ensucian la transacción del request del staff que abre la mesa.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from . import models, player_stats, push_service
from .audit import AuditAction, log_standalone
from .database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# Umbral de "casi logrado": >= 80% del próximo objetivo sin haberlo cumplido.
NEAR_RATIO = 0.8
# Racha mínima para avisar que peligra: perder 1 semana no duele, 2+ sí.
MIN_STREAK_WEEKS = 2


# ---------------------------------------------------------------------------
# Payloads (funciones puras, testeables)
# ---------------------------------------------------------------------------
def streak_payload(streak: dict) -> dict | None:
    """Aviso de racha en riesgo, o None si no aplica."""
    if not streak.get("at_risk") or streak.get("weeks", 0) < MIN_STREAK_WEEKS:
        return None
    weeks = streak["weeks"]
    return {
        "title": f"🔥 Tu racha de {weeks} semanas está en riesgo",
        "body": "Esta semana todavía no viniste. Una visita la mantiene viva.",
        "tag": "rf-streak",
        "url": "/",
    }


def _fmt(n) -> str:
    """3.0 → '3', 3.5 → '3.5' (los retos de horas traen decimales)."""
    f = float(n)
    return str(int(f)) if f == int(f) else str(round(f, 1))


def next_target(challenge_target: float, tiers: list | None, current: float) -> float | None:
    """Próximo objetivo NO cumplido: el primer tramo pendiente si el reto es
    escalonado (llegan ordenados ascendente), o la meta única. None si ya
    cumplió todo."""
    if tiers:
        for t in tiers:
            tgt = t.get("target", 0)
            if current < tgt:
                return tgt
        return None
    return challenge_target if current < challenge_target else None


def challenge_payload(title: str, metric: str, current: float, target: float | None) -> dict | None:
    """Aviso de reto casi logrado, o None si no aplica (lejos, cumplido o sin
    objetivo). El progreso 0 jamás avisa (0/NEAR de cualquier meta es 0%)."""
    if not target or target <= 0 or current >= target:
        return None
    if current / target < NEAR_RATIO:
        return None
    return {
        "title": "🎯 ¡Estás a nada de lograrlo!",
        "body": f"Vas {_fmt(current)} de {_fmt(target)} {metric} en «{title}». No lo dejes escapar.",
        "tag": "rf-challenge",
        "url": "/",
    }


# ---------------------------------------------------------------------------
# Cron semanal (jueves): racha en riesgo / reto casi logrado
# ---------------------------------------------------------------------------
async def _sent_weekly_already(db: AsyncSession, club_id: int, user_id: int,
                               week_start_utc: datetime) -> bool:
    row = (await db.execute(text("""
        SELECT 1 FROM audit_logs
        WHERE club_id = :cid AND action = 'PUSH_WEEKLY_SENT'
          AND created_at >= :since AND meta->>'user_id' = :uid
        LIMIT 1
    """), {"cid": club_id, "since": week_start_utc, "uid": str(user_id)})).first()
    return row is not None


async def _weekly_payload_for(db: AsyncSession, club_id: int,
                              player: models.Player) -> tuple[dict | None, str | None]:
    """(payload, motivo) del empujón semanal de UN jugador. Prioridad:
    racha > reto — un solo aviso por semana."""
    since = player.stats_since
    weeks = await player_stats.visit_weeks(db, club_id, player.id, since)
    payload = streak_payload(player_stats.compute_streak(weeks))
    if payload:
        return payload, "streak"

    now_col = datetime.now(player_stats.COL_TZ)
    challenges = (await db.execute(
        select(models.MonthlyChallenge).where(
            models.MonthlyChallenge.club_id == club_id,
            models.MonthlyChallenge.year == now_col.year,
            models.MonthlyChallenge.month == now_col.month,
            models.MonthlyChallenge.active == True,  # noqa: E712
        ).order_by(models.MonthlyChallenge.id)
    )).scalars().all()
    if not challenges:
        return None, None

    cash_rows = await player_stats.cash_rows_for_player(db, club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, club_id, player.id, since)
    month_start = player_stats.start_of_month_col_as_utc()
    m_cash = [r for r in cash_rows if r["date"] and r["date"] >= month_start]
    m_tour = [r for r in tour_rows if r["date"] and r["date"] >= month_start]
    for ch in challenges:
        current = player_stats.challenge_progress(ch.metric, m_cash, m_tour)
        payload = challenge_payload(ch.title, ch.metric, current,
                                    next_target(ch.target, ch.tiers, current))
        if payload:
            return payload, "challenge"
    return None, None


async def run_weekly(db: AsyncSession, *, dry_run: bool = False) -> dict:
    """Corrida del cron semanal sobre todas las cuentas suscritas (todas las
    poblaciones son chicas: solo opt-in). Idempotente por semana ISO vía
    audit_logs. Devuelve resumen para el response/logs del endpoint."""
    subs = (await db.execute(select(models.PushSubscription))).scalars().all()
    by_user: dict[tuple[int, int], list] = {}
    for s in subs:
        by_user.setdefault((s.club_id, s.user_id), []).append(s)

    week_start = player_stats.start_of_week_col_as_utc()
    # "notified" cuenta usuarios con aviso PROCESADO (el resultado real del
    # envío por-suscripción —sent/gone/errors— viaja en details).
    summary = {"subscribed_users": len(by_user), "notified": 0, "skipped_dedupe": 0,
               "no_message": 0, "no_player": 0, "errors": 0, "details": []}

    for (club_id, user_id), user_subs in by_user.items():
        try:
            if await _sent_weekly_already(db, club_id, user_id, week_start):
                summary["skipped_dedupe"] += 1
                continue
            player = (await db.execute(
                select(models.Player).where(
                    models.Player.user_id == user_id,
                    models.Player.club_id == club_id,
                )
            )).scalars().first()
            if not player:
                summary["no_player"] += 1
                continue

            payload, reason = await _weekly_payload_for(db, club_id, player)
            if not payload:
                summary["no_message"] += 1
                continue

            if dry_run:
                summary["details"].append({"club_id": club_id, "user_id": user_id,
                                           "reason": reason, "title": payload["title"]})
                summary["notified"] += 1
                continue

            result = await push_service.send_to_subscriptions(user_subs, payload)
            # El dedupe se registra aunque el push service haya fallado: un
            # reintento inmediato del cron no debe martillar al mismo user.
            await log_standalone(
                db, club_id=club_id, actor_email="cron",
                action=AuditAction.PUSH_WEEKLY_SENT, actor_type="SYSTEM",
                meta={"user_id": user_id, "reason": reason, **result},
            )
            summary["notified"] += 1
            summary["details"].append({"club_id": club_id, "user_id": user_id,
                                       "reason": reason, **result})
        except Exception:
            summary["errors"] += 1
            logger.exception("push_weekly_error club=%s user=%s", club_id, user_id)
    return summary


# ---------------------------------------------------------------------------
# Hooks de eventos del club: "hoy hay mesa" / anuncio
# ---------------------------------------------------------------------------
# Referencias fuertes a las tasks en vuelo: create_task solo guarda weak-ref
# y el GC podría matar un aviso a medio enviar. Se descartan al completar.
_bg_tasks: set = set()


def spawn(coro) -> None:
    """Dispara un aviso en background sin bloquear el request del staff.
    El error jamás sube: solo log."""
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)

    def _done(t):
        _bg_tasks.discard(t)
        exc = t.exception()
        if exc:
            logger.warning("push_trigger_failed: %r", exc)

    task.add_done_callback(_done)


def _start_of_today_col_utc() -> datetime:
    """Medianoche de HOY Colombia en UTC naive (formato de la DB)."""
    start_col = datetime.now(player_stats.COL_TZ).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return start_col.astimezone(timezone.utc).replace(tzinfo=None)


async def _sent_today(db: AsyncSession, club_id: int, action: str) -> bool:
    row = (await db.execute(text("""
        SELECT 1 FROM audit_logs
        WHERE club_id = :cid AND action = :action AND created_at >= :since
        LIMIT 1
    """), {"cid": club_id, "action": action,
           "since": _start_of_today_col_utc()})).first()
    return row is not None


async def _notify_club(club_id: int, action: str, payload: dict) -> None:
    """Envía a TODOS los suscritos del club (solo cuentas PLAYER pueden
    suscribirse), con dedupe de 1/día por tipo de aviso. Sesión DB propia:
    esto corre fuera del request que lo disparó."""
    try:
        async with AsyncSessionLocal() as db:
            if await _sent_today(db, club_id, action):
                return
            subs = (await db.execute(
                select(models.PushSubscription)
                .where(models.PushSubscription.club_id == club_id)
            )).scalars().all()
            if not subs:
                return
            result = await push_service.send_to_subscriptions(subs, payload)
            await log_standalone(
                db, club_id=club_id, actor_email=None, action=action,
                actor_type="SYSTEM", meta={"title": payload["title"], **result},
            )
            logger.info("push_club_notify club=%s action=%s %s", club_id, action, result)
    except Exception:
        logger.exception("push_club_notify_failed club=%s action=%s", club_id, action)


async def notify_table_open(club_id: int, club_name: str) -> None:
    """'Hoy hay mesa': la PRIMERA mesa del día (Colombia) avisa; las demás no."""
    await _notify_club(club_id, AuditAction.PUSH_TABLE_OPEN, {
        "title": f"🎰 ¡Hoy hay mesa en {club_name}!",
        "body": "Ya está abierta. Pasate y sumá a tu racha.",
        "tag": "rf-table",
        "url": "/",
    })


async def notify_announcement(club_id: int, club_name: str, announcement: str) -> None:
    """Anuncio del club publicado/cambiado (máx 1 aviso al día)."""
    await _notify_club(club_id, AuditAction.PUSH_ANNOUNCEMENT, {
        "title": f"📣 {club_name}",
        "body": announcement,
        "tag": "rf-announce",
        "url": "/",
    })
