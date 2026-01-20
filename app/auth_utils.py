# app/auth_utils.py
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt

# ⚠️ EN PRODUCCIÓN: Cambia esto por una variable de entorno real
SECRET_KEY = "POKER_SAAS_SUPER_SECRET_KEY_2024" 
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12 # 12 Horas de sesión

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
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt