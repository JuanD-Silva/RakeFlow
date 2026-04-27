"""Gestion multi-usuario por club."""

import secrets
import threading
import logging
import asyncio
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel

from .. import models, schemas, auth_utils
from ..dependencies import get_db, get_current_user, require_role
from ..audit import log_action, AuditAction
from ..email_service import send_invitation_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])


def _user_to_response(u: models.User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role.value if hasattr(u.role, "value") else str(u.role),
        "is_active": u.is_active,
        "invitation_pending": u.hashed_password is None and u.invitation_token is not None,
        "invitation_sent_at": u.invitation_sent_at,
        "last_login_at": u.last_login_at,
        "created_at": u.created_at,
    }


@router.get("/", response_model=List[schemas.UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Lista los usuarios del club del usuario autenticado."""
    result = await db.execute(
        select(models.User)
        .where(models.User.club_id == current_user.club_id)
        .order_by(models.User.created_at.asc())
    )
    users = result.scalars().all()
    return [_user_to_response(u) for u in users]


@router.post("/invite", status_code=status.HTTP_201_CREATED)
async def invite_user(
    data: schemas.UserInvite,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Crea un User invitado y envia email con token de aceptacion. Solo OWNER."""
    email = data.email.strip().lower()

    # No puedes invitar OWNER (solo hay un OWNER por club al inicio)
    if data.role == schemas.UserRoleEnum.OWNER:
        raise HTTPException(status_code=400, detail="No se puede invitar a otro OWNER. Cambia el rol de un usuario existente si necesitas transferir propiedad.")

    # Verificar que el email no este en uso (a nivel global de la tabla users)
    existing = (await db.execute(
        select(models.User).where(models.User.email == email)
    )).scalars().first()

    if existing and existing.club_id == current_user.club_id:
        raise HTTPException(status_code=409, detail="Ese email ya pertenece a un usuario del club")
    if existing:
        raise HTTPException(status_code=409, detail="Ese email ya esta registrado en otro club")

    # Cargar nombre del club para el email
    club = (await db.execute(
        select(models.Club).where(models.Club.id == current_user.club_id)
    )).scalars().first()
    club_name = club.name if club else "tu club"

    role_map = {
        schemas.UserRoleEnum.OWNER: models.UserRole.OWNER,
        schemas.UserRoleEnum.MANAGER: models.UserRole.MANAGER,
        schemas.UserRoleEnum.CASHIER: models.UserRole.CASHIER,
    }

    token = secrets.token_urlsafe(32)
    new_user = models.User(
        club_id=current_user.club_id,
        email=email,
        name=data.name,
        role=role_map[data.role],
        is_active=True,
        hashed_password=None,
        invitation_token=token,
        invitation_expires_at=datetime.utcnow() + timedelta(days=7),
        invitation_sent_at=datetime.utcnow(),
        invited_by_user_id=current_user.id,
    )
    db.add(new_user)
    await db.flush()

    await log_action(
        db, request=request, club=club,
        action="USER_INVITE",
        entity_type="User", entity_id=new_user.id,
        meta={"email": email, "role": data.role.value, "invited_by": current_user.email},
    )
    await db.commit()
    await db.refresh(new_user)

    # Email en background
    threading.Thread(
        target=send_invitation_email,
        args=(email, token, current_user.name or current_user.email, club_name, data.role.value),
        daemon=True,
    ).start()

    return _user_to_response(new_user)


@router.patch("/{user_id}")
async def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Actualizar nombre, rol o estado de un usuario. Solo OWNER."""
    target = (await db.execute(
        select(models.User).where(models.User.id == user_id)
    )).scalars().first()

    if not target or target.club_id != current_user.club_id:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if target.id == current_user.id and data.role and data.role != schemas.UserRoleEnum.OWNER:
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol de OWNER. Transfiere primero a otro usuario.")

    role_map = {
        schemas.UserRoleEnum.OWNER: models.UserRole.OWNER,
        schemas.UserRoleEnum.MANAGER: models.UserRole.MANAGER,
        schemas.UserRoleEnum.CASHIER: models.UserRole.CASHIER,
    }

    changes = {}
    if data.name is not None:
        changes["name"] = {"from": target.name, "to": data.name}
        target.name = data.name
    if data.role is not None:
        changes["role"] = {"from": str(target.role), "to": data.role.value}
        target.role = role_map[data.role]
    if data.is_active is not None:
        changes["is_active"] = {"from": target.is_active, "to": data.is_active}
        target.is_active = data.is_active

    club = (await db.execute(
        select(models.Club).where(models.Club.id == current_user.club_id)
    )).scalars().first()

    await log_action(
        db, request=request, club=club,
        action="USER_UPDATE",
        entity_type="User", entity_id=target.id,
        meta={"target_email": target.email, "changes": changes, "by": current_user.email},
    )
    await db.commit()
    await db.refresh(target)
    return _user_to_response(target)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Desactiva permanentemente un usuario. No borra el row para preservar auditoria."""
    target = (await db.execute(
        select(models.User).where(models.User.id == user_id)
    )).scalars().first()

    if not target or target.club_id != current_user.club_id:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta desde aqui")
    if target.role == models.UserRole.OWNER:
        raise HTTPException(status_code=400, detail="No puedes eliminar al OWNER. Cambia su rol primero.")

    target.is_active = False
    target.invitation_token = None  # invalida cualquier invitacion pendiente

    club = (await db.execute(
        select(models.Club).where(models.Club.id == current_user.club_id)
    )).scalars().first()

    await log_action(
        db, request=request, club=club,
        action="USER_DELETE",
        entity_type="User", entity_id=target.id,
        meta={"target_email": target.email, "role": str(target.role), "by": current_user.email},
    )
    await db.commit()
    return None


@router.post("/accept-invitation")
async def accept_invitation(
    data: schemas.AcceptInvitation,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Endpoint publico: el invitado acepta la invitacion y crea su contrasena."""
    user = (await db.execute(
        select(models.User).where(models.User.invitation_token == data.token)
    )).scalars().first()

    if not user:
        raise HTTPException(status_code=400, detail="Token invalido")
    if user.invitation_expires_at and user.invitation_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invitacion expirada. Pide al dueno del club que la reenvie.")
    if user.hashed_password is not None:
        raise HTTPException(status_code=400, detail="Esta invitacion ya fue aceptada")

    loop = asyncio.get_event_loop()
    user.hashed_password = await loop.run_in_executor(None, auth_utils.get_password_hash, data.password)
    user.name = data.name
    user.invitation_token = None
    user.invitation_expires_at = None
    user.is_active = True

    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()

    await log_action(
        db, request=request, club=club,
        action="USER_INVITATION_ACCEPTED",
        entity_type="User", entity_id=user.id,
        meta={"email": user.email, "role": str(user.role)},
    )
    await db.commit()

    # Auto-login: emitir token
    access_token = auth_utils.create_access_token(
        data={
            "sub": user.email,
            "club_id": user.club_id,
            "user_id": user.id,
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        }
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "user_name": user.name,
    }


@router.post("/{user_id}/resend-invitation")
async def resend_invitation(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Genera un nuevo token y reenvia el email de invitacion. Solo OWNER."""
    target = (await db.execute(
        select(models.User).where(models.User.id == user_id)
    )).scalars().first()

    if not target or target.club_id != current_user.club_id:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.hashed_password is not None:
        raise HTTPException(status_code=400, detail="Este usuario ya acepto su invitacion")

    target.invitation_token = secrets.token_urlsafe(32)
    target.invitation_expires_at = datetime.utcnow() + timedelta(days=7)
    target.invitation_sent_at = datetime.utcnow()

    club = (await db.execute(
        select(models.Club).where(models.Club.id == current_user.club_id)
    )).scalars().first()
    club_name = club.name if club else "tu club"

    await log_action(
        db, request=request, club=club,
        action="USER_INVITE_RESEND",
        entity_type="User", entity_id=target.id,
        meta={"email": target.email, "by": current_user.email},
    )
    await db.commit()

    threading.Thread(
        target=send_invitation_email,
        args=(target.email, target.invitation_token, current_user.name or current_user.email, club_name, str(target.role.value if hasattr(target.role, "value") else target.role)),
        daemon=True,
    ).start()

    return {"message": "Invitacion reenviada"}
