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

@router.get("/club-public")
async def get_club_public(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Datos del link público del club (token + anuncio). El front arma la URL
    con su propio origin: {origin}/c/{public_token}."""
    return {
        "public_token": current_club.public_token,
        "public_announcement": current_club.public_announcement,
    }


@router.patch("/club-public")
async def update_club_public(
    data: schemas.ClubPublicUpdate,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Editar el anuncio 'Hoy se rompe' del link público."""
    club = (await db.execute(
        select(models.Club).where(models.Club.id == current_club.id)
    )).scalars().first()
    club.public_announcement = (data.public_announcement or "").strip() or None
    await db.commit()
    return {"public_announcement": club.public_announcement}


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

# ---------------------------------------------------------
# Reto rotativo mensual (PR7 retención). El staff define un objetivo del mes
# (métrica + meta + recompensa que entrega en caja); el panel del jugador
# muestra el progreso. Combate el desgaste de los badges fijos.
# ---------------------------------------------------------
from datetime import datetime
from .. import player_stats


def _challenge_out(ch):
    return {
        "id": ch.id, "year": ch.year, "month": ch.month,
        "title": ch.title, "description": ch.description,
        "metric": ch.metric, "target": ch.target,
        "reward_text": ch.reward_text, "active": ch.active,
    }


@router.get("/monthly-challenge")
async def get_monthly_challenge(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Reto activo del mes en curso (hora Colombia). None si no hay."""
    now_col = datetime.now(player_stats.COL_TZ)
    ch = (await db.execute(
        select(models.MonthlyChallenge).where(
            models.MonthlyChallenge.club_id == current_club.id,
            models.MonthlyChallenge.year == now_col.year,
            models.MonthlyChallenge.month == now_col.month,
            models.MonthlyChallenge.active == True,  # noqa: E712
        )
    )).scalars().first()
    return {"challenge": _challenge_out(ch) if ch else None,
            "period": {"year": now_col.year, "month": now_col.month}}


@router.put("/monthly-challenge")
async def upsert_monthly_challenge(
    data: schemas.MonthlyChallengeUpsert,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Crea o reemplaza el reto del mes en curso. Un reto activo por (club, mes):
    se desactiva el anterior y se inserta el nuevo (upsert manual, sin depender
    de una carrera contra el índice único parcial)."""
    now_col = datetime.now(player_stats.COL_TZ)
    await db.execute(
        models.MonthlyChallenge.__table__.update()
        .where(
            models.MonthlyChallenge.club_id == current_club.id,
            models.MonthlyChallenge.year == now_col.year,
            models.MonthlyChallenge.month == now_col.month,
            models.MonthlyChallenge.active == True,  # noqa: E712
        )
        .values(active=False)
    )
    ch = models.MonthlyChallenge(
        club_id=current_club.id, year=now_col.year, month=now_col.month,
        title=data.title.strip(), description=(data.description or "").strip() or None,
        metric=data.metric, target=data.target,
        reward_text=(data.reward_text or "").strip() or None, active=True,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return {"challenge": _challenge_out(ch)}


@router.delete("/monthly-challenge", status_code=204)
async def clear_monthly_challenge(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Quita el reto del mes en curso (lo desactiva; el historial se conserva)."""
    now_col = datetime.now(player_stats.COL_TZ)
    await db.execute(
        models.MonthlyChallenge.__table__.update()
        .where(
            models.MonthlyChallenge.club_id == current_club.id,
            models.MonthlyChallenge.year == now_col.year,
            models.MonthlyChallenge.month == now_col.month,
            models.MonthlyChallenge.active == True,  # noqa: E712
        )
        .values(active=False)
    )
    await db.commit()
