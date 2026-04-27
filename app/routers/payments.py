# app/routers/payments.py
import os
import logging
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from .. import models
from ..dependencies import get_db, get_current_club, require_role

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/payments",
    tags=["Payments"]
)

EPAYCO_PUBLIC_KEY = os.getenv("EPAYCO_PUBLIC_KEY", "")
EPAYCO_PRIVATE_KEY = os.getenv("EPAYCO_PRIVATE_KEY", "")
EPAYCO_P_CUST_ID = os.getenv("EPAYCO_P_CUST_ID", "")
EPAYCO_P_KEY = os.getenv("EPAYCO_P_KEY", "")
EPAYCO_TEST = os.getenv("EPAYCO_TEST", "true") == "true"

PLAN_PRICE = 49900  # COP
PLAN_NAME = "RakeFlow Pro"
TRIAL_DAYS = 7


@router.get("/config")
async def get_payment_config(current_club: models.Club = Depends(get_current_club)):
    """Devuelve la config necesaria para el checkout de ePayco en el frontend."""
    return {
        "public_key": EPAYCO_PUBLIC_KEY,
        "p_cust_id": EPAYCO_P_CUST_ID,
        "test": EPAYCO_TEST,
        "plan_name": PLAN_NAME,
        "plan_price": PLAN_PRICE,
        "currency": "COP",
        "club_id": current_club.id,
        "club_name": current_club.name,
        "club_email": current_club.email,
    }


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


@router.post("/webhook")
async def epayco_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Webhook que ePayco llama cuando se confirma un pago.
    URL a configurar en ePayco: https://tu-backend.com/payments/webhook
    """
    try:
        data = await request.json()
    except Exception:
        data = dict(await request.form())

    logger.info("ePayco webhook received: %s", data)

    # ePayco envia x_ref_payco, x_cod_response, x_extra1 (club_id)
    ref = data.get("x_ref_payco") or data.get("ref_payco", "")
    cod_response = str(data.get("x_cod_response") or data.get("cod_response", ""))
    club_id = data.get("x_extra1") or data.get("extra1", "")
    amount = data.get("x_amount") or data.get("amount", "0")

    # cod_response 1 = Aceptada
    if cod_response == "1" and club_id:
        result = await db.execute(
            select(models.Club).where(models.Club.id == int(club_id))
        )
        club = result.scalars().first()

        if club:
            club.subscription_active = True
            club.plan_type = "PRO"
            await db.commit()
            logger.info("Subscription activated for club #%s (ref: %s, amount: %s)", club_id, ref, amount)

    return {"status": "ok"}


@router.get("/confirmation")
async def payment_confirmation(
    ref_payco: str = "",
    db: AsyncSession = Depends(get_db)
):
    """
    Pagina de confirmacion a la que ePayco redirige despues del pago.
    El frontend redirige aqui y luego al dashboard.
    """
    if not ref_payco:
        return {"status": "pending", "message": "Sin referencia de pago."}

    # Verificar con ePayco el estado real del pago
    # En produccion se deberia validar con la API de ePayco
    # Por ahora confiamos en el webhook
    return {
        "status": "ok",
        "ref_payco": ref_payco,
        "message": "Pago procesado. Tu suscripcion se activara en unos segundos."
    }


@router.post("/confirm-by-ref")
async def confirm_payment_by_ref(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Verifica un pago con la API de ePayco usando la referencia
    y activa la suscripcion si fue aprobado.
    """
    ref_payco = data.get("ref_payco", "")
    if not ref_payco:
        raise HTTPException(status_code=400, detail="Referencia de pago requerida")

    # Consultar estado del pago en ePayco
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"https://secure.epayco.co/validation/v1/reference/{ref_payco}")
            epayco_data = response.json()

        status_ok = epayco_data.get("status", False)
        transaction = epayco_data.get("data", {})
        cod_response = str(transaction.get("x_cod_response", ""))
        amount = transaction.get("x_amount", "0")

        logger.info("ePayco verification ref=%s status=%s cod=%s amount=%s club=%s", ref_payco, status_ok, cod_response, amount, current_club.id)

        # cod_response: 1=Aceptada, 2=Rechazada, 3=Pendiente, 4=Fallida
        if cod_response == "1":
            current_club.subscription_active = True
            current_club.plan_type = "PRO"
            await db.commit()
            return {"subscription_active": True, "message": "Pago confirmado. Suscripcion activada."}
        elif cod_response == "3":
            return {"subscription_active": False, "message": "Pago pendiente de confirmacion."}
        elif status_ok is False and EPAYCO_TEST:
            # En modo test, la API de validacion no siempre funciona
            # Activamos la suscripcion si hay una referencia valida
            logger.info("Test mode: activating subscription for club #%s with ref %s", current_club.id, ref_payco)
            current_club.subscription_active = True
            current_club.plan_type = "PRO"
            await db.commit()
            return {"subscription_active": True, "message": "Pago confirmado (modo test)."}
        else:
            return {"subscription_active": False, "message": "Pago rechazado o fallido."}

    except Exception as e:
        logger.error("Error verifying payment ref=%s: %s", ref_payco, e)
        # En modo test, si falla la verificacion, activar de todos modos
        if EPAYCO_TEST:
            current_club.subscription_active = True
            current_club.plan_type = "PRO"
            await db.commit()
            return {"subscription_active": True, "message": "Pago confirmado (modo test, fallback)."}
        raise HTTPException(status_code=500, detail="Error verificando el pago")


@router.post("/activate-test")
async def activate_test(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Solo disponible en modo test. Activa la suscripcion sin pago real.
    Util para desarrollo y pruebas locales donde el webhook no llega.
    """
    if not EPAYCO_TEST:
        raise HTTPException(status_code=403, detail="Solo disponible en modo test.")

    if current_club.subscription_active and current_club.plan_type == "PRO":
        return {"subscription_active": True, "message": "Ya tienes suscripcion activa."}

    current_club.subscription_active = True
    current_club.plan_type = "PRO"
    await db.commit()
    logger.info("Test mode: subscription activated for club #%s via activate-test", current_club.id)

    return {"subscription_active": True, "message": "Suscripcion activada (modo test)."}
