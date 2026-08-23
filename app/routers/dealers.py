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
import os
import asyncio
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, and_, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from typing import List, Optional
from datetime import datetime, timedelta

from .. import models, schemas, accounts, services, dealer_view, auth_utils, phone_verify
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction
from ..phone_utils import normalize_phone
from ..rate_limit import limiter

router = APIRouter(prefix="/dealers", tags=["Dealers"])
shifts_router = APIRouter(prefix="/sessions", tags=["DealerShifts"])
alerts_router = APIRouter(prefix="/dealer-alerts", tags=["DealerAlerts"])


# ---------------------------------------------------------
# Alertas dealer→staff (recepción por el staff, polling)
# ---------------------------------------------------------
@alerts_router.get("")
async def list_dealer_alerts(
    status: str = "PENDING",
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Alertas del club (default pendientes). Cualquier usuario del club las ve
    (el cajero en la mesa es quien atiende). Trae el nombre de la mesa."""
    rows = (await db.execute(
        select(models.DealerAlert, models.Session.name, models.TournamentTable.table_number, models.Tournament.name)
        .outerjoin(models.Session, and_(
            models.Session.id == models.DealerAlert.session_id,
            models.Session.club_id == models.DealerAlert.club_id,
        ))
        .outerjoin(models.TournamentTable, and_(
            models.TournamentTable.id == models.DealerAlert.tournament_table_id,
            models.TournamentTable.club_id == models.DealerAlert.club_id,
        ))
        .outerjoin(models.Tournament, models.Tournament.id == models.TournamentTable.tournament_id)
        .where(
            models.DealerAlert.club_id == current_club.id,
            models.DealerAlert.status == status.upper(),
        )
        .order_by(models.DealerAlert.created_at.desc())
        .limit(50)
    )).all()

    def _table_name(a, session_name, t_number, t_name):
        if a.tournament_table_id is not None:
            # Con multi-torneo, "Mesa 2 (torneo)" es ambiguo: cada torneo numera
            # sus mesas desde 1. El nombre del torneo desambigua.
            base = f"Mesa {t_number}" if t_number is not None else "Mesa"
            return f"{base} · {t_name}" if t_name else f"{base} (torneo)"
        return session_name or f"Mesa #{a.session_id}"

    return [{
        "id": a.id,
        "alert_type": a.alert_type,
        "message": a.message,
        "dealer_name": a.dealer_name,
        "table_name": _table_name(a, name, t_number, t_name),
        "session_id": a.session_id,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a, name, t_number, t_name in rows]


@alerts_router.post("/{alert_id}/resolve")
async def resolve_dealer_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER, models.UserRole.CASHIER])),
):
    """Marcar una alerta como atendida."""
    alert = (await db.execute(
        select(models.DealerAlert).where(
            models.DealerAlert.id == alert_id,
            models.DealerAlert.club_id == current_club.id,
        )
    )).scalars().first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    alert.status = "RESOLVED"
    alert.resolved_at = datetime.utcnow()
    alert.resolved_by_user_id = current_user.id
    await db.commit()
    return {"status": "RESOLVED"}


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

# Pago de turno: fuente única en services.shift_payment (cierre y reportes lo
# comparten para que el mismo dealer no muestre dos totales por redondeo).
def _shift_payment(hours: float, hourly_rate: float, rake_pct: float, declared_rake: Optional[float]) -> float:
    return services.shift_payment(hours, hourly_rate, rake_pct, declared_rake)


def _shift_to_dict(shift: models.DealerShift, dealer_name: str, now: Optional[datetime] = None) -> dict:
    """Serializa un turno con campos calculados. elapsed_minutes se calcula
    server-side para que el front no parsee datetimes naive (bug de TZ)."""
    end = shift.end_time or now or datetime.utcnow()
    elapsed_minutes = max(0, int((end - shift.start_time).total_seconds() // 60))
    hours = dealer_view.shift_hours(shift.start_time, end)
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
    # LEFT JOIN a users para exponer estado de cuenta (sin cuenta / invitación
    # pendiente / activa) por dealer, para el botón "Invitar a la app".
    query = (
        select(models.Dealer, models.User.hashed_password)
        .outerjoin(models.User, models.User.id == models.Dealer.user_id)
        .where(models.Dealer.club_id == current_club.id)
    )
    if not include_inactive:
        query = query.where(models.Dealer.is_active == True)  # noqa: E712
    rows = (await db.execute(query.order_by(models.Dealer.name))).all()
    out = []
    for dealer, hashed_password in rows:
        resp = schemas.DealerResponse.model_validate(dealer)
        resp.has_account = dealer.user_id is not None
        resp.invitation_pending = dealer.user_id is not None and hashed_password is None
        out.append(resp)
    return out


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
        tournament_hourly_rate_cop=data.tournament_hourly_rate_cop,
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

    # Si se cambia el estado, sincronizar la cuenta del dealer y deactivated_at.
    if "is_active" in changes:
        if changes["is_active"]:
            dealer.deactivated_at = None
            await _set_linked_user_active(db, dealer, True)
        else:
            dealer.deactivated_at = datetime.utcnow()
            await _set_linked_user_active(db, dealer, False)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_UPDATE, entity_type="Dealer", entity_id=dealer.id,
        meta={"changes": changes},
    )
    await db.commit()
    await db.refresh(dealer)
    return dealer


async def _set_linked_user_active(db: AsyncSession, dealer: models.Dealer, active: bool):
    """Sincroniza el estado de la cuenta del dealer con el del dealer: desactivar
    el dealer le corta el login; reactivarlo se lo devuelve."""
    if not dealer.user_id:
        return
    user = (await db.execute(
        select(models.User).where(models.User.id == dealer.user_id)
    )).scalars().first()
    if user:
        user.is_active = active


async def _dealer_has_history(db: AsyncSession, dealer_id: int) -> bool:
    """True si el dealer tiene turnos (cash o TORNEO), pagos o propinas asociados
    (borrar rompería el historial financiero). Los dealers con historial NO se
    eliminan: se archivan. OJO: esta lista debe cubrir TODAS las FK a dealers —
    cuando faltó tournament_dealer_shifts, el delete pasaba el chequeo y reventaba
    en la FK con un 500 (bug encontrado en prod, jul-2026)."""
    shifts = (await db.execute(
        select(models.DealerShift.id).where(models.DealerShift.dealer_id == dealer_id).limit(1)
    )).first()
    if shifts:
        return True
    t_shifts = (await db.execute(
        select(models.TournamentDealerShift.id)
        .where(models.TournamentDealerShift.dealer_id == dealer_id).limit(1)
    )).first()
    if t_shifts:
        return True
    payouts = (await db.execute(
        select(models.DealerPayout.id).where(models.DealerPayout.dealer_id == dealer_id).limit(1)
    )).first()
    if payouts:
        return True
    txs = (await db.execute(
        select(models.Transaction.id).where(models.Transaction.dealer_id == dealer_id).limit(1)
    )).first()
    return bool(txs)


@router.delete("/{dealer_id}", status_code=204)
async def deactivate_dealer(
    dealer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Soft delete: los turnos históricos referencian al dealer. Además corta el
    login de su cuenta y marca cuándo se desactivó (para la purga a 60 días)."""
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
    dealer.deactivated_at = datetime.utcnow()
    await _set_linked_user_active(db, dealer, False)  # le corta el login
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_DEACTIVATE, entity_type="Dealer", entity_id=dealer.id,
        meta={"name": dealer.name},
    )
    await db.commit()


async def _hard_delete_dealer(db: AsyncSession, dealer: models.Dealer):
    """Borra el dealer y su cuenta vinculada. SOLO llamar tras verificar que no
    tiene historial. Se borra el dealer primero (libera el FK user_id) y luego el
    user. audit_logs.actor_id no es FK, así que el user es borrable."""
    user_id = dealer.user_id
    await db.delete(dealer)
    await db.flush()
    if user_id:
        # Suscripciones push de la cuenta (FK NOT NULL a users). Hoy solo el rol
        # PLAYER se suscribe, pero borrarlas acá evita repetir el bug de FKs (#49)
        # si algún día el panel del dealer también recibe push.
        await db.execute(sa_delete(models.PushSubscription).where(
            models.PushSubscription.user_id == user_id))
        user = (await db.execute(
            select(models.User).where(models.User.id == user_id)
        )).scalars().first()
        if user:
            await db.delete(user)


@router.delete("/{dealer_id}/permanent", status_code=204)
async def delete_dealer_permanent(
    dealer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Elimina DEFINITIVAMENTE un dealer (y su cuenta), solo si NO tiene historial
    (turnos/pagos/propinas). Si tiene historial, se conserva archivado (desactivado)
    para no romper la contabilidad. OWNER/MANAGER."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")

    if await _dealer_has_history(db, dealer.id):
        raise HTTPException(
            status_code=409,
            detail="Este dealer tiene historial (turnos/pagos). No se puede eliminar; quedó desactivado.",
        )

    name = dealer.name
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_DELETE, entity_type="Dealer", entity_id=dealer.id,
        meta={"name": name, "had_account": bool(dealer.user_id)},
    )
    # El try cubre TAMBIÉN el flush de _hard_delete_dealer: una FK que falte en
    # _dealer_has_history debe degradar a 409 con mensaje, jamás a 500.
    try:
        await _hard_delete_dealer(db, dealer)
        await db.commit()
    except IntegrityError:
        # Backstop: el dealer o su cuenta quedaron referenciados por otra fila (FK).
        await db.rollback()
        raise HTTPException(status_code=409, detail="No se pudo eliminar: el dealer o su cuenta tienen referencias. Quedó desactivado (archivado).")


@router.post("/{dealer_id}/unlink-account", status_code=200)
async def unlink_dealer_account(
    dealer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Borra SOLO la cuenta de login del dealer y libera su teléfono, conservando
    la ficha y TODO su historial (turnos/pagos/propinas cuelgan del dealer_id, no
    de la cuenta). Es la salida para el dealer archivado que no se puede eliminar
    por historial pero cuyo número se necesita en otra cuenta (ej: el dueño que
    probó como dealer y ahora quiere su número para la app de jugador)."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")
    if not dealer.user_id:
        raise HTTPException(status_code=409, detail="Este dealer no tiene cuenta vinculada")
    if dealer.is_active:
        # Alineado con la UI: liberar la cuenta es para dealers ARCHIVADOS.
        # A un dealer activo se le resetea el acceso, no se le mata el login.
        raise HTTPException(status_code=409, detail="El dealer está activo: desactivalo primero para liberar su cuenta")

    # Defensa en profundidad: SOLO se borra una cuenta DEALER del propio club.
    # Si el vínculo apuntara a otra cosa (datos corruptos), se desvincula el
    # dealer sin tocar esa cuenta.
    user = (await db.execute(
        select(models.User).where(
            models.User.id == dealer.user_id,
            models.User.club_id == current_club.id,
            models.User.role == models.UserRole.DEALER,
        )
    )).scalars().first()
    freed_phone = user.phone if user else None

    dealer.user_id = None  # primero se suelta el FK, después se borra la cuenta
    await db.flush()
    if user:
        await db.delete(user)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_UNLINK_ACCOUNT, entity_type="Dealer", entity_id=dealer.id,
        meta={"name": dealer.name, "freed_phone": freed_phone, "by": current_user.email},
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="No se pudo desvincular: la cuenta tiene referencias.")
    return {"status": "unlinked", "freed_phone": freed_phone}


# ---------------------------------------------------------
# Purga automática: dealers desactivados hace +60 días y SIN historial.
# Llamado por el cron diario (GitHub Actions) con X-Internal-Token.
# Los dealers con historial se conservan archivados (borrarlos rompería la
# contabilidad); solo se purgan los "limpios".
# ---------------------------------------------------------
PURGE_AFTER_DAYS = 60


def _verify_cron_token(request: Request) -> None:
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    received = request.headers.get("x-internal-token", "")
    if not expected or received != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/purge-deactivated")
async def purge_deactivated_dealers(
    request: Request,
    dry_run: bool = False,
    db: AsyncSession = Depends(get_db),
):
    _verify_cron_token(request)
    cutoff = datetime.utcnow() - timedelta(days=PURGE_AFTER_DAYS)
    candidates = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.is_active == False,  # noqa: E712
            models.Dealer.deactivated_at.is_not(None),
            models.Dealer.deactivated_at < cutoff,
        )
    )).scalars().all()

    deleted, kept_with_history, failed = [], [], []
    for dealer in candidates:
        if await _dealer_has_history(db, dealer.id):
            kept_with_history.append(dealer.id)
            continue
        if dry_run:
            deleted.append(dealer.id)
            continue
        # Commit por dealer: si uno falla (FK colgante de su cuenta), no aborta
        # la purga de los demás.
        try:
            await _hard_delete_dealer(db, dealer)
            await db.commit()
            deleted.append(dealer.id)
        except IntegrityError:
            await db.rollback()
            failed.append(dealer.id)

    return {
        "cutoff_days": PURGE_AFTER_DAYS,
        "dry_run": dry_run,
        "deleted_count": len(deleted),
        "deleted_ids": deleted,
        "kept_with_history_ids": kept_with_history,
        "failed_ids": failed,
    }


# ---------------------------------------------------------
# Cuenta del dealer: invitar por WhatsApp con código de verificación del número.
# El dealer entra por TELÉFONO (sin email). El owner/manager toca "Invitar" y se
# abre WhatsApp (wa.me) con el link de activación + el código; el dealer ingresa
# el código (que llegó a SU número) => verifica el teléfono y crea su contraseña.
# ---------------------------------------------------------
class DealerInviteIn(BaseModel):
    phone: str = Field(..., min_length=7, max_length=20)
    name: Optional[str] = None  # si no viene, usa el nombre del dealer


def _build_invite_response(dealer: models.Dealer, club_name: Optional[str], phone: str,
                           code: str, user_id: int, reset: bool = False,
                           channel: str = "manual") -> dict:
    """Respuesta del invite/reset del dealer. Canal 'twilio' = RakeFlow ya mandó
    el código (verified: true, sin código ni wa.me); 'manual' = plan B con wa.me."""
    if channel == "twilio":
        return {
            "status": "reset" if reset else "invited",
            "dealer_id": dealer.id, "user_id": user_id, "phone": phone,
            "verified": True, "sent_channel": phone_verify.TWILIO_VERIFY_CHANNEL,
        }
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    activate_url = f"{frontend}/activar-dealer"
    if reset:
        intro = f"Hola {dealer.name}! 🔐 Restablecimos tu acceso a RakeFlow."
        action_line = f"Vuelve a activar tu cuenta aquí: {activate_url}"
    else:
        intro = f"Hola {dealer.name}! 🃏 {club_name or 'Tu club'} te invita a RakeFlow como dealer."
        action_line = f"Activa tu cuenta aquí: {activate_url}"
    message = (
        f"{intro}\n\n"
        f"{action_line}\n"
        f"Tu código de verificación es: {code}\n\n"
        f"(Vence en 24 horas)"
    )
    wa_url = f"https://wa.me/{phone}?text={quote(message)}"
    return {
        "status": "reset" if reset else "invited",
        "dealer_id": dealer.id,
        "user_id": user_id,
        "phone": phone,
        "code": code,
        "wa_url": wa_url,
        "message": message,
        "verified": False,
    }


@router.post("/{dealer_id}/invite", status_code=201)
async def invite_dealer(
    dealer_id: int,
    data: DealerInviteIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Crea (o re-invita) la cuenta rol DEALER vinculada a este dealer y devuelve
    el link wa.me con el código de verificación para enviarlo por WhatsApp.
    OWNER/MANAGER. No envía nada por sí mismo: el front abre WhatsApp."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")

    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")

    # El teléfono nuevo no puede pertenecer a OTRA cuenta (es la identidad de login).
    if await accounts.phone_taken_by_other(db, phone, current_club.id,
                                           models.UserRole.DEALER, dealer.user_id):
        raise HTTPException(status_code=409,
                            detail="Ese teléfono ya tiene cuenta de dealer en este club")

    channel, code = await phone_verify.start_invite(phone)   # Twilio Verify o plan B
    expires = datetime.utcnow() + timedelta(hours=24)

    if dealer.user_id:
        # Re-invitación: regenera código y permite CORREGIR el teléfono mientras la
        # cuenta siga pendiente (caso típico: se mandó el código a un número errado).
        user = (await db.execute(
            select(models.User).where(models.User.id == dealer.user_id)
        )).scalars().first()
        if user is None:
            raise HTTPException(status_code=409, detail="La cuenta vinculada no existe; desactiva y recrea el dealer")
        if user.hashed_password is not None:
            raise HTTPException(status_code=409, detail="Este dealer ya activó su cuenta")
        user.phone = phone
        user.phone_verified = False
        user.invitation_token = code
        user.invitation_expires_at = expires
        user.invitation_sent_at = datetime.utcnow()
        user.invitation_attempts = 0  # reset del lockout en cada re-invitación
        user.verification_channel = channel
    else:
        user = models.User(
            club_id=current_club.id,
            email=None,
            phone=phone,
            phone_verified=False,
            name=(data.name or dealer.name),
            role=models.UserRole.DEALER,
            is_active=True,
            hashed_password=None,
            invitation_token=code,
            invitation_expires_at=expires,
            invitation_sent_at=datetime.utcnow(),
            invited_by_user_id=current_user.id,
            verification_channel=channel,
        )
        db.add(user)
        await db.flush()
        dealer.user_id = user.id  # vínculo 1:1 cuenta <-> nómina

    dealer.phone = phone  # guardamos normalizado (igual que User.phone)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_INVITE, entity_type="Dealer", entity_id=dealer.id,
        meta={"phone": phone, "dealer_id": dealer.id, "user_id": user.id, "by": current_user.email},
    )
    await db.commit()

    return _build_invite_response(dealer, current_club.name, phone, code, user.id, channel=channel)


class DealerResetIn(BaseModel):
    phone: Optional[str] = Field(None, min_length=7, max_length=20)  # opcional: corregir el número


@router.post("/{dealer_id}/reset-access", status_code=201)
async def reset_dealer_access(
    dealer_id: int,
    data: DealerResetIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Resetea el acceso de un dealer que YA activó su cuenta (caso típico: olvidó
    la contraseña — no hay recuperación por email porque entra por teléfono).
    Vuelve la cuenta a 'pendiente' y devuelve un nuevo link wa.me con OTP. NO borra
    el dealer ni su historial: turnos/pagos/propinas cuelgan del dealer_id, no del
    user. OWNER/MANAGER."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")
    if not dealer.user_id:
        raise HTTPException(status_code=409, detail="Este dealer no tiene cuenta. Usa 'Invitar a la app'.")

    user = (await db.execute(
        select(models.User).where(models.User.id == dealer.user_id)
    )).scalars().first()
    if user is None:
        raise HTTPException(status_code=409, detail="La cuenta vinculada no existe; desactiva y recrea el dealer")
    if user.hashed_password is None:
        # Aún pendiente: no hay nada que resetear, es una re-invitación.
        raise HTTPException(status_code=409, detail="La cuenta aún no se activó; usa 'Re-invitar' para reenviar el código")

    phone = normalize_phone(data.phone) if data.phone else user.phone
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")
    # Si cambia el número, no puede pertenecer a otra cuenta (es la identidad de login).
    if phone != user.phone:
        if await accounts.phone_taken_by_other(db, phone, current_club.id,
                                               models.UserRole.DEALER, user.id):
            raise HTTPException(status_code=409,
                                detail="Ese teléfono ya tiene cuenta de dealer en este club")

    channel, code = await phone_verify.start_invite(phone)
    user.phone = phone
    user.phone_verified = False
    user.hashed_password = None      # vuelve a 'pendiente' y corta el login con la clave vieja
    user.invitation_token = code
    user.invitation_expires_at = datetime.utcnow() + timedelta(hours=24)
    user.invitation_sent_at = datetime.utcnow()
    user.invitation_attempts = 0     # reset del lockout OTP
    user.verification_channel = channel
    user.is_active = True
    dealer.phone = phone

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_RESET_ACCESS, entity_type="Dealer", entity_id=dealer.id,
        meta={"phone": phone, "dealer_id": dealer.id, "user_id": user.id, "by": current_user.email},
    )
    await db.commit()

    return _build_invite_response(dealer, current_club.name, phone, code, user.id, reset=True, channel=channel)


# ---------------------------------------------------------
# Activación del dealer (PÚBLICO, sin auth): verifica número + crea contraseña.
# ---------------------------------------------------------
class DealerActivateIn(BaseModel):
    phone: str = Field(..., min_length=7, max_length=20)
    code: str = Field(..., min_length=4, max_length=10)
    name: Optional[str] = Field(None, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe tener al menos una mayúscula")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe tener al menos una minúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe tener al menos un número")
        return v


@router.post("/activate")
@limiter.limit("8/hour")
async def activate_dealer(
    data: DealerActivateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """El dealer verifica su número con el código que recibió por WhatsApp y crea
    su contraseña. Devuelve el JWT (auto-login). Público (aún no tiene cuenta)."""
    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")

    # MULTI-CUENTA: un teléfono puede tener cuenta de dealer en varios clubes
    # (y de jugador). Se activa la que tiene invitación PENDIENTE con ESTE código.
    pendientes = [
        u for u in (await db.execute(
            select(models.User).where(
                models.User.phone == phone,
                models.User.role == models.UserRole.DEALER,
            )
        )).scalars().all()
        # Sin exigir invitation_token: las invitaciones por Twilio no guardan
        # código local (su token es NULL).
        if u.hashed_password is None
        and u.invitation_expires_at and u.invitation_expires_at >= datetime.utcnow()
    ]
    # Cuenta inexistente / ya activada / sin código vigente => mensaje genérico
    # (no filtra si el número existe).
    if not pendientes:
        raise HTTPException(status_code=400, detail="Código inválido o vencido")

    loop = asyncio.get_event_loop()
    # Mismo orden seguro que players.activate: candidato → puerta de vinculación
    # (sin consumir Twilio) → validación del código al final (ver accounts.py).
    user, reason, hermanas = await accounts.resolve_pending_activation(
        db, pendientes, phone, data.code, data.password, loop)
    if user is None:
        if reason == "twilio_unavailable":
            raise HTTPException(status_code=503,
                detail="No pudimos verificar el código ahora mismo. Intenta de nuevo en un momento.")
        if reason == "link_required":
            raise HTTPException(status_code=400, detail=accounts.LINK_REQUIRED_MSG)
        for u in pendientes:
            u.invitation_attempts = (u.invitation_attempts or 0) + 1
            if u.invitation_attempts >= 5:
                u.invitation_token = None
                u.invitation_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="Código inválido o vencido")

    user.hashed_password = await loop.run_in_executor(None, auth_utils.get_password_hash, data.password)
    if data.name:
        user.name = data.name
    # Solo verificado si RakeFlow mandó el código (twilio); el plan B no prueba.
    user.phone_verified = (user.verification_channel == "twilio")
    user.invitation_token = None
    user.invitation_expires_at = None
    user.invitation_attempts = 0
    user.last_login_at = datetime.utcnow()

    club = (await db.execute(select(models.Club).where(models.Club.id == user.club_id))).scalars().first()
    await log_action(
        db, request=request, club=club,
        action="DEALER_ACTIVATE", entity_type="User", entity_id=user.id, user=user,
        meta={"phone": phone, "user_id": user.id},
    )
    await db.commit()

    uids = [user.id] + [u.id for u in hermanas]
    access_token = accounts.token_for(user, club, uids)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": "dealer",
        "user_name": user.name,
    }


# ---------------------------------------------------------
# Liquidación (ledger de caja: marcar pagado)
# ---------------------------------------------------------
# El costo del dealer YA se reconoce como gasto en el cierre de la sesión
# (net_rake reduce la utilidad de socios). Esto SOLO registra la entrega física
# de la plata para llevar pendiente vs pagado; no genera gasto financiero nuevo.

@router.get("/payouts", response_model=List[schemas.DealerPayoutResponse])
async def list_payouts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    dealer_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Liquidaciones del club en un rango (por paid_at)."""
    stmt = (
        select(models.DealerPayout, models.Dealer.name)
        .join(models.Dealer, models.Dealer.id == models.DealerPayout.dealer_id)
        .where(models.DealerPayout.club_id == current_club.id)
    )
    if dealer_id is not None:
        stmt = stmt.where(models.DealerPayout.dealer_id == dealer_id)
    if start_date:
        stmt = stmt.where(func.date(models.DealerPayout.paid_at) >= start_date)
    if end_date:
        stmt = stmt.where(func.date(models.DealerPayout.paid_at) <= end_date)
    stmt = stmt.order_by(models.DealerPayout.paid_at.desc())

    rows = (await db.execute(stmt)).all()
    out = []
    for p, name in rows:
        item = schemas.DealerPayoutResponse.model_validate(p)
        item.dealer_name = name
        out.append(item)
    return out


@router.post("/{dealer_id}/payouts", response_model=schemas.DealerPayoutResponse, status_code=201)
async def create_payout(
    dealer_id: int,
    data: schemas.DealerPayoutCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Registra un pago a un dealer (liquidación)."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.id == dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado")

    # El periodo viene completo o no viene: un payout con un solo extremo no
    # cae en ninguna rama del ledger (/stats/dealer-payments) y desaparece.
    if (data.period_start is None) != (data.period_end is None):
        raise HTTPException(status_code=400, detail="El periodo del pago necesita inicio y fin (o ninguno).")
    if data.period_start and data.period_end and data.period_end < data.period_start:
        raise HTTPException(status_code=400, detail="El fin del periodo no puede ser antes del inicio.")

    # Si viene session_id, validar que la mesa sea de este club (no confiar en
    # el payload). NULL = pago general por rango, como hasta ahora.
    session_id = None
    if data.session_id is not None:
        sess = (await db.execute(
            select(models.Session).where(
                models.Session.id == data.session_id,
                models.Session.club_id == current_club.id,
            )
        )).scalars().first()
        if not sess:
            raise HTTPException(status_code=404, detail="Mesa no encontrada")
        session_id = sess.id

    payout = models.DealerPayout(
        club_id=current_club.id,
        dealer_id=dealer.id,
        session_id=session_id,
        amount=float(data.amount),
        method=data.method,
        note=data.note,
        period_start=data.period_start,
        period_end=data.period_end,
        paid_by_user_id=current_user.id,
    )
    db.add(payout)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_PAYOUT, entity_type="Dealer", entity_id=dealer.id,
        meta={"dealer": dealer.name, "amount": float(data.amount), "method": data.method},
    )
    await db.commit()
    await db.refresh(payout)

    resp = schemas.DealerPayoutResponse.model_validate(payout)
    resp.dealer_name = dealer.name
    return resp


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


@shifts_router.get("/{session_id}/dealer-payments")
async def session_dealer_payments(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Pago por-dealer de UNA mesa (control en la mesa activa). Por cada dealer
    que pasó por la mesa: devengado (Σ turnos: horas × tarifa + % del rake),
    pagado (Σ payouts ligados a ESTA mesa) y pendiente. El turno ABIERTO se
    estima con horas exactas + el rake declarado HASTA AHORA vía declare-rake
    (si no han declarado nada, rake 0 hasta el cierre) — igual que la barra en
    vivo del DealerPanel. OWNER/MANAGER."""
    session = (await db.execute(
        select(models.Session).where(
            models.Session.id == session_id,
            models.Session.club_id == current_club.id,
        )
    )).scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")

    now = datetime.utcnow()
    shift_rows = (await db.execute(
        select(models.DealerShift, models.Dealer.name)
        .join(models.Dealer, models.Dealer.id == models.DealerShift.dealer_id)
        .where(
            models.DealerShift.session_id == session_id,
            models.DealerShift.club_id == current_club.id,
            models.Dealer.club_id == current_club.id,  # cinturón y tirantes
        )
        .order_by(models.DealerShift.start_time)
    )).all()

    # Agregado por dealer. Reusa la fuente única services.shift_payment_breakdown
    # (misma plata que verá el cierre y el reporte por rango).
    per: dict = {}
    for shift, name in shift_rows:
        end = shift.end_time or now
        hours = dealer_view.shift_hours(shift.start_time, end)
        bd = services.shift_payment_breakdown(
            hours, shift.hourly_rate_cop, shift.rake_pct, shift.declared_rake)
        d = per.setdefault(shift.dealer_id, {
            "dealer_id": shift.dealer_id, "name": name,
            "hours": 0.0, "hour_payment": 0, "rake_commission": 0,
            "club_payment": 0, "has_open_shift": False, "rake_pct_open": 0,
            # De dónde sale el "% del rake": rake declarado en sus turnos y el
            # % aplicado (si todos los turnos comparten %, se muestra; si no, None).
            "declared_rake": 0.0, "rake_pct": None, "rake_pct_mixed": False,
        })
        d["hours"] += hours
        d["hour_payment"] += bd["hour_payment"]
        d["rake_commission"] += bd["rake_commission"]
        d["club_payment"] += bd["club_payment"]
        # Clamp a >=0 como el breakdown (services.py): un remainder negativo del
        # cierre no comisiona y no debe restar del "por qué".
        d["declared_rake"] += max(0.0, float(shift.declared_rake or 0))
        pct = float(shift.rake_pct or 0)
        if d["rake_pct"] is None:
            d["rake_pct"] = pct
        elif d["rake_pct"] != pct:
            d["rake_pct_mixed"] = True
        if shift.end_time is None:
            d["has_open_shift"] = True
            d["rake_pct_open"] = shift.rake_pct

    # Pagos ligados a ESTA mesa (session_id) — no los del rango general.
    pay_rows = (await db.execute(
        select(models.DealerPayout.dealer_id,
               func.coalesce(func.sum(models.DealerPayout.amount), 0.0))
        .where(
            models.DealerPayout.club_id == current_club.id,
            models.DealerPayout.session_id == session_id,
        )
        .group_by(models.DealerPayout.dealer_id)
    )).all()
    paid_map = {did: float(total or 0) for did, total in pay_rows}

    # Propinas del dealer en ESTA mesa (informativas: NO suman al 'a pagar' —
    # la propina sale de la caja al registrarla, igual que en el cierre).
    tip_rows = (await db.execute(
        select(models.Transaction.dealer_id,
               func.coalesce(func.sum(models.Transaction.amount), 0.0))
        .where(
            models.Transaction.session_id == session_id,
            models.Transaction.dealer_id.is_not(None),
            models.Transaction.type == models.TransactionType.TIP,
        )
        .group_by(models.Transaction.dealer_id)
    )).all()
    tips_map = {did: float(t or 0) for did, t in tip_rows}

    dealers = []
    for did, d in per.items():
        paid = paid_map.get(did, 0.0)
        dealers.append({
            **d,
            "hours": round(d["hours"], 2),
            "paid": round(paid),
            "pending": max(0, round(d["club_payment"] - paid)),
            # Sobre-pago visible (no clampearlo en silencio): pagar contra el
            # estimado en vivo y que el cierre ajuste el rake a la baja deja
            # paid > club_payment — el staff debe verlo para cuadrar caja.
            "overpaid": max(0, round(paid - d["club_payment"])),
            "tips": round(tips_map.get(did, 0.0)),
        })
    dealers.sort(key=lambda x: (x["name"] or "").lower())

    summary = {
        "club_payment": sum(x["club_payment"] for x in dealers),
        "paid": sum(x["paid"] for x in dealers),
        "pending": sum(x["pending"] for x in dealers),
        "total_hours": round(sum(x["hours"] for x in dealers), 2),
    }
    return {
        "session_id": session_id,
        "session_open": session.status == models.SessionStatus.OPEN,
        "dealers": dealers,
        "summary": summary,
    }


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


@shifts_router.get("/{session_id}/dealer-shifts/declares")
async def list_shift_declares(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Cortes de rake del turno ABIERTO de esta mesa: cada declaración hecha con
    declare-rake (hora + total declarado + valor anterior), leída de la
    auditoría. Para que el cajero vea el ritmo del rake por tramo. [] si la
    mesa no tiene turno abierto o aún no declararon."""
    await _get_open_session(db, session_id, current_club.id)
    shift = await _get_open_shift(db, session_id, current_club.id)
    if not shift:
        return {"declares": []}
    rows = (await db.execute(
        select(models.AuditLog)
        .where(
            models.AuditLog.club_id == current_club.id,
            models.AuditLog.action == AuditAction.DEALER_SHIFT_DECLARE,
            models.AuditLog.entity_type == "DealerShift",
            models.AuditLog.entity_id == shift.id,
        )
        .order_by(models.AuditLog.created_at)
    )).scalars().all()
    return {"declares": [
        {
            "at": dealer_view.utc_iso(r.created_at),
            "declared_rake": (r.meta or {}).get("declared_rake"),
            "previous_declared": (r.meta or {}).get("previous_declared"),
        } for r in rows
    ]}


@shifts_router.post("/{session_id}/dealer-shifts/declare-rake")
async def declare_shift_rake(
    session_id: int,
    data: schemas.DealerShiftDeclareRake,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Actualiza el rake declarado HASTA AHORA del turno ABIERTO, sin cerrarlo.
    Es el TOTAL acumulado del turno (no un incremento): cada declaración PISA la
    anterior — el registro de cada corte queda en la auditoría. Con esto el pago
    estimado del dealer (barra en vivo, control por-dealer y su propia vista)
    incluye su % del rake en todo momento, no solo al cerrar. El cierre del
    turno (change/end) o de la sesión declara el total definitivo y lo pisa."""
    await _get_open_session(db, session_id, current_club.id)

    current_shift = await _get_open_shift(db, session_id, current_club.id, for_update=True)
    if not current_shift:
        raise HTTPException(status_code=409, detail="No hay un dealer asignado en esta mesa.")

    previous = current_shift.declared_rake
    current_shift.declared_rake = float(data.declared_rake)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.DEALER_SHIFT_DECLARE, entity_type="DealerShift", entity_id=current_shift.id,
        meta={
            "session_id": session_id,
            "dealer_id": current_shift.dealer_id,
            "declared_rake": float(data.declared_rake),
            "previous_declared": previous,
        },
    )
    await db.commit()

    result = await db.execute(
        select(models.Dealer.name).where(
            models.Dealer.id == current_shift.dealer_id,
            models.Dealer.club_id == current_club.id,
        )
    )
    dealer_name = result.scalar() or ""
    return _shift_to_dict(current_shift, dealer_name)
