# app/routers/players.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from .. import models, schemas
from ..dependencies import get_db, get_current_club

router = APIRouter(
    prefix="/players",
    tags=["Players"]
)

@router.post("/", response_model=schemas.PlayerResponse)
async def create_player(player: schemas.PlayerCreate, db: AsyncSession = Depends(get_db), current_club = Depends(get_current_club)):
    """
    Registra un nuevo jugador en la base de datos (Asignado al Club Actual).
    """
    # 0. Validar nombre no vacío
    if not player.name or not player.name.strip():
        raise HTTPException(status_code=400, detail="Player name cannot be empty")

    # 1. Validación SaaS: Verificar si ya existe en ESTE club para no duplicar
    result = await db.execute(
        select(models.Player).where(
            models.Player.name == player.name, 
            models.Player.club_id == current_club.id
        )
    )
    existing_player = result.scalars().first()
    
    if existing_player:
        return existing_player

    # 2. Creación: Agregamos el club_id automáticamente
    new_player = models.Player(
        name=player.name, 
        phone=player.phone,
        club_id=current_club.id # 👈 CAMBIO OBLIGATORIO SAAS
    )
    db.add(new_player)
    await db.commit()
    await db.refresh(new_player)
    
    return new_player

@router.get("/", response_model=List[schemas.PlayerResponse])
async def read_players(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_club = Depends(get_current_club)):
    """
    Obtiene la lista de todos los jugadores del club, ordenados alfabéticamente.
    """
    # 1. Query con filtro de Club + Tu ordenamiento original
    query = (
        select(models.Player)
        .where(models.Player.club_id == current_club.id) # 👈 FILTRO SAAS
        .order_by(models.Player.name.asc())            # 👈 MANTENEMOS TU LÓGICA ORIGINAL
        .offset(skip)
        .limit(limit)
    )
    
    result = await db.execute(query)
    return result.scalars().all()