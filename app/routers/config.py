# app/routers/config.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, text
from typing import List

from .. import models, schemas, push_triggers
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
        "show_jackpot": bool(current_club.show_jackpot),
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
    prev = club.public_announcement
    club.public_announcement = (data.public_announcement or "").strip() or None
    # show_jackpot: None = no tocar (así el guardado del anuncio no lo pisa).
    if data.show_jackpot is not None:
        club.show_jackpot = data.show_jackpot
    await db.commit()
    # Anuncio nuevo (no vacío y distinto) → push a los suscritos del club.
    # Fire-and-forget post-commit con dedupe 1/día adentro: editar tres veces
    # el mismo día no spamea; borrar el anuncio jamás notifica.
    if club.public_announcement and club.public_announcement != prev:
        push_triggers.spawn(push_triggers.notify_announcement(
            club.id, club.name, club.public_announcement))
    return {"public_announcement": club.public_announcement,
            "show_jackpot": bool(club.show_jackpot)}


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
        "reward_text": ch.reward_text, "tiers": ch.tiers, "active": ch.active,
    }


def _build_challenge(club_id, year, month, data):
    """Construye una fila MonthlyChallenge activa desde un MonthlyChallengeUpsert.
    Escalonado: guarda los tramos y deja target = tramo mayor (para que cualquier
    lector que mire 'target' vea la meta tope del reto)."""
    tiers = None
    if data.tiers:
        tiers = [
            {"target": t.target,
             "reward": (t.reward or "").strip() or None,
             "reward_vip": (t.reward_vip or "").strip() or None}
            for t in data.tiers
        ]
    target = max(t["target"] for t in tiers) if tiers else data.target
    return models.MonthlyChallenge(
        club_id=club_id, year=year, month=month,
        title=data.title.strip(), description=(data.description or "").strip() or None,
        metric=data.metric, target=target,
        reward_text=(data.reward_text or "").strip() or None,
        tiers=tiers, active=True,
    )


def _active_month_stmt(club_id, now_col):
    return (
        models.MonthlyChallenge.club_id == club_id,
        models.MonthlyChallenge.year == now_col.year,
        models.MonthlyChallenge.month == now_col.month,
        models.MonthlyChallenge.active == True,  # noqa: E712
    )


@router.get("/monthly-challenges")
async def get_monthly_challenges(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Retos activos del mes en curso (hora Colombia), hasta 3, en orden estable."""
    now_col = datetime.now(player_stats.COL_TZ)
    rows = (await db.execute(
        select(models.MonthlyChallenge)
        .where(*_active_month_stmt(current_club.id, now_col))
        .order_by(models.MonthlyChallenge.id)
    )).scalars().all()
    return {"challenges": [_challenge_out(ch) for ch in rows],
            "period": {"year": now_col.year, "month": now_col.month}}


@router.put("/monthly-challenges")
async def replace_monthly_challenges(
    data: schemas.MonthlyChallengesUpsert,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Reemplaza EN BLOQUE los retos del mes en curso (hasta 3): desactiva los
    activos y reinserta el set nuevo. Lista vacía => quita todos. Un advisory lock
    por club serializa PUTs concurrentes del MISMO club (raro: acción de admin),
    así el 'desactivar-luego-insertar' es atómico."""
    now_col = datetime.now(player_stats.COL_TZ)
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": current_club.id})
    await db.execute(
        models.MonthlyChallenge.__table__.update()
        .where(*_active_month_stmt(current_club.id, now_col))
        .values(active=False)
    )
    created = [
        _build_challenge(current_club.id, now_col.year, now_col.month, item)
        for item in data.challenges
    ]
    for ch in created:
        db.add(ch)
    await db.commit()
    for ch in created:
        await db.refresh(ch)
    return {"challenges": [_challenge_out(ch) for ch in created]}


@router.delete("/monthly-challenges", status_code=204)
async def clear_monthly_challenges(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Quita todos los retos del mes en curso (los desactiva; historial se conserva)."""
    now_col = datetime.now(player_stats.COL_TZ)
    await db.execute(
        models.MonthlyChallenge.__table__.update()
        .where(*_active_month_stmt(current_club.id, now_col))
        .values(active=False)
    )
    await db.commit()
