# app/routers/transactions.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from .. import models, schemas
# Dependencias SaaS: Traemos el autenticador
from ..dependencies import get_db, get_current_club

router = APIRouter(
    prefix="/transactions",
    tags=["Transactions"]
)

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