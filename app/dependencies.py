# app/dependencies.py
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from jose import JWTError, jwt

from .database import AsyncSessionLocal
from . import models, auth_utils # Importamos el nuevo auth_utils

# URL donde el frontend pedirá login (esto lo usaremos luego)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# Conexión a BD (Igual que antes)
async def get_db():
    async with AsyncSessionLocal() as db:
        yield db

# 👇 EL NUEVO "PORTERO" SAAS (Reemplaza a FIXED_CLUB_ID)
async def get_current_club(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> models.Club:
    """
    Decodifica el Token JWT, extrae el club_id y verifica que exista.
    Si todo está bien, devuelve el objeto Club.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas o expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # 1. Decodificar Token
        payload = jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
        email: str = payload.get("sub")
        club_id: int = payload.get("club_id")
        
        if email is None or club_id is None:
            raise credentials_exception
            
    except JWTError:
        raise credentials_exception

    # 2. Verificar en Base de Datos
    result = await db.execute(select(models.Club).where(models.Club.id == club_id))
    club = result.scalars().first()
    
    if club is None:
        raise credentials_exception
        
    return club