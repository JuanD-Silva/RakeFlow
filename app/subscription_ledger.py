"""Libro de pagos de suscripción: la única puerta para extender un plan.

Antes cada camino (confirm, webhook, subscribe, cron) sumaba sus 30 días por su
cuenta y sin memoria: un webhook reintentado regalaba un mes por entrega, el
webhook de un cobro del cron extendía otra vez, y /wompi/confirm aceptaba
reusar una transacción vieja. Ahora:

  - apply_approved(): una referencia o transacción ya APPROVED no vuelve a
    sumar días (fila bloqueada FOR UPDATE + índices únicos), y el monto debe
    cubrir el precio del club en COP.
  - reserve(): crea la fila PENDING ANTES de cobrar. El cron usa un índice
    único por (club, vencimiento) para que dos corridas no cobren el mismo
    periodo.
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from . import models
from .audit import log_action

logger = logging.getLogger(__name__)

PLAN_PRICE = 199000  # COP — precio default del Plan Pro
PERIOD_DAYS = 30

APPROVED, PENDING, DECLINED, ERROR = "APPROVED", "PENDING", "DECLINED", "ERROR"


def price_for(club: models.Club) -> int:
    """Precio aplicable: el grandfathered del club si lo tiene, si no el default."""
    return int(club.subscription_price_cop) if club.subscription_price_cop else PLAN_PRICE


def renew_period_key(club: models.Club) -> str | None:
    return club.subscription_period_end.date().isoformat() if club.subscription_period_end else None


async def reserve(db: AsyncSession, club: models.Club, *, reference: str, kind: str,
                  amount_cop: int, period_key: str | None = None) -> models.SubscriptionPayment | None:
    """Anota el intento (PENDING) y hace COMMIT antes de cobrar. Devuelve None
    si otro proceso ya reservó (misma referencia o mismo periodo de renovación).
    ON CONFLICT DO NOTHING en vez de capturar IntegrityError: un rollback
    expiraría los objetos de la sesión (el club del loop del cron)."""
    now = datetime.utcnow()
    new_id = (await db.execute(
        pg_insert(models.SubscriptionPayment.__table__)
        .values(club_id=club.id, reference=reference, kind=kind, status=PENDING,
                amount_cop=amount_cop, period_key=period_key, created_at=now, updated_at=now)
        .on_conflict_do_nothing()
        .returning(models.SubscriptionPayment.__table__.c.id)
    )).scalar()
    await db.commit()
    if new_id is None:
        return None
    return await db.get(models.SubscriptionPayment, new_id)


async def mark(db: AsyncSession, row: models.SubscriptionPayment, status: str, provider_tx_id: str | None = None):
    row.status = status
    if provider_tx_id and not row.provider_tx_id:
        row.provider_tx_id = provider_tx_id
    row.updated_at = datetime.utcnow()
    await db.commit()


async def apply_approved(db: AsyncSession, club: models.Club, *, reference: str, provider_tx_id: str | None,
                         amount_in_cents: int | None, currency: str | None, kind: str, via: str,
                         request=None, extra_meta: dict | None = None) -> dict:
    """Aplica un pago APPROVED una sola vez. NO hace commit (lo hace el caller,
    junto con sus propios cambios). Devuelve:
      {"applied": True,  "period_end": dt}             → se sumaron 30 días
      {"applied": False, "reason": "already_applied"}  → ya estaba aplicado
      {"applied": False, "reason": "amount_mismatch" | "currency_mismatch"}
    """
    price = price_for(club)
    if currency and currency.upper() != "COP":
        logger.warning("subscription_currency_mismatch club=%s ref=%s cur=%s", club.id, reference, currency)
        return {"applied": False, "reason": "currency_mismatch"}
    if amount_in_cents is not None and int(amount_in_cents) < price * 100:
        logger.warning("subscription_amount_mismatch club=%s ref=%s cents=%s price=%s",
                       club.id, reference, amount_in_cents, price)
        await log_action(db, club=club, request=request, action="SUBSCRIPTION_PAYMENT_REJECTED",
                         entity_type="Subscription",
                         meta={"reason": "amount_mismatch", "reference": reference,
                               "transaction_id": provider_tx_id, "amount_cop": int(amount_in_cents) // 100,
                               "expected_cop": price, "via": via})
        return {"applied": False, "reason": "amount_mismatch"}

    # 1) ¿Esta transacción ya se aplicó con otra referencia (p.ej. backfill legacy)?
    if provider_tx_id:
        by_tx = (await db.execute(
            select(models.SubscriptionPayment)
            .where(models.SubscriptionPayment.provider_tx_id == provider_tx_id)
            .with_for_update()
        )).scalars().first()
        if by_tx is not None and by_tx.status == APPROVED:
            return {"applied": False, "reason": "already_applied", "period_end": club.subscription_period_end}

    # 2) Fila de la referencia (bloqueada). Si no existe, se crea.
    row = (await db.execute(
        select(models.SubscriptionPayment)
        .where(models.SubscriptionPayment.reference == reference)
        .with_for_update()
    )).scalars().first()
    if row is None:
        await db.execute(
            pg_insert(models.SubscriptionPayment.__table__)
            .values(club_id=club.id, reference=reference, kind=kind, status=PENDING,
                    amount_cop=(int(amount_in_cents) // 100) if amount_in_cents is not None else price,
                    created_at=datetime.utcnow(), updated_at=datetime.utcnow())
            .on_conflict_do_nothing()
        )
        row = (await db.execute(
            select(models.SubscriptionPayment)
            .where(models.SubscriptionPayment.reference == reference)
            .with_for_update()
        )).scalars().first()
    if row is None or row.status == APPROVED:
        return {"applied": False, "reason": "already_applied", "period_end": club.subscription_period_end}
    if row.club_id != club.id:
        logger.error("subscription_reference_club_mismatch ref=%s row_club=%s club=%s", reference, row.club_id, club.id)
        return {"applied": False, "reason": "club_mismatch"}

    # 3) Extender desde el vencimiento vigente (o desde hoy si ya venció).
    now = datetime.utcnow()
    base = club.subscription_period_end if (club.subscription_period_end and club.subscription_period_end > now) else now
    period_end = base + timedelta(days=PERIOD_DAYS)
    club.subscription_active = True
    club.plan_type = "PRO"
    club.subscription_period_end = period_end

    row.status = APPROVED
    if provider_tx_id:
        row.provider_tx_id = provider_tx_id
    if amount_in_cents is not None:
        row.amount_cop = int(amount_in_cents) // 100
    row.period_end_applied = period_end
    row.updated_at = now

    meta = {"provider": "wompi", "via": via, "transaction_id": provider_tx_id, "reference": reference,
            "amount_cop": row.amount_cop, "period_end": period_end.isoformat()}
    meta.update(extra_meta or {})
    await log_action(db, club=club, request=request,
                     action="SUBSCRIPTION_RENEWED" if kind == "renew" else "SUBSCRIPTION_PAID",
                     entity_type="Subscription", meta=meta)
    return {"applied": True, "period_end": period_end}


async def mark_by_reference(db: AsyncSession, reference: str, status: str, provider_tx_id: str | None = None):
    """Para eventos no aprobados del webhook: libera la reserva (DECLINED/ERROR)."""
    row = (await db.execute(
        select(models.SubscriptionPayment)
        .where(models.SubscriptionPayment.reference == reference)
        .with_for_update()
    )).scalars().first()
    if row is not None and row.status == PENDING:
        await mark(db, row, status, provider_tx_id)


async def pending_subscribe_recent(db: AsyncSession, club_id: int, minutes: int = 15) -> bool:
    since = datetime.utcnow() - timedelta(minutes=minutes)
    n = (await db.execute(
        select(func.count(models.SubscriptionPayment.id)).where(
            models.SubscriptionPayment.club_id == club_id,
            models.SubscriptionPayment.kind == "subscribe",
            models.SubscriptionPayment.status == PENDING,
            models.SubscriptionPayment.created_at >= since,
        )
    )).scalar()
    return bool(n)
