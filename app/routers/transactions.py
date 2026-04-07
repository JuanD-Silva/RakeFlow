# app/routers/transactions.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from .. import models, schemas
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
from ..dependencies import get_db, get_current_club

router = APIRouter(
    prefix="/transactions",
    tags=["Transactions"]
)
class TransactionUpdate(BaseModel):
    amount: float
    method: str = "CASH" # CASH o DIGITAL
# ---------------------------------------------------------
# HELPER: Buscar Sesión Activa (Actualizado para SaaS)
# ---------------------------------------------------------
async def get_active_session(db: AsyncSession, club_id: int):
    """
    Busca una sesión abierta específicamente para el club indicado.
    """
    result = await db.execute(
        select(models.Session).where(
            models.Session.status == models.SessionStatus.OPEN,
            models.Session.club_id == club_id # 👈 Seguridad: Filtro por Club ID
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(
            status_code=400, 
            detail="No hay ninguna mesa abierta en este club. Abre una sesión primero."
        )
    return session


# ---------------------------------------------------------
# 0. BUYIN / REBUY (Entrada de Dinero) 💰
# ---------------------------------------------------------
@router.post("/buyin", response_model=schemas.TransactionResponse)
async def create_buyin(
    tx: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 Auth
):
    """
    Registra la compra de fichas (Entrada inicial o Recompra).
    """
    # 1. Buscar sesión activa (Pasamos el ID del club autenticado)
    session = await get_active_session(db, current_club.id)

    # 2. Crear Transacción
    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.BUYIN,
        amount=tx.amount,
        method=tx.method or "CASH" 
    )
    
    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    
    return new_tx




# ---------------------------------------------------------
# 1. CASHOUT (Retiro de Fichas)
# ---------------------------------------------------------
@router.post("/cashout", response_model=schemas.TransactionResponse)
async def create_cashout(
    tx: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # 1. Buscar sesión activa
    session = await get_active_session(db, current_club.id)

    # 2. Crear Transacción
    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.CASHOUT,
        amount=tx.amount,
        method="CASH"
    )
    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    return new_tx


# ---------------------------------------------------------
# 1. EDITAR TRANSACCIÓN (Corregir monto o método) ✏️
# ---------------------------------------------------------
@router.put("/{transaction_id}")
async def update_transaction(
    transaction_id: int, 
    data: TransactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    logger.debug("Buscando transacción ID %d para club %d", transaction_id, current_club.id)

    # 1. Buscamos la transacción SOLO por ID (sin filtrar club todavía)
    #    y cargamos la sesión para verificar después.
    stmt = (
        select(models.Transaction)
        .options(selectinload(models.Transaction.session))
        .where(models.Transaction.id == transaction_id)
    )
    result = await db.execute(stmt)
    tx = result.scalars().first()

    # 2. Diagnóstico de errores
    if not tx:
        
        raise HTTPException(status_code=404, detail="Transacción no encontrada (ID inválido)")

    # 3. Verificaciones de Seguridad Manuales
    if not tx.session:
        
        raise HTTPException(status_code=404, detail="Transacción huérfana")

    

    if tx.session.club_id != current_club.id:
        
        raise HTTPException(status_code=404, detail="Transacción no encontrada en este club")

    if tx.session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="No se pueden editar transacciones de sesiones cerradas")

    # 4. Si todo está bien, actualizamos
    
    tx.amount = data.amount
    tx.method = data.method
    
    await db.commit()
    await db.refresh(tx)
    
    return {"message": "Transacción actualizada", "id": tx.id, "new_amount": tx.amount}
# ---------------------------------------------------------
# 2. ELIMINAR TRANSACCIÓN (Borrar error) 🗑️
# ---------------------------------------------------------
@router.delete("/{transaction_id}")
async def delete_transaction(
    transaction_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # Buscar la transacción Y CARGAR LA SESIÓN
    stmt = (
        select(models.Transaction)
        .options(selectinload(models.Transaction.session)) # 👈 SOLUCIÓN DEL ERROR
        .join(models.Session)
        .where(
            models.Transaction.id == transaction_id,
            models.Session.club_id == current_club.id
        )
    )
    result = await db.execute(stmt)
    tx = result.scalars().first()

    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")

    if tx.session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="No se pueden borrar transacciones de sesiones cerradas")

    await db.execute(delete(models.Transaction).where(models.Transaction.id == tx.id))
    await db.commit()

    return {"message": "Transacción eliminada con éxito"}
# ---------------------------------------------------------
# 2. SPEND (Gastos / Bebidas)
# ---------------------------------------------------------
@router.post("/spend", response_model=schemas.TransactionResponse)
async def create_spend(
    tx: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """
    Registra cuando un jugador paga bebidas/comida con fichas.
    """
    session = await get_active_session(db, current_club.id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.SPEND,
        amount=tx.amount
    )
    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    return new_tx


# ---------------------------------------------------------
# 3. TIP (Propina Dealer)
# ---------------------------------------------------------
@router.post("/tip", response_model=schemas.TransactionResponse)
async def create_tip(
    tx: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """
    Registra propina al dealer (fichas que salen de juego).
    """
    session = await get_active_session(db, current_club.id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.TIP,
        amount=tx.amount
    )
    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    return new_tx


# ---------------------------------------------------------
# 4. JACKPOT PAYOUT (Pago de Premio) - ⚠️ LÓGICA CRÍTICA
# ---------------------------------------------------------
@router.post("/jackpot-payout", response_model=schemas.TransactionResponse)
async def create_jackpot_payout(
    tx: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 Auth
):
    """
    Registra un pago de premio Jackpot.
    Valida que existan fondos reales (Historial Ingresos - Egresos) de ESTE club.
    """
    
    # --- A. VALIDACIÓN DE FONDOS (Matemática Real-Time SaaS) ---
    
    # 1. Total Recaudado (Ingresos Históricos de sesiones cerradas DE ESTE CLUB)
    stmt_income = select(func.sum(models.Session.declared_jackpot_cash)).where(
        models.Session.status == models.SessionStatus.CLOSED,
        models.Session.club_id == current_club.id # 👈 Filtro SaaS
    )
    total_income = (await db.execute(stmt_income)).scalar() or 0.0
    
    # 2. Total Pagado (Egresos Históricos DE ESTE CLUB)
    stmt_payouts = (
        select(func.sum(models.Transaction.amount))
        .join(models.Session, models.Transaction.session_id == models.Session.id)
        .where(
            models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT,
            models.Session.club_id == current_club.id # 👈 Filtro SaaS
        )
    )
    total_paid_so_far = (await db.execute(stmt_payouts)).scalar() or 0.0
    
    current_balance = total_income - total_paid_so_far

    # 3. Verificar si alcanza
    if current_balance < tx.amount:
        raise HTTPException(
            status_code=400, 
            detail=f"Fondos insuficientes en el Jackpot. Disponible real: ${current_balance:,.0f}"
        )

    # --- B. REGISTRO DE LA TRANSACCIÓN ---
    session = await get_active_session(db, current_club.id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        amount=tx.amount,
        type=models.TransactionType.JACKPOT_PAYOUT 
    )
    
    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    
    return new_tx


@router.post("/bonus", response_model=schemas.TransactionResponse)
async def create_bonus(
    tx_data: schemas.TransactionCreate, 
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """
    Registra un BONO para un jugador.
    Contablemente: Suma al balance del jugador y se considera un Gasto del Club (resta del Rake).
    """
    # 1. Verificar sesión activa
    stmt = select(models.Session).where(
        models.Session.id == tx_data.session_id,
        models.Session.club_id == current_club.id,
        models.Session.status == models.SessionStatus.OPEN
    )
    session = (await db.execute(stmt)).scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada o cerrada")

    # 2. Crear la transacción tipo BONUS
    new_tx = models.Transaction(
        session_id=tx_data.session_id,
        player_id=tx_data.player_id,
        amount=tx_data.amount,
        type=models.TransactionType.BONUS, # 👈 Usamos el tipo que agregaste a la DB
        method="CASH", # Los bonos suelen ser crédito interno, se marca como CASH o INTERNAL
        timestamp=datetime.utcnow() # O la hora actual
    )

    db.add(new_tx)
    await db.commit()
    await db.refresh(new_tx)
    
    return new_tx