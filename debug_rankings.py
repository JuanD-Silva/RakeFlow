import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from datetime import datetime
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")

# Parche para Docker/Postgres
if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# 👇👇👇 CONFIGURACIÓN: CAMBIA ESTO SI TU CLUB NO ES EL 1 👇👇👇
CLUB_ID_A_REVISAR = 3 
# 👆👆👆 (Si creaste varios clubes, prueba con 1, 2, o 3)

async def audit_players():
    print(f"🔌 Conectando para auditar el CLUB ID: {CLUB_ID_A_REVISAR}...")
    
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        print("📊 Calculando Ranking (Filtrado por Club)...")
        print("-" * 95)
        print(f"{'JUGADOR':<20} | {'ENTRADAS (Buy-in)':<18} | {'SALIDAS (Cashout)':<18} | {'NETO (Ganancia)':<15}")
        print("-" * 95)

        start_date = datetime(2020, 1, 1)

        sql = text("""
            SELECT p.name, 
                   SUM(CASE WHEN t.type IN ('BUYIN', 'REBUY') THEN t.amount ELSE 0 END) as total_in,
                   SUM(CASE WHEN t.type IN ('CASHOUT', 'JACKPOT_PAYOUT') THEN t.amount ELSE 0 END) as total_out,
                   SUM(
                       CASE 
                           WHEN t.type IN ('CASHOUT', 'JACKPOT_PAYOUT') THEN t.amount
                           WHEN t.type IN ('BUYIN', 'REBUY') THEN -t.amount
                           ELSE 0 
                       END
                   ) as val

            FROM players p
            JOIN transactions t ON p.id = t.player_id
            JOIN sessions s ON t.session_id = s.id
            
            -- 👇 AQUÍ ESTÁ EL FILTRO QUE FALTABA
            WHERE p.club_id = :club_id 
              AND s.end_time >= :start_date

            GROUP BY p.id, p.name
            ORDER BY val DESC
        """)

        result = await db.execute(sql, {"start_date": start_date, "club_id": CLUB_ID_A_REVISAR})
        rows = result.fetchall()

        if not rows:
            print(f"⚠️ No se encontraron jugadores para el Club ID {CLUB_ID_A_REVISAR}.")
            print("Prueba cambiando la variable 'CLUB_ID_A_REVISAR' en el script a 2 o 3.")
        
        for r in rows:
            in_str = f"${r.total_in:,.0f}"
            out_str = f"${r.total_out:,.0f}"
            net_str = f"${r.val:,.0f}"
            color = "\033[92m" if r.val > 0 else "\033[91m"
            reset = "\033[0m"

            print(f"{r.name:<20} | {in_str:<18} | {out_str:<18} | {color}{net_str:<15}{reset}")

        print("-" * 95)
        print(f"Total Jugadores en este club: {len(rows)}")

    await engine.dispose()

if __name__ == "__main__":
    try:
        asyncio.run(audit_players())
    except Exception as e:
        print(f"❌ Error: {e}")