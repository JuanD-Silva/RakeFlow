# app/dependencies.py
from typing import List
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from jose import JWTError, jwt

from .database import AsyncSessionLocal
from . import models, auth_utils

# URL donde el frontend pedirá login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# Conexión a BD
async def get_db():
    async with AsyncSessionLocal() as db:
        yield db

async def get_current_club(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> models.Club:
    """
    Decodifica el Token JWT, extrae el club_id y verifica que exista.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas o expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
        email: str = payload.get("sub")
        club_id: int = payload.get("club_id")

        if email is None or club_id is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    result = await db.execute(select(models.Club).where(models.Club.id == club_id))
    club = result.scalars().first()

    if club is None:
        raise credentials_exception

    return club

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> models.User:
    """
    Extrae el usuario autenticado desde el JWT.
    Requiere que el JWT incluya 'user_id' (se debe agregar al login de Users cuando se implemente).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas o expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(models.User).where(models.User.id == user_id))
    user = result.scalars().first()

    if user is None or not user.is_active:
        raise credentials_exception

    return user

def require_role(allowed_roles: List[models.UserRole]):
    """
    Genera una dependencia que verifica que el usuario tenga uno de los roles permitidos.
    Uso: current_user: models.User = Depends(require_role([UserRole.OWNER]))
    """
    async def check_role(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para esta acción"
            )
        return current_user
    return check_role