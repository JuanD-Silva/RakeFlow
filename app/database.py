# app/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from dotenv import load_dotenv

load_dotenv()

# 1. OBTENER LA URL
DATABASE_URL = os.getenv("DATABASE_URL")

# 2. VALIDACIÓN DE SEGURIDAD
if not DATABASE_URL:
    # Esto evita errores cripticos si la variable no existe
    raise ValueError("❌ ERROR FATAL: No se encontró la variable DATABASE_URL.")

# 3. EL FIX MÁGICO PARA RAILWAY/RENDER 🛠️
# Railway entrega la URL comenzando con "postgres://" o "postgresql://"
# Pero SQLAlchemy Async necesita explícitamente "postgresql+asyncpg://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# 4. CREAR EL MOTOR CON LA URL CORREGIDA
engine = create_async_engine(DATABASE_URL, echo=True)

# 5. CONFIGURAR LA SESIÓN
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Base para los modelos
Base = declarative_base()

# Dependencia para inyección
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session