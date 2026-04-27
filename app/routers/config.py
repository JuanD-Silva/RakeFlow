# app/routers/config.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from typing import List

from .. import models, schemas
from ..dependencies import get_db, get_current_club, require_role

router = APIRouter(
    prefix="/config",
    tags=["Configuration"]
)

@router.post("/initial-setup")
async def initial_setup(
    setup_data: schemas.InitialSetupRequest,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Configura:
    1. Meta Mensual (Prioridad 1).
    2. Reglas de Socios dinámicas (Prioridad 2).
    """
    # 1. Limpiar reglas anteriores
    await db.execute(delete(models.DistributionRule).where(models.DistributionRule.club_id == current_club.id))
    
    rules_to_create = []

    # 2. Crear Regla de Meta/Deuda (Prioridad 1)
    # Si el usuario pone 0, igual la creamos para mantener la estructura, o podríamos omitirla.
    # La creamos en 0 para que el Dashboard muestre "Meta Completada".
    rules_to_create.append(models.DistributionRule(
        club_id=current_club.id,
        name="Meta Mensual (Fijos)",
        rule_type=models.RuleType.FIXED, 
        value=setup_data.monthly_goal, 
        priority=1,
        active=True
    ))

    # 3. Crear Reglas para cada Socio (Prioridad 2)
    # Todos los socios tienen la misma prioridad (2) para que el porcentaje
    # se calcule sobre la misma base (la utilidad neta después de gastos).
    if setup_data.partners:
        for partner in setup_data.partners:
            rules_to_create.append(models.DistributionRule(
                club_id=current_club.id,
                name=f"Socio: {partner.name}", # Ej: "Socio: Juan"
                rule_type=models.RuleType.PERCENTAGE,
                value=partner.percentage, 
                priority=2, 
                active=True
            ))
    else:
        # Fallback si no mandan socios: 100% a la casa
        rules_to_create.append(models.DistributionRule(
            club_id=current_club.id,
            name="Utilidad Socios (General)",
            rule_type=models.RuleType.PERCENTAGE,
            value=100.0, 
            priority=2, 
            active=True
        ))

    db.add_all(rules_to_create)

    # Marcar setup como completado
    current_club.setup_completed = True
    await db.commit()

    return {"message": "Configuración de socios guardada exitosamente"}
@router.get("/distribution", response_model=List[schemas.DistributionRuleResponse])
async def get_distribution_rules(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club) # 👈 Inyección Auth
):
    """
    Obtiene las reglas de negocio activas para el club autenticado.
    """
    result = await db.execute(
        select(models.DistributionRule)
        .where(
            models.DistributionRule.club_id == current_club.id, # 👈 Filtro SaaS
            models.DistributionRule.active == True
        )
        .order_by(models.DistributionRule.priority.asc())
    )
    return result.scalars().all()

@router.post("/distribution", response_model=List[schemas.DistributionRuleResponse])
async def update_distribution_rules(
    rules: List[schemas.DistributionRuleCreate],
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    Sobrescribe TODAS las reglas del club autenticado.
    """
    
    # 1. Borrar reglas viejas DE ESTE CLUB (Limpieza)
    #    Ojo: Usamos current_club.id para no tocar datos de otros clientes.
    await db.execute(
        delete(models.DistributionRule).where(models.DistributionRule.club_id == current_club.id)
    )
    
    # 2. Crear las nuevas reglas asignadas a este club
    new_rules_db = []
    for r in rules:
        new_rule = models.DistributionRule(
            club_id=current_club.id, # 👈 Asignación automática segura
            name=r.name,
            rule_type=r.rule_type,
            value=r.value,
            priority=r.priority,
            active=True
        )
        new_rules_db.append(new_rule)
    
    db.add_all(new_rules_db)
    await db.commit()
    
    # 3. Retornar las nuevas consultando la DB
    result = await db.execute(
        select(models.DistributionRule)
        .where(models.DistributionRule.club_id == current_club.id)
        .order_by(models.DistributionRule.priority.asc())
    )
    return result.scalars().all()