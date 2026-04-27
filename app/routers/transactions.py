# app/routers/transactions.py
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from .. import models, schemas
from ..audit import log_action, AuditAction
from datetime import datetime
import logging

logger = logging.getLogger(__name__)
from ..dependencies import get_db, get_current_club, require_role

# Editar/eliminar transacciones: solo OWNER + MANAGER (no CASHIER)
_EDIT_TX_ROLES = [models.UserRole.OWNER, models.UserRole.MANAGER]

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
async def get_active_session(db: AsyncSession, club_id: int, session_id: int | None = None):
    """
    Resuelve la mesa cash a usar.
    - Si `session_id` viene: valida que pertenezca al club y este OPEN.
    - Si no viene (compat): retorna la primera OPEN del club.
    Multi-mesa: el cliente debe pasar session_id; el fallback se mantiene
    solo para compat con clientes viejos durante la migracion.
    """
    if session_id is not None:
        result = await db.execute(
            select(models.Session).where(
                models.Session.id == session_id,
                models.Session.club_id == club_id,
            )
        )
        session = result.scalars().first()
        if not session:
            raise HTTPException(status_code=404, detail="Mesa no encontrada en este club")
        if session.status != models.SessionStatus.OPEN:
            raise HTTPException(status_code=400, detail="La mesa indicada esta cerrada")
        return session

    # Fallback: primera OPEN
    result = await db.execute(
        select(models.Session).where(
            models.Session.status == models.SessionStatus.OPEN,
            models.Session.club_id == club_id,
        ).order_by(models.Session.id.asc())
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(
            status_code=400,
            detail="No hay ninguna mesa abierta en este club. Abre una sesion primero.",
        )
    return session


# ---------------------------------------------------------
# 0. BUYIN / REBUY (Entrada de Dinero) 💰
# ---------------------------------------------------------
@router.post("/buyin", response_model=schemas.TransactionResponse)
async def create_buyin(
    tx: schemas.TransactionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 Auth
):
    """
    Registra la compra de fichas (Entrada inicial o Recompra).
    """
    session = await get_active_session(db, current_club.id, tx.session_id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.BUYIN,
        amount=tx.amount,
        method=tx.method or "CASH"
    )

    db.add(new_tx)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_CREATE,
        entity_type="Transaction", entity_id=new_tx.id,
        meta={"type": "BUYIN", "amount": tx.amount, "player_id": tx.player_id, "session_id": session.id, "method": new_tx.method},
    )
    await db.commit()
    await db.refresh(new_tx)

    return new_tx




# ---------------------------------------------------------
# 1. CASHOUT (Retiro de Fichas)
# ---------------------------------------------------------
@router.post("/cashout", response_model=schemas.TransactionResponse)
async def create_cashout(
    tx: schemas.TransactionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    session = await get_active_session(db, current_club.id, tx.session_id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        type=models.TransactionType.CASHOUT,
        amount=tx.amount,
        method="CASH"
    )
    db.add(new_tx)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_CREATE,
        entity_type="Transaction", entity_id=new_tx.id,
        meta={"type": "CASHOUT", "amount": tx.amount, "player_id": tx.player_id, "session_id": session.id},
    )
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_EDIT_TX_ROLES)),
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
    old_amount = tx.amount
    old_method = tx.method
    tx.amount = data.amount
    tx.method = data.method

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_UPDATE,
        entity_type="Transaction", entity_id=tx.id,
        meta={"old_amount": old_amount, "new_amount": tx.amount, "old_method": old_method, "new_method": tx.method},
    )
    await db.commit()
    await db.refresh(tx)

    return {"message": "Transacción actualizada", "id": tx.id, "new_amount": tx.amount}
# ---------------------------------------------------------
# 2. ELIMINAR TRANSACCIÓN (Borrar error) 🗑️
# ---------------------------------------------------------
@router.delete("/{transaction_id}")
async def delete_transaction(
    transaction_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_EDIT_TX_ROLES)),
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

    snapshot = {
        "id": tx.id, "type": str(tx.type.value if hasattr(tx.type, "value") else tx.type),
        "amount": tx.amount, "player_id": tx.player_id, "session_id": tx.session_id,
    }
    await db.execute(delete(models.Transaction).where(models.Transaction.id == tx.id))
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_DELETE,
        entity_type="Transaction", entity_id=snapshot["id"],
        meta=snapshot,
    )
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
    session = await get_active_session(db, current_club.id, tx.session_id)

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
    session = await get_active_session(db, current_club.id, tx.session_id)

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
    request: Request,
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
    session = await get_active_session(db, current_club.id, tx.session_id)

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=tx.player_id,
        amount=tx.amount,
        type=models.TransactionType.JACKPOT_PAYOUT
    )

    db.add(new_tx)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_CREATE,
        entity_type="Transaction", entity_id=new_tx.id,
        meta={"type": "JACKPOT_PAYOUT", "amount": tx.amount, "player_id": tx.player_id, "session_id": session.id, "jackpot_balance_before": current_balance},
    )
    await db.commit()
    await db.refresh(new_tx)

    return new_tx


@router.post("/bonus", response_model=schemas.TransactionResponse)
async def create_bonus(
    tx_data: schemas.TransactionCreate,
    request: Request,
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
        type=models.TransactionType.BONUS,
        method="CASH",
        timestamp=datetime.utcnow()
    )

    db.add(new_tx)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_CREATE,
        entity_type="Transaction", entity_id=new_tx.id,
        meta={"type": "BONUS", "amount": tx_data.amount, "player_id": tx_data.player_id, "session_id": tx_data.session_id},
    )
    await db.commit()
    await db.refresh(new_tx)

    return new_tx

# ---------------------------------------------------------
# BUST (Jugador quebro / se quedo sin fichas sin cashout)
# ---------------------------------------------------------
class BustRequest(BaseModel):
    player_id: int
    session_id: int | None = None  # opcional para compat


@router.post("/bust")
async def toggle_bust(
    data: BustRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Marca o desmarca a un jugador como quebrado en la sesion indicada (o la primera OPEN).

    Idempotente: si ya existe un BUST del jugador en la sesion lo borra
    (deshacer click erroneo); si no existe lo crea con amount=0.
    """
    session = await get_active_session(db, current_club.id, data.session_id)

    existing_stmt = select(models.Transaction).where(
        models.Transaction.session_id == session.id,
        models.Transaction.player_id == data.player_id,
        models.Transaction.type == models.TransactionType.BUST,
    )
    existing = (await db.execute(existing_stmt)).scalars().first()

    if existing:
        await db.execute(delete(models.Transaction).where(models.Transaction.id == existing.id))
        await log_action(
            db, request=request, club=current_club,
            action=AuditAction.TRANSACTION_BUST_TOGGLE,
            entity_type="Transaction", entity_id=existing.id,
            meta={"player_id": data.player_id, "session_id": session.id, "is_busted": False, "undo": True},
        )
        await db.commit()
        return {"action": "undone", "is_busted": False}

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=data.player_id,
        type=models.TransactionType.BUST,
        amount=0.0,
        method="CASH",
    )
    db.add(new_tx)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_BUST_TOGGLE,
        entity_type="Transaction", entity_id=new_tx.id,
        meta={"player_id": data.player_id, "session_id": session.id, "is_busted": True},
    )
    await db.commit()
    await db.refresh(new_tx)
    return {"action": "busted", "is_busted": True, "transaction_id": new_tx.id}


# ---------------------------------------------------------
# TOGGLE ESTADO DE PAGO (marca todas las transacciones de un jugador en una sesión)
# ---------------------------------------------------------
class TogglePaidRequest(BaseModel):
    player_id: int
    session_id: int
    is_paid: bool

@router.post("/toggle-paid")
async def toggle_paid(
    data: TogglePaidRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """Marca todas las transacciones BUYIN/REBUY de un jugador en una sesión como pagadas o pendientes."""
    # Verificar que la sesión pertenezca al club
    session_result = await db.execute(
        select(models.Session).where(
            models.Session.id == data.session_id,
            models.Session.club_id == current_club.id
        )
    )
    if not session_result.scalars().first():
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    # Actualizar todas las transacciones BUYIN/REBUY del jugador en esa sesión
    from sqlalchemy import update
    await db.execute(
        update(models.Transaction)
        .where(models.Transaction.session_id == data.session_id)
        .where(models.Transaction.player_id == data.player_id)
        .where(models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]))
        .values(is_paid=data.is_paid)
    )
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_TOGGLE_PAID,
        entity_type="Session", entity_id=data.session_id,
        meta={"player_id": data.player_id, "is_paid": data.is_paid, "scope": "bulk"},
    )
    await db.commit()
    return {"message": "Estado actualizado", "is_paid": data.is_paid}


# ---------------------------------------------------------
# TOGGLE GRANULAR (marca una sola transacción BUYIN/REBUY)
# ---------------------------------------------------------
class ToggleTxPaidRequest(BaseModel):
    is_paid: bool


@router.post("/{transaction_id}/toggle-paid")
async def toggle_transaction_paid(
    transaction_id: int,
    data: ToggleTxPaidRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Marca una transacción BUYIN/REBUY específica como pagada o pendiente."""
    stmt = (
        select(models.Transaction)
        .options(selectinload(models.Transaction.session))
        .where(models.Transaction.id == transaction_id)
    )
    tx = (await db.execute(stmt)).scalars().first()

    if not tx or not tx.session or tx.session.club_id != current_club.id:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")

    if tx.type not in (models.TransactionType.BUYIN, models.TransactionType.REBUY):
        raise HTTPException(status_code=400, detail="Solo BUYIN/REBUY tienen estado de pago")

    if tx.session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Sesión cerrada, no se puede modificar")

    tx.is_paid = data.is_paid
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TRANSACTION_TOGGLE_PAID,
        entity_type="Transaction", entity_id=tx.id,
        meta={"is_paid": data.is_paid, "scope": "single", "player_id": tx.player_id, "session_id": tx.session_id},
    )
    await db.commit()
    return {"id": tx.id, "is_paid": tx.is_paid}
