import asyncio
from sqlalchemy import text
from app.database import engine

async def fix_missing_columns():
    print("🛠️ Reparando columnas faltantes en la tabla 'tournaments'...")
    
    # Lista de columnas a agregar con su tipo y valor por defecto
    columns_to_add = [
        "rebuy_price INTEGER DEFAULT 0",
        "double_rebuy_price INTEGER DEFAULT 0",
        "addon_price INTEGER DEFAULT 0",
        "double_addon_price INTEGER DEFAULT 0"
    ]
    
    async with engine.connect() as conn:
        # PostgreSQL requiere autocommit para ciertos comandos DDL, aunque ALTER TABLE suele funcionar en transacción
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        
        for col_def in columns_to_add:
            col_name = col_def.split()[0] # Obtenemos el nombre (ej: rebuy_price)
            try:
                print(f"➡️ Intentando agregar columna '{col_name}'...")
                # Usamos IF NOT EXISTS para que no falle si alguna ya se creó
                await conn.execute(text(f"ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS {col_def}"))
                print(f"✅ Columna '{col_name}' verificada/creada.")
            except Exception as e:
                print(f"❌ Error con '{col_name}': {e}")

    print("\n🎉 Base de datos reparada. ¡Ahora sí debería funcionar!")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(fix_missing_columns())