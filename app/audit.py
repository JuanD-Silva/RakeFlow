"""
Auditoria de acciones de usuarios/clubs.

Uso tipico dentro de un endpoint:

    from app.audit import log_action, AuditAction

    await log_action(
        db,
        request=request,
        club=current_club,
        action=AuditAction.TRANSACTION_CREATE,
        entity_type="Transaction",
        entity_id=new_tx.id,
        meta={"type": "BUYIN", "amount": 50000, "player_id": 12},
    )

Importante: el helper agrega el AuditLog a la sesion pero NO hace commit.
Asi el log queda dentro de la misma transaccion que la accion auditada.
Si el endpoint hace rollback, el log tambien se pierde (consistente).
"""

import logging
from typing import Optional, Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from . import models

logger = logging.getLogger(__name__)


class AuditAction:
    """Constantes de acciones auditables. Mantener ordenadas por dominio."""

    # Auth
    LOGIN_SUCCESS = "LOGIN_SUCCESS"
    LOGIN_FAILED = "LOGIN_FAILED"
    PASSWORD_RESET = "PASSWORD_RESET"
    ACCOUNT_DELETE = "ACCOUNT_DELETE"

    # Transactions
    TRANSACTION_CREATE = "TRANSACTION_CREATE"
    TRANSACTION_UPDATE = "TRANSACTION_UPDATE"
    TRANSACTION_DELETE = "TRANSACTION_DELETE"
    TRANSACTION_TOGGLE_PAID = "TRANSACTION_TOGGLE_PAID"
    TRANSACTION_BUST_TOGGLE = "TRANSACTION_BUST_TOGGLE"

    # Sessions
    SESSION_CLOSE = "SESSION_CLOSE"
    SESSION_DELETE = "SESSION_DELETE"

    # Tournaments
    TOURNAMENT_CREATE = "TOURNAMENT_CREATE"
    TOURNAMENT_FINALIZE = "TOURNAMENT_FINALIZE"
    TOURNAMENT_DELETE = "TOURNAMENT_DELETE"
    TOURNAMENT_PLAYER_ELIMINATE = "TOURNAMENT_PLAYER_ELIMINATE"
    TOURNAMENT_TOGGLE_PAID = "TOURNAMENT_TOGGLE_PAID"

    # Config
    DISTRIBUTION_RULES_UPDATE = "DISTRIBUTION_RULES_UPDATE"
    RANKINGS_RESET = "RANKINGS_RESET"


async def log_action(
    db: AsyncSession,
    *,
    club: models.Club,
    action: str,
    request: Optional[Request] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    meta: Optional[dict[str, Any]] = None,
    actor_type: str = "CLUB",
) -> None:
    """
    Agrega un AuditLog a la sesion actual. No hace commit.
    Nunca lanza: si algo falla aqui no debe romper la accion del usuario.
    """
    try:
        ip = None
        user_agent = None
        request_id = None
        if request is not None:
            # En Railway/Vercel la IP real viene en X-Forwarded-For
            fwd = request.headers.get("x-forwarded-for", "")
            ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
            ua = request.headers.get("user-agent", "")
            user_agent = ua[:500] if ua else None
            request_id = request.headers.get("x-request-id") or getattr(request.state, "request_id", None)

        log = models.AuditLog(
            club_id=club.id,
            actor_type=actor_type,
            actor_id=club.id,
            actor_email=club.email,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta,
            ip=ip,
            user_agent=user_agent,
            request_id=request_id,
        )
        db.add(log)
    except Exception:
        logger.exception("Failed to create audit log for action=%s", action)


async def log_standalone(
    db: AsyncSession,
    *,
    club_id: int,
    actor_email: Optional[str],
    action: str,
    request: Optional[Request] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    meta: Optional[dict[str, Any]] = None,
    actor_type: str = "CLUB",
) -> None:
    """
    Variante para casos donde no tenemos un objeto Club cargado
    (ej: login fallido — el club pudo no existir).
    Hace add + commit propio.
    """
    try:
        ip = None
        user_agent = None
        request_id = None
        if request is not None:
            fwd = request.headers.get("x-forwarded-for", "")
            ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
            ua = request.headers.get("user-agent", "")
            user_agent = ua[:500] if ua else None
            request_id = request.headers.get("x-request-id") or getattr(request.state, "request_id", None)

        log = models.AuditLog(
            club_id=club_id,
            actor_type=actor_type,
            actor_id=None,
            actor_email=actor_email,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta,
            ip=ip,
            user_agent=user_agent,
            request_id=request_id,
        )
        db.add(log)
        await db.commit()
    except Exception:
        logger.exception("Failed to write standalone audit log for action=%s", action)
