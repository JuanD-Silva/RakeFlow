# app/routers/players.py
import os
import secrets
import asyncio
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_
from sqlalchemy.future import select
from typing import List, Optional
from datetime import datetime, timedelta

from .. import models, schemas, auth_utils
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction
from ..phone_utils import normalize_phone
from ..rate_limit import limiter

router = APIRouter(
    prefix="/players",
    tags=["Players"]
)

@router.post("/", response_model=schemas.PlayerResponse)
async def create_player(player: schemas.PlayerCreate, db: AsyncSession = Depends(get_db), current_club = Depends(get_current_club)):
    """
    Registra un nuevo jugador en la base de datos (Asignado al Club Actual).
    """
    # 0. Validar nombre no vacío
    if not player.name or not player.name.strip():
        raise HTTPException(status_code=400, detail="Player name cannot be empty")

    # 1. Validación SaaS: Verificar si ya existe en ESTE club para no duplicar
    result = await db.execute(
        select(models.Player).where(
            models.Player.name == player.name, 
            models.Player.club_id == current_club.id
        )
    )
    existing_player = result.scalars().first()
    
    if existing_player:
        return existing_player

    # 2. Creación: Agregamos el club_id automáticamente
    new_player = models.Player(
        name=player.name, 
        phone=player.phone,
        club_id=current_club.id # 👈 CAMBIO OBLIGATORIO SAAS
    )
    db.add(new_player)
    await db.commit()
    await db.refresh(new_player)
    
    return new_player

@router.get("/", response_model=List[schemas.PlayerResponse])
async def read_players(skip: int = 0, limit: int = 10000, db: AsyncSession = Depends(get_db), current_club = Depends(get_current_club)):
    """
    Obtiene la lista de todos los jugadores del club, ordenados alfabéticamente.
    Incluye el estado de la cuenta del panel (sin cuenta / pendiente / activa)
    para el botón "Invitar a la app" del staff (patrón list_dealers).
    """
    query = (
        select(models.Player, models.User.hashed_password)
        # Guard de club en el join (defensa en profundidad): si el vínculo 1:1
        # se rompiera algún día, jamás leer el user de otro club.
        .outerjoin(models.User, and_(
            models.User.id == models.Player.user_id,
            models.User.club_id == models.Player.club_id,
        ))
        .where(models.Player.club_id == current_club.id)
        .order_by(models.Player.name.asc())
        .offset(skip)
        .limit(limit)
    )

    rows = (await db.execute(query)).all()
    out = []
    for player, hashed_password in rows:
        resp = schemas.PlayerResponse.model_validate(player)
        resp.has_account = player.user_id is not None
        resp.invitation_pending = player.user_id is not None and hashed_password is None
        resp.history_unlocked = player.stats_since is None
        out.append(resp)
    return out


# ---------------------------------------------------------
# Cuenta del jugador (Panel del Jugador): invitar por WhatsApp con código OTP.
# Clon del flujo de dealers (dealers.py): el jugador entra por TELÉFONO, el
# staff abre wa.me con el link de activación + código, y el jugador crea su
# contraseña en /activar-jugador. Al activar, stats_since = now(): su panel
# arranca de cero hasta que compre el histórico en caja (unlock-history).
# ---------------------------------------------------------
class PlayerInviteIn(BaseModel):
    phone: str = Field(..., min_length=7, max_length=20)


def _build_invite_response(player: models.Player, club_name: Optional[str], phone: str,
                           code: str, user_id: int, reset: bool = False) -> dict:
    """Link wa.me + mensaje para invitar/resetear. RakeFlow NO envía nada."""
    frontend = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    activate_url = f"{frontend}/activar-jugador"
    if reset:
        intro = f"Hola {player.name}! 🔐 Restablecimos tu acceso a tus estadísticas."
        action_line = f"Volvé a activar tu cuenta acá: {activate_url}"
    else:
        intro = (f"Hola {player.name}! 🃏 {club_name or 'Tu club'} te invita a ver "
                 f"tus estadísticas de juego: sesiones, resultados, logros y ranking.")
        action_line = f"Activá tu cuenta acá: {activate_url}"
    message = (
        f"{intro}\n\n"
        f"{action_line}\n"
        f"Tu código de verificación es: {code}\n\n"
        f"(Vence en 24 horas)"
    )
    wa_url = f"https://wa.me/{phone}?text={quote(message)}"
    return {
        "status": "reset" if reset else "invited",
        "player_id": player.id,
        "user_id": user_id,
        "phone": phone,
        "code": code,
        "wa_url": wa_url,
        "message": message,
    }


@router.post("/{player_id}/invite", status_code=201)
async def invite_player(
    player_id: int,
    data: PlayerInviteIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Crea (o re-invita) la cuenta rol PLAYER vinculada a este jugador y devuelve
    el link wa.me con el código. OWNER/MANAGER. No envía nada por sí mismo."""
    player = (await db.execute(
        select(models.Player).where(
            models.Player.id == player_id,
            models.Player.club_id == current_club.id,
        )
    )).scalars().first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")

    # El teléfono es la identidad de login: no puede pertenecer a OTRA cuenta
    # (ni de otro club, ni a un dealer). Regla idéntica a dealers.
    taken = (await db.execute(
        select(models.User).where(models.User.phone == phone)
    )).scalars().first()
    if taken and not (player.user_id and taken.id == player.user_id):
        raise HTTPException(status_code=409, detail="Ese teléfono ya está registrado en otra cuenta de RakeFlow")

    code = f"{secrets.randbelow(1000000):06d}"  # OTP 6 dígitos
    expires = datetime.utcnow() + timedelta(hours=24)

    if player.user_id:
        # Re-invitación: regenera código y permite corregir el teléfono mientras
        # la cuenta siga pendiente.
        user = (await db.execute(
            select(models.User).where(models.User.id == player.user_id)
        )).scalars().first()
        if user is None:
            raise HTTPException(status_code=409, detail="La cuenta vinculada no existe")
        if user.hashed_password is not None:
            raise HTTPException(status_code=409, detail="Este jugador ya activó su cuenta")
        user.phone = phone
        user.phone_verified = False
        user.invitation_token = code
        user.invitation_expires_at = expires
        user.invitation_sent_at = datetime.utcnow()
        user.invitation_attempts = 0
    else:
        user = models.User(
            club_id=current_club.id,
            email=None,
            phone=phone,
            phone_verified=False,
            name=player.name,
            role=models.UserRole.PLAYER,
            is_active=True,
            hashed_password=None,
            invitation_token=code,
            invitation_expires_at=expires,
            invitation_sent_at=datetime.utcnow(),
            invited_by_user_id=current_user.id,
        )
        db.add(user)
        await db.flush()
        player.user_id = user.id  # vínculo 1:1 cuenta <-> ficha

    player.phone = phone  # guardamos normalizado (tarea de recolección resuelta)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.PLAYER_INVITE, entity_type="Player", entity_id=player.id,
        meta={"phone": phone, "player_id": player.id, "user_id": user.id, "by": current_user.email},
    )
    await db.commit()

    return _build_invite_response(player, current_club.name, phone, code, user.id)


class PlayerResetIn(BaseModel):
    phone: Optional[str] = Field(None, min_length=7, max_length=20)


@router.post("/{player_id}/reset-access", status_code=201)
async def reset_player_access(
    player_id: int,
    data: PlayerResetIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Resetea el acceso de un jugador que YA activó (olvidó la clave). Vuelve la
    cuenta a 'pendiente' y devuelve nuevo wa.me con OTP. NO toca stats_since ni
    el historial. OWNER/MANAGER."""
    player = (await db.execute(
        select(models.Player).where(
            models.Player.id == player_id,
            models.Player.club_id == current_club.id,
        )
    )).scalars().first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    if not player.user_id:
        raise HTTPException(status_code=409, detail="Este jugador no tiene cuenta. Usá 'Invitar'.")

    user = (await db.execute(
        select(models.User).where(models.User.id == player.user_id)
    )).scalars().first()
    if user is None:
        raise HTTPException(status_code=409, detail="La cuenta vinculada no existe")
    if user.hashed_password is None:
        raise HTTPException(status_code=409, detail="La cuenta aún no se activó; usá 'Re-invitar'")

    phone = normalize_phone(data.phone) if data.phone else user.phone
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")
    if phone != user.phone:
        taken = (await db.execute(
            select(models.User).where(models.User.phone == phone)
        )).scalars().first()
        if taken and taken.id != user.id:
            raise HTTPException(status_code=409, detail="Ese teléfono ya está registrado en otra cuenta de RakeFlow")

    code = f"{secrets.randbelow(1000000):06d}"
    user.phone = phone
    user.phone_verified = False
    user.hashed_password = None
    user.invitation_token = code
    user.invitation_expires_at = datetime.utcnow() + timedelta(hours=24)
    user.invitation_sent_at = datetime.utcnow()
    user.invitation_attempts = 0
    user.is_active = True
    player.phone = phone

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.PLAYER_RESET_ACCESS, entity_type="Player", entity_id=player.id,
        meta={"phone": phone, "player_id": player.id, "user_id": user.id, "by": current_user.email},
    )
    await db.commit()

    return _build_invite_response(player, current_club.name, phone, code, user.id, reset=True)


class PlayerActivateIn(BaseModel):
    phone: str = Field(..., min_length=7, max_length=20)
    code: str = Field(..., min_length=4, max_length=10)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe tener al menos una mayúscula")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe tener al menos una minúscula")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe tener al menos un número")
        return v


@router.post("/activate")
@limiter.limit("8/hour")
async def activate_player(
    data: PlayerActivateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """El jugador verifica su número con el código de WhatsApp y crea su
    contraseña. Devuelve JWT (auto-login). Público. Al activar por primera vez,
    stats_since = now(): el panel arranca de cero hasta comprar el histórico."""
    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Teléfono inválido")

    user = (await db.execute(
        select(models.User).where(
            models.User.phone == phone,
            models.User.role == models.UserRole.PLAYER,
        )
    )).scalars().first()

    # Mensaje genérico: no filtra si el número existe.
    if (not user or user.hashed_password is not None
            or not user.invitation_token
            or not user.invitation_expires_at
            or user.invitation_expires_at < datetime.utcnow()):
        raise HTTPException(status_code=400, detail="Código inválido o vencido")

    # Lockout anti-fuerza-bruta POR TELÉFONO (además del rate limit por IP).
    if user.invitation_token != data.code.strip():
        user.invitation_attempts = (user.invitation_attempts or 0) + 1
        if user.invitation_attempts >= 5:
            user.invitation_token = None
            user.invitation_expires_at = None
        await db.commit()
        raise HTTPException(status_code=400, detail="Código inválido o vencido")

    # Capturar ANTES de mutar: la primera activación se detecta porque
    # last_login_at todavía es NULL (nunca entró).
    es_primera_activacion = user.last_login_at is None

    loop = asyncio.get_event_loop()
    user.hashed_password = await loop.run_in_executor(None, auth_utils.get_password_hash, data.password)
    user.phone_verified = True
    user.invitation_token = None
    user.invitation_expires_at = None
    user.invitation_attempts = 0
    user.last_login_at = datetime.utcnow()

    # Corte del histórico: arranca de cero desde la PRIMERA activación.
    # Solo la primera: si ya activó antes (reset de clave), stats_since NULL
    # significa "compró el histórico" y NO debe re-bloquearse.
    player = (await db.execute(
        select(models.Player).where(
            models.Player.user_id == user.id,
            models.Player.club_id == user.club_id,  # defensa en profundidad
        )
    )).scalars().first()
    if player and player.stats_since is None and es_primera_activacion:
        player.stats_since = datetime.utcnow()

    club = (await db.execute(select(models.Club).where(models.Club.id == user.club_id))).scalars().first()
    await log_action(
        db, request=request, club=club,
        action=AuditAction.PLAYER_ACTIVATE, entity_type="User", entity_id=user.id, user=user,
        meta={"phone": phone, "user_id": user.id, "player_id": player.id if player else None},
    )
    await db.commit()

    access_token = auth_utils.create_access_token(data={
        "sub": user.phone,
        "club_id": user.club_id,
        "user_id": user.id,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
    })
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": "player",
        "user_name": user.name,
    }


@router.post("/{player_id}/unlock-history")
async def unlock_player_history(
    player_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Toggle de la venta del histórico (se cobra EN CAJA, esto solo destraba):
    - bloqueado (stats_since con fecha) -> desbloquea (NULL): el panel muestra
      todo el histórico. La fecha previa queda en el audit log (reversible).
    - desbloqueado (NULL) -> re-bloquea con la fecha guardada en el último
      unlock del audit (o now() si no hay), para revertir un cobro errado.
    OWNER/MANAGER."""
    player = (await db.execute(
        select(models.Player).where(
            models.Player.id == player_id,
            models.Player.club_id == current_club.id,
        )
    )).scalars().first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    if player.stats_since is not None:
        prev = player.stats_since
        player.stats_since = None
        action_meta = {"action": "unlock", "prev_stats_since": str(prev), "by": current_user.email}
        unlocked = True
    else:
        # Re-bloqueo: recuperar el corte original del último unlock auditado.
        last = (await db.execute(
            select(models.AuditLog)
            .where(
                models.AuditLog.club_id == current_club.id,
                models.AuditLog.action == AuditAction.PLAYER_HISTORY_UNLOCK,
                models.AuditLog.entity_type == "Player",
                models.AuditLog.entity_id == player.id,
            )
            .order_by(models.AuditLog.created_at.desc())
            .limit(1)
        )).scalars().first()
        prev_str = (last.meta or {}).get("prev_stats_since") if last else None
        try:
            player.stats_since = datetime.fromisoformat(prev_str) if prev_str else datetime.utcnow()
        except (TypeError, ValueError):
            player.stats_since = datetime.utcnow()
        action_meta = {"action": "relock", "stats_since": str(player.stats_since), "by": current_user.email}
        unlocked = False

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.PLAYER_HISTORY_UNLOCK, entity_type="Player", entity_id=player.id,
        meta=action_meta,
    )
    await db.commit()

    return {"player_id": player.id, "history_unlocked": unlocked,
            "stats_since": str(player.stats_since) if player.stats_since else None}