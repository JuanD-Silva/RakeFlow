# app/routers/blind_templates.py
"""Biblioteca de estructuras de blinds (PR3).

Presets fijos (constantes, para todos los clubes) + plantillas propias del club
(tabla blind_templates). Scoped por club_id, no toca plata (blinds y stack son
fichas). Reusado por el editor de blinds al crear o editar un torneo.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app import models, schemas
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction
from ..blind_presets import BLIND_PRESETS

router = APIRouter(prefix="/blind-templates", tags=["Blind Templates"])


@router.get("", response_model=schemas.BlindTemplateList)
async def list_blind_templates(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Presets fijos + plantillas guardadas del club (las más nuevas primero)."""
    result = await db.execute(
        select(models.BlindTemplate)
        .where(models.BlindTemplate.club_id == current_club.id)
        .order_by(desc(models.BlindTemplate.created_at))
    )
    saved = result.scalars().all()
    return schemas.BlindTemplateList(
        presets=[schemas.BlindTemplateResponse(is_preset=True, **p) for p in BLIND_PRESETS],
        saved=[
            schemas.BlindTemplateResponse(
                id=t.id, name=t.name,
                blind_structure=t.blind_structure or [],
                starting_stack=t.starting_stack or 0,
                is_preset=False,
            )
            for t in saved
        ],
    )


@router.post("", response_model=schemas.BlindTemplateResponse, status_code=201)
async def create_blind_template(
    data: schemas.BlindTemplateCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Guardar una plantilla propia del club. El club_id sale del token, nunca del payload."""
    template = models.BlindTemplate(
        club_id=current_club.id,
        name=data.name.strip(),
        blind_structure=[lvl.model_dump() for lvl in data.blind_structure],
        starting_stack=data.starting_stack,
    )
    db.add(template)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.BLIND_TEMPLATE_CREATE,
        entity_type="BlindTemplate", entity_id=template.id,
        meta={"name": template.name, "levels": len(template.blind_structure)},
    )
    await db.commit()
    await db.refresh(template)
    return schemas.BlindTemplateResponse(
        id=template.id, name=template.name,
        blind_structure=template.blind_structure or [],
        starting_stack=template.starting_stack or 0,
        is_preset=False,
    )


@router.delete("/{template_id}", status_code=204)
async def delete_blind_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Borrar una plantilla del club. Re-chequea ownership por club_id (404 si no es del club)."""
    result = await db.execute(
        select(models.BlindTemplate)
        .where(models.BlindTemplate.id == template_id)
        .where(models.BlindTemplate.club_id == current_club.id)
    )
    template = result.scalars().first()
    if not template:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada.")
    name = template.name
    await db.delete(template)
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.BLIND_TEMPLATE_DELETE,
        entity_type="BlindTemplate", entity_id=template_id,
        meta={"name": name},
    )
    await db.commit()
    return None
