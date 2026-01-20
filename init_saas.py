# init_saas.py
import asyncio
from app.database import AsyncSessionLocal, engine
from app.models import Base, Club, User, UserRole

async def init_saas_data():
    async with AsyncSessionLocal() as db:
        print("🌱 Creando el primer Club y Usuario Admin...")

        # 1. Crear el Club
        new_club = Club(
            name="Poker Club Demo",
            code="DEMO-001",
            plan_type="PRO",
            is_active=True
        )
        db.add(new_club)
        await db.commit()
        await db.refresh(new_club)
        
        print(f"✅ Club creado: {new_club.name} (ID: {new_club.id})")

        # 2. Crear el Usuario Dueño (Super Admin del Club)
        # Nota: En un sistema real, aquí hashearías la contraseña.
        new_user = User(
            club_id=new_club.id,
            username="admin",
            hashed_password="password123", # ⚠️ Solo para pruebas
            role=UserRole.OWNER,
            is_active=True
        )
        db.add(new_user)
        await db.commit()
        
        print(f"✅ Usuario creado: {new_user.username} (Password: password123)")
        print("🚀 ¡Base de datos SaaS inicializada!")

if __name__ == "__main__":
    asyncio.run(init_saas_data())