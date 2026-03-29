# fix_enums.py
import asyncio
from sqlalchemy import text
from app.database import engine

async def fix_postgres_enums():
    print("🔄 Actualizando Enums...")
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        
        # Agregamos los nuevos tipos de transacción
        new_types = ["TOURNAMENT_REBUY", "TOURNAMENT_ADDON"]
        
        for t in new_types:
            try:
                print(f"➡️ Agregando '{t}'...")
                await conn.execute(text(f"ALTER TYPE transactiontype ADD VALUE '{t}'"))
            except Exception as e:
                print(f"ℹ️ {t} ya existe o dio error: {e}")

    print("\n🎉 Enums actualizados.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(fix_postgres_enums())