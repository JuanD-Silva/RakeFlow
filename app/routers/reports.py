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


@router.get("/adoption")
async def adoption(
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    """Embudo de adopción del panel del jugador (solo este club).

    Mide el paso del universo del club al panel: del CRM (todos los jugadores
    registrados), a los que juegan hoy (base activa real, vía transacciones de
    sesiones cash del club), a los que tienen cuenta de panel y lo abren.

    La conversión que importa es `activos_30d → activos_30d_con_panel`: ahí está
    la fuga (jul-2026 en Mambo eran 4 de 71 = 6%). La actividad del panel se mide
    por jugadores (players con user_id) cuyo `last_seen_at` cae en la ventana —
    no por usuarios sueltos, para no contar staff que abre el panel de gestión.
    """
    row = (await db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM players WHERE club_id = :cid) AS crm_total,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.hashed_password IS NOT NULL) AS con_panel,
          (SELECT COUNT(DISTINCT t.player_id)
             FROM transactions t JOIN sessions s ON s.id = t.session_id
             WHERE s.club_id = :cid AND s.start_time >= now() - interval '7 days') AS activos_7d,
          (SELECT COUNT(DISTINCT t.player_id)
             FROM transactions t JOIN sessions s ON s.id = t.session_id
             WHERE s.club_id = :cid AND s.start_time >= now() - interval '30 days') AS activos_30d,
          (SELECT COUNT(DISTINCT t.player_id)
             FROM transactions t
             JOIN sessions s ON s.id = t.session_id
             JOIN players p ON p.id = t.player_id
             JOIN users u ON u.id = p.user_id
             WHERE s.club_id = :cid AND s.start_time >= now() - interval '30 days'
               AND p.club_id = :cid AND u.hashed_password IS NOT NULL) AS activos_30d_con_panel,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.last_seen_at IS NOT NULL) AS panel_abrieron,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.last_seen_at >= now() - interval '7 days') AS panel_activos_7d,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.last_seen_at >= now() - interval '30 days') AS panel_activos_30d
    """), {"cid": current_club.id})).one()

    now = datetime.utcnow()
    return {
        "crm_total": row.crm_total,
        "activos_7d": row.activos_7d,
        "activos_30d": row.activos_30d,
        "con_panel": row.con_panel,
        "activos_30d_con_panel": row.activos_30d_con_panel,
        "panel_abrieron": row.panel_abrieron,
        "panel_activos_7d": row.panel_activos_7d,
        "panel_activos_30d": row.panel_activos_30d,
        "club_id": current_club.id,
        "generated_at": now.isoformat() + "Z",
    }



# ---------------------------------------------------------------------------
# BI DE LA OPERACIÓN: una sola llamada con lo que el dueño mira para saber
# "cómo va el mes": pulso vs mes anterior, qué noches son oro, jugadores
# nuevos vs que vuelven, y (compacto) la app del jugador.
#
# Todo en fecha COLOMBIA (col_date_of): una mesa cerrada a las 11pm es de ESA
# noche. "Jugó" = buy-in/rebuy en mesa cash cerrada o inscripción en torneo
# completado (cash + torneo, como el KPI 'Jugadores del periodo').
# ---------------------------------------------------------------------------
from datetime import date, timedelta
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from .. import services


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _prev_month_start(d: date) -> date:
    return (d.replace(day=1) - timedelta(days=1)).replace(day=1)


def _add_months(d: date, n: int) -> date:
    y, m = d.year, d.month + n
    while m > 12: y, m = y + 1, m - 12
    while m < 1: y, m = y - 1, m + 12
    return date(y, m, 1)


def _pct_delta(cur, prev):
    if prev in (None, 0): return None
    return round((cur - prev) / abs(prev) * 100)


@router.get("/bi")
async def operation_bi(
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
    db: AsyncSession = Depends(get_db),
):
    cid = current_club.id
    now_utc = datetime.utcnow()
    hoy = player_stats.col_date_of(now_utc)
    mes_ini = _month_start(hoy)
    mes_prev_ini = _prev_month_start(hoy)
    dia_del_mes = hoy.day
    # Mismos N días del mes anterior (clamp al largo de ese mes).
    prev_len = (mes_ini - mes_prev_ini).days
    prev_fin = mes_prev_ini + timedelta(days=min(dia_del_mes, prev_len) - 1)
    hace_8_sem = hoy - timedelta(days=56)
    seis_meses_ini = _add_months(mes_ini, -5)
    desde = min(seis_meses_ini, hace_8_sem, mes_prev_ini) - timedelta(days=1)
    desde_utc = datetime.combine(desde, datetime.min.time())

    # ---- Noches: mesas cash cerradas + torneos completados (con jugadores) ----
    sesiones = (await db.execute(
        select(models.Session).where(
            models.Session.club_id == cid,
            models.Session.status == models.SessionStatus.CLOSED,
            models.Session.end_time >= desde_utc,
        )
    )).scalars().all()
    torneos = (await db.execute(
        select(models.Tournament).options(selectinload(models.Tournament.players)).where(
            models.Tournament.club_id == cid,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= desde_utc,
        )
    )).scalars().all()
    # Costo de dealers de torneo por fecha (turnos cerrados).
    t_shifts = (await db.execute(
        select(models.TournamentDealerShift).where(
            models.TournamentDealerShift.club_id == cid,
            models.TournamentDealerShift.end_time.isnot(None),
            models.TournamentDealerShift.end_time >= desde_utc,
        )
    )).scalars().all()

    # Por fecha Colombia: rake bruto, gastos, neto, #mesas, #torneos
    noches = defaultdict(lambda: {"bruto": 0.0, "gastos": 0.0, "cash": 0, "torneos": 0, "jugadores": set()})
    for s in sesiones:
        d = player_stats.col_date_of(s.end_time or s.start_time)
        n = noches[d]
        n["bruto"] += float(s.declared_rake_cash or 0)
        n["gastos"] += float((s.dealer_cost or 0) + (s.courtesy_cost or 0))
        n["cash"] += 1
    for t in torneos:
        d = player_stats.col_date_of(t.end_time or t.start_time)
        n = noches[d]
        n["bruto"] += services.tournament_rake_of(t)
        n["torneos"] += 1
        for p in t.players:
            if p.player_id: n["jugadores"].add(p.player_id)
    for sh in t_shifts:
        d = player_stats.col_date_of(sh.end_time)
        elapsed_min = max(0, int((sh.end_time - sh.start_time).total_seconds() // 60))
        bd = services.shift_payment_breakdown(round(elapsed_min / 60.0, 2), sh.tournament_hourly_rate_cop or 0, 0, None)
        noches[d]["gastos"] += float(bd["club_payment"])

    # ---- Actividad de jugadores (cash) por fecha + primera jugada histórica ----
    sess_ids = [s.id for s in sesiones]
    if sess_ids:
        rows = (await db.execute(text("""
            SELECT t.player_id, t.timestamp, t.session_id, t.amount, CAST(t.type AS TEXT) AS tp
            FROM transactions t
            WHERE t.session_id = ANY(:sids) AND t.player_id IS NOT NULL
              AND CAST(t.type AS TEXT) IN ('BUYIN','REBUY')
        """), {"sids": sess_ids})).all()
    else:
        rows = []
    sess_date = {s.id: player_stats.col_date_of(s.end_time or s.start_time) for s in sesiones}
    buyins = []
    for pid, ts, sid, amount, tp in rows:
        d = sess_date.get(sid)
        if d is None: continue
        noches[d]["jugadores"].add(pid)
        if tp == 'BUYIN': buyins.append((d, float(amount or 0)))
    # Jugadas por jugador y fecha (cash + torneo) para nuevos/vuelven
    jugadas = defaultdict(set)  # pid -> {date}
    for d, n in noches.items():
        for pid in n["jugadores"]:
            jugadas[pid].add(d)
    # Primera jugada HISTÓRICA por jugador (cash o torneo) — sin límite de fecha.
    first_rows = (await db.execute(text("""
        SELECT player_id, MIN(ts) FROM (
          SELECT t.player_id, s.end_time AS ts
            FROM transactions t JOIN sessions s ON s.id = t.session_id
           WHERE s.club_id = :cid AND s.status = 'CLOSED' AND t.player_id IS NOT NULL
             AND CAST(t.type AS TEXT) IN ('BUYIN','REBUY')
          UNION ALL
          SELECT tp.player_id, tr.end_time AS ts
            FROM tournament_players tp JOIN tournaments tr ON tr.id = tp.tournament_id
           WHERE tr.club_id = :cid AND tr.status = 'COMPLETED' AND tp.player_id IS NOT NULL
        ) x WHERE ts IS NOT NULL GROUP BY player_id
    """), {"cid": cid})).all()
    primera = {pid: player_stats.col_date_of(ts) for pid, ts in first_rows}

    # ---- 1. PULSO: mes en curso vs mismos días del mes anterior ----
    def resumen(ini: date, fin: date):
        ds = [d for d in noches if ini <= d <= fin]
        bruto = sum(noches[d]["bruto"] for d in ds)
        gastos = sum(noches[d]["gastos"] for d in ds)
        jug = set().union(*(noches[d]["jugadores"] for d in ds)) if ds else set()
        nb = [a for d, a in buyins if ini <= d <= fin]
        n_noches = len(ds)
        return {
            "rake_neto": round(bruto - gastos),
            "rake_bruto": round(bruto),
            "noches": n_noches,
            "jugadores": len(jug),
            "rake_por_noche": round((bruto - gastos) / n_noches) if n_noches else 0,
            "ticket": round(sum(nb) / len(nb)) if nb else 0,
        }
    actual = resumen(mes_ini, hoy)
    previo = resumen(mes_prev_ini, prev_fin)
    pulso = {k: {"actual": actual[k], "previo": previo[k], "delta_pct": _pct_delta(actual[k], previo[k])} for k in actual}

    # ---- 2. NOCHES DE ORO: últimas 8 semanas por día de la semana ----
    por_dia = {i: {"noches": 0, "rake": 0.0, "jugadores": 0} for i in range(7)}
    for d, n in noches.items():
        if hace_8_sem <= d <= hoy and (n["cash"] or n["torneos"]):
            w = por_dia[d.weekday()]
            w["noches"] += 1; w["rake"] += n["bruto"] - n["gastos"]; w["jugadores"] += len(n["jugadores"])
    dias_semana = [{
        "weekday": i,
        "noches": por_dia[i]["noches"],
        "rake_prom": round(por_dia[i]["rake"] / por_dia[i]["noches"]) if por_dia[i]["noches"] else 0,
        "jugadores_prom": round(por_dia[i]["jugadores"] / por_dia[i]["noches"], 1) if por_dia[i]["noches"] else 0,
    } for i in range(7)]

    # ---- 3. JUGADORES: nuevos vs vuelven, últimos 6 meses ----
    meses = []
    for k in range(5, -1, -1):
        m_ini = _add_months(mes_ini, -k)
        m_fin = _add_months(m_ini, 1) - timedelta(days=1)
        en_mes = {pid for pid, ds in jugadas.items() if any(m_ini <= d <= m_fin for d in ds)}
        nuevos = {pid for pid in en_mes if primera.get(pid) and m_ini <= primera[pid] <= m_fin}
        recurrentes = en_mes - nuevos
        # De los nuevos: ¿volvieron en los 30 días siguientes a su primera jugada?
        maduro = (m_fin + timedelta(days=30)) <= hoy
        volvieron = 0
        if nuevos:
            for pid in nuevos:
                f = primera[pid]
                if any(f < d <= f + timedelta(days=30) for d in jugadas[pid]):
                    volvieron += 1
        meses.append({
            "month": m_ini.isoformat()[:7],
            "nuevos": len(nuevos),
            "recurrentes": len(recurrentes),
            "volvieron_30d": volvieron if nuevos else 0,
            "volvieron_pct": round(volvieron / len(nuevos) * 100) if (nuevos and maduro) else None,
            "maduro": maduro,
        })

    # ---- 4. APP (compacto y honesto): embudo + retención al club con/sin panel ----
    ad = (await db.execute(text("""
        SELECT
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.hashed_password IS NULL) AS pendientes,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.hashed_password IS NOT NULL) AS activados,
          (SELECT COUNT(*) FROM players p JOIN users u ON u.id = p.user_id
             WHERE p.club_id = :cid AND u.hashed_password IS NOT NULL
               AND u.last_seen_at >= now() - interval '30 days') AS usan_30d
    """), {"cid": cid})).one()
    activados_ids = set((await db.execute(text("""
        SELECT p.id FROM players p JOIN users u ON u.id = p.user_id
        WHERE p.club_id = :cid AND u.hashed_password IS NOT NULL
    """), {"cid": cid})).scalars().all())
    # Cohorte: jugaron el mes pasado; ¿volvieron este mes? con panel vs sin panel.
    prev_fin_total = mes_ini - timedelta(days=1)
    cohorte = {pid for pid, ds in jugadas.items() if any(mes_prev_ini <= d <= prev_fin_total for d in ds)}
    volvio = {pid for pid in cohorte if any(mes_ini <= d <= hoy for d in jugadas[pid])}
    con = cohorte & activados_ids; sin = cohorte - activados_ids
    def tasa(grupo):
        return {"cohorte": len(grupo), "volvieron": len(grupo & volvio),
                "pct": round(len(grupo & volvio) / len(grupo) * 100) if grupo else None}
    activos_30d = len(set().union(*(noches[d]["jugadores"] for d in noches if hoy - timedelta(days=30) <= d <= hoy)) or set())
    activos_30d_con_panel = len({pid for d in noches if hoy - timedelta(days=30) <= d <= hoy for pid in noches[d]["jugadores"]} & activados_ids)

    return {
        "hoy": hoy.isoformat(),
        "mes": mes_ini.isoformat()[:7],
        "comparacion": {"dias": dia_del_mes, "mes_previo": mes_prev_ini.isoformat()[:7]},
        "pulso": pulso,
        "dias_semana": dias_semana,
        "meses": meses,
        "app": {
            "pendientes": ad.pendientes, "activados": ad.activados, "usan_30d": ad.usan_30d,
            "activos_30d": activos_30d, "activos_30d_con_panel": activos_30d_con_panel,
            "retencion": {"con_panel": tasa(con), "sin_panel": tasa(sin)},
        },
        "generated_at": now_utc.isoformat() + "Z",
    }
