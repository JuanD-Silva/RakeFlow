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
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, player_stats
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

