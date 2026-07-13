# app/push_service.py
"""Web Push del Panel del Jugador: cifrado y envío vía pywebpush.

Claves VAPID por env var (generarlas con scripts/generate_vapid_keys.py y
cargarlas en Railway — JAMÁS en el repo):
- VAPID_PRIVATE_KEY: clave privada EC P-256 en base64url crudo (no PEM)
- VAPID_PUBLIC_KEY: punto público sin comprimir en base64url — va tal cual
  al applicationServerKey del navegador (la expone GET /player/push/config)
- VAPID_CLAIMS_SUB: contacto del emisor (mailto:...), requerido por RFC 8292

Sin claves el módulo queda DESHABILITADO: /config lo reporta al front y los
send_* son no-op — nunca rompen el request/cron que los dispara.

pywebpush es sync (requests) → cada envío corre en el executor para no
bloquear el event loop. Suscripciones muertas (404/410 del push service del
navegador) se borran al vuelo: es la limpieza natural del ciclo de vida.
"""
import asyncio
import json
import logging
import os

from pywebpush import webpush, WebPushException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from . import models
from .database import AsyncSessionLocal

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_CLAIMS_SUB = os.getenv("VAPID_CLAIMS_SUB", "mailto:soporte@rakeflow.site")

# Si el teléfono está apagado, el push service retiene el mensaje hasta este
# TTL. 12h: "hoy hay mesa" mañana ya no sirve.
DEFAULT_TTL = 12 * 3600


def push_enabled() -> bool:
    return bool(VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY)


def _send_one(sub_info: dict, payload: str) -> None:
    webpush(
        subscription_info=sub_info,
        data=payload,
        vapid_private_key=VAPID_PRIVATE_KEY,
        # Dict NUEVO en cada envío: pywebpush lo MUTA (le agrega aud/exp).
        vapid_claims={"sub": VAPID_CLAIMS_SUB},
        ttl=DEFAULT_TTL,
    )


async def send_to_subscriptions(subs: list, payload: dict) -> dict:
    """Envía `payload` (title/body/tag/url — lo interpreta el SW) a una lista de
    PushSubscription YA CARGADA — el caller es responsable del filtro por
    club/user (tenant isolation). Borra las suscripciones vencidas (404/410)
    en una sesión DB PROPIA: jamás commitea la transacción del caller (un
    request/cron con cambios pendientes no debe heredar un commit oculto).
    Devuelve {"sent", "gone", "errors"} para logs/response."""
    if not push_enabled() or not subs:
        return {"sent": 0, "gone": 0, "errors": 0}
    data = json.dumps(payload, ensure_ascii=False)
    loop = asyncio.get_running_loop()
    sent = gone = errors = 0
    dead_ids = []
    for s in subs:
        info = {"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}
        try:
            await loop.run_in_executor(None, _send_one, info, data)
            sent += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                dead_ids.append(s.id)
                gone += 1
            else:
                errors += 1
                logger.warning("webpush_failed sub=%s status=%s: %s", s.id, code, e)
        except Exception:
            errors += 1
            logger.exception("webpush_unexpected sub=%s", s.id)
    if dead_ids:
        async with AsyncSessionLocal() as cleanup_db:
            await cleanup_db.execute(
                delete(models.PushSubscription)
                .where(models.PushSubscription.id.in_(dead_ids))
            )
            await cleanup_db.commit()
    return {"sent": sent, "gone": gone, "errors": errors}


async def send_to_user(
    db: AsyncSession, club_id: int, user_id: int, payload: dict
) -> dict:
    """Todas las suscripciones (teléfono + PC) de UNA cuenta del club.
    `db` se usa SOLO para leer; la limpieza va en sesión propia."""
    subs = (await db.execute(
        select(models.PushSubscription).where(
            models.PushSubscription.club_id == club_id,
            models.PushSubscription.user_id == user_id,
        )
    )).scalars().all()
    return await send_to_subscriptions(subs, payload)
