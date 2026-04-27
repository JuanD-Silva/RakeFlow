"""
Cliente HTTP para Wompi Colombia + helpers de webhook.

Variables de entorno necesarias:
- WOMPI_PUBLIC_KEY     pub_test_... o pub_prod_...
- WOMPI_PRIVATE_KEY    prv_test_... o prv_prod_...
- WOMPI_EVENTS_KEY     para verificar firma del webhook
- WOMPI_INTEGRITY_KEY  para firma de integridad de transacciones (frontend)
- WOMPI_TEST           "true" en sandbox (default), "false" en prod

Docs: https://docs.wompi.co/docs/colombia/inicio-rapido/
"""

import hashlib
import hmac
import json
import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


def _is_test() -> bool:
    return os.getenv("WOMPI_TEST", "true").lower() != "false"


def _api_base() -> str:
    if _is_test():
        return "https://sandbox.wompi.co/v1"
    return "https://production.wompi.co/v1"


def get_public_config() -> dict:
    """Datos publicos que el frontend necesita para tokenizar."""
    return {
        "public_key": os.getenv("WOMPI_PUBLIC_KEY", ""),
        "integrity_key": os.getenv("WOMPI_INTEGRITY_KEY", ""),
        "test_mode": _is_test(),
        "api_base": _api_base(),
        "currency": "COP",
    }


async def get_acceptance_tokens() -> dict:
    """
    Obtiene los acceptance tokens del merchant. Wompi exige que el usuario
    acepte estos antes de tokenizar (terms y data policy).
    """
    public_key = os.getenv("WOMPI_PUBLIC_KEY", "")
    if not public_key:
        raise RuntimeError("WOMPI_PUBLIC_KEY no configurada")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_api_base()}/merchants/{public_key}")
        r.raise_for_status()
        data = r.json().get("data", {})
        return {
            "acceptance_token": data.get("presigned_acceptance", {}).get("acceptance_token"),
            "acceptance_permalink": data.get("presigned_acceptance", {}).get("permalink"),
            "personal_data_acceptance_token": data.get("presigned_personal_data_auth", {}).get("acceptance_token"),
            "personal_data_acceptance_permalink": data.get("presigned_personal_data_auth", {}).get("permalink"),
        }


async def get_transaction(transaction_id: str) -> dict:
    """Consulta el estado de una transaccion. Backend la usa para confirmar despues del checkout."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{_api_base()}/transactions/{transaction_id}")
        r.raise_for_status()
        return r.json().get("data", {})


async def charge_payment_source(*, payment_source_id: int, customer_email: str, amount_cop: int, reference: str) -> dict:
    """
    Cobra un payment_source ya tokenizado (cobro recurrente real).
    amount_cop en pesos enteros (no centavos).
    Wompi requiere signature de integridad: SHA-256(reference+amount_in_cents+currency+integrity_key).
    """
    private_key = os.getenv("WOMPI_PRIVATE_KEY", "")
    integrity_key = os.getenv("WOMPI_INTEGRITY_KEY", "")
    if not private_key or not integrity_key:
        raise RuntimeError("WOMPI_PRIVATE_KEY o WOMPI_INTEGRITY_KEY no configuradas")
    amount_in_cents = amount_cop * 100
    currency = "COP"
    sig_input = f"{reference}{amount_in_cents}{currency}{integrity_key}"
    signature = hashlib.sha256(sig_input.encode("utf-8")).hexdigest()
    payload = {
        "amount_in_cents": amount_in_cents,
        "currency": currency,
        "customer_email": customer_email,
        "payment_source_id": payment_source_id,
        "reference": reference,
        "signature": signature,
        "payment_method": {"installments": 1},
    }
    headers = {"Authorization": f"Bearer {private_key}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{_api_base()}/transactions", json=payload, headers=headers)
        if r.status_code >= 400:
            logger.error("wompi_charge_failed status=%s body=%s", r.status_code, r.text)
            r.raise_for_status()
        return r.json().get("data", {})


def verify_webhook_signature(raw_body: bytes, checksum_header: str) -> bool:
    """
    Wompi firma webhooks calculando SHA-256 de la concatenacion de
    properties indicadas + timestamp + events_secret. El checksum viene en
    el body (no en header), pero validamos sobre el body completo.

    Estrategia simple: el body trae signature.checksum, y nosotros recalculamos
    SHA-256(concatena valores en orden + timestamp + events_secret).
    """
    events_secret = os.getenv("WOMPI_EVENTS_KEY", "")
    if not events_secret:
        logger.warning("WOMPI_EVENTS_KEY no configurada, saltando verificacion")
        return True  # En desarrollo
    try:
        body = json.loads(raw_body)
        sig = body.get("signature", {})
        properties = sig.get("properties", [])
        checksum_expected = sig.get("checksum", "")
        timestamp = body.get("timestamp", "")

        # Extraer valores en el orden indicado
        data = body.get("data", {})
        concat = ""
        for prop in properties:
            # prop ej: "transaction.id", "transaction.status", "transaction.amount_in_cents"
            value = data
            for key in prop.split("."):
                if not isinstance(value, dict):
                    value = ""
                    break
                value = value.get(key, "")
            concat += str(value)
        concat += str(timestamp) + events_secret

        calculated = hashlib.sha256(concat.encode("utf-8")).hexdigest()
        valid = hmac.compare_digest(calculated, checksum_expected)
        if not valid:
            logger.warning("wompi_webhook_invalid_signature expected=%s got=%s", checksum_expected, calculated)
        return valid
    except Exception:
        logger.exception("Error verificando firma de webhook Wompi")
        return False
