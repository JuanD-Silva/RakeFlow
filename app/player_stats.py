# app/player_stats.py
"""Motor de estadísticas por jugador (Panel del Jugador) y fórmulas compartidas
con los rankings del staff.

ÚNICA fuente de verdad de:
- la inversión de torneo (singles = total − dobles, valuados a su precio)
- la fórmula de profit/spend de cash (CASHOUT+JACKPOT+BONUS − BUYIN−REBUY; SPEND+TIP aparte)
- las horas en mesa (primera entrada → última salida o cierre de sesión)
- los rankings mensuales (compute_monthly_rankings; /stats/rankings es un wrapper top-3)

Todos los helpers por jugador aceptan `since` (= Player.stats_since): el corte
de la venta del histórico. None = histórico completo. El corte va por fecha de
CIERRE (sesión/torneo): una sesión pertenece al panel si cerró después del corte.
"""
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
_EPOCH = datetime(2000, 1, 1)

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
            GREATEST(0, EXTRACT(EPOCH FROM (
                COALESCE(
                    MAX(CASE WHEN CAST(t.type AS TEXT) IN ('CASHOUT','BUST') THEN t.timestamp END),
                    s.end_time
                ) - MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END)
            )) / 3600) AS hours
        FROM transactions t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.club_id = :cid AND t.player_id = :pid
          AND s.status = 'CLOSED' AND s.end_time >= :since
        GROUP BY s.id, s.name, s.end_time
        HAVING MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) IS NOT NULL
        ORDER BY s.end_time
    """)
    rows = (await db.execute(sql, {"cid": club_id, "pid": player_id,
                                   "since": since or _EPOCH})).all()
    return [
        {
            "session_id": r.session_id,
            "name": r.name or f"Mesa #{r.session_id}",
            "date": r.end_time,
            "invested": float(r.invested or 0),
            "returned": float(r.returned or 0),
            "spend": float(r.spend or 0),
            "hours": float(r.hours or 0),
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
            models.Tournament.end_time >= (since or _EPOCH),
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
                                   "since": since or _EPOCH})).all()
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
