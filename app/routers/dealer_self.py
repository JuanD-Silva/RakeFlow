# app/routers/dealer_self.py
"""
Vista AUTENTICADA del dealer (rol DEALER). El dealer logueado opera SU mesa
(la de su turno abierto) y ve su portal (turno actual, historial, resumen).

A diferencia del link público anónimo (app/routers/public.py), acá la identidad
es real: las acciones quedan auditadas con el usuario del dealer, y la mesa se
resuelve por su user_id -> Dealer -> turno abierto (nunca por un token elegido
por el cliente). El dealer NO maneja turnos (eso lo hace el cajero) ni ve plata
del club ni de otros dealers: solo sus propios números.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, services
from ..dependencies import get_db, require_role
from ..audit import log_action, AuditAction
from ..dealer_view import utc_iso, session_players, shift_hours, ALERT_TYPES

router = APIRouter(prefix="/dealer", tags=["DealerSelf"])

# Todos los endpoints exigen rol DEALER.
_require_dealer = require_role([models.UserRole.DEALER])


class BustIn(BaseModel):
    player_id: int


class AlertIn(BaseModel):
    alert_type: str
    message: Optional[str] = Field(None, max_length=200)


async def _my_dealer(db: AsyncSession, user: models.User) -> models.Dealer:
    """Entidad Dealer vinculada a la cuenta. 404 si la cuenta no está vinculada."""
    dealer = (await db.execute(
        select(models.Dealer).where(
            models.Dealer.user_id == user.id,
            models.Dealer.club_id == user.club_id,
            models.Dealer.is_active == True,  # noqa: E712
        )
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Tu cuenta no está vinculada a un dealer activo")
    return dealer


async def _my_open_shift(db: AsyncSession, dealer: models.Dealer, club_id: int):
    """(shift, session) del turno abierto del dealer, o (None, None) si no tiene.
    Si la sesión está CLOSED se trata como sin mesa."""
    shift = (await db.execute(
        select(models.DealerShift).where(
            models.DealerShift.dealer_id == dealer.id,
            models.DealerShift.club_id == club_id,
            models.DealerShift.end_time.is_(None),
        ).order_by(models.DealerShift.start_time.desc())
    )).scalars().first()
    if not shift:
        return None, None
    session = (await db.execute(
        select(models.Session).where(
            models.Session.id == shift.session_id,
            models.Session.club_id == club_id,
        )
    )).scalars().first()
    if not session or session.status != models.SessionStatus.OPEN:
        return None, None
    return shift, session


# ---------------------------------------------------------
# 1. MI MESA (operar): jugadores + cupos
# ---------------------------------------------------------
@router.get("/my-table")
async def my_table(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    dealer = await _my_dealer(db, current_user)
    shift, session = await _my_open_shift(db, dealer, current_user.club_id)
    if not session:
        return {"has_table": False, "dealer_name": dealer.name}

    players = await session_players(db, session.id)
    active = sum(1 for p in players if not p["is_busted"])
    cap = int(session.max_players) if session.max_players else None
    return {
        "has_table": True,
        "dealer_name": dealer.name,
        "table_name": session.name or f"Mesa #{session.id}",
        "is_open": True,
        "max_players": cap,
        "players_count": active,
        "seats_available": max(0, cap - active) if cap is not None else None,
        "players": players,
    }


@router.post("/my-table/bust")
async def my_table_bust(
    data: BustIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    """Sacar/devolver un jugador (toggle BUST). No financiero (amount=0).
    Auditado con el usuario real del dealer."""
    dealer = await _my_dealer(db, current_user)
    shift, session = await _my_open_shift(db, dealer, current_user.club_id)
    if not session:
        raise HTTPException(status_code=409, detail="No tenés una mesa asignada")

    # Tenant safety: el jugador debe estar sentado en ESTA mesa y ser del club.
    seated = (await db.execute(
        select(models.Transaction.id)
        .join(models.Player, models.Player.id == models.Transaction.player_id)
        .where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Player.club_id == session.club_id,
            models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]),
        ).limit(1)
    )).first()
    if not seated:
        raise HTTPException(status_code=404, detail="Jugador no está en esta mesa")

    existing = (await db.execute(
        select(models.Transaction.id).where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Transaction.type == models.TransactionType.BUST,
        ).limit(1)
    )).first()

    club = (await db.execute(select(models.Club).where(models.Club.id == current_user.club_id))).scalars().first()

    if existing:
        await db.execute(delete(models.Transaction).where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Transaction.type == models.TransactionType.BUST,
        ))
        if club:
            await log_action(
                db, request=request, club=club, user=current_user,
                action=AuditAction.TRANSACTION_BUST_TOGGLE,
                entity_type="Transaction",
                meta={"player_id": data.player_id, "session_id": session.id,
                      "is_busted": False, "undo": True, "source": "dealer_authenticated"},
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
    if club:
        await log_action(
            db, request=request, club=club, user=current_user,
            action=AuditAction.TRANSACTION_BUST_TOGGLE,
            entity_type="Transaction", entity_id=new_tx.id,
            meta={"player_id": data.player_id, "session_id": session.id,
                  "is_busted": True, "source": "dealer_authenticated"},
        )
    await db.commit()
    return {"action": "busted", "is_busted": True}


@router.post("/my-table/alert", status_code=201)
async def my_table_alert(
    data: AlertIn,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    dealer = await _my_dealer(db, current_user)
    shift, session = await _my_open_shift(db, dealer, current_user.club_id)
    if not session:
        raise HTTPException(status_code=409, detail="No tenés una mesa asignada")

    alert_type = (data.alert_type or "").upper()
    if alert_type not in ALERT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de alerta inválido")

    recent = (await db.execute(
        select(models.DealerAlert).where(
            models.DealerAlert.club_id == session.club_id,
            models.DealerAlert.session_id == session.id,
            models.DealerAlert.alert_type == alert_type,
            models.DealerAlert.status == "PENDING",
            models.DealerAlert.created_at >= datetime.utcnow() - timedelta(seconds=30),
        )
    )).scalars().first()
    if recent:
        return {"status": "already_sent", "alert_type": alert_type}

    alert = models.DealerAlert(
        club_id=session.club_id,
        session_id=session.id,
        alert_type=alert_type,
        message=(data.message or "").strip() or None,
        dealer_name=dealer.name,
        status="PENDING",
    )
    db.add(alert)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"status": "already_sent", "alert_type": alert_type}
    return {"status": "sent", "alert_type": alert_type}


# ---------------------------------------------------------
# 2. PORTAL DEL DEALER: turno actual, historial, resumen
# ---------------------------------------------------------
@router.get("/my-shift")
async def my_shift(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    """Turno abierto actual: tiempo + pago ESTIMADO en vivo (solo horas×tarifa;
    el % del rake del turno no se conoce hasta que el cajero lo cuente al cierre)."""
    dealer = await _my_dealer(db, current_user)
    shift, session = await _my_open_shift(db, dealer, current_user.club_id)
    if not session:
        return {"has_shift": False, "dealer_name": dealer.name}

    hours = shift_hours(shift.start_time)
    est_pay_hours_only = round(hours * (shift.hourly_rate_cop or 0.0))
    return {
        "has_shift": True,
        "dealer_name": dealer.name,
        "table_name": session.name or f"Mesa #{session.id}",
        "start_time": utc_iso(shift.start_time),
        "hours": round(hours, 2),
        "hourly_rate_cop": shift.hourly_rate_cop,
        "rake_pct": shift.rake_pct,
        "estimated_pay_hours_only": est_pay_hours_only,
        "note": "Estimado por horas; el % del rake del turno se suma al cierre.",
    }


@router.get("/my-history")
async def my_history(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    """Turnos CERRADOS del dealer con su pago (mismo cálculo que el cierre)."""
    dealer = await _my_dealer(db, current_user)
    limit = max(1, min(limit, 200))
    rows = (await db.execute(
        select(models.DealerShift, models.Session.name)
        .join(models.Session, models.Session.id == models.DealerShift.session_id)
        .where(
            models.DealerShift.dealer_id == dealer.id,
            models.DealerShift.club_id == current_user.club_id,
            models.DealerShift.end_time.is_not(None),
        )
        .order_by(models.DealerShift.start_time.desc())
        .limit(limit)
    )).all()

    history = []
    for shift, session_name in rows:
        hours = shift_hours(shift.start_time, shift.end_time)
        payment = services.shift_payment(hours, shift.hourly_rate_cop, shift.rake_pct, shift.declared_rake)
        history.append({
            "shift_id": shift.id,
            "session_id": shift.session_id,
            "table_name": session_name or f"Mesa #{shift.session_id}",
            "start_time": utc_iso(shift.start_time),
            "end_time": utc_iso(shift.end_time),
            "hours": round(hours, 2),
            "declared_rake": shift.declared_rake,
            "payment": round(payment),
        })
    return {"shifts": history}


@router.get("/my-summary")
async def my_summary(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(_require_dealer),
):
    """Resumen del dealer: ganado este mes, total, horas, # turnos, y
    devengado vs pagado vs pendiente. Solo SUS números."""
    dealer = await _my_dealer(db, current_user)

    # Turnos cerrados del dealer (devengado = Σ pago por turno).
    shifts = (await db.execute(
        select(models.DealerShift).where(
            models.DealerShift.dealer_id == dealer.id,
            models.DealerShift.club_id == current_user.club_id,
            models.DealerShift.end_time.is_not(None),
        )
    )).scalars().all()

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    earned_total = 0.0
    earned_month = 0.0
    hours_total = 0.0
    sessions_set = set()
    for s in shifts:
        hours = shift_hours(s.start_time, s.end_time)
        pay = services.shift_payment(hours, s.hourly_rate_cop, s.rake_pct, s.declared_rake)
        earned_total += pay
        hours_total += hours
        sessions_set.add(s.session_id)
        if s.end_time and s.end_time >= month_start:
            earned_month += pay

    # Pagado (liquidaciones registradas al dealer).
    paid_total = float((await db.execute(
        select(func.coalesce(func.sum(models.DealerPayout.amount), 0.0)).where(
            models.DealerPayout.dealer_id == dealer.id,
            models.DealerPayout.club_id == current_user.club_id,
        )
    )).scalar() or 0.0)

    return {
        "dealer_name": dealer.name,
        "earned_month": round(earned_month),
        "earned_total": round(earned_total),
        "hours_total": round(hours_total, 1),
        "shifts_count": len(shifts),
        "sessions_count": len(sessions_set),
        "paid_total": round(paid_total),
        "pending_total": round(earned_total - paid_total),
    }
