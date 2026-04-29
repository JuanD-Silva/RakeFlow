"""
Cobros recurrentes de suscripciones (cron diario).

Para cada club con:
- subscription_active = True
- wompi_payment_source_id IS NOT NULL
- subscription_period_end <= now + RENEW_WINDOW_DAYS
- sin intento de cobro en las ultimas 24h (idempotencia)

cobra el plan via charge_payment_source y:
- APPROVED: renueva +30 dias y manda email de exito
- DECLINED/ERROR: manda email de pago fallido (no desactiva, da gracia)
- PENDING: deja pasar; el webhook cerrara la operacion

Diseno idempotente: si por error el cron corre 2 veces el mismo dia,
el chequeo de "intento reciente" via audit_logs evita doble cobro.
"""

import logging
import time
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_

from . import models, payments_wompi
from .audit import log_action

logger = logging.getLogger(__name__)

RENEW_WINDOW_DAYS = 3   # cobrar suscripciones que vencen en <=3 dias
MAX_BATCH = 200          # safety: nunca procesar mas que esto en una corrida


async def _had_recent_attempt(db: AsyncSession, club_id: int, hours: int = 24) -> bool:
    """Idempotencia: chequea si hubo un intento de renovacion en las ultimas N horas."""
    since = datetime.utcnow() - timedelta(hours=hours)
    stmt = (
        select(models.AuditLog)
        .where(models.AuditLog.club_id == club_id)
        .where(models.AuditLog.action.in_(["SUBSCRIPTION_RENEWED", "SUBSCRIPTION_RENEW_FAILED", "SUBSCRIPTION_RENEW_PENDING"]))
        .where(models.AuditLog.created_at >= since)
        .limit(1)
    )
    res = await db.execute(stmt)
    return res.scalars().first() is not None


async def run_renewals(db: AsyncSession, plan_price_cop: int, *, dry_run: bool = False) -> dict[str, Any]:
    """Procesa renovaciones. Retorna resumen para el response del endpoint."""
    now = datetime.utcnow()
    cutoff = now + timedelta(days=RENEW_WINDOW_DAYS)

    stmt = (
        select(models.Club)
        .where(models.Club.subscription_active == True)
        .where(models.Club.wompi_payment_source_id.isnot(None))
        .where(models.Club.subscription_period_end.isnot(None))
        .where(models.Club.subscription_period_end <= cutoff)
        .limit(MAX_BATCH)
    )
    candidates = (await db.execute(stmt)).scalars().all()

    summary: dict[str, Any] = {
        "ts": now.isoformat(),
        "candidates_total": len(candidates),
        "approved": 0,
        "declined": 0,
        "pending": 0,
        "skipped_recent": 0,
        "errors": 0,
        "details": [],
    }

    if dry_run:
        for c in candidates:
            summary["details"].append({
                "club_id": c.id, "name": c.name,
                "period_end": c.subscription_period_end.isoformat() if c.subscription_period_end else None,
                "card": f"{c.wompi_card_brand}-{c.wompi_card_last4}" if c.wompi_card_brand else None,
                "action": "would_charge",
            })
        return summary

    # Importar email service tarde para evitar circularidad
    from . import email_service

    for club in candidates:
        try:
            if await _had_recent_attempt(db, club.id):
                summary["skipped_recent"] += 1
                continue

            reference = f"rakeflow-club-{club.id}-renew-{int(time.time())}"
            customer_email = club.wompi_customer_email or club.email

            try:
                tx = await payments_wompi.charge_payment_source(
                    payment_source_id=club.wompi_payment_source_id,
                    customer_email=customer_email,
                    amount_cop=plan_price_cop,
                    reference=reference,
                    recurrent=True,
                )
            except Exception as e:
                logger.exception("renewal_charge_exception club=%s: %s", club.id, e)
                summary["errors"] += 1
                await log_action(
                    db, club=club,
                    action="SUBSCRIPTION_RENEW_FAILED",
                    entity_type="Subscription",
                    meta={"reason": "charge_exception", "error": str(e)[:200]},
                )
                await db.commit()
                continue

            transaction_id = tx.get("id", "")
            status = tx.get("status", "PENDING")

            if status == "APPROVED":
                period_end = (club.subscription_period_end or now) + timedelta(days=30)
                club.subscription_period_end = period_end
                await log_action(
                    db, club=club,
                    action="SUBSCRIPTION_RENEWED",
                    entity_type="Subscription",
                    meta={
                        "provider": "wompi",
                        "via": "cron",
                        "transaction_id": transaction_id,
                        "amount_cop": plan_price_cop,
                        "period_end": period_end.isoformat(),
                    },
                )
                await db.commit()

                try:
                    email_service.send_payment_succeeded_email(
                        to_email=club.email,
                        club_name=club.name,
                        amount=plan_price_cop,
                        period_end=period_end,
                        card_brand=club.wompi_card_brand,
                        card_last4=club.wompi_card_last4,
                    )
                except Exception:
                    logger.exception("send_payment_succeeded_email_failed")

                summary["approved"] += 1
                summary["details"].append({"club_id": club.id, "status": "APPROVED", "tx": transaction_id})

            elif status == "PENDING":
                await log_action(
                    db, club=club,
                    action="SUBSCRIPTION_RENEW_PENDING",
                    entity_type="Subscription",
                    meta={"provider": "wompi", "transaction_id": transaction_id},
                )
                await db.commit()
                summary["pending"] += 1
                summary["details"].append({"club_id": club.id, "status": "PENDING", "tx": transaction_id})

            else:  # DECLINED, ERROR, VOIDED
                status_msg = tx.get("status_message") or status
                await log_action(
                    db, club=club,
                    action="SUBSCRIPTION_RENEW_FAILED",
                    entity_type="Subscription",
                    meta={
                        "provider": "wompi",
                        "transaction_id": transaction_id,
                        "wompi_status": status,
                        "status_message": status_msg,
                    },
                )
                await db.commit()

                try:
                    email_service.send_payment_failed_email(
                        to_email=club.email,
                        club_name=club.name,
                        amount=plan_price_cop,
                        reason=status_msg,
                        card_brand=club.wompi_card_brand,
                        card_last4=club.wompi_card_last4,
                    )
                except Exception:
                    logger.exception("send_payment_failed_email_failed")

                summary["declined"] += 1
                summary["details"].append({"club_id": club.id, "status": status, "tx": transaction_id})

        except Exception:
            logger.exception("renewal_unexpected_error club=%s", getattr(club, "id", "?"))
            summary["errors"] += 1
            await db.rollback()

    return summary
