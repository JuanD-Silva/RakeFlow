import asyncio
from sqlalchemy import text
from app.database import engine

async def add_double_counters():
    print("🛠️ Agregando contadores de 'Dobles' a los jugadores...")
    
    queries = [
        "ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS double_rebuys_count INTEGER DEFAULT 0",
        "ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS double_addons_count INTEGER DEFAULT 0"
    ]
    
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        for q in queries:
            try:
                await conn.execute(text(q))
                print(f"✅ Ejecutado: {q}")
            except Exception as e:
                print(f"❌ Error: {e}")

    print("\n🎉 Base de datos lista para distinguir Sencillos vs Dobles.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(add_double_counters())