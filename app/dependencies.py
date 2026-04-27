# app/dependencies.py
from typing import List, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from jose import JWTError, jwt

from .database import AsyncSessionLocal
from . import models, auth_utils

# URL donde el frontend pedirá login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


async def get_db():
    async with AsyncSessionLocal() as db:
        yield db


def _decode_token(token: str) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales invalidas o expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
    except JWTError:
        raise credentials_exception
    if payload.get("club_id") is None:
        raise credentials_exception
    return payload


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> models.User:
    """
    Resuelve el User autenticado.
    - Token nuevo (con user_id): busca por user_id.
    - Token viejo (solo club_id): fallback al OWNER del club, para no
      desconectar a usuarios con sesion previa al deploy.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales invalidas o expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = _decode_token(token)
    user_id: Optional[int] = payload.get("user_id")
    club_id: int = payload.get("club_id")

    if user_id is not None:
        user = (await db.execute(
            select(models.User).where(models.User.id == user_id)
        )).scalars().first()
    else:
        # Compat con tokens emitidos antes del rollout multi-usuario
        user = (await db.execute(
            select(models.User)
            .where(models.User.club_id == club_id)
            .where(models.User.role == models.UserRole.OWNER)
            .order_by(models.User.id.asc())
            .limit(1)
        )).scalars().first()

    if user is None or not user.is_active or user.club_id != club_id:
        raise credentials_exception
    if user.hashed_password is None:
        # Invitacion no aceptada todavia
        raise credentials_exception

    return user


async def get_current_club(
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> models.Club:
    """
    Backwards compat: devuelve el Club al que pertenece el usuario autenticado.
    Mantenemos el nombre para no romper los routers existentes.
    """
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()
    if club is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Club no encontrado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return club


def require_role(allowed_roles: List[models.UserRole]):
    """
    Verifica que el User autenticado tenga uno de los roles permitidos.
    Uso: current_user: models.User = Depends(require_role([UserRole.OWNER]))
    """
    async def check_role(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para esta accion",
            )
        return current_user
    return check_role