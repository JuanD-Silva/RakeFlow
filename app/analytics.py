from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, desc
from .main import get_db
from .database import get_db
from .models import Transaction, TransactionType, Player, Session
from decimal import Decimal


router = APIRouter(prefix="/reports", tags=["Analytics"])

@router.get("/top-players")
async def get_top_players(
    order_by: str = Query("profit", enum=["profit", "fidelity"]),
    db: AsyncSession = Depends(get_db)
):
    """
    KPI 2 (Profit): Sum(Cashout) - Sum(Buyin + Rebuy)
    KPI 3 (Fidelity): Tiempo estimado en mesa (Max Time - Min Time per session)
    """
    
    if order_by == "profit":
        # Lógica: Sumar cashouts (positivo) y restar buyins (negativo)
        stmt = (
            select(
                Player.name,
                (
                    func.sum(
                        case(
                            (Transaction.type == TransactionType.CASHOUT, Transaction.amount),
                            else_=-Transaction.amount
                        )
                    )
                ).label("total_profit")
            )
            .join(Transaction)
            .group_by(Player.id)
            .order_by(desc("total_profit"))
        )
        result = await db.execute(stmt)
        return [{"player": row.name, "profit": row.total_profit} for row in result]

    elif order_by == "fidelity":
        # Lógica compleja: Aproximación de tiempo en mesa.
        # Calculamos (Max(timestamp) - Min(timestamp)) por cada sesión y jugador, luego sumamos esos deltas.
        
        # Subquery para obtener min y max por sesión/jugador
        subquery = (
            select(
                Transaction.player_id,
                Transaction.session_id,
                (func.max(Transaction.timestamp) - func.min(Transaction.timestamp)).label("session_duration")
            )
            .group_by(Transaction.player_id, Transaction.session_id)
            .subquery()
        )

        # Query principal sumando las duraciones
        stmt = (
            select(
                Player.name,
                func.sum(subquery.c.session_duration).label("total_time_played")
            )
            .join(subquery, Player.id == subquery.c.player_id)
            .group_by(Player.id)
            .order_by(desc("total_time_played"))
        )
        
        result = await db.execute(stmt)
        return [{"player": row.name, "total_time": row.total_time_played} for row in result]

@router.get("/jackpot-status")
async def get_jackpot_status(db: AsyncSession = Depends(get_db)):
    """
    Calcula el Pozo Actual del Jackpot.
    Fórmula: Total Recaudado (Sessions) - Total Pagado (Transactions)
    """
    # 1. Total Recaudado (Suma de declared_jackpot_cash de todas las sesiones cerradas)
    recaudo_q = select(func.sum(Session.declared_jackpot_cash)).where(Session.status == 'CLOSED')
    total_recaudado = (await db.execute(recaudo_q)).scalar() or Decimal(0)
    
    # 2. Total Pagado (Suma de transacciones tipo JACKPOT_PAYOUT)
    pagos_q = select(func.sum(Transaction.amount)).where(Transaction.type == TransactionType.JACKPOT_PAYOUT)
    total_pagado = (await db.execute(pagos_q)).scalar() or Decimal(0)
    
    pozo_actual = total_recaudado - total_pagado
    
    return {
        "jackpot_total_collected": total_recaudado,
        "jackpot_total_paid": total_pagado,
        "current_jackpot_balance": pozo_actual 
    }

# app/analytics.py

@router.get("/financial-summary")
async def get_financial_summary(db: AsyncSession = Depends(get_db)):
    """
    Resumen Financiero Semanal Híbrido:
    - Rake Total (Ganancia neta operativa).
    - Rake Promedio/Hora (Eficiencia de la mesa).
    - Jackpot Recaudado (Crecimiento del pozo).
    """
    stmt = (
        select(
            func.date_trunc('week', Session.start_time).label('week_start'),
            func.sum(Session.declared_rake_cash).label('total_rake'),
            func.avg(Session.rake_per_hour).label('avg_rake_per_hour'),
            # Agregamos la suma del Jackpot sin borrar lo anterior
            func.sum(Session.declared_jackpot_cash).label('total_jackpot_collected')
        )
        .where(Session.status == 'CLOSED')
        .group_by('week_start')
        .order_by(desc('week_start'))
    )
    
    result = await db.execute(stmt)
    return [
        {
            "week": row.week_start, 
            "total_rake": row.total_rake,
            # Mantenemos el redondeo y protección contra nulos
            "avg_hourly_rake": round(row.avg_rake_per_hour, 2) if row.avg_rake_per_hour else 0,
            # Nueva métrica
            "jackpot_collected": row.total_jackpot_collected or 0
        } 
        for row in result
    ]