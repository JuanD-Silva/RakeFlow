# app/routers/push.py
"""Web Push del Panel del Jugador: subscribe / unsubscribe / config / prueba.

Patrón player_self: rol PLAYER y TODO amarrado al (user_id, club_id) del token
— jamás se confía en ids del payload. La suscripción pertenece a la CUENTA
(User), no a la ficha Player: sobrevive aunque el club desvincule la ficha.

El estado "suscrito" NO se consulta al server: lo sabe el navegador
(pushManager.getSubscription()); el front re-postea subscribe al abrir el
panel si tiene suscripción local (upsert idempotente que auto-repara).

iOS: Web Push existe solo en iOS 16.4+ y ÚNICAMENTE con la app instalada
(Añadir a pantalla de inicio); esa aclaración vive en la UI del toggle (PR2).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from .. import models, push_service
from ..dependencies import get_db, require_role
from ..rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/player/push", tags=["Push"])

_require_player = require_role([models.UserRole.PLAYER])


class _PushKeys(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=512)
    auth: str = Field(..., min_length=1, max_length=512)


class SubscribeIn(BaseModel):
    endpoint: str = Field(..., min_length=12, max_length=1024)
    keys: _PushKeys


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(..., min_length=12, max_length=1024)


@router.get("/config")
async def push_config(user: models.User = Depends(_require_player)):
    """Insumo del toggle 🔔: si el server puede enviar (claves VAPID cargadas)
    y la clave pública que el navegador usa como applicationServerKey."""
    return {
        "enabled": push_service.push_enabled(),
        "public_key": push_service.VAPID_PUBLIC_KEY,
    }


# Máximo de dispositivos por cuenta: acota lo que un cliente roto o malicioso
# puede inflar la tabla (subscribe NO tiene rate limit por IP a propósito: en
# el WiFi del club decenas de teléfonos comparten UNA IP pública y el panel
# re-postea al abrir; un bucket por IP daría 429 a suscripciones legítimas).
MAX_SUBS_PER_USER = 10


@router.post("/subscribe")
async def subscribe(
    data: SubscribeIn,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Registra (o re-registra) la suscripción de ESTE navegador. Upsert por
    endpoint: si la fila existía de otra cuenta (mismo teléfono, otro login),
    se re-asigna — el navegador solo tiene UNA suscripción por service worker,
    así que la fila anterior quedaría muerta de todos modos."""
    if not push_service.push_enabled():
        raise HTTPException(status_code=503, detail="Push no configurado en el servidor")
    if not data.endpoint.startswith("https://"):
        raise HTTPException(status_code=422, detail="Endpoint inválido")
    # Rastro de re-asignación (auditoría barata): si la fila cambia de dueño
    # que quede en logs — un takeover requeriría robar endpoint+claves del
    # navegador de la víctima, pero si pasa, que sea visible. La carrera
    # select→upsert puede perder un log; el upsert en sí es atómico.
    prev = (await db.execute(
        select(models.PushSubscription.user_id, models.PushSubscription.club_id)
        .where(models.PushSubscription.endpoint == data.endpoint)
    )).first()
    stmt = pg_insert(models.PushSubscription).values(
        club_id=user.club_id,
        user_id=user.id,
        endpoint=data.endpoint,
        p256dh=data.keys.p256dh,
        auth=data.keys.auth,
    ).on_conflict_do_update(
        index_elements=[models.PushSubscription.endpoint],
        set_={
            "club_id": user.club_id,
            "user_id": user.id,
            "p256dh": data.keys.p256dh,
            "auth": data.keys.auth,
        },
    )
    await db.execute(stmt)
    # Cap por cuenta: conservar las MAX_SUBS_PER_USER más recientes.
    keep = (
        select(models.PushSubscription.id)
        .where(
            models.PushSubscription.user_id == user.id,
            models.PushSubscription.club_id == user.club_id,
        )
        .order_by(models.PushSubscription.created_at.desc(),
                  models.PushSubscription.id.desc())
        .limit(MAX_SUBS_PER_USER)
        .scalar_subquery()
    )
    await db.execute(
        delete(models.PushSubscription).where(
            models.PushSubscription.user_id == user.id,
            models.PushSubscription.club_id == user.club_id,
            models.PushSubscription.id.not_in(keep),
        )
    )
    await db.commit()
    if prev and (prev.user_id != user.id or prev.club_id != user.club_id):
        logger.warning(
            "push_sub_reassigned old_user=%s old_club=%s -> new_user=%s new_club=%s",
            prev.user_id, prev.club_id, user.id, user.club_id,
        )
    return {"subscribed": True}


@router.post("/unsubscribe")
async def unsubscribe(
    data: UnsubscribeIn,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """Borra la suscripción de este navegador. Solo la PROPIA: si el endpoint
    pertenece a otra cuenta no toca nada (y no filtra que exista)."""
    result = await db.execute(
        delete(models.PushSubscription).where(
            models.PushSubscription.endpoint == data.endpoint,
            models.PushSubscription.user_id == user.id,
            models.PushSubscription.club_id == user.club_id,
        )
    )
    await db.commit()
    return {"unsubscribed": result.rowcount > 0}


@router.post("/test")
@limiter.limit("5/hour")
async def send_test(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(_require_player),
):
    """El jugador se manda una notificación de prueba a sí mismo (todas sus
    suscripciones). Es el smoke real del canal en prod sin esperar a los
    disparadores del PR2 — y le confirma al usuario que el toggle funciona."""
    if not push_service.push_enabled():
        raise HTTPException(status_code=503, detail="Push no configurado en el servidor")
    result = await push_service.send_to_user(db, user.club_id, user.id, {
        "title": "🔔 RakeFlow",
        "body": "¡Listo! Así te vamos a avisar cuando haya mesa.",
        "tag": "rf-test",
        "url": "/",
    })
    if result["sent"] == 0 and result["gone"] == 0 and result["errors"] == 0:
        raise HTTPException(status_code=404, detail="No tenés suscripciones activas")
    return result
