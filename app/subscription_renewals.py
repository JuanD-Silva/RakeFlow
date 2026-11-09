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

Diseno idempotente: antes de cobrar se RESERVA el periodo en
subscription_payments (índice único por club + vencimiento, commit previo al
cobro). Dos corridas simultáneas: una gana la reserva, la otra salta. El
APPROVED se aplica por subscription_ledger.apply_approved, así el webhook del
mismo cobro no vuelve a sumar 30 días.
"""

import logging
import secrets

import httpx
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_

from . import models, payments_wompi
from . import subscription_ledger as ledger
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


async def _reconcile_pending(db: AsyncSession, summary: dict[str, Any]) -> None:
    """Reservas PENDING de más de 1 h (webhook perdido o timeout al cobrar):
    se consulta el estado real en Wompi. APPROVED se aplica (una sola vez);
    DECLINED/ERROR/VOIDED libera la reserva. Sin transacción conocida y con
    más de 24 h, se marca ERROR: Wompi nunca registró el cobro."""
    old = datetime.utcnow() - timedelta(hours=1)
    row_ids = (await db.execute(
        select(models.SubscriptionPayment.id)
        .where(models.SubscriptionPayment.status == ledger.PENDING)
        .where(models.SubscriptionPayment.created_at <= old)
        .limit(MAX_BATCH)
    )).scalars().all()
    # Por id y releída en cada vuelta: un rollback expira los objetos de la
    # sesión y un lazy load en async revienta (MissingGreenlet).
    for rid in row_ids:
        try:
            row = await db.get(models.SubscriptionPayment, rid, populate_existing=True)
            if row is None or row.status != ledger.PENDING:
                continue
            if not row.provider_tx_id:
                # Cobro en el aire sin transaction_id: se busca por referencia.
                found = await payments_wompi.find_transactions_by_reference(row.reference)
                if found:
                    # Solo transacciones de ESTA referencia (por si el filtro no se aplicó).
                    found = [x for x in found if x.get("reference") == row.reference] or None
                if found:
                    row.provider_tx_id = found[0].get("id")
                    await db.commit()
                elif found == []:
                    # Wompi respondió y no tiene esa referencia: no hubo cobro.
                    await ledger.mark(db, row, ledger.ERROR)
                    summary["reconciled"] += 1
                    continue
                else:
                    # No se pudo consultar. Pasadas 24 h se escala a revisión
                    # manual (REVIEW sigue bloqueando el periodo: nunca se
                    # vuelve a cobrar a ciegas un cobro que pudo haber salido).
                    if row.created_at <= datetime.utcnow() - timedelta(hours=24):
                        await ledger.mark(db, row, ledger.REVIEW)
                        club = await db.get(models.Club, row.club_id)
                        if club is not None:
                            await log_action(db, club=club, action="SUBSCRIPTION_PAYMENT_REVIEW",
                                             entity_type="Subscription",
                                             meta={"reference": row.reference, "kind": row.kind,
                                                   "reason": "uncertain_charge_unreconciled"})
                            await db.commit()
                        logger.error("subscription_payment_needs_review ref=%s club=%s", row.reference, row.club_id)
                        summary["reconciled"] += 1
                    continue
            tx = await payments_wompi.get_transaction(row.provider_tx_id)
            st = tx.get("status")
            if st == "APPROVED":
                club = await db.get(models.Club, row.club_id)
                if club is None:
                    continue
                await ledger.apply_approved(
                    db, club, reference=row.reference, provider_tx_id=row.provider_tx_id,
                    amount_in_cents=tx.get("amount_in_cents"), currency=tx.get("currency"),
                    kind=row.kind, via="reconcile",
                )
                await db.commit()
                summary["reconciled"] += 1
            elif st in ("DECLINED", "ERROR", "VOIDED"):
                await ledger.mark(db, row, ledger.DECLINED if st == "DECLINED" else ledger.ERROR)
                summary["reconciled"] += 1
        except Exception:
            logger.exception("renewal_reconcile_failed id=%s", rid)
            await db.rollback()


async def run_renewals(db: AsyncSession, plan_price_cop: int, *, dry_run: bool = False) -> dict[str, Any]:
    """
    Procesa renovaciones. Retorna resumen para el response del endpoint.
    plan_price_cop = default global; cada club puede tener subscription_price_cop
    propio (grandfather), que tiene prioridad.
    """
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
    candidate_ids = [c.id for c in candidates]  # antes de cualquier rollback (expira objetos)

    summary: dict[str, Any] = {
        "ts": now.isoformat(),
        "candidates_total": len(candidates),
        "approved": 0,
        "declined": 0,
        "pending": 0,
        "skipped_recent": 0,
        "errors": 0,
        "reconciled": 0,
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

    await _reconcile_pending(db, summary)

    for club_id in candidate_ids:
        try:
            # Releer el club: la conciliación, un webhook o /subscribe pudieron
            # renovarlo después de armar la lista (y un rollback expira objetos).
            club = await db.get(models.Club, club_id, populate_existing=True)
            if club is None or not club.subscription_active or not club.wompi_payment_source_id:
                continue
            if club.subscription_period_end and club.subscription_period_end > cutoff:
                summary["skipped_recent"] += 1
                continue
            # Un /wompi/subscribe en vuelo (el dueño pagando ahora): no cobrar encima.
            sub_pending = (await db.execute(
                select(models.SubscriptionPayment.id)
                .where(models.SubscriptionPayment.club_id == club_id)
                .where(models.SubscriptionPayment.kind == "subscribe")
                .where(models.SubscriptionPayment.status == ledger.PENDING)
                .limit(1)
            )).scalar()
            if sub_pending:
                summary["skipped_recent"] += 1
                continue
            if await _had_recent_attempt(db, club.id):
                summary["skipped_recent"] += 1
                continue

            customer_email = club.wompi_customer_email or club.email
            club_price = int(club.subscription_price_cop) if club.subscription_price_cop else plan_price_cop
            period_key = ledger.renew_period_key(club)
            reference = f"rakeflow-club-{club.id}-renew-{period_key}-{secrets.token_hex(3)}"
            attempt = await ledger.reserve(db, club, reference=reference, kind="renew",
                                           amount_cop=club_price, period_key=period_key)
            if attempt is None:
                # Otra corrida ya está cobrando (o cobró) este vencimiento.
                summary["skipped_recent"] += 1
                continue

            try:
                tx = await payments_wompi.charge_payment_source(
                    payment_source_id=club.wompi_payment_source_id,
                    customer_email=customer_email,
                    amount_cop=club_price,
                    reference=reference,
                    recurrent=True,
                )
            except httpx.HTTPStatusError as e:
                # Wompi rechazó la solicitud (4xx/5xx con respuesta): en un 4xx
                # no hubo cobro → se libera la reserva. Un 5xx queda PENDING
                # (incierto) y lo concilia la próxima corrida.
                code = e.response.status_code if e.response is not None else 0
                logger.error("renewal_charge_http_error club=%s status=%s", club.id, code)
                summary["errors"] += 1
                if 400 <= code < 500:
                    attempt.status = ledger.ERROR
                    attempt.updated_at = datetime.utcnow()
                await log_action(
                    db, club=club,
                    action="SUBSCRIPTION_RENEW_FAILED",
                    entity_type="Subscription",
                    meta={"reason": "charge_http_error", "status_code": code, "reference": reference},
                )
                await db.commit()
                continue
            except Exception as e:
                # Sin respuesta de Wompi no sabemos si cobró: la reserva queda
                # PENDING (bloquea otro cobro de este vencimiento) y la concilia
                # el webhook o _reconcile_pending en la próxima corrida.
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
            if transaction_id and not attempt.provider_tx_id:
                attempt.provider_tx_id = transaction_id
                await db.commit()

            if status == "APPROVED":
                res = await ledger.apply_approved(
                    db, club, reference=reference, provider_tx_id=transaction_id or None,
                    amount_in_cents=tx.get("amount_in_cents"), currency=tx.get("currency"),
                    kind="renew", via="cron",
                )
                await db.commit()
                if not res["applied"]:
                    summary["details"].append({"club_id": club.id, "status": "APPROVED_NOT_APPLIED",
                                               "reason": res["reason"], "tx": transaction_id})
                    continue
                period_end = res["period_end"]

                try:
                    email_service.send_payment_succeeded_email(
                        to_email=club.email,
                        club_name=club.name,
                        amount=club_price,
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
                attempt.status = ledger.DECLINED if status == "DECLINED" else ledger.ERROR
                attempt.updated_at = datetime.utcnow()
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
                        amount=club_price,
                        reason=status_msg,
                        card_brand=club.wompi_card_brand,
                        card_last4=club.wompi_card_last4,
                    )
                except Exception:
                    logger.exception("send_payment_failed_email_failed")

                summary["declined"] += 1
                summary["details"].append({"club_id": club.id, "status": status, "tx": transaction_id})

        except Exception:
            logger.exception("renewal_unexpected_error club=%s", club_id)
            summary["errors"] += 1
            await db.rollback()

    return summary
