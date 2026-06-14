# app/routers/dealers.py
"""
Módulo de dealers para mesas cash.

Los clubes pagan a los dealers: tarifa por hora dealeada + % del rake
generado durante su turno. El rake de cada turno lo cuenta el cajero al
cambiar de dealer (como contar el drop físico); el último turno de la
sesión se auto-calcula al cierre como declared_rake_cash - suma de turnos
previos.

El cierre es SOLO INFORMATIVO: no toca la distribución financiera ni
registra gastos.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from typing import List, Optional
from datetime import datetime

from .. import models, schemas
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction

router = APIRouter(prefix="/dealers", tags=["Dealers"])
shifts_router = APIRouter(prefix="/sessions", tags=["DealerShifts"])


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _shift_payment(hours: float, hourly_rate: float, rake_pct: float, declared_rake: Optional[float]) -> float:
    """Pago de un turno: horas x tarifa + % del rake (el componente de rake
    nunca resta: un rake auto-calculado negativo paga $0 de ese componente)."""
    rake_component = max(0.0, declared_rake or 0.0) * rake_pct / 100.0
    return round(hours * hourly_rate + rake_component)


def _shift_to_dict(shift: models.DealerShift, dealer_name: str, now: Optional[datetime] = None) -> dict:
    """Serializa un turno con campos calculados. elapsed_minutes se calcula
    server-side para que el front no parsee datetimes naive (bug de TZ)."""
    end = shift.end_time or now or datetime.utcnow()
    elapsed_minutes = max(0, int((end - shift.start_time).total_seconds() // 60))
    hours = round(elapsed_minutes / 60.0, 2)
    return {
        "id": shift.id,
        "dealer_id": shift.dealer_id,
        "dealer_name": dealer_name,
        "start_time": shift.start_time,
        "end_time": shift.end_time,
        "elapsed_minutes": elapsed_minutes,
        "hours": hours,
        "declared_rake": shift.declared_rake,
        "hourly_rate_cop": shift.hourly_rate_cop,
        "rake_pct": shift.rake_pct,
        "payment": _shift_payment(hours, shift.hourly_rate_cop, shift.rake_pct, shift.declared_rake),
    }


async def _get_open_session(db: AsyncSession, session_id: int, club_id: int) -> models.Session:
    result = await db.execute(
        select(models.Session).where(
            models.Session.id == session_id,
            models.Session.club_id == club_id,
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    if session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="La mesa ya está cerrada")
    return session


async def _get_open_shift(db: AsyncSession, session_id: int, club_id: int, for_update: bool = False) -> Optional[models.DealerShift]:
    query = select(models.DealerShift).where(
        models.DealerShift.session_id == session_id,
        models.DealerShift.club_id == club_id,
        models.DealerShift.end_time.is_(None),
    )
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    return result.scalars().first()


async def _validate_dealer_available(
    db: AsyncSession, dealer_id: int, club_id: int, session_id: int, force: bool
) -> models.Dealer:
    """Valida que el dealer exista, sea del club y esté activo. Si tiene un
    turno abierto en OTRA mesa, 409 (salvo force=True)."""
    result = await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == club_id,
        )
    )
    dealer = result.scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")
    if not dealer.is_active:
        raise HTTPException(status_code=400, detail="El dealer está desactivado")

    if not force:
        result = await db.execute(
            select(models.DealerShift, models.Session.name)
            .join(models.Session, models.Session.id == models.DealerShift.session_id)
            .where(
                models.DealerShift.dealer_id == dealer_id,
                models.DealerShift.club_id == club_id,
                models.DealerShift.end_time.is_(None),
                models.DealerShift.session_id != session_id,
            )
        )
        row = result.first()
        if row:
            other_shift, other_name = row
            mesa = other_name or f"Mesa #{other_shift.session_id}"
            raise HTTPException(
                status_code=409,
                detail=f"{dealer.name} tiene un turno abierto en {mesa}. Usa force para asignarlo igual.",
            )
    return dealer


async def close_dealer_shifts_and_build_report(
    db: AsyncSession, session: models.Session, declared_rake: float
) -> dict:
    """
    Al cerrar la mesa: cierra el turno abierto (si hay) auto-calculando su
    rake como declared_rake_total - suma de turnos previos, y arma el informe
    por dealer. NO toca la distribución financiera (solo informe).

    No hace commit: participa de la transacción del close.
    """
    result = await db.execute(
        select(models.DealerShift, models.Dealer.name)
        .join(models.Dealer, models.Dealer.id == models.DealerShift.dealer_id)
        .where(
            models.DealerShift.session_id == session.id,
            models.DealerShift.club_id == session.club_id,
        )
        .order_by(models.DealerShift.start_time)
    )
    rows = result.all()

    # Propinas asignadas a dealers en esta sesión (independiente de los turnos:
    # informan cuánto recibió cada dealer, no salen de la caja del rake)
    tips_result = await db.execute(
        select(models.Transaction.dealer_id, models.Dealer.name, func.sum(models.Transaction.amount))
        .join(models.Dealer, models.Dealer.id == models.Transaction.dealer_id)
        .where(
            models.Transaction.session_id == session.id,
            models.Transaction.type == models.TransactionType.TIP,
            models.Transaction.dealer_id.isnot(None),
            models.Dealer.club_id == session.club_id,
        )
        .group_by(models.Transaction.dealer_id, models.Dealer.name)
    )
    dealers_tips = [
        {"dealer_id": d_id, "dealer_name": d_name, "total": float(total or 0)}
        for d_id, d_name, total in tips_result.all()
    ]

    if not rows:
        return {
            "dealers_report": [],
            "total_dealers_payment": 0,
            "unassigned_rake": 0,
            "dealers_warning": None,
            "dealers_note": None,
            "dealers_tips": dealers_tips,
        }

    closed_rake_sum = sum(
        (s.declared_rake or 0.0) for s, _ in rows if s.end_time is not None
    )
    warning = None
    unassigned = 0.0

    open_rows = [(s, n) for s, n in rows if s.end_time is None]
    if open_rows:
        open_shift, _ = open_rows[0]
        remainder = round(float(declared_rake) - closed_rake_sum, 2)
        open_shift.end_time = session.end_time or datetime.utcnow()
        open_shift.declared_rake = remainder
        if remainder < 0:
            warning = (
                f"El rake del último turno quedó negativo (${remainder:,.0f}). "
                "Los conteos por turno suman más que el rake total declarado."
            )
    else:
        diff = round(float(declared_rake) - closed_rake_sum, 2)
        if diff > 0:
            unassigned = diff
        elif diff < 0:
            warning = (
                f"Los rakes contados por turno (${closed_rake_sum:,.0f}) superan "
                f"el rake total declarado (${float(declared_rake):,.0f})."
            )

    # Gaps sin dealer entre turnos: el rake de esos ratos queda dentro del
    # conteo siguiente (es inherente a contar el drop físico). Si fue
    # significativo, lo avisamos en el informe para que el pago sea consciente.
    gap_minutes = 0
    prev_end = None
    for s, _ in rows:
        if prev_end and s.start_time > prev_end:
            gap_minutes += int((s.start_time - prev_end).total_seconds() // 60)
        if s.end_time and (prev_end is None or s.end_time > prev_end):
            prev_end = s.end_time
    note = None
    if gap_minutes >= 10:
        note = (
            f"La mesa estuvo ~{gap_minutes} min sin dealer asignado; el rake de "
            "esos ratos quedó dentro del conteo del turno siguiente."
        )

    report = [_shift_to_dict(s, n, now=session.end_time) for s, n in rows]
    total_payment = round(sum(item["payment"] for item in report))

    return {
        "dealers_report": report,
        "total_dealers_payment": total_payment,
        "unassigned_rake": unassigned,
        "dealers_warning": warning,
        "dealers_note": note,
        "dealers_tips": dealers_tips,
    }


# ---------------------------------------------------------
# CRUD de dealers
# ---------------------------------------------------------

@router.get("/", response_model=List[schemas.DealerResponse])
async def list_dealers(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    query = select(models.Dealer).where(models.Dealer.club_id == current_club.id)
    if not include_inactive:
        query = query.where(models.Dealer.is_active == True)  # noqa: E712
    result = await db.execute(query.order_by(models.Dealer.name))
    return result.scalars().all()


@router.post("/", response_model=schemas.DealerResponse, status_code=201)
async def create_dealer(
    data: schemas.DealerCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Cualquier usuario del club puede crear un dealer (el cajero a las 2am),
    igual que con players. Queda auditado."""
    # Si ya existe uno activo con el mismo nombre, lo devolvemos (como players)
    result = await db.execute(
        select(models.Dealer).where(
            models.Dealer.club_id == current_club.id,
            models.Dealer.name == data.name,
            models.Dealer.is_active == True,  # noqa: E712
        )
    )
    existing = result.scalars().first()
    if existing:
        return existing

    dealer = models.Dealer(
        club_id=current_club.id,
        name=data.name,
        phone=data.phone,
        hourly_rate_cop=data.hourly_rate_cop,
        rake_pct=data.rake_pct,
    )
    db.add(dealer)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_CREATE, entity_type="Dealer", entity_id=dealer.id,
        meta={"name": dealer.name, "hourly_rate_cop": dealer.hourly_rate_cop, "rake_pct": dealer.rake_pct},
    )
    await db.commit()
    await db.refresh(dealer)
    return dealer


@router.patch("/{dealer_id}", response_model=schemas.DealerResponse)
async def update_dealer(
    dealer_id: int,
    data: schemas.DealerUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Editar tarifas es decisión financiera: OWNER/MANAGER. No cambia turnos
    históricos (las tarifas se snapshotean en cada turno al iniciarlo)."""
    result = await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )
    dealer = result.scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")

    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(dealer, field, value)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_UPDATE, entity_type="Dealer", entity_id=dealer.id,
        meta={"changes": changes},
    )
    await db.commit()
    await db.refresh(dealer)
    return dealer


@router.delete("/{dealer_id}", status_code=204)
async def deactivate_dealer(
    dealer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Soft delete: los turnos históricos referencian al dealer."""
    result = await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )
    dealer = result.scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")

    dealer.is_active = False
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_DEACTIVATE, entity_type="Dealer", entity_id=dealer.id,
        meta={"name": dealer.name},
    )
    await db.commit()


# ---------------------------------------------------------
# Turnos (operación de mesa)
# ---------------------------------------------------------

@shifts_router.get("/{session_id}/dealer-shifts")
async def list_shifts(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Turnos de la sesión (abiertos y cerrados) con horas y pago calculado.
    Funciona también con sesión CLOSED (historial)."""
    # Verificar ownership de la sesión (sin exigir OPEN)
    result = await db.execute(
        select(models.Session).where(
            models.Session.id == session_id,
            models.Session.club_id == current_club.id,
        )
    )
    if not result.scalars().first():
        raise HTTPException(status_code=404, detail="Mesa no encontrada")

    result = await db.execute(
        select(models.DealerShift, models.Dealer.name)
        .join(models.Dealer, models.Dealer.id == models.DealerShift.dealer_id)
        .where(
            models.DealerShift.session_id == session_id,
            models.DealerShift.club_id == current_club.id,
        )
        .order_by(models.DealerShift.start_time)
    )
    now = datetime.utcnow()
    return [_shift_to_dict(s, n, now=now) for s, n in result.all()]


@shifts_router.post("/{session_id}/dealer-shifts/start")
async def start_shift(
    session_id: int,
    data: schemas.DealerShiftStart,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Asigna un dealer a la mesa (inicia turno). 409 si ya hay turno abierto
    en esta mesa (usar /change) o si el dealer está en otra mesa (force)."""
    await _get_open_session(db, session_id, current_club.id)

    existing = await _get_open_shift(db, session_id, current_club.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Ya hay un dealer en esta mesa. Usa cambiar dealer.",
        )

    dealer = await _validate_dealer_available(db, data.dealer_id, current_club.id, session_id, data.force)

    shift = models.DealerShift(
        club_id=current_club.id,
        session_id=session_id,
        dealer_id=dealer.id,
        start_time=datetime.utcnow(),
        hourly_rate_cop=dealer.hourly_rate_cop,
        rake_pct=dealer.rake_pct,
    )
    db.add(shift)
    try:
        await db.flush()
        await log_action(
            db, request=request, club=current_club,
            action=AuditAction.DEALER_SHIFT_START, entity_type="DealerShift", entity_id=shift.id,
            meta={"session_id": session_id, "dealer_id": dealer.id, "dealer_name": dealer.name},
        )
        await db.commit()
    except IntegrityError:
        # Race de doble-tap: el índice único parcial (un turno abierto por
        # mesa) lo bloqueó. Lo traducimos al mismo 409 del check de arriba.
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ya hay un dealer en esta mesa. Usa cambiar dealer.",
        )
    await db.refresh(shift)
    return _shift_to_dict(shift, dealer.name)


@shifts_router.post("/{session_id}/dealer-shifts/change")
async def change_shift(
    session_id: int,
    data: schemas.DealerShiftChange,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Cambio de dealer atómico: cierra el turno actual declarando su rake
    contado y abre el del dealer entrante en la misma transacción."""
    await _get_open_session(db, session_id, current_club.id)

    current_shift = await _get_open_shift(db, session_id, current_club.id, for_update=True)
    if not current_shift:
        raise HTTPException(
            status_code=409,
            detail="No hay un dealer asignado en esta mesa. Usa asignar dealer.",
        )

    dealer = await _validate_dealer_available(db, data.dealer_id, current_club.id, session_id, data.force)

    now = datetime.utcnow()
    current_shift.end_time = now
    current_shift.declared_rake = float(data.declared_rake)

    new_shift = models.DealerShift(
        club_id=current_club.id,
        session_id=session_id,
        dealer_id=dealer.id,
        start_time=now,
        hourly_rate_cop=dealer.hourly_rate_cop,
        rake_pct=dealer.rake_pct,
    )
    db.add(new_shift)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_SHIFT_CHANGE, entity_type="DealerShift", entity_id=new_shift.id,
        meta={
            "session_id": session_id,
            "outgoing_shift_id": current_shift.id,
            "outgoing_dealer_id": current_shift.dealer_id,
            "declared_rake": float(data.declared_rake),
            "incoming_dealer_id": dealer.id,
            "incoming_dealer_name": dealer.name,
        },
    )
    await db.commit()
    await db.refresh(new_shift)
    return _shift_to_dict(new_shift, dealer.name)


@shifts_router.post("/{session_id}/dealer-shifts/end")
async def end_shift(
    session_id: int,
    data: schemas.DealerShiftEnd,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Termina el turno actual sin abrir otro (descanso / mesa sin dealer)."""
    await _get_open_session(db, session_id, current_club.id)

    current_shift = await _get_open_shift(db, session_id, current_club.id, for_update=True)
    if not current_shift:
        raise HTTPException(status_code=409, detail="No hay un dealer asignado en esta mesa.")

    current_shift.end_time = datetime.utcnow()
    current_shift.declared_rake = float(data.declared_rake)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_SHIFT_END, entity_type="DealerShift", entity_id=current_shift.id,
        meta={
            "session_id": session_id,
            "dealer_id": current_shift.dealer_id,
            "declared_rake": float(data.declared_rake),
        },
    )
    await db.commit()

    # Nombre del dealer para el response
    result = await db.execute(
        select(models.Dealer.name).where(
            models.Dealer.id == current_shift.dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )
    dealer_name = result.scalar() or ""
    return _shift_to_dict(current_shift, dealer_name)
