from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, text, desc, or_
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime, timedelta, time

# Importamos modelos y esquemas
from .. import models, schemas
# Dependencias SaaS
from ..dependencies import get_db, get_current_club

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

    # 2. TORNEOS
    stmt_tourney = select(models.Tournament).options(selectinload(models.Tournament.players)).where(
        models.Tournament.club_id == club_id,
        models.Tournament.status == "COMPLETED",
        models.Tournament.end_time >= start,
        models.Tournament.end_time <= end
    )
    tournaments = (await db.execute(stmt_tourney)).scalars().all()
    tourney = 0.0
    for t in tournaments:
        t_inc = 0
        for p in t.players:
            # Calcular ingresos brutos del torneo
            inv = t.buyin_amount + \
                  ((p.rebuys_count - p.double_rebuys_count) * t.rebuy_price) + \
                  (p.double_rebuys_count * t.double_rebuy_price) + \
                  ((p.addons_count - p.double_addons_count) * t.addon_price) + \
                  (p.double_addons_count * t.double_addon_price)
            t_inc += inv
        tourney += (t_inc * (t.rake_percentage / 100))



    return (cash + int(tourney))

# ---------------------------------------------------------
# 1. DASHBOARD GENERAL (KPIs) 📊
# ---------------------------------------------------------
@router.get("/dashboard")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db), 
    current_club: models.Club = Depends(get_current_club)
):
    try:
        now = datetime.utcnow()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # A. TOTAL SESIONES Y HORAS (Cash + Torneos)
        # Cash
        stmt_cash = select(models.Session).where(models.Session.club_id == current_club.id, models.Session.status == "CLOSED", models.Session.end_time >= start_of_month)
        cash_sessions = (await db.execute(stmt_cash)).scalars().all()
        cash_hours = len(cash_sessions) * 5
        
        # Torneos
        stmt_tourney = select(models.Tournament).where(models.Tournament.club_id == current_club.id, models.Tournament.status == "COMPLETED", models.Tournament.end_time >= start_of_month)
        tournaments = (await db.execute(stmt_tourney)).scalars().all()
        tourney_hours = 0
        for t in tournaments:
            if t.start_time and t.end_time:
                tourney_hours += (t.end_time - t.start_time).total_seconds() / 3600

        total_sessions = len(cash_sessions) + len(tournaments)
        total_hours = cash_hours + tourney_hours

        # B. RAKE TOTAL MENSUAL (Profit Operativo)
        total_profit = await _get_net_profit_in_range(db, current_club.id, start_of_month, now)

        # C. META (Eficiencia)
        stmt_meta = select(func.sum(models.DistributionRule.value)).where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True,
            or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED)
        )
        monthly_goal = (await db.execute(stmt_meta)).scalar() or 50000000.0
        efficiency = (total_profit / monthly_goal * 100) if monthly_goal > 0 else 0

        # D. JACKPOT
        stmt_jackpot_in = select(func.sum(models.Session.declared_jackpot_cash)).where(models.Session.club_id == current_club.id, models.Session.status == "CLOSED")
        jackpot_in = (await db.execute(stmt_jackpot_in)).scalar() or 0.0
        
        stmt_jackpot_out = select(func.sum(models.Transaction.amount)).join(models.Session).where(models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT, models.Session.club_id == current_club.id)
        jackpot_out = (await db.execute(stmt_jackpot_out)).scalar() or 0.0

        return {
            "avg_rake_hour": int(total_profit / total_hours) if total_hours > 0 else 0,
            "total_hours": round(total_hours, 1),
            "total_sessions": total_sessions,
            "avg_ticket": 0, 
            "efficiency": round(efficiency, 1),
            "jackpot": int(jackpot_in - jackpot_out),
            "weekly_profit": 0 
        }

    except Exception as e:
        print(f"❌ ERROR DASHBOARD: {e}")
        return {}

# ---------------------------------------------------------
# 2. DISTRIBUCIÓN SEMANAL (CASCADA: META -> SOCIOS) 🌊
# ---------------------------------------------------------
@router.get("/weekly-distribution")
async def get_weekly_distribution(
    start_date: str = None, 
    end_date: str = None, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
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
        print(f"❌ Error Weekly: {e}")
        return {"error": str(e)}

# ---------------------------------------------------------
# 4. META MENSUAL (BARRA DE PROGRESO)
# ---------------------------------------------------------
@router.get("/monthly-debt-quota")
async def get_monthly_debt_quota(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # Meta
    stmt_rules = select(func.sum(models.DistributionRule.value)).where(models.DistributionRule.club_id == current_club.id, models.DistributionRule.active == True, or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED))
    target = (await db.execute(stmt_rules)).scalar() or 50000000.0

    # Pagado (Profit Acumulado)
    now = datetime.utcnow()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    current = await _get_net_profit_in_range(db, current_club.id, start_of_month, now)
    
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
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    try:
        start_date = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
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
            WHERE p.club_id = :cid AND s.end_time >= :start_date AND s.status = 'CLOSED'
            GROUP BY p.id, p.name
        """)
        
        rows_stats = (await db.execute(sql_cash_stats, {"cid": current_club.id, "start_date": start_date})).all()
        
        for r in rows_stats:
            names_map[r.id] = r.name
            if r.profit > 0: winners_map[r.id] = winners_map.get(r.id, 0) + r.profit
            if r.spend > 0: spenders_map[r.id] = spenders_map.get(r.id, 0) + r.spend

        # 2. TIEMPO EN MESA (Active) - Cálculo especial
        # Nota: Seleccionamos sesiones ÚNICAS por jugador para no sumar el tiempo 
        # multiple veces si hizo varias recompras en la misma sesión.
        sql_cash_time = text("""
            SELECT DISTINCT t.player_id, 
                   EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600 as hours
            FROM transactions t
            JOIN sessions s ON t.session_id = s.id
            WHERE s.club_id = :cid 
              AND s.end_time >= :start_date 
              AND s.status = 'CLOSED'
              AND t.player_id IS NOT NULL
        """)
        
        rows_time = (await db.execute(sql_cash_time, {"cid": current_club.id, "start_date": start_date})).all()
        
        for r in rows_time:
            # r[0] es player_id, r[1] es horas
            pid = r[0]
            hours = float(r[1]) if r[1] else 0.0
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
                models.Tournament.end_time >= start_date
            )
        )
        tournaments = q_tourneys.scalars().all()

        for t in tournaments:
            # Calcular duración del torneo en horas
            tourney_duration = 0.0
            if t.start_time and t.end_time:
                tourney_duration = (t.end_time - t.start_time).total_seconds() / 3600

            for p in t.players:
                pid = p.player_id
                
                # Asegurar nombre
                if pid not in names_map:
                    # Si el jugador solo juega torneos y no cash, buscamos su nombre
                    n = await db.execute(select(models.Player.name).where(models.Player.id == pid))
                    names_map[pid] = n.scalar() or "Desconocido"

                # 1. Calcular Profit (Premio - Inversión)
                inv = t.buyin_amount + \
                      ((p.rebuys_count + p.double_rebuys_count) * t.rebuy_price) + \
                      ((p.addons_count + p.double_addons_count) * t.addon_price)
                
                net = (p.prize_collected or 0) - inv
                if net > 0: 
                    winners_map[pid] = winners_map.get(pid, 0) + net

                # 2. Calcular Tiempo (Sumar duración del torneo)
                active_map[pid] = active_map.get(pid, 0.0) + tourney_duration

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
            "active": get_top_3(active_map) # Ahora sí enviamos datos reales
        }

    except Exception as e:
        print(f"❌ Error Rankings: {e}")
        # En caso de error devolvemos listas vacías para que el front no explote
        return {"winners": [], "spenders": [], "active": []}

@router.get("/jackpot-global") 
async def get_global_jackpot(db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    stmt_income = select(func.sum(models.Session.declared_jackpot_cash)).where(models.Session.status == "CLOSED", models.Session.club_id == current_club.id)
    total_income = (await db.execute(stmt_income)).scalar() or 0.0
    stmt_payouts = select(func.sum(models.Transaction.amount)).join(models.Session).where(models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT, models.Session.club_id == current_club.id)
    total_payouts = (await db.execute(stmt_payouts)).scalar() or 0.0
    return {"total_jackpot": total_income - total_payouts}


@router.get("/history-mixed")
async def get_mixed_history(
    skip: int = 0, 
    limit: int = 20, 
    db: AsyncSession = Depends(get_db), 
    current_club: models.Club = Depends(get_current_club)
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


