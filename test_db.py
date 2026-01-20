# test_db.py
import asyncio
import asyncpg

async def test_connection():
    print("Probando conexión...")
    try:
        # Esta URL es idéntica a tu .env
        conn = await asyncpg.connect('postgresql://poker_admin:poker_pass@localhost:5432/poker_treasury_db')
        print("\n✅ ¡CONEXIÓN EXITOSA! La base de datos aceptó la contraseña.")
        await conn.close()
    except Exception as e:
        print(f"\n❌ FALLÓ: {e}")

if __name__ == "__main__":
    asyncio.run(test_connection())