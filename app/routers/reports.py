# app/routers/reports.py
"""Reportes de producto para el staff (OWNER/MANAGER).

Hoy: retención del Panel del Jugador (D7/D30) por cohorte de activación (PR8).

La serie temporal sale 100% de audit_logs: LOGIN_SUCCESS (existe desde el
lanzamiento del panel) ∪ PANEL_OPEN (apertura del panel, throttle 1/día). El
login solo no alcanza —el token dura 30 días— así que un jugador fiel que abre
a diario generaría un único LOGIN_SUCCESS; PANEL_OPEN captura ese uso recurrente.

Nota de expectativas: mientras el panel sea joven, casi todas las cohortes salen
'inmaduras' (aún no cumplieron la ventana del bucket) → pct = null. Es correcto:
no reportamos porcentajes sobre cohortes que no tuvieron tiempo de retener.
"""
import hashlib
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, player_stats
from ..audit import log_standalone, AuditAction
from ..dependencies import get_db, get_current_club, require_role

router = APIRouter(prefix="/reports", tags=["Analytics"])

# Buckets de retención: (key, label, lo, hi). "Retenido en el bucket" = hubo
# actividad entre lo..hi DÍAS CORRIDOS desde la activación (ventana [lo, hi)).
# Ventanas anchas a propósito: un jugador de club va 1–2 veces/semana, así que
# "día 7 exacto" no aplica; medimos "volvió alrededor de la semana / del mes".
RETENTION_BUCKETS = [
    ("d1", "Día 1–3", 1, 3),
    ("d7", "Semana (día 5–10)", 5, 10),
    ("d30", "Mes (día 24–40)", 24, 40),
]


def _compute_retention(events, now, buckets=RETENTION_BUCKETS):
    """Cómputo puro (testeable sin DB).

    events: iterable de (user_id, ts_naive_utc). Agrupa por jugador; la cohorte
    es el lunes ISO (hora Colombia) de su PRIMERA actividad (= activación). Para
    cada bucket [lo, hi) un jugador está 'retenido' si tuvo alguna actividad a
    lo..hi días corridos de su activación. Solo entra al denominador si su cohorte
    ya 'maduró' (pasaron >= hi días desde la activación); si no, es inmaduro.
    """
    by_user = defaultdict(list)
    for uid, ts in events:
        by_user[uid].append(ts)

    players = []
    for uid, tss in by_user.items():
        tss.sort()
        activation = tss[0]
        age_days = (now - activation).total_seconds() / 86400.0
        deltas = [(t - activation).total_seconds() / 86400.0 for t in tss]
        players.append({
            "week": player_stats._col_week_monday(activation),
            "age_days": age_days,
            "deltas": deltas,
        })

    def bucket_stats(subset):
        out = {}
        for key, _label, lo, hi in buckets:
            mature = [p for p in subset if p["age_days"] >= hi]
            retained = sum(1 for p in mature if any(lo <= d < hi for d in p["deltas"]))
            n = len(mature)
            out[key] = {
                "mature": n,
                "retained": retained,
                "pct": round(retained / n, 4) if n else None,
            }
        return out

    cohorts_map = defaultdict(list)
    for p in players:
        cohorts_map[p["week"]].append(p)

    cohorts = [
        {
            "week_start": week.isoformat(),
            "activated": len(cohorts_map[week]),
            "retention": bucket_stats(cohorts_map[week]),
        }
        for week in sorted(cohorts_map.keys())
    ]

    return {
        "buckets": [{"key": k, "label": lb, "window_days": [lo, hi]}
                    for k, lb, lo, hi in buckets],
        "cohorts": cohorts,
        "overall": {"activated": len(players), "retention": bucket_stats(players)},
    }


@router.get("/retention")
async def retention(
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    """Retención D7/D30 del panel por cohorte de activación (solo este club)."""
    # role se guarda en minúscula ('player') porque viene de UserRole.PLAYER.value,
    # tanto en LOGIN_SUCCESS (auth.py) como en PANEL_OPEN (player_self.py).
    rows = (await db.execute(text("""
        SELECT (meta->>'user_id')::int AS user_id, created_at
        FROM audit_logs
        WHERE club_id = :cid
          AND action IN ('LOGIN_SUCCESS', 'PANEL_OPEN')
          AND meta->>'role' = 'player'
          AND meta->>'user_id' IS NOT NULL
        ORDER BY created_at
    """), {"cid": current_club.id})).all()

    now = datetime.utcnow()
    events = [(r.user_id, r.created_at) for r in rows]
    result = _compute_retention(events, now)
    result["club_id"] = current_club.id
    result["generated_at"] = now.isoformat() + "Z"
    return result


# ===========================================================================
# Reactivación de inactivos como EXPERIMENTO con grupo de control (PR9)
# ===========================================================================
# Hipótesis (sin evidencia en el corpus, se mide): mandar un WhatsApp a un
# jugador que dejó de venir lo trae de vuelta al local. Para probarlo con rigor,
# un CONTROL (~CONTROL_PCT%) queda como holdout: califica igual pero NO recibe
# mensaje, y comparamos su tasa de retorno contra el tratamiento. Ese delta es
# la única prueba de que el mensaje sirve.

INACTIVE_DAYS = 21        # sin visita hace >= esto → "inactivo" (análisis Mambo $45M)
CONTROL_PCT = 30          # % holdout que NO recibe mensajes (grupo de control)
LIFT_WINDOW_DAYS = 30     # ventana para contar "volvió tras calificar"


def assign_reengagement_group(club_id: int, player_id: int) -> str:
    """Grupo ESTABLE y determinista por hash → reproducible en tests, ~CONTROL_PCT%
    al control y sin sesgo. Se persiste la 1ª vez que el jugador califica y NO se
    re-balancea (cambiarlo invalidaría el experimento)."""
    h = int(hashlib.md5(f"{club_id}:{player_id}".encode()).hexdigest(), 16) % 100
    return "control" if h < CONTROL_PCT else "treatment"


def _compute_lift(rows, now, window_days=LIFT_WINDOW_DAYS):
    """Cómputo puro del lift (testeable sin DB).

    rows: iterable de (group, qualified_at, first_return_after_qualified). Un
    jugador cuenta (es 'maduro') solo si su ventana ya cerró (qualified_at +
    window <= now); si no, aún puede volver → no sesga. 'Retornó' = tuvo una
    visita en (qualified_at, qualified_at + window]. lift = pct_tratamiento −
    pct_control (intención de tratar: el baseline es qualified_at para AMBOS
    grupos, no el envío, que solo ocurre en tratamiento)."""
    horizon = timedelta(days=window_days)
    stats = {"treatment": {"mature": 0, "returned": 0},
             "control": {"mature": 0, "returned": 0}}
    for grp, qat, first_return in rows:
        if grp not in stats or qat is None:
            continue
        if qat + horizon > now:          # ventana sin cerrar → inmaduro
            continue
        stats[grp]["mature"] += 1
        if first_return is not None and first_return <= qat + horizon:
            stats[grp]["returned"] += 1

    def pct(s):
        return round(s["returned"] / s["mature"], 4) if s["mature"] else None

    tp, cp = pct(stats["treatment"]), pct(stats["control"])
    lift = round(tp - cp, 4) if (tp is not None and cp is not None) else None
    return {
        "window_days": window_days,
        "treatment": {**stats["treatment"], "pct": tp},
        "control": {**stats["control"], "pct": cp},
        "lift": lift,   # > 0 = el mensaje ayuda; null = alguna rama sin maduros
    }


async def _last_sent_map(db: AsyncSession, club_id: int) -> dict:
    """Última fecha de REENGAGEMENT_SENT por jugador (para no re-spamear)."""
    rows = (await db.execute(text("""
        SELECT (meta->>'player_id')::int AS pid, MAX(created_at) AS last_sent
        FROM audit_logs
        WHERE club_id = :cid AND action = 'REENGAGEMENT_SENT'
          AND meta->>'player_id' IS NOT NULL
        GROUP BY 1
    """), {"cid": club_id})).all()
    return {r.pid: r.last_sent for r in rows}


@router.post("/reengagement/refresh")
async def reengagement_refresh(
    days: int = INACTIVE_DAYS,
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    """Incorpora al experimento a los inactivos nuevos (asigna grupo estable +
    baseline) y devuelve SOLO la lista del grupo tratamiento para contactar por
    WhatsApp. El control queda asignado pero NUNCA se devuelve → no se le manda
    nada. Muta (asigna grupos), por eso es POST."""
    if not (1 <= days <= 365):
        raise HTTPException(status_code=422, detail="days fuera de rango (1–365)")
    cutoff = datetime.utcnow() - timedelta(days=days)
    # Inactivos con teléfono: sin visita (última transacción) desde el corte.
    # visits = sesiones/torneos distintos, proxy no-monetario del valor del jugador.
    rows = (await db.execute(text("""
        SELECT p.id, p.name, p.phone,
               p.reengagement_group AS grp,
               MAX(t.timestamp) AS last_visit,
               COUNT(DISTINCT COALESCE(t.session_id::text, 'tour-' || t.tournament_id::text)) AS visits
        FROM players p
        JOIN transactions t ON t.player_id = p.id
        WHERE p.club_id = :cid AND p.phone IS NOT NULL AND p.phone <> ''
        GROUP BY p.id, p.name, p.phone, p.reengagement_group
        HAVING MAX(t.timestamp) < :cutoff
        ORDER BY visits DESC, MAX(t.timestamp) ASC
    """), {"cid": current_club.id, "cutoff": cutoff})).all()

    now = datetime.utcnow()
    counts = {"treatment": 0, "control": 0}
    treatment = []
    for r in rows:
        grp = r.grp
        if grp is None:
            grp = assign_reengagement_group(current_club.id, r.id)
            # Guard AND reengagement_group IS NULL: idempotente y a prueba de race.
            await db.execute(text("""
                UPDATE players SET reengagement_group = :g, reengagement_qualified_at = :q
                WHERE id = :pid AND club_id = :cid AND reengagement_group IS NULL
            """), {"g": grp, "q": now, "pid": r.id, "cid": current_club.id})
        counts[grp] = counts.get(grp, 0) + 1
        if grp == "treatment":
            treatment.append(r)
    await db.commit()

    last_sent = await _last_sent_map(db, current_club.id)
    items = [{
        "player_id": r.id,
        "name": r.name,
        "phone": r.phone,
        "visits": r.visits,
        "days_inactive": (now - r.last_visit).days if r.last_visit else None,
        "last_sent_at": (last_sent[r.id].isoformat() + "Z") if r.id in last_sent else None,
    } for r in treatment]

    return {
        "club_id": current_club.id,
        "inactive_days": days,
        "control_pct": CONTROL_PCT,
        "counts": {"treatment": counts.get("treatment", 0),
                   "control": counts.get("control", 0),
                   "total_qualified": counts.get("treatment", 0) + counts.get("control", 0)},
        "treatment": items,   # solo tratamiento; el control jamás se expone acá
    }


@router.post("/reengagement/{player_id}/sent")
async def reengagement_mark_sent(
    player_id: int,
    request: Request,
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    """Registra que el staff mandó el WhatsApp de reactivación a este jugador.
    Solo tratamiento: marcar un control rompería el experimento (400)."""
    player = (await db.execute(
        select(models.Player).where(
            models.Player.id == player_id,
            models.Player.club_id == current_club.id,
        )
    )).scalars().first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    if player.reengagement_group != "treatment":
        raise HTTPException(status_code=400,
                            detail="Solo se registran envíos del grupo tratamiento")
    await log_standalone(
        db, club_id=current_club.id, actor_email=current_user.email,
        action=AuditAction.REENGAGEMENT_SENT, actor_type="USER", request=request,
        meta={"player_id": player_id},
    )
    return {"ok": True, "player_id": player_id}


@router.get("/reengagement/lift")
async def reengagement_lift(
    window: int = LIFT_WINDOW_DAYS,
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    """Lift del experimento: % de retorno tratamiento vs control entre los que
    calificaron. Señal lenta (N chico) — documentado; puede tardar semanas."""
    if not (1 <= window <= 365):
        raise HTTPException(status_code=422, detail="window fuera de rango (1–365)")
    rows = (await db.execute(text("""
        SELECT p.reengagement_group AS grp,
               p.reengagement_qualified_at AS qat,
               (SELECT MIN(t.timestamp) FROM transactions t
                WHERE t.player_id = p.id AND t.timestamp > p.reengagement_qualified_at) AS first_return
        FROM players p
        WHERE p.club_id = :cid AND p.reengagement_qualified_at IS NOT NULL
    """), {"cid": current_club.id})).all()

    now = datetime.utcnow()
    result = _compute_lift([(r.grp, r.qat, r.first_return) for r in rows], now, window)
    result["club_id"] = current_club.id
    result["generated_at"] = now.isoformat() + "Z"
    return result
