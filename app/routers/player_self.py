# app/routers/player_self.py
"""Panel del Jugador: endpoints self-service del rol PLAYER (patrón dealer_self).

El jugador SOLO ve lo suyo: sus sesiones, su plata, sus logros, su posición.
Jamás: rake del club, distribución, ni montos/nombres de otros jugadores.
Todas las respuestas son dicts armados a mano (nunca serializar Session/Club).

Corte del histórico: todo se calcula desde Player.stats_since (None = todo;
ver player_stats). La posición en rankings NO se corta: es el ranking real del
mes del club, igual para todos.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, player_stats, services
from ..audit import log_standalone, AuditAction
from ..dependencies import get_db, get_current_user, require_role
from .public import live_tournaments, open_cash_tables

router = APIRouter(prefix="/player", tags=["PlayerSelf"])

_require_player = require_role([models.UserRole.PLAYER])


async def _my_player(db: AsyncSession, user: models.User) -> models.Player:
    """Ficha de jugador vinculada a la cuenta. 404 si el club la desvinculó."""
    player = (await db.execute(
        select(models.Player).where(
            models.Player.user_id == user.id,
            models.Player.club_id == user.club_id,
        )
    )).scalars().first()
    if not player:
        raise HTTPException(status_code=404, detail="Tu cuenta no está vinculada a un jugador de este club")
    return player


async def _jackpot_count(db: AsyncSession, club_id: int, player_id: int, since) -> int:
    return (await db.execute(text("""
        SELECT COUNT(*) FROM transactions t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.club_id = :cid AND t.player_id = :pid
          AND t.type = 'JACKPOT_PAYOUT' AND s.end_time >= :since
    """), {"cid": club_id, "pid": player_id,
           "since": since or player_stats.EPOCH})).scalar() or 0


def _totals(cash_rows, tour_rows):
    invested = sum(r["invested"] for r in cash_rows) + sum(r["invested"] for r in tour_rows)
    returned = sum(r["returned"] for r in cash_rows) + sum(r["returned"] for r in tour_rows)
    profit = returned - invested
    cash_profit = sum(r["returned"] - r["invested"] for r in cash_rows)
    hours = sum(r["hours"] for r in cash_rows)
    return {
        "invested": invested,
        "returned": returned,
        "profit": profit,
        "roi": round(profit / invested, 4) if invested > 0 else None,
        "expenses": sum(r["spend"] for r in cash_rows),  # consumo+propinas, aparte del ROI
        "hours": round(hours, 1),
        # Winrate de cash ($/hora): la métrica estándar de un jugador de cash.
        # Mínimo 30 min de muestra: con minutos en mesa la división da números
        # absurdos y de todos modos no significa nada.
        "profit_per_hour": round(cash_profit / hours) if hours >= 0.5 else None,
        # Visitas = sesiones JUGADAS (con entrada); las filas solo-corrección
        # suman plata pero no visitas.
        "cash_sessions": sum(1 for r in cash_rows if r.get("played", True)),
        "tournaments": len(tour_rows),
        "visits": sum(1 for r in cash_rows if r.get("played", True)) + len(tour_rows),
    }


async def _has_open_session(db: AsyncSession, club_id: int, player_id: int) -> bool:
    """Aviso 'tenés una sesión abierta; se suma al cerrar'."""
    n = (await db.execute(text("""
        SELECT COUNT(*) FROM transactions t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.club_id = :cid AND t.player_id = :pid AND s.status = 'OPEN'
          AND t.type IN ('BUYIN','REBUY')
    """), {"cid": club_id, "pid": player_id})).scalar() or 0
    return n > 0


async def _track_panel_open(db: AsyncSession, user: models.User, request: Request) -> None:
    """Deja rastro de la apertura del panel para medir retención (PR8).

    Throttle diario (día Colombia): ~1 evento PANEL_OPEN por jugador por día, así
    audit_logs no crece por cada request y basta para la retención a nivel de día.
    (Dos aperturas concurrentes pueden colar un duplicado ese día; es inocuo: el
    reporte mide "hubo actividad en la ventana", no cuenta eventos.) El update de
    last_seen_at y el INSERT viajan en el mismo commit (atómicos). Best-effort:
    log_standalone traga cualquier fallo → nunca rompe el my-profile. El meta
    espeja a LOGIN_SUCCESS (user_id + role) para que el reporte lea ambos eventos
    igual (meta->>'user_id')."""
    if not player_stats.should_log_panel_open(user.last_seen_at):
        return
    user.last_seen_at = datetime.utcnow()
    await log_standalone(
        db, club_id=user.club_id, actor_email=user.email,
        action=AuditAction.PANEL_OPEN, actor_type="USER", request=request,
        # role = user.role.value ("player", minúscula) para espejar EXACTAMENTE
        # el meta de LOGIN_SUCCESS y que el reporte lea ambos con el mismo filtro.
        meta={"user_id": user.id, "role": user.role.value},
    )


@router.get("/my-profile")
async def my_profile(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    player = await _my_player(db, user)
    await _track_panel_open(db, user, request)
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)

    totals = _totals(cash_rows, tour_rows)
    streak = player_stats.compute_streak(weeks)
    level = player_stats.compute_level(totals["visits"])
    # Estatus VIP (pilar del club por volumen). SOLO para quien PAGÓ el histórico
    # completo (stats_since NULL): es un beneficio premium del que desbloqueó su
    # data, no de cualquier pilar. Se expone SOLO el booleano —nunca el volumen ni
    # el ranking— para no premiar el gasto a la vista. Cacheado por club.
    vip = False
    if since is None:
        standings = await player_stats.compute_club_standings(db, user.club_id)
        vip = player_stats.is_vip(standings, player.id)

    # Resumen del mes en curso (hora Colombia), sobre las filas ya cortadas
    month_start = player_stats.start_of_month_col_as_utc()
    m_cash = [r for r in cash_rows if r["date"] and r["date"] >= month_start]
    m_tour = [r for r in tour_rows if r["date"] and r["date"] >= month_start]
    m = _totals(m_cash, m_tour)

    out = {
        "player_name": player.name,
        "totals": totals,
        "level": level,
        "is_vip": vip,
        "streak": streak,
        "month": {"invested": m["invested"], "returned": m["returned"],
                  "profit": m["profit"], "visits": m["visits"], "hours": m["hours"]},
        # "Mejor noche" del mes: métrica donde el que pierde también tiene algo
        # que mostrar. Del mes en curso (m_cash/m_tour), no del histórico entero.
        "best_session": player_stats.best_session_of(m_cash, m_tour),
        # Comparación contra uno mismo (horas de la semana + récord/promedio):
        # goal-gradient donde el que pierde también progresa.
        "self_compare": player_stats.self_compare_stats(cash_rows, tour_rows),
        "open_session": await _has_open_session(db, user.club_id, player.id),
        "archive": None,
    }
    if since is not None:
        # Histórico bloqueado: el gancho de venta (SOLO conteos, jamás montos)
        arc = await player_stats.archive_counts(db, user.club_id, player.id, since)
        if arc["sessions"] or arc["tournaments"]:
            out["archive"] = {"locked": True, **arc}
    return out


@router.get("/my-sessions")
async def my_sessions(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    player = await _my_player(db, user)
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)

    items = [
        {"type": "cash", "name": r["name"], "date": r["date"].isoformat() if r["date"] else None,
         "invested": r["invested"], "returned": r["returned"],
         "profit": r["returned"] - r["invested"], "hours": round(r["hours"], 1),
         "spend": r["spend"]}
        for r in cash_rows
    ] + [
        {"type": "tournament", "name": r["name"], "date": r["date"].isoformat() if r["date"] else None,
         "invested": r["invested"], "returned": r["returned"],
         "profit": r["returned"] - r["invested"], "rank": r["rank"]}
        for r in tour_rows
    ]
    items.sort(key=lambda x: x["date"] or "", reverse=True)
    limit = max(1, min(limit, 100))
    skip = max(0, skip)
    page = items[skip:skip + limit]
    # Curva de profit acumulado (orden cronológico, TODO el histórico visible):
    # insumo del sparkline del front sin pedir todas las páginas.
    # En paralelo, curva de ACTIVIDAD acumulada (horas, o visitas si es solo-torneo):
    # una línea que SUBE, para reencuadrar el Historial del que va en negativo — la
    # curva de profit en rojo es la pérdida acumulada, lo que más deprime la visita.
    cum, curve = 0.0, []
    cum_h, hours_curve = 0.0, []
    for it in sorted(items, key=lambda x: x["date"] or ""):
        cum += it["profit"]
        curve.append(round(cum))
        cum_h += it.get("hours") or 0
        hours_curve.append(round(cum_h, 1))
    if cum_h > 0:
        activity_curve, activity_total = hours_curve, f"{round(cum_h)} h"
    else:
        activity_curve = list(range(1, len(items) + 1))  # 1,2,…N visitas
        activity_total = f"{len(items)} visita{'s' if len(items) != 1 else ''}"
    return {"items": page, "total": len(items), "has_more": skip + limit < len(items),
            "profit_curve": curve,
            "activity_curve": activity_curve, "activity_total": activity_total}


@router.get("/my-achievements")
async def my_achievements(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    player = await _my_player(db, user)
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)
    jk = await _jackpot_count(db, user.club_id, player.id, since)

    badges = player_stats.compute_badges(
        cash_rows, tour_rows,
        streak_weeks_max=player_stats.longest_streak(weeks),
        jackpot_count=jk,
    )
    visits = sum(1 for r in cash_rows if r.get("played", True)) + len(tour_rows)
    return {"badges": badges, "level": player_stats.compute_level(visits),
            "unlocked_count": sum(1 for b in badges if b["achieved"])}


@router.get("/my-rank")
async def my_rank(
    year: int | None = None,
    month: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Posición propia en los rankings mensuales del club. SOLO posición y
    total de rankeados — jamás nombres ni montos de otros. No se corta por
    stats_since: es el ranking real del mes, igual para todos."""
    if month is not None and not (1 <= month <= 12):
        raise HTTPException(status_code=422, detail="Mes inválido")
    player = await _my_player(db, user)
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()
    winners, spenders, active, _names, period = \
        await player_stats.compute_monthly_rankings(db, club, year, month)

    # Empates: competition ranking (1 + #{estrictamente mayores}) — dos
    # empatados comparten posición; el top-3 del staff corta por orden estable,
    # así que un empatado en el 3er valor puede ver "#3" sin salir en el card.
    def my_pos(data_map, value_key):
        if player.id not in data_map:
            return None
        mine = data_map[player.id]
        pos = 1 + sum(1 for v in data_map.values() if v > mine)
        return {"rank": pos, value_key: round(float(mine), 1), "total": len(data_map)}

    return {
        "winners": my_pos(winners, "value"),
        "spenders": my_pos(spenders, "value"),
        "active": my_pos(active, "hours"),
        "period": period,
    }


@router.get("/club-info")
async def club_info(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Razones de volver: anuncio del club + próximos torneos programados.
    Misma información que ya es pública en /c/{token} (incluido el buy-in)."""
    player = await _my_player(db, user)
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()
    scheduled = (await db.execute(
        select(models.Tournament)
        .where(
            models.Tournament.club_id == user.club_id,
            models.Tournament.status == "SCHEDULED",
        )
        .order_by(models.Tournament.scheduled_start.asc())
        .limit(10)
    )).scalars().all()
    # Mi silla en los torneos vivos: el jugador llega al club y su panel le dice
    # dónde sentarse (mesa/silla) o que está en lista de espera. Solo LO SUYO.
    live = await live_tournaments(db, user.club_id)
    my_seats = []
    if live:
        seat_rows = (await db.execute(
            select(models.TournamentPlayer.tournament_id,
                   models.TournamentPlayer.seat_number,
                   models.TournamentTable.table_number)
            .outerjoin(models.TournamentTable,
                       (models.TournamentTable.id == models.TournamentPlayer.table_id)
                       & (models.TournamentTable.tournament_id
                          == models.TournamentPlayer.tournament_id))
            .where(models.TournamentPlayer.tournament_id.in_([t["id"] for t in live]),
                   models.TournamentPlayer.player_id == player.id,
                   models.TournamentPlayer.status == "ACTIVE")
        )).all()
        my_seats = [
            {"tournament_id": tid,
             "table_number": int(tnum) if tnum is not None else None,
             "seat_number": int(seat) if seat is not None else None}
            for tid, seat, tnum in seat_rows
        ]

    # La razón #1 para abrir el panel: ¿hay mesa AHORA? Misma info (y misma
    # función) que el link público /c/{token} — nada que no sea ya público.
    return {
        "club_name": club.name,
        "announcement": club.public_announcement,
        "jackpot": await services.club_jackpot_public(db, club),
        "open_tables": await open_cash_tables(db, user.club_id),
        "live_tournaments": live,
        "my_seats": my_seats,
        "scheduled": [
            {"name": t.name,
             "scheduled_start": t.scheduled_start.isoformat() if t.scheduled_start else None,
             "buyin": t.buyin_amount}
            for t in scheduled
        ],
    }


# Movida a player_stats.challenge_progress (la comparte el cron de push);
# alias local para no tocar los call-sites de este router.
_challenge_progress = player_stats.challenge_progress


def _tiers_view(tiers: list, current: float, vip: bool) -> dict:
    """Vista escalonada PURA (testeable): estado de cada tramo + barra GLOBAL hacia
    el tramo tope (monótona: nunca retrocede al cruzar un tramo) + la recompensa que
    le toca a ESTE jugador (VIP ve reward_vip si el tramo la trae; si no, la base).
    Los escalones intermedios los comunica el checklist de tramos (done por tramo);
    la barra apunta siempre al tope. Los tramos llegan ordenados ascendente."""
    tiers_out = []
    for t in tiers:
        tgt = t.get("target", 0)
        rvip = t.get("reward_vip")
        tiers_out.append({
            "target": tgt,
            "reward": rvip if (vip and rvip) else t.get("reward"),
            "done": current >= tgt,
        })
    top_target = tiers_out[-1]["target"] if tiers_out else 0
    return {
        "tiers": tiers_out,
        "progress": {
            "current": current, "target": top_target,
            "done": bool(tiers_out) and all(t["done"] for t in tiers_out),
            "completed": sum(1 for t in tiers_out if t["done"]),
        },
    }


@router.get("/my-challenges")
async def my_challenges(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Retos rotativos del mes del club (hasta 3) + progreso propio de cada uno.
    Lista vacía si el club no definió retos este mes. Combate el desgaste de los
    badges fijos (novelty effect)."""
    player = await _my_player(db, user)
    now_col = datetime.now(player_stats.COL_TZ)
    rows = (await db.execute(
        select(models.MonthlyChallenge).where(
            models.MonthlyChallenge.club_id == user.club_id,
            models.MonthlyChallenge.year == now_col.year,
            models.MonthlyChallenge.month == now_col.month,
            models.MonthlyChallenge.active == True,  # noqa: E712
        ).order_by(models.MonthlyChallenge.id)
    )).scalars().all()
    if not rows:
        return {"challenges": []}

    # Las filas del jugador NO dependen del reto → se traen UNA sola vez y se
    # reusan para el progreso de cada uno.
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    month_start = player_stats.start_of_month_col_as_utc()
    m_cash = [r for r in cash_rows if r["date"] and r["date"] >= month_start]
    m_tour = [r for r in tour_rows if r["date"] and r["date"] >= month_start]

    # VIP (mismo gate que el panel: solo si pagó el histórico → stats_since NULL)
    # se computa UNA vez y solo si algún reto escalonado lo necesita (es caro).
    vip = False
    if since is None and any(ch.tiers for ch in rows):
        standings = await player_stats.compute_club_standings(db, user.club_id)
        vip = player_stats.is_vip(standings, player.id)

    out_list = []
    for ch in rows:
        current = _challenge_progress(ch.metric, m_cash, m_tour)
        item = {
            "id": ch.id,
            "title": ch.title,
            "description": ch.description,
            "metric": ch.metric,
            "reward_text": ch.reward_text,
        }
        if ch.tiers:
            view = _tiers_view(ch.tiers, current, vip)
            item["tiers"] = view["tiers"]
            item["is_vip"] = vip
            item["progress"] = view["progress"]
        else:
            item["progress"] = {"current": current, "target": ch.target, "done": current >= ch.target}
        out_list.append(item)
    return {"challenges": out_list}


@router.get("/monthly-summary")
async def monthly_summary(
    year: int | None = None,
    month: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Insumo del resumen compartible (card de WhatsApp)."""
    if month is not None and not (1 <= month <= 12):
        raise HTTPException(status_code=422, detail="Mes inválido")
    player = await _my_player(db, user)
    since = player.stats_since

    now = datetime.utcnow()
    if year and month:
        start = datetime(year, month, 1)
        end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    else:
        start = player_stats.start_of_month_col_as_utc()
        end = now
    period = {"year": start.year, "month": start.month}  # SIEMPRE el mes pedido
    # El corte de la venta manda: no mostrar plata anterior a stats_since.
    # partial = el corte parte el mes; locked = el mes entero quedó bajo el corte.
    partial = bool(since and start < since < end)
    locked = bool(since and since >= end)
    if since and since > start:
        start = since

    cash_all = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_all = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    cash_rows = [r for r in cash_all if r["date"] and start <= r["date"] < end]
    tour_rows = [r for r in tour_all if r["date"] and start <= r["date"] < end]
    t = _totals(cash_rows, tour_rows)

    best = player_stats.best_session_of(cash_rows, tour_rows)

    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)
    streak = player_stats.compute_streak(weeks)
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()

    return {
        "player_name": player.name,
        "club_name": club.name,
        "period": period,
        "partial": partial,   # el corte del histórico parte este mes
        "locked": locked,     # mes enteramente anterior al corte: todo en 0
        "visits": t["visits"],
        "hours": t["hours"],
        "invested": t["invested"],
        "returned": t["returned"],
        "profit": t["profit"],
        "best_session": best,
        "streak_weeks": streak["weeks"],
        "level": player_stats.compute_level(len(cash_all) + len(tour_all))["tier"],
    }


@router.get("/weekly-summary")
async def weekly_summary(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Recap de la semana ISO en curso (hora Colombia): insumo del empujón
    semanal de re-engagement (la ventana del estudio es SEMANAL, no mensual).
    No-monetario a propósito (mismo criterio del Inicio en PR5): visitas, horas,
    mejor noche y racha — lo que invita a VOLVER, no la plata."""
    player = await _my_player(db, user)
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)

    week_start = player_stats.start_of_week_col_as_utc()
    w_cash = [r for r in cash_rows if r["date"] and r["date"] >= week_start]
    w_tour = [r for r in tour_rows if r["date"] and r["date"] >= week_start]
    t = _totals(w_cash, w_tour)
    streak = player_stats.compute_streak(weeks)

    return {
        "player_name": player.name,
        "week_start": week_start.isoformat() + "Z",
        "visits": t["visits"],
        "hours": t["hours"],
        "best_session": player_stats.best_session_of(w_cash, w_tour),
        "streak_weeks": streak["weeks"],
        "streak_at_risk": streak["at_risk"],
    }


@router.get("/my-highlight")
async def my_highlight(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Destaque del jugador: su mejor posición relativa en el club en una métrica
    NO-monetaria (horas / visitas / constancia) — un peak positivo honesto para
    el que no tiene profit que lucir. `null` si no llega al tercio superior en
    nada (no forzamos un top falso). Solo su posición: jamás nombres ni valores
    de otros jugadores."""
    player = await _my_player(db, user)
    standings = await player_stats.compute_club_standings(db, user.club_id)
    return {"highlight": player_stats.best_highlight(standings, player.id)}
