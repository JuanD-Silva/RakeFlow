import asyncio
from app.database import AsyncSessionLocal
from app.models import Player, User, UserRole

async def seed():
    async with AsyncSessionLocal() as db:
        print("🌱 Sembrando datos iniciales...")
        
        # 1. Crear un Jugador
        shark = Player(name="Juan Silva", alias="El Shark", phone="300-1234567")
        db.add(shark)
        
        # 2. Crear un Cajero (Usuario)
        cashier = User(username="cajero1", role=UserRole.CAJERO)
        db.add(cashier)

        await db.commit()
        print("✅ Datos creados exitosamente.")
        print("   -> Jugador ID 1: Juan Silva")

if __name__ == "__main__":
    asyncio.run(seed())