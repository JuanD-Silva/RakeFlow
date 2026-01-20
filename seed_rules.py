# seed_rules.py
import asyncio
from sqlalchemy import delete
from app.database import AsyncSessionLocal
from app.models import DistributionRule, RuleType

# ID de tu club (El que creamos en init_saas.py)
MY_CLUB_ID = 1

async def seed_financial_rules():
    async with AsyncSessionLocal() as db:
        print(f"⚙️ Configurando reglas financieras para el Club ID {MY_CLUB_ID}...")

        # 1. Limpiar reglas anteriores (para no duplicar si lo corres dos veces)
        await db.execute(delete(DistributionRule).where(DistributionRule.club_id == MY_CLUB_ID))
        
        # ---------------------------------------------------------
        # TUS REGLAS DE NEGOCIO (Aquí es donde personalizas)
        # ---------------------------------------------------------

        # REGLA 1: La Deuda / Cuota Mensual ($400.000)
        # Prioridad 1: Se cobra ANTES que los socios.
        rule_debt = DistributionRule(
            club_id=MY_CLUB_ID,
            name="Abono Deuda/Fijos",
            rule_type=RuleType.MONTHLY_QUOTA, # Tipo: Cuota hasta llenar el vaso
            value=400000.0,                   # Monto: $400k
            priority=1,                       # Importancia: Alta (se paga primero)
            active=True
        )
        db.add(rule_debt)

        # REGLA 2: Los Socios (Ejemplo: Tú ganas el 25%)
        # Prioridad 2: Se calcula sobre lo que sobre después de la deuda.
        
        # Socio 1 (Tú)
        partner_1 = DistributionRule(
            club_id=MY_CLUB_ID,
            name="Socio Juan (25%)",
            rule_type=RuleType.PERCENTAGE,
            value=0.25, # 25%
            priority=2,
            active=True
        )
        db.add(partner_1)

        # Socio 2 (Ejemplo)
        partner_2 = DistributionRule(
            club_id=MY_CLUB_ID,
            name="Socio Pedro (25%)",
            rule_type=RuleType.PERCENTAGE,
            value=0.25,
            priority=2,
            active=True
        )
        db.add(partner_2)

        # Socio 3 (Ejemplo)
        partner_3 = DistributionRule(
            club_id=MY_CLUB_ID,
            name="Socio Maria (25%)",
            rule_type=RuleType.PERCENTAGE,
            value=0.25,
            priority=2,
            active=True
        )
        db.add(partner_3)

        # Socio 4 (Ejemplo o Fondo de la casa)
        partner_4 = DistributionRule(
            club_id=MY_CLUB_ID,
            name="Fondo Reserva (25%)",
            rule_type=RuleType.PERCENTAGE,
            value=0.25,
            priority=2,
            active=True
        )
        db.add(partner_4)

        # ---------------------------------------------------------
        
        await db.commit()
        print("✅ Reglas insertadas correctamente:")
        print("   - 1. Abono Deuda ($400.000)")
        print("   - 2. Socios (4 partes de 25%)")

if __name__ == "__main__":
    asyncio.run(seed_financial_rules())