# app/routers/public.py
"""
Capa PÚBLICA (sin auth): link del club con actividad viva + vista dealer con
alertas al staff. Patrón sin auth como el webhook de Wompi (solo Depends(get_db)),
identificando el recurso por un token imposible de adivinar en la URL.

Reglas de seguridad: estos endpoints exponen SOLO datos no sensibles (nombre del
club, mesas/torneos con conteos y estado). NUNCA plata, rake, socios ni jugadores
nominales.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy import text
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, Field

from .. import models
from ..dependencies import get_db

router = APIRouter(prefix="/public", tags=["Public"])

_ALERT_TYPES = {"CHIPS", "WAITER", "MANAGER", "URGENT"}


class DealerAlertIn(BaseModel):
    alert_type: str
    message: Optional[str] = Field(None, max_length=200)


async def _get_club_by_token(db: AsyncSession, token: str) -> models.Club:
    club = (await db.execute(
        select(models.Club).where(models.Club.public_token == token)
    )).scalars().first()
    if not club or not club.is_active:
        raise HTTPException(status_code=404, detail="Club no encontrado")
    return club


async def _get_open_session_by_token(db: AsyncSession, token: str) -> models.Session:
    session = (await db.execute(
        select(models.Session).where(models.Session.public_token == token)
    )).scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return session


async def _current_dealer_name(db: AsyncSession, session_id: int) -> Optional[str]:
    row = (await db.execute(
        select(models.Dealer.name)
        .join(models.DealerShift, models.DealerShift.dealer_id == models.Dealer.id)
        .where(
            models.DealerShift.session_id == session_id,
            models.DealerShift.end_time.is_(None),
        )
    )).first()
    return row[0] if row else None


# ---------------------------------------------------------
# 1. ACTIVIDAD VIVA DEL CLUB (link público)
# ---------------------------------------------------------
@router.get("/clubs/{public_token}/activity")
async def get_club_activity(public_token: str, db: AsyncSession = Depends(get_db)):
    club = await _get_club_by_token(db, public_token)

    # Mesas cash OPEN con conteo de jugadores (mismo patrón que active-summary)
    cash_rows = (await db.execute(text("""
        SELECT s.id, s.name, s.start_time,
            COALESCE(COUNT(DISTINCT t.player_id) FILTER (
                WHERE CAST(t.type AS TEXT) IN ('BUYIN','REBUY')
            ), 0) AS players_count
        FROM sessions s
        LEFT JOIN transactions t ON t.session_id = s.id
        WHERE s.club_id = :cid AND s.status = 'OPEN'
        GROUP BY s.id, s.name, s.start_time
        ORDER BY s.id DESC
    """), {"cid": club.id})).fetchall()
    cash = [{
        "name": r.name or f"Mesa #{r.id}",
        "players_count": int(r.players_count or 0),
        "start_time": r.start_time.isoformat() if r.start_time else None,
        "status": "Abierta",
    } for r in cash_rows]

    # Torneos activos (no COMPLETED, sin end_time) con inscritos/activos
    tourneys = (await db.execute(
        select(models.Tournament).where(
            models.Tournament.club_id == club.id,
            models.Tournament.status != "COMPLETED",
            models.Tournament.end_time.is_(None),
        ).order_by(models.Tournament.id.desc())
    )).scalars().all()
    tournaments = []
    for t in tourneys:
        registered = len(t.players)
        active = sum(1 for p in t.players if p.status == "ACTIVE")
        tournaments.append({
            "name": t.name,
            "registered": registered,
            "active": active,
            "status": "En juego" if t.status not in ("REGISTERING",) else "Por iniciar",
        })

    return {
        "club_name": club.name,
        "announcement": club.public_announcement or None,
        "cash": cash,
        "tournaments": tournaments,
        "scheduled": [],  # torneos programados: pendiente T4 (no hay scheduled_start)
        "updated_at": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------
# 2. VISTA DEALER (datos de la mesa) + ALERTA AL STAFF
# ---------------------------------------------------------
@router.get("/dealer/{session_token}")
async def get_dealer_view(session_token: str, db: AsyncSession = Depends(get_db)):
    session = await _get_open_session_by_token(db, session_token)
    club = (await db.execute(select(models.Club).where(models.Club.id == session.club_id))).scalars().first()
    return {
        "club_name": club.name if club else "",
        "table_name": session.name or f"Mesa #{session.id}",
        "is_open": session.status == models.SessionStatus.OPEN,
        "dealer_name": await _current_dealer_name(db, session.id),
    }


@router.post("/dealer/{session_token}/alert", status_code=201)
async def send_dealer_alert(session_token: str, data: DealerAlertIn, db: AsyncSession = Depends(get_db)):
    session = await _get_open_session_by_token(db, session_token)
    if session.status != models.SessionStatus.OPEN:
        raise HTTPException(status_code=409, detail="La mesa ya está cerrada")

    alert_type = (data.alert_type or "").upper()
    if alert_type not in _ALERT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de alerta inválido")

    # Anti-spam: si ya hay una alerta PENDING del mismo tipo en esta mesa de hace
    # <30s, no creamos otra (devolvemos la existente como "ya enviada").
    recent = (await db.execute(
        select(models.DealerAlert).where(
            models.DealerAlert.session_id == session.id,
            models.DealerAlert.alert_type == alert_type,
            models.DealerAlert.status == "PENDING",
            models.DealerAlert.created_at >= datetime.utcnow() - timedelta(seconds=30),
        )
    )).scalars().first()
    if recent:
        return {"status": "already_sent", "alert_type": alert_type}

    alert = models.DealerAlert(
        club_id=session.club_id,
        session_id=session.id,
        alert_type=alert_type,
        message=(data.message or "").strip() or None,
        dealer_name=await _current_dealer_name(db, session.id),
        status="PENDING",
    )
    db.add(alert)
    try:
        await db.commit()
    except IntegrityError:
        # Índice único parcial (session_id, alert_type) WHERE PENDING: ya hay una
        # alerta de ese tipo pendiente. Backstop contra race/flood.
        await db.rollback()
        return {"status": "already_sent", "alert_type": alert_type}
    return {"status": "sent", "alert_type": alert_type}
