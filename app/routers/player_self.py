# app/routers/player_self.py
"""Panel del Jugador: endpoints self-service del rol PLAYER (patrón dealer_self).

El jugador SOLO ve lo suyo: sus sesiones, su plata, sus logros, su posición.
Jamás: rake del club, distribución, ni montos/nombres de otros jugadores.
Todas las respuestas son dicts armados a mano (nunca serializar Session/Club).

Corte del histórico: todo se calcula desde Player.stats_since (None = todo;
ver player_stats). La posición en rankings NO se corta: es el ranking real del
mes del club, igual para todos.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, player_stats
from ..dependencies import get_db, get_current_user, require_role

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
           "since": since or player_stats._EPOCH})).scalar() or 0


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
        "cash_sessions": len(cash_rows),
        "tournaments": len(tour_rows),
        "visits": len(cash_rows) + len(tour_rows),
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


@router.get("/my-profile")
async def my_profile(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    player = await _my_player(db, user)
    since = player.stats_since
    cash_rows = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_rows = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)

    totals = _totals(cash_rows, tour_rows)
    streak = player_stats.compute_streak(weeks)
    level = player_stats.compute_level(totals["visits"])

    # Resumen del mes en curso (hora Colombia), sobre las filas ya cortadas
    month_start = player_stats.start_of_month_col_as_utc()
    m_cash = [r for r in cash_rows if r["date"] and r["date"] >= month_start]
    m_tour = [r for r in tour_rows if r["date"] and r["date"] >= month_start]
    m = _totals(m_cash, m_tour)

    out = {
        "player_name": player.name,
        "totals": totals,
        "level": level,
        "streak": streak,
        "month": {"invested": m["invested"], "returned": m["returned"],
                  "profit": m["profit"], "visits": m["visits"]},
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
    cum, curve = 0.0, []
    for it in sorted(items, key=lambda x: x["date"] or ""):
        cum += it["profit"]
        curve.append(round(cum))
    return {"items": page, "total": len(items), "has_more": skip + limit < len(items),
            "profit_curve": curve}


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
    visits = len(cash_rows) + len(tour_rows)
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
    await _my_player(db, user)
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
    return {
        "club_name": club.name,
        "announcement": club.public_announcement,
        "scheduled": [
            {"name": t.name,
             "scheduled_start": t.scheduled_start.isoformat() if t.scheduled_start else None,
             "buyin": t.buyin_amount}
            for t in scheduled
        ],
    }


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
    # El corte de la venta manda: no mostrar meses anteriores a stats_since
    if since and since > start:
        start = since

    cash_all = await player_stats.cash_rows_for_player(db, user.club_id, player.id, since)
    tour_all = await player_stats.tournament_rows_for_player(db, user.club_id, player.id, since)
    cash_rows = [r for r in cash_all if r["date"] and start <= r["date"] < end]
    tour_rows = [r for r in tour_all if r["date"] and start <= r["date"] < end]
    t = _totals(cash_rows, tour_rows)

    best = None
    rows = cash_rows + tour_rows
    if rows:
        b = max(rows, key=lambda r: r["returned"] - r["invested"])
        best = {"name": b["name"], "profit": b["returned"] - b["invested"],
                "date": b["date"].isoformat() if b["date"] else None}

    weeks = await player_stats.visit_weeks(db, user.club_id, player.id, since)
    streak = player_stats.compute_streak(weeks)
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()

    return {
        "player_name": player.name,
        "club_name": club.name,
        "period": {"year": start.year, "month": start.month},
        "visits": t["visits"],
        "hours": t["hours"],
        "invested": t["invested"],
        "returned": t["returned"],
        "profit": t["profit"],
        "best_session": best,
        "streak_weeks": streak["weeks"],
        "level": player_stats.compute_level(len(cash_all) + len(tour_all))["tier"],
    }
