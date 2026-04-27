"""Endpoint de consulta de AuditLog — solo para el club autenticado."""

from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from .. import models
from ..dependencies import get_db, get_current_club, require_role

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get("/logs")
async def list_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    date_from: Optional[str] = Query(None, description="ISO date YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="ISO date YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Lista los logs del club autenticado, filtrable y paginado."""
    stmt = select(models.AuditLog).where(models.AuditLog.club_id == current_club.id)
    count_stmt = select(func.count(models.AuditLog.id)).where(models.AuditLog.club_id == current_club.id)

    if action:
        stmt = stmt.where(models.AuditLog.action == action)
        count_stmt = count_stmt.where(models.AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(models.AuditLog.entity_type == entity_type)
        count_stmt = count_stmt.where(models.AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(models.AuditLog.entity_id == entity_id)
        count_stmt = count_stmt.where(models.AuditLog.entity_id == entity_id)
    if date_from:
        try:
            dt = datetime.strptime(date_from, "%Y-%m-%d")
            stmt = stmt.where(models.AuditLog.created_at >= dt)
            count_stmt = count_stmt.where(models.AuditLog.created_at >= dt)
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.strptime(date_to, "%Y-%m-%d")
            stmt = stmt.where(models.AuditLog.created_at < dt.replace(hour=23, minute=59, second=59))
            count_stmt = count_stmt.where(models.AuditLog.created_at < dt.replace(hour=23, minute=59, second=59))
        except ValueError:
            pass

    total = (await db.execute(count_stmt)).scalar() or 0

    stmt = stmt.order_by(models.AuditLog.created_at.desc()).offset(skip).limit(limit)
    result = await db.execute(stmt)
    logs = result.scalars().all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": log.id,
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "actor_type": log.actor_type,
                "actor_email": log.actor_email,
                "meta": log.meta,
                "ip": log.ip,
                "request_id": log.request_id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }
