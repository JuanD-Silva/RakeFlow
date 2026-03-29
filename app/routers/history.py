from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from .. import models
from ..dependencies import get_db, get_current_club

router = APIRouter(prefix="/history", tags=["History"])

# Esquema de respuesta unificado
class HistoryItem(BaseModel):
    id: int
    type: str  # "CASH" | "TOURNAMENT"
    title: str # Nombre del evento o "Sesión #ID"
    date: datetime
    duration_minutes: int
    
    # Métricas Financieras
    rake: int          # Ganancia del Club
    secondary_metric: int # Cash: Meta Pagada | Torneo: Premios Pagados
    total_in: int      # Cash: Buyins | Torneo: Recaudo Total
    
@router.get("/", response_model=List[HistoryItem])
async def get_history(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    history = []

    # 1. TRAER MESAS CASH (CERRADAS)
    # Optimizamos cargando transacciones solo para calcular totales si es necesario
    q_sessions = await db.execute(
        select(models.Session)
        .options(selectinload(models.Session.transactions))
        .where(models.Session.club_id == current_club.id)
        .where(models.Session.status == models.SessionStatus.CLOSED)
    )
    sessions = q_sessions.scalars().all()

    for s in sessions:
        # Calcular duración
        duration = 0
        if s.end_time and s.start_time:
            duration = int((s.end_time - s.start_time).total_seconds() / 60)
        
        # Calcular Buyins Totales (Cash In) manualmente sumando transacciones
        total_buyin = sum(t.amount for t in s.transactions if str(t.type) in ['BUYIN', 'REBUY'])

        history.append({
            "id": s.id,
            "type": "CASH",
            "title": f"Mesa Cash #{s.id}",
            "date": s.end_time or s.start_time,
            "duration_minutes": duration,
            "rake": int(s.declared_rake_cash or 0),
            "secondary_metric": int(s.debt_payment or 0), # Meta Pagada
            "total_in": int(total_buyin)
        })

    # 2. TRAER TORNEOS (COMPLETADOS)
    q_tournaments = await db.execute(
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(models.Tournament.club_id == current_club.id)
        .where(models.Tournament.status == "COMPLETED")
    )
    tournaments = q_tournaments.scalars().all()

    for t in tournaments:
        duration = 0
        if t.end_time and t.start_time:
            duration = int((t.end_time - t.start_time).total_seconds() / 60)

        # Calcular finanzas del torneo
        total_income = 0
        total_prizes = 0
        
        for p in t.players:
            # Ingresos (Buyin + Rebuys + Addons)
            invested = t.buyin_amount + \
                       ((p.rebuys_count - p.double_rebuys_count) * t.rebuy_price) + \
                       (p.double_rebuys_count * t.double_rebuy_price) + \
                       ((p.addons_count - p.double_addons_count) * t.addon_price) + \
                       (p.double_addons_count * t.double_addon_price)
            total_income += invested
            total_prizes += (p.prize_collected or 0)

        # Rake calculado
        rake_val = total_income * (t.rake_percentage / 100)

        history.append({
            "id": t.id,
            "type": "TOURNAMENT",
            "title": t.name, # Nombre real del torneo
            "date": t.end_time or t.start_time,
            "duration_minutes": duration,
            "rake": int(rake_val),
            "secondary_metric": int(total_prizes), # Premios entregados
            "total_in": int(total_income)
        })

    # 3. ORDENAR POR FECHA DESCENDENTE
    history.sort(key=lambda x: x["date"], reverse=True)
    
    return history