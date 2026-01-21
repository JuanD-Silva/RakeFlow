import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv

# Cargar variables de entorno para obtener la URL de Railway
load_dotenv()

database_url = os.getenv("DATABASE_URL")

# Corrección de URL para asyncpg (igual que en tu database.py)
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif database_url and database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

async def agregar_bonus():
    print(f"🔌 Conectando a Railway...")
    
    # IMPORTANTE: Usamos isolation_level="AUTOCOMMIT"
    # Postgres NO permite modificar Enums dentro de una transacción normal.
    # Este modo le dice a SQLAlchemy: "Ejecuta el comando directo, sin abrir transacción".
    engine = create_async_engine(database_url, isolation_level="AUTOCOMMIT")

    async with engine.connect() as conn:
        try:
            print("⏳ Ejecutando comando SQL...")
            await conn.execute(text("ALTER TYPE transactiontype ADD VALUE 'BONUS';"))
            print("✅ ¡ÉXITO! Se agregó 'BONUS' a la lista de tipos permitidos.")
        except Exception as e:
            if "already exists" in str(e) or "duplicate value" in str(e):
                print("⚠️  El valor 'BONUS' ya existía. No hace falta hacer nada.")
            else:
                print(f"❌ Error inesperado: {e}")
    
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(agregar_bonus())