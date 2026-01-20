# app/routers/stats.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, text, desc, extract
from typing import List
from datetime import datetime, timedelta,time

# Importamos modelos y esquemas
from .. import models, schemas
# Dependencias SaaS
from ..dependencies import get_db, get_current_club

router = APIRouter(
    prefix="/stats",
    tags=["Stats"] 
)

# ---------------------------------------------------------
# 1. DASHBOARD GENERAL (KPIs) 📊
# ---------------------------------------------------------
@router.get("/stats/dashboard")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db), 
    current_club: models.Club = Depends(get_current_club) # ✅ ESTO ESTABA BIEN
):
    """
    Estadísticas principales para las tarjetas superiores.
    Envía TODOS los campos requeridos para evitar la pantalla negra.
    """
    try:
        # A. TOTAL SESIONES (Cerradas)
        stmt_sessions = select(func.count(models.Session.id)).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED
        )
        total_sessions = (await db.execute(stmt_sessions)).scalar() or 0

        # B. RAKE TOTAL HISTÓRICO
        stmt_rake = select(func.sum(models.Session.declared_rake_cash)).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED
        )
        total_rake = (await db.execute(stmt_rake)).scalar() or 0.0

        # C. TICKET PROMEDIO (Promedio de Buy-ins)
        stmt_ticket = (
            select(func.avg(models.Transaction.amount))
            .join(models.Session, models.Transaction.session_id == models.Session.id)
            .where(
                models.Transaction.type == models.TransactionType.BUYIN,
                models.Session.club_id == current_club.id
            )
        )
        avg_ticket = (await db.execute(stmt_ticket)).scalar() or 0.0

        # D. CÁLCULOS DERIVADOS (Estimaciones)
        ESTIMATED_HOURS_PER_SESSION = 5
        total_hours = total_sessions * ESTIMATED_HOURS_PER_SESSION
        
        # Rake por Hora
        avg_rake_hour = (total_rake / total_hours) if total_hours > 0 else 0

        # Eficiencia (Por ahora 0 para evitar errores)
        efficiency = 0.0 

        # E. JACKPOT ACTUAL
        stmt_jackpot_in = select(func.sum(models.Session.declared_jackpot_cash)).where(
            models.Session.club_id == current_club.id, 
            models.Session.status == models.SessionStatus.CLOSED
        )
        jackpot_in = (await db.execute(stmt_jackpot_in)).scalar() or 0.0
        
        stmt_jackpot_out = (
            select(func.sum(models.Transaction.amount))
            .join(models.Session)
            .where(
                models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT,
                models.Session.club_id == current_club.id
            )
        )
        jackpot_out = (await db.execute(stmt_jackpot_out)).scalar() or 0.0
        current_jackpot = jackpot_in - jackpot_out

        # F. RESPUESTA COMPLETA
        return {
            "avg_rake_hour": round(avg_rake_hour, 0),
            "total_hours": total_hours,
            "total_sessions": total_sessions,
            "avg_ticket": round(avg_ticket, 0),
            "efficiency": efficiency,
            "jackpot": current_jackpot,
            "weekly_profit": 0 
        }

    except Exception as e:
        print(f"❌ ERROR DASHBOARD: {e}")
        return {
            "avg_rake_hour": 0,
            "total_hours": 0,
            "total_sessions": 0,
            "avg_ticket": 0,
            "efficiency": 0,
            "jackpot": 0,
            "weekly_profit": 0
        }


# ---------------------------------------------------------
# 2. JACKPOT GLOBAL DEL CLUB
# ---------------------------------------------------------
@router.get("/jackpot-global") 
async def get_global_jackpot(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 ¡FALTABA ESTO!
):
    stmt_income = select(func.sum(models.Session.declared_jackpot_cash)).where(
        models.Session.status == models.SessionStatus.CLOSED,
        models.Session.club_id == current_club.id
    )
    total_income = (await db.execute(stmt_income)).scalar() or 0.0
    
    stmt_payouts = (
        select(func.sum(models.Transaction.amount))
        .join(models.Session, models.Transaction.session_id == models.Session.id)
        .where(
            models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT,
            models.Session.club_id == current_club.id
        )
    )
    total_payouts = (await db.execute(stmt_payouts)).scalar() or 0.0
    
    return {"total_jackpot": total_income - total_payouts}


# ---------------------------------------------------------
# 3. DISTRIBUCIÓN SEMANAL (GRÁFICA)
# ---------------------------------------------------------
@router.get("/weekly-distribution")
async def get_weekly_distribution(
    start_date: str = None, 
    end_date: str = None, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    try:
        if not start_date or not end_date:
            today = datetime.now().date()
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
            # Inicio del primer día a las 00:00:00
            start_dt = datetime.combine(start, time.min)
            # Fin del último día a las 23:59:59
            end_dt = datetime.combine(end, time.max)
        else:
            # Convertimos strings "YYYY-MM-DD" a datetime objetos
            start_dt = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
            end_dt = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)
    except Exception as e:
        # Si algo falla en el parseo, devolvemos el día de hoy completo
        start_dt = datetime.combine(datetime.now().date(), time.min)
        end_dt = datetime.combine(datetime.now().date(), time.max)

    stmt = (
        select(
            models.FinancialDistribution.name,
            func.sum(models.FinancialDistribution.amount).label("total_earned")
        )
        .join(models.Session, models.FinancialDistribution.session_id == models.Session.id)
        .where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED, # 👈 Filtramos solo cerradas
            models.Session.end_time >= start_dt, 
            models.Session.end_time <= end_dt
        )
        .group_by(models.FinancialDistribution.name)
        .order_by(desc("total_earned"))
    )

    results = (await db.execute(stmt)).all()

    report = []
    total_week = 0.0
    for row in results:
        name = row[0]
        total = float(row[1]) if row[1] else 0.0
        report.append({"name": name, "total": total})
        total_week += total
        
    return {
        "range": {
            "start": start_dt.strftime("%d %b"), 
            "end": end_dt.strftime("%d %b")
        },
        "total_week": total_week,
        "distribution": report
    }

# ---------------------------------------------------------
# 4. META MENSUAL (BARRA DE PROGRESO)
# ---------------------------------------------------------
@router.get("/monthly-debt-quota")
async def get_monthly_debt_quota(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 ¡FALTABA ESTO!
):
    # 1. Calcular pagado
    current_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    stmt_paid = select(func.sum(models.Session.debt_payment)).where(
        models.Session.club_id == current_club.id,
        models.Session.status == models.SessionStatus.CLOSED,
        models.Session.end_time >= current_month
    )
    paid_so_far = (await db.execute(stmt_paid)).scalar() or 0.0

    # 2. Calcular META
    stmt_rules = select(func.sum(models.DistributionRule.value)).where(
        models.DistributionRule.club_id == current_club.id,
        models.DistributionRule.active == True,
        models.DistributionRule.rule_type.in_([models.RuleType.MONTHLY_QUOTA, models.RuleType.FIXED])
    )
    target_from_db = (await db.execute(stmt_rules)).scalar() or 0.0

    target = target_from_db if target_from_db > 0 else 400000.0
    remaining = max(0.0, target - paid_so_far)

    return {
        "target": target,
        "paid_so_far": paid_so_far,
        "remaining": remaining,
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
    """
    Retorna los Top 3 jugadores del MES ACTUAL en:
    - Ganancias (Cashouts)
    - Gastos (Spends + Tips)
    - Tiempo jugado (Horas)
    """
    try:
        # 1. Definir el inicio del mes actual (Fecha de corte)
        # Todo lo anterior a esta fecha será ignorado.
        start_date = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # Diccionario de parámetros para inyectar en SQL
        params = {"cid": current_club.id, "start_date": start_date}

        # ---------------------------------------------------------------------
        # A. GANADORES DEL MES (Winners)
        # Sumamos Cashouts + Jackpots de sesiones cerradas este mes
        # ---------------------------------------------------------------------
        sql_winners = text("""
            SELECT p.name, SUM(t.amount) as val
            FROM players p
            JOIN transactions t ON p.id = t.player_id
            JOIN sessions s ON t.session_id = s.id  -- 👈 Unimos con sesión para ver la fecha
            WHERE p.club_id = :cid 
              AND (t.type = 'CASHOUT' OR t.type = 'JACKPOT_PAYOUT')
              AND s.end_time >= :start_date         -- 👈 FILTRO MENSUAL
              AND s.status = 'CLOSED'
            GROUP BY p.name
            ORDER BY val DESC
            LIMIT 3
        """)
        winners = (await db.execute(sql_winners, params)).all()

        # ---------------------------------------------------------------------
        # B. CLIENTES VIP DEL MES (Spenders)
        # Sumamos Gastos + Propinas de sesiones cerradas este mes
        # ---------------------------------------------------------------------
        sql_spenders = text("""
            SELECT p.name, SUM(t.amount) as val
            FROM players p
            JOIN transactions t ON p.id = t.player_id
            JOIN sessions s ON t.session_id = s.id
            WHERE p.club_id = :cid
              AND t.type IN ('SPEND', 'TIP')
              AND s.end_time >= :start_date         -- 👈 FILTRO MENSUAL
              AND s.status = 'CLOSED'
            GROUP BY p.name
            ORDER BY val DESC
            LIMIT 3
        """)
        spenders = (await db.execute(sql_spenders, params)).all()

        # ---------------------------------------------------------------------
        # C. LOS MÁS FIELES DEL MES (Active Time)
        # Sumamos horas jugadas en sesiones cerradas este mes
        # ---------------------------------------------------------------------
        sql_active = text("""
            SELECT p.name, 
                   SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600) as val
            FROM players p
            JOIN (SELECT DISTINCT player_id, session_id FROM transactions) t ON p.id = t.player_id
            JOIN sessions s ON t.session_id = s.id
            WHERE p.club_id = :cid
              AND s.status = 'CLOSED'
              AND s.end_time IS NOT NULL
              AND s.end_time >= :start_date         -- 👈 FILTRO MENSUAL
            GROUP BY p.name
            ORDER BY val DESC
            LIMIT 3
        """)
        active = (await db.execute(sql_active, params)).all()

        return {
            "winners": [{"name": r.name, "value": r.val} for r in winners],
            "spenders": [{"name": r.name, "value": r.val} for r in spenders],
            "active": [{"name": r.name, "value": float(r.val) if r.val else 0.0} for r in active]
        }
    except Exception as e:
        print(f"❌ Error Rankings Mensuales: {e}")
        return {"winners": [], "spenders": [], "active": []}