# app/routers/audit.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database import get_db
from .. import models
# 👇 Importamos la seguridad SaaS
from ..dependencies import get_current_club

router = APIRouter()

@router.get("/current-session")
async def get_current_session_audit(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 Inyección Auth
):
    """
    Calcula el arqueo de caja en tiempo real para la sesión activa del club.
    """
    # 1. Buscar la sesión activa DE ESTE CLUB
    result = await db.execute(
        select(models.Session).where(
            models.Session.club_id == current_club.id, # 👈 Filtro SaaS
            models.Session.status == models.SessionStatus.OPEN
        )
    )
    session = result.scalars().first()
    
    if not session:
        raise HTTPException(status_code=404, detail="No hay sesión activa para auditar")

    # 2. Sumar transacciones por tipo
    # (Helper interno para no repetir código)
    async def get_sum(tx_type):
        stmt = select(func.sum(models.Transaction.amount)).where(
            models.Transaction.session_id == session.id,
            models.Transaction.type == tx_type
        )
        return (await db.execute(stmt)).scalar() or 0.0

    # 3. Obtener totales
    total_buyins = await get_sum(models.TransactionType.BUYIN)
    total_rebuys = await get_sum(models.TransactionType.REBUY) # Si usas rebuys separados
    
    total_cashouts = await get_sum(models.TransactionType.CASHOUT)
    total_spends = await get_sum(models.TransactionType.SPEND)
    total_tips = await get_sum(models.TransactionType.TIP)
    total_jackpot_payouts = await get_sum(models.TransactionType.JACKPOT_PAYOUT)

    # 4. Matemática de la Caja 🧮
    # Entradas (Lo que entró a la mesa)
    total_in = total_buyins + total_rebuys
    
    # Salidas (Lo que salió de la mesa en fichas)
    total_out = total_cashouts + total_spends + total_tips + total_jackpot_payouts
    
    # Efectivo esperado en caja (teóricamente)
    expected_cash = total_in - total_out

    return {
        "session_id": session.id,
        "total_buyins": total_in,
        "total_cashouts": total_cashouts,
        "total_spends": total_spends,
        "total_tips": total_tips,
        "total_jackpot_payouts": total_jackpot_payouts,
        "total_expenses": total_spends, # Alias compatible con frontend
        "expected_cash_in_box": expected_cash
    }