import asyncio
from sqlalchemy import text
from app.database import engine

async def add_payout_structure():
    print("🛠️ Agregando estructura de premios a la base de datos...")
    
    # Agregamos una columna JSON para guardar la lista de porcentajes (Ej: [50, 30, 20])
    query = "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS payout_structure JSON DEFAULT '[]'"
    
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            await conn.execute(text(query))
            print("✅ Columna 'payout_structure' creada.")
        except Exception as e:
            print(f"❌ Error: {e}")

    print("\n🎉 Base de datos lista.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(add_payout_structure())