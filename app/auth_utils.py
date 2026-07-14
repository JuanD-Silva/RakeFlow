# app/auth_utils.py
import os
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY no encontrada en variables de entorno.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 dias (POS de club; dispositivo de confianza)

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    """Verifica si la contraseña escrita coincide con el hash"""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    """Encripta la contraseña para guardarla en BD"""
    return pwd_context.hash(password)

def create_access_token(data: dict):
    """Genera el Token JWT que el frontend guardará"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    # purpose="access": separa explícitamente la sesión del select_token efímero
    # del login multi-cuenta (purpose="select", que NO es una sesión).
    to_encode.update({"exp": expire, "purpose": "access"})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt