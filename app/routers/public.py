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
from sqlalchemy import text, delete
from datetime import datetime, timedelta, timezone
from typing import Optional
from pydantic import BaseModel, Field

from .. import models
from ..dependencies import get_db
from ..audit import log_action, AuditAction

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


def _utc_iso(dt) -> Optional[str]:
    """ISO con offset UTC (+00:00). Los timestamps se guardan como UTC naïve
    (datetime.utcnow); sin el offset, el front los parsea como hora local y el
    cálculo de tiempo en mesa sale mal (negativo => 0m para activos)."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


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


async def _session_players(db: AsyncSession, session_id: int) -> list[dict]:
    """Jugadores sentados en la mesa para la vista dealer.
    seated_at = primer buy-in (arranca su reloj de tiempo en mesa);
    busted_at = BUST (congela el reloj, baja el conteo y libera el cupo).
    """
    rows = (await db.execute(text("""
        SELECT p.id, p.name,
            MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) AS seated_at,
            MAX(CASE WHEN CAST(t.type AS TEXT) = 'BUST' THEN t.timestamp END) AS busted_at
        FROM players p
        JOIN transactions t ON p.id = t.player_id
        WHERE t.session_id = :sid
        GROUP BY p.id, p.name
        HAVING MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) IS NOT NULL
        ORDER BY MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END)
    """), {"sid": session_id})).fetchall()
    return [{
        "player_id": r.id,
        "name": r.name,
        "seated_at": _utc_iso(r.seated_at),
        "busted_at": _utc_iso(r.busted_at),
        "is_busted": r.busted_at is not None,
    } for r in rows]


# ---------------------------------------------------------
# 1. ACTIVIDAD VIVA DEL CLUB (link público)
# ---------------------------------------------------------
@router.get("/clubs/{public_token}/activity")
async def get_club_activity(public_token: str, db: AsyncSession = Depends(get_db)):
    club = await _get_club_by_token(db, public_token)

    # Mesas cash OPEN con conteo de jugadores (mismo patrón que active-summary).
    # Jugadores en mesa = con buy-in y SIN quebrar (el BUST de quien sale baja el
    # conteo y libera cupos). Un BUST implica buy-in previo => basta restarlos.
    cash_rows = (await db.execute(text("""
        SELECT s.id, s.name, s.start_time, s.max_players,
            GREATEST(0,
                COUNT(DISTINCT t.player_id) FILTER (WHERE CAST(t.type AS TEXT) IN ('BUYIN','REBUY'))
                - COUNT(DISTINCT t.player_id) FILTER (WHERE CAST(t.type AS TEXT) = 'BUST')
            ) AS players_count
        FROM sessions s
        LEFT JOIN transactions t ON t.session_id = s.id
        WHERE s.club_id = :cid AND s.status = 'OPEN'
        GROUP BY s.id, s.name, s.start_time, s.max_players
        ORDER BY s.id DESC
    """), {"cid": club.id})).fetchall()
    cash = []
    for r in cash_rows:
        count = int(r.players_count or 0)
        cap = int(r.max_players) if r.max_players else None
        cash.append({
            "name": r.name or f"Mesa #{r.id}",
            "players_count": count,
            "max_players": cap,
            "seats_available": max(0, cap - count) if cap is not None else None,
            "start_time": _utc_iso(r.start_time),
            "status": "Abierta",
        })

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
    players = await _session_players(db, session.id)
    active = sum(1 for p in players if not p["is_busted"])
    cap = int(session.max_players) if session.max_players else None
    return {
        "club_name": club.name if club else "",
        "table_name": session.name or f"Mesa #{session.id}",
        "is_open": session.status == models.SessionStatus.OPEN,
        "dealer_name": await _current_dealer_name(db, session.id),
        "max_players": cap,
        "players_count": active,
        "seats_available": max(0, cap - active) if cap is not None else None,
        "players": players,
    }


class DealerBustIn(BaseModel):
    player_id: int


@router.post("/dealer/{session_token}/bust")
async def dealer_toggle_bust(session_token: str, data: DealerBustIn, request: Request, db: AsyncSession = Depends(get_db)):
    """El dealer marca/desmarca que un jugador salió de la mesa (BUST).
    Reusa el mecanismo de quiebra: escribe un BUST con timestamp que congela el
    tiempo en mesa del jugador (rakeback/fidelidad), baja el conteo y libera el
    cupo en el link público. Idempotente: si ya está marcado, lo deshace.
    Acción NO financiera (amount=0); la plata la cierra el cajero en el panel.
    """
    session = await _get_open_session_by_token(db, session_token)
    if session.status != models.SessionStatus.OPEN:
        raise HTTPException(status_code=409, detail="La mesa ya está cerrada")

    # Club para auditar: esta es una mutación desde una superficie SIN auth (solo
    # token), así que dejar rastro en audit_logs importa más que en el panel.
    club = (await db.execute(select(models.Club).where(models.Club.id == session.club_id))).scalars().first()

    # Tenant safety (defensa en profundidad): el jugador debe pertenecer al club
    # de la sesión Y estar sentado en ESTA mesa (tener un buy-in aquí). Evita que
    # con el token se inserten BUST de player_ids arbitrarios o de otro club.
    seated = (await db.execute(
        select(models.Transaction.id)
        .join(models.Player, models.Player.id == models.Transaction.player_id)
        .where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Player.club_id == session.club_id,
            models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]),
        ).limit(1)
    )).first()
    if not seated:
        raise HTTPException(status_code=404, detail="Jugador no está en esta mesa")

    existing = (await db.execute(
        select(models.Transaction.id).where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Transaction.type == models.TransactionType.BUST,
        ).limit(1)
    )).first()

    if existing:
        # Borramos TODOS los BUST del jugador en la sesión (no solo por id): si
        # una carrera dejó duplicados, "Volvió" los limpia de una.
        await db.execute(delete(models.Transaction).where(
            models.Transaction.session_id == session.id,
            models.Transaction.player_id == data.player_id,
            models.Transaction.type == models.TransactionType.BUST,
        ))
        if club:
            await log_action(
                db, request=request, club=club,
                action=AuditAction.TRANSACTION_BUST_TOGGLE,
                entity_type="Transaction", actor_type="DEALER_PUBLIC",
                meta={"player_id": data.player_id, "session_id": session.id,
                      "is_busted": False, "undo": True, "source": "dealer_public_link"},
            )
        await db.commit()
        return {"action": "undone", "is_busted": False}

    new_tx = models.Transaction(
        session_id=session.id,
        player_id=data.player_id,
        type=models.TransactionType.BUST,
        amount=0.0,
        method="CASH",
    )
    db.add(new_tx)
    await db.flush()
    if club:
        await log_action(
            db, request=request, club=club,
            action=AuditAction.TRANSACTION_BUST_TOGGLE,
            entity_type="Transaction", entity_id=new_tx.id, actor_type="DEALER_PUBLIC",
            meta={"player_id": data.player_id, "session_id": session.id,
                  "is_busted": True, "source": "dealer_public_link"},
        )
    await db.commit()
    return {"action": "busted", "is_busted": True}


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
