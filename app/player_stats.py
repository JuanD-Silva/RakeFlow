# app/player_stats.py
"""Motor de estadísticas por jugador (Panel del Jugador) y fórmulas compartidas
con los rankings del staff.

ÚNICA fuente de verdad de:
- la inversión de torneo (singles = total − dobles, valuados a su precio)
- la fórmula de profit/spend de cash (CASHOUT+JACKPOT+BONUS − BUYIN−REBUY; SPEND+TIP aparte)
- las horas en mesa (primera entrada → última salida o cierre de sesión)
- los rankings mensuales (compute_monthly_rankings; /stats/rankings es un wrapper top-3)

Todos los helpers por jugador aceptan `since` (= Player.stats_since): el corte
de la venta del histórico. None = histórico completo. Semántica del corte:
- PLATA (cash_rows / tournament_rows / archive): por fecha de CIERRE — una
  sesión pertenece al panel si cerró después del corte.
- VISITAS/RACHA (visit_weeks): por fecha de la actividad (timestamp de la
  entrada / start_time del torneo) — una visita ocurre cuando el jugador va.
"""
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from . import models

COL_TZ = ZoneInfo("America/Bogota")
UTC = ZoneInfo("UTC")

# Fecha "cero" para queries con corte opcional: si since es None se usa esto
# (todo el histórico). Evita duplicar cada SQL en variante con/sin filtro.
EPOCH = datetime(2000, 1, 1)

# Pesos de horas por posición en torneo (rankings "fieles"). Base 0.5 para
# todos (no se registra cada eliminación); el podio duró más.
TOURNEY_RANK_WEIGHTS = {1: 1.5, 2: 1.3, 3: 1.2}
TOURNEY_BASE_WEIGHT = 0.5

# Niveles por VISITAS (no por plata: premia frecuencia y no expone pérdidas)
LEVEL_TIERS = [("Bronce", 0), ("Plata", 10), ("Oro", 30), ("Diamante", 75)]


def start_of_month_col_as_utc() -> datetime:
    """Inicio del mes en hora Colombia, como UTC naive (las columnas se guardan
    con datetime.utcnow()). Ver comentario homólogo en stats.py."""
    col_now = datetime.now(COL_TZ)
    col_start = col_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return col_start.astimezone(UTC).replace(tzinfo=None)


def _col_week_monday(dt_utc_naive):
    """Lunes (date, hora Colombia) de la semana ISO a la que pertenece un
    timestamp naive-UTC. Mismo criterio de semana que visit_weeks."""
    col = dt_utc_naive.replace(tzinfo=UTC).astimezone(COL_TZ)
    return (col - timedelta(days=col.weekday())).date()


def _col_month_key(dt_utc_naive):
    """(año, mes) en hora Colombia de un timestamp naive-UTC."""
    col = dt_utc_naive.replace(tzinfo=UTC).astimezone(COL_TZ)
    return (col.year, col.month)


def start_of_week_col_as_utc(today=None) -> datetime:
    """Inicio (lunes 00:00 hora Colombia) de la semana ISO en curso, como UTC
    naive. Mismo criterio de semana que visit_weeks / self_compare_stats."""
    col_now = today or datetime.now(COL_TZ)
    monday = (col_now - timedelta(days=col_now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return monday.astimezone(UTC).replace(tzinfo=None)


def col_date_of(dt_utc_naive):
    """Fecha calendario (date) en hora Colombia de un timestamp naive-UTC."""
    return dt_utc_naive.replace(tzinfo=UTC).astimezone(COL_TZ).date()


def should_log_panel_open(last_seen_at, now_utc=None) -> bool:
    """Throttle del evento PANEL_OPEN: True si la apertura de HOY (día Colombia)
    aún no se registró. Máx 1 evento por jugador por día → audit_logs no crece
    por cada request de my-profile, y basta para medir retención a nivel de día."""
    now = now_utc or datetime.utcnow()
    if last_seen_at is None:
        return True
    return col_date_of(last_seen_at) < col_date_of(now)


def self_compare_stats(cash_rows: list[dict], tour_rows: list[dict], today=None) -> dict:
    """Comparación contra uno mismo (goal-gradient + "vs tu promedio"). Todo
    sobre las filas ya cortadas por `since`. Horas = solo cash (única fuente).
    - week_hours: horas de la semana ISO en curso (Colombia).
    - best_week_hours: máximo de horas en una sola semana (récord = meta de la barra).
    - avg_week_hours: promedio de horas por semana ACTIVA (con horas > 0).
    - avg_month_visits: promedio de visitas por mes ACTIVO."""
    col_now = today or datetime.now(COL_TZ)
    this_week = (col_now - timedelta(days=col_now.weekday())).date()

    week_hours: dict = {}
    for r in cash_rows:
        if not r["date"] or not r["hours"]:
            continue
        wk = _col_week_monday(r["date"])
        week_hours[wk] = week_hours.get(wk, 0.0) + r["hours"]
    active = [h for h in week_hours.values() if h > 0]

    month_visits: dict = {}
    for r in cash_rows:
        if r.get("played", True) and r["date"]:
            key = _col_month_key(r["date"])
            month_visits[key] = month_visits.get(key, 0) + 1
    for r in tour_rows:
        if r["date"]:
            key = _col_month_key(r["date"])
            month_visits[key] = month_visits.get(key, 0) + 1

    return {
        "week_hours": round(week_hours.get(this_week, 0.0), 1),
        "best_week_hours": round(max(active), 1) if active else 0.0,
        "avg_week_hours": round(sum(active) / len(active), 1) if active else 0.0,
        "avg_month_visits": round(sum(month_visits.values()) / len(month_visits), 1) if month_visits else 0.0,
    }


def tournament_investment(t: models.Tournament, p: models.TournamentPlayer) -> float:
    """Inversión total del jugador en un torneo. rebuys_count/addons_count son
    TOTALES (singles + dobles): singles = total − dobles, cada uno a su precio.
    Incluye tips (misma definición que usan los rankings desde siempre)."""
    single_rebuys = max(0, (p.rebuys_count or 0) - (p.double_rebuys_count or 0))
    single_addons = max(0, (p.addons_count or 0) - (p.double_addons_count or 0))
    return t.buyin_amount + \
        ((p.tips_count or 0) * (t.dealer_tip_amount or 0)) + \
        single_rebuys * t.rebuy_price + \
        (p.double_rebuys_count or 0) * t.double_rebuy_price + \
        single_addons * t.addon_price + \
        (p.double_addons_count or 0) * t.double_addon_price


# ---------------------------------------------------------
# Rankings mensuales del club (extraído tal cual de stats.get_rankings;
# el endpoint queda como wrapper top-3). NO cambiar fórmulas sin gate de
# comparación JSON pre/post.
# ---------------------------------------------------------
async def compute_monthly_rankings(
    db: AsyncSession,
    club: models.Club,
    year: int | None = None,
    month: int | None = None,
):
    """Devuelve (winners_map, spenders_map, active_map, names_map, period_dict)
    con TODOS los jugadores del club en el período (no solo el top 3)."""
    now = datetime.utcnow()
    if year and month:
        # Mes historico explicito
        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1)
        else:
            end_date = datetime(year, month + 1, 1)
        is_current_month = (year == now.year and month == now.month)
    else:
        # Mes en curso (default): respeta rankings_reset_at del club.
        # Mes en hora Colombia para coincidir con la UI del cliente.
        start_date = start_of_month_col_as_utc()
        if club.rankings_reset_at and club.rankings_reset_at > start_date:
            start_date = club.rankings_reset_at
        end_date = now
        is_current_month = True

    winners_map = {}
    spenders_map = {}
    active_map = {}
    names_map = {}

    # A.1 Profit y Spend de cash (SQL agrupado)
    sql_cash_stats = text("""
        SELECT p.id, p.name,
            SUM(CASE
                WHEN t.type IN ('CASHOUT', 'JACKPOT_PAYOUT', 'BONUS') THEN t.amount
                WHEN t.type IN ('BUYIN', 'REBUY') THEN -t.amount
                ELSE 0
            END) as profit,
            SUM(CASE
                WHEN t.type IN ('SPEND', 'TIP') THEN t.amount
                ELSE 0
            END) as spend
        FROM players p
        JOIN transactions t ON p.id = t.player_id
        JOIN sessions s ON t.session_id = s.id
        WHERE p.club_id = :cid
          AND s.end_time >= :start_date
          AND s.end_time < :end_date
          AND s.status = 'CLOSED'
        GROUP BY p.id, p.name
    """)
    rows_stats = (await db.execute(
        sql_cash_stats, {"cid": club.id, "start_date": start_date, "end_date": end_date})).all()
    for r in rows_stats:
        names_map[r.id] = r.name
        if r.profit > 0: winners_map[r.id] = winners_map.get(r.id, 0) + r.profit
        if r.spend > 0: spenders_map[r.id] = spenders_map.get(r.id, 0) + r.spend

    # A.2 Tiempo en mesa: primera entrada -> última salida (o cierre de sesión)
    sql_cash_time = text("""
        SELECT
            t.player_id,
            EXTRACT(EPOCH FROM (
                COALESCE(
                    MAX(CASE WHEN CAST(t.type AS TEXT) IN ('CASHOUT', 'BUST') THEN t.timestamp END),
                    s.end_time
                ) - MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN', 'REBUY') THEN t.timestamp END)
            )) / 3600 AS hours
        FROM transactions t
        JOIN sessions s ON t.session_id = s.id
        WHERE s.club_id = :cid
          AND s.end_time >= :start_date
          AND s.end_time < :end_date
          AND s.status = 'CLOSED'
          AND t.player_id IS NOT NULL
        GROUP BY t.player_id, s.id, s.end_time
        HAVING MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN', 'REBUY') THEN t.timestamp END) IS NOT NULL
    """)
    rows_time = (await db.execute(
        sql_cash_time, {"cid": club.id, "start_date": start_date, "end_date": end_date})).all()
    for r in rows_time:
        pid = r[0]
        hours = float(r[1]) if r[1] else 0.0
        if hours < 0:
            hours = 0.0
        active_map[pid] = active_map.get(pid, 0.0) + hours

    # B. Torneos COMPLETED del período
    q_tourneys = await db.execute(
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(
            models.Tournament.club_id == club.id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= start_date,
            models.Tournament.end_time < end_date,
        )
    )
    tournaments = q_tourneys.scalars().all()

    # Precargar nombres de jugadores que solo juegan torneos (evita N+1 queries)
    tourney_player_ids = {p.player_id for t in tournaments for p in t.players if p.player_id not in names_map}
    if tourney_player_ids:
        names_result = await db.execute(
            select(models.Player.id, models.Player.name).where(models.Player.id.in_(tourney_player_ids))
        )
        for row in names_result.all():
            names_map[row.id] = row.name

    for t in tournaments:
        tourney_duration = 0.0
        if t.start_time and t.end_time:
            tourney_duration = (t.end_time - t.start_time).total_seconds() / 3600

        for p in t.players:
            pid = p.player_id
            net = (p.prize_collected or 0) - tournament_investment(t, p)
            if net > 0:
                winners_map[pid] = winners_map.get(pid, 0) + net
            weight = TOURNEY_RANK_WEIGHTS.get(p.rank, TOURNEY_BASE_WEIGHT)
            active_map[pid] = active_map.get(pid, 0.0) + tourney_duration * weight

    period = {
        "year": start_date.year,
        "month": start_date.month,
        "is_current_month": is_current_month,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }
    return winners_map, spenders_map, active_map, names_map, period


# ---------------------------------------------------------
# Destaque del jugador (peak positivo NO-monetario para el que pierde)
# ---------------------------------------------------------
HIGHLIGHT_LABELS = {
    "hours": "en horas jugadas",
    "visits": "en visitas al club",
    "constancy": "en constancia",
}

# Cache por club del standings histórico: es idéntico para todos los jugadores y
# cambia lento, pero /player/my-highlight lo pediría en cada apertura y en cada
# vuelta a la pestaña Inicio (remonta). TTL corto → se reagrega el club a lo sumo
# una vez cada _STANDINGS_TTL_S, no por request. Por-worker (aceptable).
_STANDINGS_CACHE: dict[int, tuple[float, dict]] = {}
_STANDINGS_TTL_S = 300


async def compute_club_standings(db: AsyncSession, club_id: int) -> dict:
    """Standings HISTÓRICOS del club por jugador: {hours, visits, constancy} →
    {player_id: valor}. Base del 'destaque' del panel. Sin corte por stats_since:
    la posición en el club es la real (mismo criterio que los rankings).
    Cacheado por club con TTL corto (ver _STANDINGS_CACHE)."""
    cached = _STANDINGS_CACHE.get(club_id)
    if cached is not None and (time.monotonic() - cached[0]) < _STANDINGS_TTL_S:
        return cached[1]

    hours_map: dict[int, float] = {}
    visits_map: dict[int, int] = {}
    constancy_map: dict[int, int] = {}

    # Horas en mesa + visitas cash (una fila por sesión, sumadas por jugador).
    cash = (await db.execute(text("""
        WITH per_session AS (
          SELECT t.player_id AS pid,
            GREATEST(0, EXTRACT(EPOCH FROM (
              COALESCE(MAX(CASE WHEN CAST(t.type AS TEXT) IN ('CASHOUT','BUST') THEN t.timestamp END), s.end_time)
              - MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END)
            )) / 3600) AS hours
          FROM transactions t JOIN sessions s ON t.session_id = s.id
          WHERE s.club_id = :cid AND s.status = 'CLOSED' AND t.player_id IS NOT NULL
          GROUP BY t.player_id, s.id, s.end_time
          HAVING MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) IS NOT NULL
        )
        SELECT pid, SUM(hours) AS hours, COUNT(*) AS visits FROM per_session GROUP BY pid
    """), {"cid": club_id})).all()
    for r in cash:
        hours_map[r.pid] = float(r.hours or 0)
        visits_map[r.pid] = int(r.visits or 0)

    # Visitas de torneo (torneos jugados distintos) → se suman a las cash.
    tour = (await db.execute(text("""
        SELECT tp.player_id AS pid, COUNT(DISTINCT tp.tournament_id) AS n
        FROM tournament_players tp JOIN tournaments t ON t.id = tp.tournament_id
        WHERE t.club_id = :cid AND tp.player_id IS NOT NULL
        GROUP BY tp.player_id
    """), {"cid": club_id})).all()
    for r in tour:
        visits_map[r.pid] = visits_map.get(r.pid, 0) + int(r.n or 0)

    # Constancia: semanas ISO (hora Colombia) distintas con entrada cash.
    # OJO timezone (mismo criterio que visit_weeks): t.timestamp es naive-UTC, así
    # que hay que interpretarlo como UTC y RECIÉN convertir a Bogotá — un solo
    # `AT TIME ZONE 'America/Bogota'` lo trataría como si ya fuera hora local y
    # correría de semana a las partidas de domingo por la noche.
    weeks = (await db.execute(text("""
        SELECT player_id AS pid, COUNT(DISTINCT wk) AS weeks FROM (
          SELECT t.player_id,
                 date_trunc('week', ((t.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')) AS wk
          FROM transactions t JOIN sessions s ON s.id = t.session_id
          WHERE s.club_id = :cid AND CAST(t.type AS TEXT) IN ('BUYIN','REBUY')
                AND t.player_id IS NOT NULL
        ) x GROUP BY player_id
    """), {"cid": club_id})).all()
    for r in weeks:
        constancy_map[r.pid] = int(r.weeks or 0)

    result = {"hours": hours_map, "visits": visits_map, "constancy": constancy_map}
    _STANDINGS_CACHE[club_id] = (time.monotonic(), result)
    return result


def best_highlight(standings: dict, player_id: int, threshold_pct: int = 33,
                   min_total: int = 8) -> dict | None:
    """El mejor 'Top X%' del jugador entre las métricas no-monetarias, o None si
    en ninguna llega al tercio superior. Es un 'estado ganador' HONESTO (percentil
    real, solo su posición — nunca nombres/valores de otros) para el que no tiene
    profit que lucir. Nunca inventa un top falso: si es flojo en todas → None y el
    panel cae al reencuadre existente (racha/nivel/mejor-noche)."""
    best = None
    for metric in ("hours", "visits", "constancy"):
        m = standings.get(metric, {})
        val = m.get(player_id, 0)
        if not val or val <= 0:
            continue
        values = [v for v in m.values() if v and v > 0]
        total = len(values)
        if total < min_total:
            continue
        rank = 1 + sum(1 for v in values if v > val)   # competition ranking
        pct = max(1, -(-rank * 100 // total))          # ceil(rank/total*100)
        if pct > threshold_pct:
            continue
        cand = {"metric": metric, "rank": rank, "total": total, "pct": pct,
                "label": f"Top {pct}% {HIGHLIGHT_LABELS[metric]}"}
        if best is None or pct < best["pct"] or (pct == best["pct"] and rank < best["rank"]):
            best = cand
    return best


# ---------------------------------------------------------
# Helpers POR JUGADOR (todos con corte `since` = Player.stats_since)
# ---------------------------------------------------------
async def cash_rows_for_player(db: AsyncSession, club_id: int, player_id: int,
                               since: datetime | None = None) -> list[dict]:
    """Una fila por sesión cash CLOSED del jugador: invertido, retornado, gasto
    y horas en mesa (misma semántica que los rankings)."""
    sql = text("""
        SELECT s.id AS session_id, s.name, s.end_time,
            SUM(CASE WHEN t.type IN ('BUYIN','REBUY') THEN t.amount ELSE 0 END) AS invested,
            SUM(CASE WHEN t.type IN ('CASHOUT','JACKPOT_PAYOUT','BONUS') THEN t.amount ELSE 0 END) AS returned,
            SUM(CASE WHEN t.type IN ('SPEND','TIP') THEN t.amount ELSE 0 END) AS spend,
            -- Horas solo si hubo entrada (BUYIN/REBUY). Sin HAVING: una sesión
            -- con solo cashout/jackpot/consumo (corrección de staff) igual debe
            -- mostrar su plata en el panel — los rankings del staff la cuentan.
            CASE WHEN MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) IS NULL
                 THEN 0
                 ELSE GREATEST(0, EXTRACT(EPOCH FROM (
                    COALESCE(
                        MAX(CASE WHEN CAST(t.type AS TEXT) IN ('CASHOUT','BUST') THEN t.timestamp END),
                        s.end_time
                    ) - MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END)
                 )) / 3600)
            END AS hours,
            BOOL_OR(t.type IN ('BUYIN','REBUY')) AS played
        FROM transactions t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.club_id = :cid AND t.player_id = :pid
          AND s.status = 'CLOSED' AND s.end_time >= :since
        GROUP BY s.id, s.name, s.end_time
        ORDER BY s.end_time
    """)
    rows = (await db.execute(sql, {"cid": club_id, "pid": player_id,
                                   "since": since or EPOCH})).all()
    return [
        {
            "session_id": r.session_id,
            "name": r.name or f"Mesa #{r.session_id}",
            "date": r.end_time,
            "invested": float(r.invested or 0),
            "returned": float(r.returned or 0),
            "spend": float(r.spend or 0),
            "hours": float(r.hours or 0),
            # played=False: fila solo-corrección (sin entrada) — cuenta la plata
            # pero NO cuenta como visita/sesión jugada.
            "played": bool(r.played),
        }
        for r in rows
    ]


async def tournament_rows_for_player(db: AsyncSession, club_id: int, player_id: int,
                                     since: datetime | None = None) -> list[dict]:
    """Una fila por torneo COMPLETED del jugador: inversión, premio, rank."""
    q = await db.execute(
        select(models.Tournament, models.TournamentPlayer)
        .join(models.TournamentPlayer, models.TournamentPlayer.tournament_id == models.Tournament.id)
        .where(
            models.Tournament.club_id == club_id,
            models.TournamentPlayer.player_id == player_id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= (since or EPOCH),
        )
        .order_by(models.Tournament.end_time)
    )
    out = []
    for t, p in q.all():
        out.append({
            "tournament_id": t.id,
            "name": t.name,
            "date": t.end_time,
            "invested": float(tournament_investment(t, p)),
            "returned": float(p.prize_collected or 0),
            "rank": p.rank if (p.rank or 0) > 0 else None,
        })
    return out


def best_session_of(cash_rows: list[dict], tour_rows: list[dict]) -> dict | None:
    """La "mejor noche": fila (cash o torneo) de mayor profit (returned − invested).
    None si no hay filas. Fuente única — la usan my-profile y monthly-summary."""
    rows = cash_rows + tour_rows
    if not rows:
        return None
    b = max(rows, key=lambda r: r["returned"] - r["invested"])
    return {"name": b["name"], "profit": b["returned"] - b["invested"],
            "date": b["date"].isoformat() if b["date"] else None}


async def visit_weeks(db: AsyncSession, club_id: int, player_id: int,
                      since: datetime | None = None) -> list:
    """Semanas ISO (lunes, hora Colombia) con ≥1 visita: BUYIN/REBUY en cash
    (incluye sesiones OPEN: una visita es una visita) o torneo jugado.
    OJO timezone: las columnas son UTC naive → (ts AT TIME ZONE 'UTC') AT TIME
    ZONE 'America/Bogota' (interpretar-como-Bogotá directo corre el día)."""
    sql = text("""
        SELECT DISTINCT date_trunc('week',
            ((t.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'))::date AS w
        FROM transactions t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.club_id = :cid AND t.player_id = :pid
          AND t.type IN ('BUYIN','REBUY') AND t.timestamp >= :since
        UNION
        SELECT DISTINCT date_trunc('week',
            ((tor.start_time AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota'))::date
        FROM tournament_players tp
        JOIN tournaments tor ON tor.id = tp.tournament_id
        WHERE tor.club_id = :cid AND tp.player_id = :pid AND tor.start_time >= :since
        ORDER BY 1
    """)
    rows = (await db.execute(sql, {"cid": club_id, "pid": player_id,
                                   "since": since or EPOCH})).all()
    return [r[0] for r in rows]


def compute_streak(weeks: list, today=None) -> dict:
    """Racha de semanas ISO consecutivas con visita, contando hacia atrás.
    Semana actual vacía + anterior con visita = racha vigente en riesgo."""
    today = today or datetime.now(COL_TZ).date()
    this_week = today - timedelta(days=today.weekday())
    wset = set(weeks)
    at_risk = this_week not in wset
    w = this_week - timedelta(days=7) if at_risk else this_week
    streak = 0
    while w in wset:
        streak += 1
        w -= timedelta(days=7)
    last = max(wset) if wset else None
    days_since = None
    if last is not None:
        days_since = max(0, (today - last).days)  # aprox: semana de la última visita
    return {"weeks": streak, "at_risk": bool(at_risk and streak), "days_since_last_visit": days_since}


def compute_level(visits: int) -> dict:
    """Nivel por visitas con progreso hacia el siguiente."""
    name, floor = LEVEL_TIERS[0]
    for n, f in LEVEL_TIERS:
        if visits >= f:
            name, floor = n, f
    nxt = next(((n, f) for n, f in LEVEL_TIERS if f > visits), None)
    progress = 100.0
    if nxt:
        progress = round(100 * (visits - floor) / (nxt[1] - floor), 1)
    return {
        "tier": name,
        "visits": visits,
        "next_tier": nxt[0] if nxt else None,
        "next_tier_at": nxt[1] if nxt else None,
        "progress_pct": progress,
    }


async def archive_counts(db: AsyncSession, club_id: int, player_id: int,
                         before: datetime) -> dict:
    """Cuánto hay en el archivo ANTERIOR al corte — SOLO conteos, jamás montos
    (es el gancho de venta del histórico)."""
    sql = text("""
        SELECT
          (SELECT COUNT(DISTINCT s.id) FROM transactions t
             JOIN sessions s ON s.id = t.session_id
            WHERE s.club_id = :cid AND t.player_id = :pid AND s.status = 'CLOSED'
              AND s.end_time < :before AND t.type IN ('BUYIN','REBUY')) AS sessions,
          (SELECT COUNT(*) FROM tournament_players tp
             JOIN tournaments tor ON tor.id = tp.tournament_id
            WHERE tor.club_id = :cid AND tp.player_id = :pid
              AND tor.status = 'COMPLETED' AND tor.end_time < :before) AS tournaments,
          (SELECT MIN(t.timestamp) FROM transactions t
             JOIN sessions s ON s.id = t.session_id
            WHERE s.club_id = :cid AND t.player_id = :pid) AS oldest
    """)
    r = (await db.execute(sql, {"cid": club_id, "pid": player_id, "before": before})).first()
    return {
        "sessions": r.sessions or 0,
        "tournaments": r.tournaments or 0,
        "oldest": r.oldest.isoformat() if r.oldest else None,
    }


# Badges v1: (key, nombre, emoji, descripción). Todos computables con
# cash_rows + tournament_rows + weeks — sin queries extra.
BADGES = [
    ("debut", "Debut", "🃏", "Tu primera visita al club"),
    ("first_win", "Primera sangre", "🩸", "Una sesión o torneo con ganancia"),
    ("ten_visits", "Habitué", "🍺", "10 visitas"),
    ("fifty_visits", "Regular de la casa", "🎖️", "50 visitas"),
    ("hundred_visits", "Leyenda del club", "👑", "100 visitas"),
    ("first_podium", "Primer podio", "🥉", "Top 3 en un torneo"),
    ("champion", "Campeón", "🏆", "Ganaste un torneo"),
    ("marathon", "Maratonista", "🏃", "Una sesión de 8+ horas en mesa"),
    ("hot_streak", "Racha caliente", "🔥", "4 semanas seguidas viniendo"),
    ("iron_streak", "Inoxidable", "🛡️", "12 semanas seguidas viniendo"),
    ("triple_up", "Multiplicador ×3", "🚀", "Triplicaste tu plata en una sesión"),
    ("jackpot", "Jackpotero", "🎰", "Cobraste un jackpot"),
]


def compute_badges(cash_rows: list[dict], tour_rows: list[dict], streak_weeks_max: int,
                   jackpot_count: int) -> list[dict]:
    """Evalúa los 12 badges. streak_weeks_max = racha MÁS LARGA histórica del
    período visible (no solo la vigente)."""
    visits = len(cash_rows) + len(tour_rows)
    session_profits = [r["returned"] - r["invested"] for r in cash_rows] + \
                      [r["returned"] - r["invested"] for r in tour_rows]
    best_mult = max((r["returned"] / r["invested"] for r in cash_rows if r["invested"] > 0), default=0)
    max_hours = max((r["hours"] for r in cash_rows), default=0)
    podiums = [r for r in tour_rows if r["rank"] and r["rank"] <= 3]
    wins = [r for r in tour_rows if r["rank"] == 1]

    conditions = {
        "debut": (visits >= 1, min(visits, 1), 1),
        "first_win": (any(p > 0 for p in session_profits), int(any(p > 0 for p in session_profits)), 1),
        "ten_visits": (visits >= 10, min(visits, 10), 10),
        "fifty_visits": (visits >= 50, min(visits, 50), 50),
        "hundred_visits": (visits >= 100, min(visits, 100), 100),
        "first_podium": (len(podiums) >= 1, min(len(podiums), 1), 1),
        "champion": (len(wins) >= 1, min(len(wins), 1), 1),
        "marathon": (max_hours >= 8, round(min(max_hours, 8), 1), 8),
        "hot_streak": (streak_weeks_max >= 4, min(streak_weeks_max, 4), 4),
        "iron_streak": (streak_weeks_max >= 12, min(streak_weeks_max, 12), 12),
        "triple_up": (best_mult >= 3, round(min(best_mult, 3), 2), 3),
        "jackpot": (jackpot_count >= 1, min(jackpot_count, 1), 1),
    }
    out = []
    for key, name, emoji, desc in BADGES:
        achieved, current, target = conditions[key]
        out.append({"key": key, "name": name, "emoji": emoji, "description": desc,
                    "achieved": bool(achieved),
                    "progress": {"current": current, "target": target}})
    return out


def longest_streak(weeks: list) -> int:
    """Racha más larga de semanas consecutivas en el histórico visible."""
    if not weeks:
        return 0
    ws = sorted(set(weeks))
    best = cur = 1
    for a, b in zip(ws, ws[1:]):
        cur = cur + 1 if (b - a).days == 7 else 1
        best = max(best, cur)
    return best
