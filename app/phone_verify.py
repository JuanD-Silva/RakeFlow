# app/phone_verify.py
"""Verificación de teléfono con Twilio Verify (envío del código por WhatsApp/SMS).

Antes el club recibía el código y lo reenviaba por wa.me — cómodo pero el número
NO quedaba probado (el club veía el código). Ahora RakeFlow le manda el código
DIRECTO al teléfono vía Twilio Verify, así activar prueba posesión del número.

Twilio Verify es llave-en-mano: genera, envía y valida el código (maneja
expiración, reintentos y el fallback de canal). Nosotros no vemos ni guardamos
el código en el camino verificado.

Config por env var (cargarlas en Railway; sin ellas el módulo queda
DESHABILITADO y todo cae al flujo manual de siempre — plan B):
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_VERIFY_SERVICE_SID   (el "Verify Service" que se crea en la consola)
- TWILIO_VERIFY_CHANNEL       (whatsapp | sms; default whatsapp)

PLAN B: si Twilio no está configurado, o el envío falla (sin crédito, número
inválido, Twilio caído), start_invite cae a un código local + link wa.me — el
flujo que ya funciona hoy. Nunca deja a un jugador sin poder activar.
"""
import logging
import os
import re
import secrets

import httpx

logger = logging.getLogger(__name__)

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_VERIFY_SERVICE_SID = os.getenv("TWILIO_VERIFY_SERVICE_SID")
TWILIO_VERIFY_CHANNEL = os.getenv("TWILIO_VERIFY_CHANNEL", "whatsapp")

_BASE = "https://verify.twilio.com/v2/Services"
# El envío al teléfono no debe demorar el request del staff: si Twilio tarda,
# cae a plan B.
_TIMEOUT = 8.0


def verify_enabled() -> bool:
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID)


def to_e164(phone_normalized: str | None) -> str | None:
    """normalize_phone ya devuelve dígitos con indicativo (57...). E.164 = +eso."""
    if not phone_normalized:
        return None
    d = re.sub(r"\D", "", phone_normalized)
    return "+" + d if d else None


def new_code() -> str:
    """Código local de 6 dígitos para el plan B (Twilio genera el suyo aparte)."""
    return f"{secrets.randbelow(1000000):06d}"


async def send_code(phone_e164: str) -> bool:
    """Twilio Verify manda el código al teléfono. True si aceptó el envío
    (status 'pending'); False ante cualquier fallo (dispara el plan B)."""
    if not verify_enabled() or not phone_e164:
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_BASE}/{TWILIO_VERIFY_SERVICE_SID}/Verifications",
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                data={"To": phone_e164, "Channel": TWILIO_VERIFY_CHANNEL},
            )
        if r.status_code in (200, 201) and r.json().get("status") == "pending":
            return True
        logger.warning("twilio_verify_send_failed status=%s body=%s",
                       r.status_code, r.text[:200])
        return False
    except Exception:
        logger.exception("twilio_verify_send_error")
        return False


async def check_code_status(phone_e164: str, code: str) -> str:
    """Estado de la verificación: 'approved' | 'denied' | 'unavailable'.

    - 'approved': código correcto (se CONSUME: no llamar dos veces).
    - 'denied':   código incorrecto o vencido (Twilio respondió). Cuenta para
                  el lockout.
    - 'unavailable': Twilio no configurado o inalcanzable (5xx/timeout/red).
                  NO es culpa del usuario → el caller no debe quemar la
                  invitación ni contar el intento; que reintente en un momento.
    """
    if not verify_enabled():
        return "unavailable"
    if not phone_e164 or not code:
        return "denied"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{_BASE}/{TWILIO_VERIFY_SERVICE_SID}/VerificationCheck",
                auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                data={"To": phone_e164, "Code": code.strip()},
            )
        if r.status_code in (200, 201):
            return "approved" if r.json().get("status") == "approved" else "denied"
        # 404 = no hay verificación activa (vencida/ya consumida): denegado.
        if r.status_code == 404:
            return "denied"
        # 429/5xx: problema del servicio, no del código → no quemar el intento.
        logger.warning("twilio_verify_check_unavailable status=%s", r.status_code)
        return "unavailable"
    except Exception:
        logger.exception("twilio_verify_check_error")
        return "unavailable"


async def check_code(phone_e164: str, code: str) -> bool:
    """True si el código es correcto. Envoltorio de check_code_status."""
    return (await check_code_status(phone_e164, code)) == "approved"


async def start_invite(phone_normalized: str) -> tuple[str, str | None]:
    """Arranca una invitación. Devuelve (channel, code):
      - ('twilio', None)  → Twilio aceptó el envío; el código lo maneja Twilio.
      - ('manual', code)  → plan B: código local (va por wa.me como hoy).
    El caller guarda channel en user.verification_channel."""
    if verify_enabled():
        if await send_code(to_e164(phone_normalized)):
            return "twilio", None
    return "manual", new_code()
