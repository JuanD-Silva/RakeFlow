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
    raise ValueError("❌ ERROR FATAL: No se encontró la variable DATABASE_URL.")

# 3. EL FIX MÁGICO PARA RAILWAY/RENDER 🛠️
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# 4. CREAR EL MOTOR CON LA CONFIGURACIÓN ANTI-CAÍDAS 🛡️
engine = create_async_engine(
    DATABASE_URL,
    echo=False,          # Cambiado a False para limpiar un poco la terminal (opcional)
    
    # 👇 ESTAS SON LAS LÍNEAS QUE EVITAN EL ERROR "ConnectionDoesNotExistError"
    pool_pre_ping=True,  # Verifica la conexión antes de cada consulta
    pool_recycle=300,    # Renueva la conexión cada 5 minutos (300 segundos)
    pool_size=5,         # Mantiene 5 conexiones listas
    max_overflow=10      # Permite picos de hasta 10 conexiones extra
)

# 5. CONFIGURAR LA SESIÓN
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Base para los modelos
Base = declarative_base()

# Dependencia para inyección
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session