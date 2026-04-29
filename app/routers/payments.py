# app/routers/payments.py
import os
import asyncio
import logging
import time
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from .. import models
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction
from .. import payments_wompi

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/payments",
    tags=["Payments"]
)

PLAN_PRICE = 49900  # COP
PLAN_NAME = "RakeFlow Pro"
TRIAL_DAYS = 7


@router.get("/status")
async def get_subscription_status(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """Estado actual de la suscripcion del club."""
    now = datetime.utcnow()
    in_trial = False
    trial_remaining = 0

    if current_club.subscription_trial_end:
        if now < current_club.subscription_trial_end:
            in_trial = True
            trial_remaining = (current_club.subscription_trial_end - now).days

    return {
        "subscription_active": current_club.subscription_active or False,
        "plan_type": current_club.plan_type,
        "in_trial": in_trial,
        "trial_days_remaining": trial_remaining,
        "trial_end": current_club.subscription_trial_end.isoformat() if current_club.subscription_trial_end else None,
        # Info de la tarjeta tokenizada en Wompi (para mostrar al user)
        "has_payment_method": bool(current_club.wompi_payment_source_id),
        "card_brand": current_club.wompi_card_brand,
        "card_last4": current_club.wompi_card_last4,
        "period_end": current_club.subscription_period_end.isoformat() if current_club.subscription_period_end else None,
    }


@router.post("/start-trial")
async def start_trial(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Inicia el periodo de prueba de 7 dias."""
    if current_club.subscription_active:
        return {"message": "Ya tienes una suscripcion activa."}

    if current_club.subscription_trial_end:
        return {"message": "Ya usaste tu periodo de prueba."}

    current_club.subscription_trial_end = datetime.utcnow() + timedelta(days=TRIAL_DAYS)
    current_club.subscription_active = True
    current_club.plan_type = "PRO_TRIAL"
    await db.commit()

    return {
        "message": f"Prueba gratuita de {TRIAL_DAYS} dias activada.",
        "trial_end": current_club.subscription_trial_end.isoformat()
    }


@router.post("/activate-test")
async def activate_test(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Solo disponible en modo test (WOMPI_TEST=true). Activa la suscripcion
    sin pago real. Util para desarrollo y demos.
    """
    if os.getenv("WOMPI_TEST", "true").lower() == "false":
        raise HTTPException(status_code=403, detail="Solo disponible en modo test.")

    if current_club.subscription_active and current_club.plan_type == "PRO":
        return {"subscription_active": True, "message": "Ya tienes suscripcion activa."}

    current_club.subscription_active = True
    current_club.plan_type = "PRO"
    current_club.subscription_period_end = datetime.utcnow() + timedelta(days=30)
    await db.commit()
    logger.info("Test mode: subscription activated for club #%s via activate-test", current_club.id)

    return {"subscription_active": True, "message": "Suscripcion activada (modo test)."}


# ===========================================================
# WOMPI (pasarela de pagos)
# ===========================================================
class WompiTransactionConfirm(BaseModel):
    transaction_id: str


@router.get("/wompi/config")
async def wompi_config(
    current_club: models.Club = Depends(get_current_club),
):
    """Config publica que el frontend usa para inicializar el widget Wompi."""
    cfg = payments_wompi.get_public_config()
    try:
        tokens = await payments_wompi.get_acceptance_tokens()
    except Exception as e:
        logger.error("wompi_config_acceptance_tokens_failed: %s", e)
        tokens = {}
    return {
        **cfg,
        **tokens,
        "amount_cop": PLAN_PRICE,
        "club_id": current_club.id,
        "club_email": current_club.email,
        "reference_prefix": f"rakeflow-club-{current_club.id}-",
    }


@router.post("/wompi/confirm")
async def wompi_confirm_transaction(
    data: WompiTransactionConfirm,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    El frontend invoca esto despues de que Wompi redirige post-checkout.
    Consultamos a Wompi el estado real (no confiamos solo en el redirect)
    y activamos la suscripcion si fue APPROVED.
    """
    try:
        tx = await payments_wompi.get_transaction(data.transaction_id)
    except Exception as e:
        logger.error("wompi_get_transaction_failed: %s", e)
        raise HTTPException(status_code=502, detail="No se pudo verificar el pago con Wompi")

    status_w = tx.get("status")
    if status_w != "APPROVED":
        return {"subscription_active": False, "wompi_status": status_w}

    # Verificar que sea de este club (la reference debe contener el club_id)
    reference = tx.get("reference", "")
    if f"club-{current_club.id}-" not in reference:
        logger.warning("wompi_confirm_reference_mismatch club=%s ref=%s", current_club.id, reference)
        raise HTTPException(status_code=400, detail="Referencia no corresponde a este club")

    # Activar suscripcion 30 dias
    now = datetime.utcnow()
    period_end = now + timedelta(days=30)
    current_club.subscription_active = True
    current_club.plan_type = "PRO"
    current_club.subscription_period_end = period_end

    # Guardar el payment_source_id para cobros recurrentes
    pm = tx.get("payment_method", {}) or {}
    extra = pm.get("extra", {}) or {}
    if tx.get("payment_source_id"):
        current_club.wompi_payment_source_id = tx["payment_source_id"]
    if tx.get("customer_email"):
        current_club.wompi_customer_email = tx["customer_email"]
    if extra.get("brand"):
        current_club.wompi_card_brand = extra["brand"]
    if extra.get("last_four"):
        current_club.wompi_card_last4 = extra["last_four"]

    amount_in_cents = tx.get("amount_in_cents", 0)
    await log_action(
        db, request=request, club=current_club,
        action="SUBSCRIPTION_PAID",
        entity_type="Subscription", entity_id=None,
        meta={
            "provider": "wompi",
            "transaction_id": data.transaction_id,
            "reference": reference,
            "amount_cop": amount_in_cents // 100 if amount_in_cents else None,
            "card_brand": extra.get("brand"),
            "card_last4": extra.get("last_four"),
            "period_end": period_end.isoformat(),
        },
    )
    await db.commit()
    logger.info("wompi_subscription_activated club=%s tx=%s", current_club.id, data.transaction_id)
    return {
        "subscription_active": True,
        "wompi_status": status_w,
        "period_end": period_end.isoformat(),
    }


@router.post("/wompi/webhook")
async def wompi_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Webhook de Wompi: notifica cambios de estado de transacciones.
    Verifica firma HMAC y activa suscripcion si corresponde.
    Debe responder 200 rapido (Wompi reintentos).
    """
    raw = await request.body()
    if not payments_wompi.verify_webhook_signature(raw, ""):
        logger.warning("wompi_webhook_invalid_signature")
        raise HTTPException(status_code=401, detail="Firma invalida")

    try:
        body = await request.json()
    except Exception:
        return {"status": "ok"}  # cuerpo malo, ignorar pero responder 200

    event = body.get("event", "")
    tx = (body.get("data") or {}).get("transaction", {})
    status_w = tx.get("status")
    reference = tx.get("reference", "")
    transaction_id = tx.get("id", "")

    logger.info("wompi_webhook event=%s status=%s ref=%s tx=%s", event, status_w, reference, transaction_id)

    if event != "transaction.updated" or status_w != "APPROVED":
        return {"status": "ok"}

    # Extraer club_id de la reference: rakeflow-club-{id}-{rand}
    club_id = None
    parts = reference.split("-")
    try:
        idx = parts.index("club")
        club_id = int(parts[idx + 1])
    except (ValueError, IndexError):
        logger.warning("wompi_webhook_unknown_reference: %s", reference)
        return {"status": "ok"}

    result = await db.execute(select(models.Club).where(models.Club.id == club_id))
    club = result.scalars().first()
    if not club:
        return {"status": "ok"}

    # Activar / renovar
    now = datetime.utcnow()
    base = club.subscription_period_end if (club.subscription_period_end and club.subscription_period_end > now) else now
    period_end = base + timedelta(days=30)
    club.subscription_active = True
    club.plan_type = "PRO"
    club.subscription_period_end = period_end

    pm = tx.get("payment_method", {}) or {}
    extra = pm.get("extra", {}) or {}
    if tx.get("payment_source_id"):
        club.wompi_payment_source_id = tx["payment_source_id"]
    if tx.get("customer_email"):
        club.wompi_customer_email = tx["customer_email"]
    if extra.get("brand"):
        club.wompi_card_brand = extra["brand"]
    if extra.get("last_four"):
        club.wompi_card_last4 = extra["last_four"]

    await log_action(
        db, club=club,
        action="SUBSCRIPTION_PAID",
        entity_type="Subscription",
        meta={
            "provider": "wompi",
            "via": "webhook",
            "transaction_id": transaction_id,
            "reference": reference,
            "amount_cop": (tx.get("amount_in_cents") or 0) // 100,
            "period_end": period_end.isoformat(),
        },
    )
    await db.commit()
    return {"status": "ok"}


# ===========================================================
# WOMPI: Suscripcion con tarjeta tokenizada (cobro recurrente)
# ===========================================================
class WompiSubscribeRequest(BaseModel):
    card_token: str          # cc_token devuelto por POST /v1/tokens/cards
    acceptance_token: str
    accept_personal_auth: str
    customer_email: str | None = None  # default: email del club


@router.post("/wompi/subscribe")
async def wompi_subscribe(
    data: WompiSubscribeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Flow completo de suscripcion con cobro recurrente:
    1. Frontend ya tokenizo la tarjeta -> nos pasa cc_token
    2. Backend crea payment_source (la tarjeta queda tokenizada permanente)
    3. Backend cobra el primer mes
    4. Si APPROVED, activa suscripcion 30 dias y guarda payment_source_id
    """
    customer_email = (data.customer_email or current_club.email).strip()

    # 1. Crear payment_source
    try:
        ps = await payments_wompi.create_payment_source(
            card_token=data.card_token,
            customer_email=customer_email,
            acceptance_token=data.acceptance_token,
            accept_personal_auth=data.accept_personal_auth,
        )
    except httpx.HTTPStatusError as e:
        logger.error("wompi_subscribe_payment_source_failed: %s", e.response.text)
        raise HTTPException(status_code=400, detail="No se pudo registrar la tarjeta. Verifica los datos e intenta de nuevo.")

    payment_source_id = ps.get("id")
    if not payment_source_id:
        raise HTTPException(status_code=500, detail="Wompi no devolvio un payment_source_id valido")

    # 2. Cobrar primer mes
    reference = f"rakeflow-club-{current_club.id}-sub-{int(time.time())}"
    try:
        tx = await payments_wompi.charge_payment_source(
            payment_source_id=payment_source_id,
            customer_email=customer_email,
            amount_cop=PLAN_PRICE,
            reference=reference,
        )
    except httpx.HTTPStatusError as e:
        logger.error("wompi_subscribe_charge_failed: %s", e.response.text)
        raise HTTPException(status_code=400, detail="No se pudo procesar el cobro. La tarjeta quedo registrada pero el primer pago fallo.")

    transaction_id = tx.get("id")

    # 3. Polling rapido (max 10s) para ver si APPROVED inmediato
    for _ in range(5):
        await asyncio.sleep(2)
        latest = await payments_wompi.get_transaction(transaction_id)
        if latest.get("status") in ("APPROVED", "DECLINED", "ERROR", "VOIDED"):
            tx = latest
            break

    status = tx.get("status", "PENDING")
    pm = tx.get("payment_method", {}) or {}
    extra = pm.get("extra", {}) or {}
    card_brand = extra.get("brand")
    card_last4 = extra.get("last_four")

    if status == "APPROVED":
        period_end = datetime.utcnow() + timedelta(days=30)
        current_club.subscription_active = True
        current_club.plan_type = "PRO"
        current_club.subscription_period_end = period_end
        current_club.wompi_payment_source_id = payment_source_id
        current_club.wompi_customer_email = customer_email
        if card_brand:
            current_club.wompi_card_brand = card_brand
        if card_last4:
            current_club.wompi_card_last4 = card_last4

        await log_action(
            db, request=request, club=current_club,
            action="SUBSCRIPTION_PAID",
            entity_type="Subscription",
            meta={
                "provider": "wompi",
                "via": "subscribe_endpoint",
                "transaction_id": transaction_id,
                "payment_source_id": payment_source_id,
                "amount_cop": PLAN_PRICE,
                "card_brand": card_brand,
                "card_last4": card_last4,
                "period_end": period_end.isoformat(),
            },
        )
        await db.commit()
        return {
            "subscription_active": True,
            "transaction_id": transaction_id,
            "wompi_status": status,
            "card_brand": card_brand,
            "card_last4": card_last4,
            "period_end": period_end.isoformat(),
        }

    if status == "PENDING":
        # Webhook eventualmente cerrara la operacion. Guardamos payment_source_id
        # para que el cron pueda cobrar en el futuro aunque este no haya cerrado.
        current_club.wompi_payment_source_id = payment_source_id
        current_club.wompi_customer_email = customer_email
        if card_brand:
            current_club.wompi_card_brand = card_brand
        if card_last4:
            current_club.wompi_card_last4 = card_last4
        await db.commit()
        return {
            "subscription_active": False,
            "transaction_id": transaction_id,
            "wompi_status": status,
            "message": "Pago en proceso. Te avisaremos cuando se acredite.",
        }

    return {
        "subscription_active": False,
        "transaction_id": transaction_id,
        "wompi_status": status,
        "message": tx.get("status_message") or "Pago rechazado. Verifica los datos de tu tarjeta o intenta con otra.",
    }
