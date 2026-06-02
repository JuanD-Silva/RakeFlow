from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, text, desc, or_
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
import logging

from .. import models, schemas, services
from ..dependencies import get_db, get_current_club, require_role

# Mambo y demas clubes operan en Colombia. Railway corre en UTC, asi que
# usar datetime.utcnow().replace(day=1) deja el "mes en curso" desfasado
# para el cliente entre 19:00 (Colombia) y 00:00 (UTC) del primer dia del mes
# siguiente: el server pasa al mes nuevo pero el cliente todavia ve el anterior.
_COL_TZ = ZoneInfo("America/Bogota")
_UTC = ZoneInfo("UTC")


def _start_of_month_col_as_utc() -> datetime:
    """Inicio del mes en hora Colombia, expresado como UTC naive para
    comparar con Session.end_time / Tournament.end_time (que se guardan
    con datetime.utcnow() — naive UTC)."""
    col_now = datetime.now(_COL_TZ)
    col_start = col_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return col_start.astimezone(_UTC).replace(tzinfo=None)

# Reportes financieros: solo dueno y encargado, no cashier
_REPORT_ROLES = [models.UserRole.OWNER, models.UserRole.MANAGER]

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/stats",
    tags=["Stats"] 
)

# --- FUNCIÓN AUXILIAR: Calcular Rake Neto (Cash + Torneos - Gastos) en un rango ---
async def _get_net_profit_in_range(db: AsyncSession, club_id: int, start: datetime, end: datetime) -> float:
    # 1. CASH
    stmt_cash = select(func.sum(models.Session.declared_rake_cash)).where(
        models.Session.club_id == club_id,
        models.Session.status == models.SessionStatus.CLOSED,
        models.Session.end_time >= start,
        models.Session.end_time <= end
    )
    cash = (await db.execute(stmt_cash)).scalar() or 0.0

    # 2. TORNEOS (misma funcion que usa el cierre de caja: una sola fuente de verdad)
    tourney = await services.tournament_rake_in_range(db, club_id, start, end)

    return (cash + int(tourney))

# ---------------------------------------------------------
# 1. DASHBOARD GENERAL (KPIs) 📊
# ---------------------------------------------------------
@router.get("/dashboard")
async def get_dashboard_stats(
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    try:
        now = datetime.utcnow()
        # Si el frontend pasa rango (sincronizado con WeeklyReport navegando),
        # usamos eso. Si no, default = mes en curso hora Colombia. Esto evita
        # el desfase entre el rango que el user esta viendo y los KPIs.
        if start_date and end_date:
            range_start = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
            range_end = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)
        else:
            range_start = _start_of_month_col_as_utc()
            range_end = now
        if current_club.rankings_reset_at and current_club.rankings_reset_at > range_start:
            range_start = current_club.rankings_reset_at

        # A. TOTAL SESIONES Y HORAS DEL RANGO (Cash + Torneos)
        stmt_cash = select(models.Session).where(
            models.Session.club_id == current_club.id,
            models.Session.status == "CLOSED",
            models.Session.end_time >= range_start,
            models.Session.end_time <= range_end,
        )
        cash_sessions = (await db.execute(stmt_cash)).scalars().all()
        cash_hours = sum(
            (s.end_time - s.start_time).total_seconds() / 3600
            for s in cash_sessions if s.end_time and s.start_time
        )

        stmt_tourney = select(models.Tournament).where(
            models.Tournament.club_id == current_club.id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= range_start,
            models.Tournament.end_time <= range_end,
        )
        tournaments = (await db.execute(stmt_tourney)).scalars().all()
        tourney_hours = sum(
            (t.end_time - t.start_time).total_seconds() / 3600
            for t in tournaments if t.start_time and t.end_time
        )

        total_sessions = len(cash_sessions) + len(tournaments)
        total_hours = cash_hours + tourney_hours

        # B. PROFIT DEL RANGO (cash + torneos)
        range_profit = await _get_net_profit_in_range(db, current_club.id, range_start, range_end)

        # C. META (la meta es mensual por definicion, asi que efficiency siempre
        # se calcula contra el MES del range_start, no contra el rango).
        stmt_meta = select(func.sum(models.DistributionRule.value)).where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True,
            or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED)
        )
        # Sin reglas FIXED/QUOTA activas no hay meta: devolvemos 0 para que el
        # frontend oculte la barra.
        monthly_goal = (await db.execute(stmt_meta)).scalar() or 0.0
        efficiency = (range_profit / monthly_goal * 100) if monthly_goal > 0 else 0

        # D. JACKPOT — historico (no filtra fecha, es saldo acumulado)
        stmt_jackpot_in = select(func.sum(models.Session.declared_jackpot_cash)).where(models.Session.club_id == current_club.id, models.Session.status == "CLOSED")
        jackpot_in = (await db.execute(stmt_jackpot_in)).scalar() or 0.0

        stmt_jackpot_out = select(func.sum(models.Transaction.amount)).join(models.Session).where(models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT, models.Session.club_id == current_club.id)
        jackpot_out = (await db.execute(stmt_jackpot_out)).scalar() or 0.0

        # E. BUY-IN PROMEDIO DEL RANGO = monto total / numero de entradas.
        stmt_avg_ticket = (
            select(
                func.coalesce(func.sum(models.Transaction.amount), 0).label("total_buyin"),
                func.count(models.Transaction.id).label("entries"),
            )
            .join(models.Session, models.Transaction.session_id == models.Session.id)
            .where(
                models.Session.club_id == current_club.id,
                models.Session.status == models.SessionStatus.CLOSED,
                models.Session.end_time >= range_start,
                models.Session.end_time <= range_end,
                models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]),
            )
        )
        row = (await db.execute(stmt_avg_ticket)).first()
        avg_ticket = int(row.total_buyin / row.entries) if (row and row.entries) else 0

        return {
            "avg_rake_hour": int(range_profit / total_hours) if total_hours > 0 else 0,
            "total_hours": round(total_hours, 1),
            "total_sessions": total_sessions,
            "avg_ticket": avg_ticket,
            "efficiency": round(efficiency, 1),
            "jackpot": int(jackpot_in - jackpot_out),
            "weekly_profit": 0
        }

    except Exception as e:
        logger.error("Error dashboard: %s", e)
        return {}

# ---------------------------------------------------------
# 2. DISTRIBUCIÓN SEMANAL (CASCADA: META -> SOCIOS) 🌊
# ---------------------------------------------------------
@router.get("/weekly-distribution")
async def get_weekly_distribution(
    start_date: str = None,
    end_date: str = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    try:
        # 1. Definir rango de fechas
        if not start_date or not end_date:
            today = datetime.now().date()
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
            start_dt = datetime.combine(start, time.min)
            end_dt = datetime.combine(end, time.max)
        else:
            start_dt = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
            end_dt = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)

        # 2. Profit de ESTA SEMANA
        net_profit_week = await _get_net_profit_in_range(db, current_club.id, start_dt, end_dt)

        # 3. Lógica de Cascada
        distribution = []
        remaining_pool = net_profit_week

        #  
        # PASO A: META MENSUAL (Prioridad 1)
        stmt_quota = select(models.DistributionRule).where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True,
            or_(
                models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA,
                models.DistributionRule.rule_type == models.RuleType.FIXED
            )
        ).order_by(models.DistributionRule.priority)
        
        quota_rule = (await db.execute(stmt_quota)).scalars().first()

        if quota_rule and remaining_pool > 0:
            target = quota_rule.value
            
            # Inicio del Mes
            month_start = start_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            # Calcular cuánto se generó ANTES de empezar esta semana
            if start_dt > month_start:
                prior_end = start_dt - timedelta(seconds=1)
                profit_prior = await _get_net_profit_in_range(db, current_club.id, month_start, prior_end)
            else:
                profit_prior = 0.0

            # ¿Cuánto de la meta ya estaba lleno?
            covered_before = min(max(0, profit_prior), target)
            
            # ¿Cuánto falta?
            gap = target - covered_before
            
            if gap > 0:
                payment = min(remaining_pool, gap)
                distribution.append({
                    "name": quota_rule.name or "Meta Mensual",
                    "total": int(payment),
                    "percent": 0 # Indicador visual
                })
                remaining_pool -= payment

        # PASO B: SOCIOS (Prioridad 2 - Si sobra dinero)
        if remaining_pool > 0:
            percent_rules = (await db.execute(select(models.DistributionRule).where(
                models.DistributionRule.club_id == current_club.id,
                models.DistributionRule.active == True,
                models.DistributionRule.rule_type == models.RuleType.PERCENTAGE
            ).order_by(models.DistributionRule.priority))).scalars().all()

            if percent_rules:
                for r in percent_rules:
                    amount = remaining_pool * (r.value / 100)
                    distribution.append({
                        "name": r.name,
                        "total": int(amount),
                        "percent": r.value
                    })
            else:
                distribution.append({"name": "Fondo Club", "total": int(remaining_pool), "percent": 100})

        return {
            "range": { "start": start_dt.strftime("%d %b"), "end": end_dt.strftime("%d %b") },
            "total_week": int(net_profit_week), # Esto es el Total Generado (Card 1)
            "distribution": distribution
        }

    except Exception as e:
        logger.error("Error weekly distribution: %s", e)
        return {"error": str(e)}

# ---------------------------------------------------------
# 4. META MENSUAL (BARRA DE PROGRESO)
# ---------------------------------------------------------
@router.get("/monthly-debt-quota")
async def get_monthly_debt_quota(
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    # Meta. Sin reglas configuradas el target queda en 0 y el frontend oculta la barra.
    stmt_rules = select(func.sum(models.DistributionRule.value)).where(models.DistributionRule.club_id == current_club.id, models.DistributionRule.active == True, or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED))
    target = (await db.execute(stmt_rules)).scalar() or 0.0

    # Pagado: por defecto mes en curso (hora Colombia). Si el frontend pasa rango
    # (sincronizado con WeeklyReport), usamos ese rango — asi la card "Rake del Mes"
    # se sincroniza con el periodo que el user esta viendo.
    now = datetime.utcnow()
    if start_date and end_date:
        range_start = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
        range_end = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)
    else:
        range_start = _start_of_month_col_as_utc()
        range_end = now

    current = await _get_net_profit_in_range(db, current_club.id, range_start, range_end)
    
    remaining = max(0.0, target - current)

    return {
        "target": target,
        "paid_so_far": int(current),
        "remaining": int(remaining),
        "is_completed": remaining == 0
    }

# ---------------------------------------------------------
# 5. RANKINGS (HALL OF FAME) 🏆
# ---------------------------------------------------------
@router.get("/rankings")
async def get_rankings(
    year: int | None = None,
    month: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """
    Rankings mensuales. Por default mes en curso.
    Si se pasan year y month, devuelve los rankings de ese mes especifico.
    """
    try:
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
            start_date = _start_of_month_col_as_utc()
            if current_club.rankings_reset_at and current_club.rankings_reset_at > start_date:
                start_date = current_club.rankings_reset_at
            end_date = now
            is_current_month = True

        # Mapas para acumular valores por ID de jugador
        winners_map = {}
        spenders_map = {}
        active_map = {} # 👈 Este faltaba calcular
        names_map = {}

        # ---------------------------------------------------------
        # A. PROCESAR CASH (Profit, Spend y TIEMPO)
        # ---------------------------------------------------------
        
        # 1. Profit y Spend (SQL agrupado)
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

        rows_stats = (await db.execute(sql_cash_stats, {"cid": current_club.id, "start_date": start_date, "end_date": end_date})).all()
        
        for r in rows_stats:
            names_map[r.id] = r.name
            if r.profit > 0: winners_map[r.id] = winners_map.get(r.id, 0) + r.profit
            if r.spend > 0: spenders_map[r.id] = spenders_map.get(r.id, 0) + r.spend

        # 2. TIEMPO EN MESA (Active) - Por jugador, por sesión.
        # Entrada = primer BUYIN/REBUY del jugador en la sesión.
        # Salida  = último CASHOUT o BUST del jugador; si no hubo, el cierre de sesión.
        # Un jugador que quebró (BUST sin cashout) o se fue no carga las horas restantes.
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

        rows_time = (await db.execute(sql_cash_time, {"cid": current_club.id, "start_date": start_date, "end_date": end_date})).all()

        for r in rows_time:
            pid = r[0]
            hours = float(r[1]) if r[1] else 0.0
            if hours < 0:
                hours = 0.0
            active_map[pid] = active_map.get(pid, 0.0) + hours

        # ---------------------------------------------------------
        # B. PROCESAR TORNEOS (Profit y TIEMPO)
        # ---------------------------------------------------------
        q_tourneys = await db.execute(
            select(models.Tournament)
            .options(selectinload(models.Tournament.players))
            .where(
                models.Tournament.club_id == current_club.id,
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

        # Pesos de horas por posición en torneo.
        # Base 0.5 para todos (no es viable registrar cada eliminación en torneos grandes);
        # podio recibe multiplicador para reflejar que realmente duró más.
        TOURNEY_RANK_WEIGHTS = {1: 1.5, 2: 1.3, 3: 1.2}
        TOURNEY_BASE_WEIGHT = 0.5

        for t in tournaments:
            tourney_duration = 0.0
            if t.start_time and t.end_time:
                tourney_duration = (t.end_time - t.start_time).total_seconds() / 3600

            for p in t.players:
                pid = p.player_id

                # 1. Calcular Profit (Premio - Inversión).
                # rebuys_count/addons_count son TOTALES (singles + dobles):
                # singles = total - dobles, valuados a precio single; dobles a precio double.
                single_rebuys = max(0, (p.rebuys_count or 0) - (p.double_rebuys_count or 0))
                single_addons = max(0, (p.addons_count or 0) - (p.double_addons_count or 0))
                inv = t.buyin_amount + \
                      ((p.tips_count or 0) * (t.dealer_tip_amount or 0)) + \
                      single_rebuys * t.rebuy_price + \
                      (p.double_rebuys_count or 0) * t.double_rebuy_price + \
                      single_addons * t.addon_price + \
                      (p.double_addons_count or 0) * t.double_addon_price

                net = (p.prize_collected or 0) - inv
                if net > 0:
                    winners_map[pid] = winners_map.get(pid, 0) + net

                # 2. Tiempo ponderado por rank
                weight = TOURNEY_RANK_WEIGHTS.get(p.rank, TOURNEY_BASE_WEIGHT)
                active_map[pid] = active_map.get(pid, 0.0) + tourney_duration * weight

                # 3. Calcular Spends (Si hubiera tips registrados en transacciones vinculadas al torneo)
                # (Opcional: Si tus torneos generan transacciones de TIP en la tabla transactions, 
                # deberías hacer un query similar al de cash pero filtrando por tournament_id).
                # Por ahora asumimos que el gasto fuerte es en Cash.

        # ---------------------------------------------------------
        # C. ORDENAR Y RETORNAR TOP 3
        # ---------------------------------------------------------
        def get_top_3(data_map):
            # Convertir dict {id: val} a lista [{name, value}]
            lista = [{"name": names_map.get(k, "Unknown"), "value": v} for k, v in data_map.items()]
            # Ordenar descendente y tomar 3
            return sorted(lista, key=lambda x: x["value"], reverse=True)[:3]

        return {
            "winners": get_top_3(winners_map),
            "spenders": get_top_3(spenders_map),
            "active": get_top_3(active_map),
            "period": {
                "year": start_date.year,
                "month": start_date.month,
                "is_current_month": is_current_month,
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
            }
        }

    except Exception as e:
        logger.error("Error rankings: %s", e)
        # En caso de error devolvemos listas vacías para que el front no explote
        return {"winners": [], "spenders": [], "active": [], "period": None}

@router.get("/jackpot-global")
async def get_global_jackpot(db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    stmt_income = select(func.sum(models.Session.declared_jackpot_cash)).where(models.Session.status == "CLOSED", models.Session.club_id == current_club.id)
    total_income = (await db.execute(stmt_income)).scalar() or 0.0
    stmt_payouts = select(func.sum(models.Transaction.amount)).join(models.Session).where(models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT, models.Session.club_id == current_club.id)
    total_payouts = (await db.execute(stmt_payouts)).scalar() or 0.0
    adjustment = current_club.jackpot_adjustment or 0.0
    return {"total_jackpot": total_income - total_payouts + adjustment}

@router.post("/jackpot-adjust")
async def adjust_jackpot(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Ajusta el jackpot manualmente (positivo = agrega, negativo = retira)."""
    amount = data.get("amount", 0)
    reason = data.get("reason", "")
    if amount == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser 0")
    current_club.jackpot_adjustment = (current_club.jackpot_adjustment or 0.0) + float(amount)
    await db.commit()
    return {"message": "Jackpot ajustado", "adjustment_applied": amount, "reason": reason}


@router.get("/history-mixed")
async def get_mixed_history(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """
    Retorna una lista combinada de Sesiones de Cash y Torneos,
    ordenada cronológicamente (más reciente primero).
    """
    
    # 1. Traer Sesiones de Cash (Cerradas o Abiertas, según prefieras)
    stmt_sessions = select(models.Session).where(
        models.Session.club_id == current_club.id
    ).order_by(models.Session.start_time.desc()).limit(limit)
    
    sessions_result = await db.execute(stmt_sessions)
    sessions = sessions_result.scalars().all()

    # 2. Traer Torneos
    stmt_tournaments = select(models.Tournament).where(
        models.Tournament.club_id == current_club.id
    ).order_by(models.Tournament.start_time.desc()).limit(limit)
    
    tournaments_result = await db.execute(stmt_tournaments)
    tournaments = tournaments_result.scalars().all()

    # 3. Formatear y Etiquetar ("type")
    history_list = []

    # Procesar Sesiones
    for s in sessions:
        history_list.append({
            "id": s.id,
            "type": "SESSION",  # 👈 ESTA ES LA CLAVE PARA TU FRONTEND
            "name": f"Mesa Cash #{s.id}", # O el nombre que uses
            "start_time": s.start_time,
            "end_time": s.end_time,
            "status": s.status,
            "total_cash": s.declared_rake_cash, # Ejemplo de dato a mostrar
            # Agrega los campos que necesites en la tarjeta visual
        })

    # Procesar Torneos
    for t in tournaments:
        history_list.append({
            "id": t.id,
            "type": "TOURNAMENT", # 👈 ESTA ES LA CLAVE PARA TU FRONTEND
            "name": t.name,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "status": t.status,
            "total_cash": t.buyin_amount, # O el pozo acumulado
            "buyin_amount": t.buyin_amount # Campo único de torneos
        })

    # 4. Ordenar la lista combinada por fecha (lo más nuevo arriba)
    # Python sort: x['start_time'] puede ser None si apenas se creó, manejar con cuidado
    def get_sort_key(item):
        return item['start_time'] or datetime.min

    history_list.sort(key=get_sort_key, reverse=True)

    # Aplicar paginación manual a la lista combinada (opcional)
    return history_list[skip : skip + limit]


