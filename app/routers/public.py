# app/routers/public.py
"""
Capa PÚBLICA (sin auth): link del club con actividad viva + vista dealer con
alertas al staff. Patrón sin auth como el webhook de Wompi (solo Depends(get_db)),
identificando el recurso por un token imposible de adivinar en la URL.

Reglas de seguridad: estos endpoints exponen SOLO datos no sensibles (nombre del
club, mesas/torneos con conteos y estado). NUNCA plata, rake ni socios.
Excepción deliberada (2026-07-23, decisión de Juan): el sorteo de sillas del
torneo expone NOMBRES de jugadores con su mesa/silla tras el token del club —
es la misma info que el staff pega en la TV el día del torneo. Solo nombres:
la plata sigue prohibida en toda la capa pública.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy import text, delete, func
from datetime import datetime, timedelta, timezone
from typing import Optional
from pydantic import BaseModel, Field

from .. import models, tournament_clock, tournament_chips, services, tournament_prereg
from ..dependencies import get_db
from ..phone_utils import normalize_phone
from ..rate_limit import limiter
from .tournaments import TERMINAL_STATUSES
from ..audit import log_action, AuditAction

router = APIRouter(prefix="/public", tags=["Public"])

from ..dealer_view import ALERT_TYPES as _ALERT_TYPES


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


# Helpers compartidos con la vista autenticada del dealer (app/dealer_view.py).
# Alias locales para no tocar el resto del archivo.
from ..dealer_view import utc_iso as _utc_iso, current_dealer_name as _current_dealer_name, session_players as _session_players


# ---------------------------------------------------------
# 1. ACTIVIDAD VIVA DEL CLUB (link público)
# ---------------------------------------------------------
async def open_cash_tables(db: AsyncSession, club_id: int) -> list[dict]:
    """Mesas cash OPEN con conteo de jugadores (mismo criterio que
    active-summary). Jugador EN MESA = su última entrada (BUYIN/REBUY) es
    posterior a su última salida (CASHOUT o BUST). La comparten el link
    público /c/{token} y el panel del jugador (/player/club-info): misma
    info, con y sin login."""
    cash_rows = (await db.execute(text("""
        SELECT s.id, s.name, s.start_time, s.max_players,
            COALESCE(a.cnt, 0) AS players_count
        FROM sessions s
        LEFT JOIN (
            SELECT session_id, COUNT(*) AS cnt FROM (
                SELECT t.session_id, t.player_id,
                    MAX(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) AS in_ts,
                    MAX(CASE WHEN CAST(t.type AS TEXT) IN ('CASHOUT','BUST') THEN t.timestamp END) AS out_ts
                FROM transactions t
                WHERE t.session_id IN (SELECT id FROM sessions WHERE club_id = :cid AND status = 'OPEN')
                GROUP BY t.session_id, t.player_id
            ) x
            WHERE x.in_ts IS NOT NULL AND (x.out_ts IS NULL OR x.in_ts > x.out_ts)
            GROUP BY session_id
        ) a ON a.session_id = s.id
        WHERE s.club_id = :cid AND s.status = 'OPEN'
        ORDER BY s.id DESC
    """), {"cid": club_id})).fetchall()
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
    return cash


async def live_tournaments(db: AsyncSession, club_id: int) -> list[dict]:
    """Torneos EN JUEGO o por iniciar (no COMPLETED, no SCHEDULED, sin
    end_time) con conteos y cupos. Compartida por el link público y el
    panel del jugador — misma info, con y sin login."""
    # Torneos EN JUEGO (no COMPLETED, no SCHEDULED, sin end_time). Los SCHEDULED
    # van aparte en scheduled[]; sin excluirlos acá aparecerían duplicados.
    tourneys = (await db.execute(
        select(models.Tournament).where(
            models.Tournament.club_id == club_id,
            models.Tournament.status != "COMPLETED",
            models.Tournament.status != "SCHEDULED",
            models.Tournament.end_time.is_(None),
        ).order_by(models.Tournament.id.desc())
    )).scalars().all()
    tournaments = []
    for t in tourneys:
        registered = len(t.players)
        active = sum(1 for p in t.players if p.status == "ACTIVE")
        # Cupos de mesas (Fase 1b): sólo si el torneo tiene mesas OPEN.
        n_tables = (await db.execute(
            select(func.count(models.TournamentTable.id))
            .where(models.TournamentTable.tournament_id == t.id, models.TournamentTable.status == "OPEN")
        )).scalar() or 0
        seats_available = None
        if n_tables:
            total_seats = (await db.execute(
                select(func.coalesce(func.sum(models.TournamentTable.max_seats), 0))
                .where(models.TournamentTable.tournament_id == t.id, models.TournamentTable.status == "OPEN")
            )).scalar() or 0
            seated = (await db.execute(
                select(func.count(models.TournamentPlayer.id))
                .join(models.TournamentTable, models.TournamentTable.id == models.TournamentPlayer.table_id)
                .where(models.TournamentTable.tournament_id == t.id,
                       models.TournamentTable.status == "OPEN",
                       models.TournamentPlayer.status == "ACTIVE")
            )).scalar() or 0
            seats_available = max(0, int(total_seats) - int(seated))
        tournaments.append({
            # id: para pedir el sorteo de sillas (/tournaments/{id}/seating).
            # Numérico y sin valor sin el token del club — no filtra nada.
            "id": t.id,
            "name": t.name,
            "registered": registered,
            "active": active,
            "tables": n_tables or None,
            "seats_available": seats_available,
            "status": "En juego" if t.status not in ("REGISTERING",) else "Por iniciar",
        })

    return tournaments


@router.get("/clubs/{public_token}/activity")
async def get_club_activity(public_token: str, db: AsyncSession = Depends(get_db)):
    club = await _get_club_by_token(db, public_token)

    cash = await open_cash_tables(db, club.id)

    tournaments = await live_tournaments(db, club.id)

    # Torneos PROGRAMADOS (status SCHEDULED). Excepción deliberada a la regla de
    # "no plata": se expone el buyin porque es info que el jugador necesita para
    # decidir si va (decisión de Juan). Nada de rake/socios/jugadores nominales.
    scheduled_rows = (await db.execute(
        select(models.Tournament).where(
            models.Tournament.club_id == club.id,
            models.Tournament.status == "SCHEDULED",
        ).order_by(models.Tournament.scheduled_start.asc().nullslast())
    )).scalars().all()
    scheduled = [{
        # id: para abrir la ficha + formulario de pre-inscripción.
        "id": t.id,
        "name": t.name,
        "scheduled_start": t.scheduled_start.isoformat() if t.scheduled_start else None,
        "buyin": t.buyin_amount,
    } for t in scheduled_rows]

    return {
        "club_name": club.name,
        "announcement": club.public_announcement or None,
        # El jackpot que ve el staff en la mesa (services.club_jackpot): un solo
        # número para todos. None si el club eligió no exponerlo.
        "jackpot": await services.club_jackpot_public(db, club),
        "cash": cash,
        "tournaments": tournaments,
        "scheduled": scheduled,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.get("/clubs/{public_token}/tournaments/{tournament_id}/seating")
async def get_tournament_seating(public_token: str, tournament_id: int,
                                 db: AsyncSession = Depends(get_db)):
    """Sorteo de sillas del torneo, público tras el token del club: el jugador
    llega, abre el link del grupo y ve su mesa/silla sin preguntar en caja.
    Es la misma info que el staff pega en la TV: SOLO nombres y asientos —
    jamás plata (buyins/rebuys/premios se quedan adentro)."""
    club = await _get_club_by_token(db, public_token)
    # Solo torneos VIVOS — mismo criterio que live_tournaments: hay DOS estados
    # terminales (END deja FINISHED, FINALIZE deja COMPLETED); con solo
    # 'COMPLETED' el roster de los torneos terminados con END quedaría público
    # para siempre.
    t = (await db.execute(
        select(models.Tournament).where(
            models.Tournament.id == tournament_id,
            models.Tournament.club_id == club.id,
            models.Tournament.status.notin_(TERMINAL_STATUSES),
            models.Tournament.end_time.is_(None),
        )
    )).scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    rows = (await db.execute(
        select(models.Player.name,
               models.TournamentPlayer.seat_number,
               models.TournamentTable.table_number)
        .join(models.TournamentPlayer, models.TournamentPlayer.player_id == models.Player.id)
        # El join a la mesa también exige tournament_id: cinturón y tirantes por
        # si un write path futuro asignara una mesa ajena (hoy _get_owned_table
        # lo impide) — acá jamás se mostraría un table_number de otro torneo.
        .outerjoin(models.TournamentTable,
                   (models.TournamentTable.id == models.TournamentPlayer.table_id)
                   & (models.TournamentTable.tournament_id == t.id))
        .where(models.TournamentPlayer.tournament_id == t.id,
               models.TournamentPlayer.status == "ACTIVE")
    )).all()

    tables: dict[int, list] = {}
    waiting: list[str] = []
    for name, seat, table_number in rows:
        name = name or "—"   # Player.name es nullable: jamás tronar por un nombre vacío
        if table_number is not None and seat is not None:
            tables.setdefault(int(table_number), []).append({"seat": int(seat), "name": name})
        else:
            # ACTIVE sin mesa/silla = lista de espera (criterio del nivelado FIFO)
            waiting.append(name)

    return {
        "tournament_name": t.name,
        "tables": [
            {"table_number": num, "seats": sorted(seats, key=lambda s: s["seat"])}
            for num, seats in sorted(tables.items())
        ],
        "waiting": sorted(waiting, key=str.casefold),
    }


# ---------------------------------------------------------
# VISTA TV DEL TORNEO (pública, sin auth) — reloj/blinds para proyectar.
# Sólo datos no sensibles: nombre del club/torneo, reloj, blinds y conteo de
# jugadores. NUNCA plata, rake, premios ni jugadores nominales.
# ---------------------------------------------------------
# ---------------------------------------------------------
# 1.c FICHA DEL TORNEO + PRE-INSCRIPCIÓN (formulario público)
# Ver app/tournament_prereg.py para las reglas de cupo/espera. Excepción
# deliberada a "no plata" (igual que el buyin de los programados): se exponen
# los PRECIOS que paga el jugador (entrada, rebuy, add-on, propina, bounty)
# porque los necesita para decidir si va. Nunca rake, premiación, pozo, nombres
# ni teléfonos (decisión de Juan, 2026-11-06).
# ---------------------------------------------------------
# Tope duro de pre-inscripciones vivas por torneo: un formulario anónimo no
# puede llenar la tabla aunque esquive el rate limit cambiando de IP.
MAX_PENDING_PREREGS = 500


class PreregistrationIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    phone: str = Field(..., min_length=7, max_length=20)


async def _get_club_tournament(db: AsyncSession, public_token: str, tournament_id: int):
    """Torneo NO terminado de ESTE club (el token identifica al club; el id solo
    no basta: sin el filtro por club se podría leer un torneo ajeno)."""
    club = await _get_club_by_token(db, public_token)
    t = (await db.execute(
        select(models.Tournament).where(
            models.Tournament.id == tournament_id,
            models.Tournament.club_id == club.id,
            models.Tournament.status.notin_(TERMINAL_STATUSES),
            models.Tournament.end_time.is_(None),
        )
    )).scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return t, club


def _public_occupancy(occ: dict) -> dict:
    # Solo el contador; el desglose inscritos/pre-inscritos es del staff.
    return {k: occ[k] for k in ("max_entries", "taken", "waitlist", "full")}


@router.get("/clubs/{public_token}/tournaments/{tournament_id}")
async def get_public_tournament(public_token: str, tournament_id: int,
                                db: AsyncSession = Depends(get_db)):
    """Ficha completa del torneo para el link público (sin datos sensibles)."""
    t, club = await _get_club_tournament(db, public_token, tournament_id)
    blinds = t.blind_structure or []
    return {
        "club_name": club.name,
        "currency": club.currency,
        "locale": club.locale,
        "timezone": club.timezone,
        "tournament": {
            "id": t.id,
            "name": t.name,
            "status": t.status,
            # SIN offset, igual que /activity: scheduled_start sale de un
            # <input datetime-local> y se guarda como hora de pared del club (no
            # UTC). Marcarlo +00:00 lo correría 5h en Colombia.
            "scheduled_start": t.scheduled_start.isoformat() if t.scheduled_start else None,
            "registration_open": tournament_prereg.registration_open(t),
            "buyin": t.buyin_amount or 0,
            "dealer_tip": t.dealer_tip_amount or 0,
            "bounty": t.bounty_amount or 0,
            "rebuy_price": t.rebuy_price or 0,
            "double_rebuy_price": t.double_rebuy_price or 0,
            "rebuy_until_level": t.rebuy_until_level,
            "addon_price": t.addon_price or 0,
            "double_addon_price": t.double_addon_price or 0,
            "addon_until_level": t.addon_until_level,
            "starting_stack": t.starting_stack or 0,
            "rebuy_chips": t.rebuy_chips or 0,
            "double_rebuy_chips": t.double_rebuy_chips or 0,
            "addon_chips": t.addon_chips or 0,
            "double_addon_chips": t.double_addon_chips or 0,
            "tip_chips": t.tip_chips or 0,
            "blind_structure": blinds,
        },
        "occupancy": _public_occupancy(await tournament_prereg.occupancy(db, t)),
    }


@router.post("/clubs/{public_token}/tournaments/{tournament_id}/preregister")
@limiter.limit("60/hour")  # igual que self-register: el link circula por
                           # WhatsApp y muchos lo abren desde el WiFi del club.
async def preregister(public_token: str, tournament_id: int, data: PreregistrationIn,
                      request: Request, db: AsyncSession = Depends(get_db)):
    """Pre-inscripción pública. Idempotente por teléfono: repetirla devuelve el
    lugar que ya tenía en vez de duplicar."""
    t, club = await _get_club_tournament(db, public_token, tournament_id)
    if not tournament_prereg.registration_open(t):
        raise HTTPException(status_code=400,
                            detail="Las inscripciones por link ya cerraron. Inscríbete en el club.")

    phone = normalize_phone(data.phone)
    if not phone or len(phone) < 10:
        raise HTTPException(status_code=400, detail="Teléfono inválido")
    name = " ".join(data.name.split())
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Nombre inválido")

    if await tournament_prereg.phone_already_entered(db, t.id, phone):
        return {"already_entered": True, "spot": "ENTERED", "waitlist_position": None,
                "occupancy": _public_occupancy(await tournament_prereg.occupancy(db, t))}

    Prereg = models.TournamentPreregistration
    existing = (await db.execute(select(Prereg).where(
        Prereg.tournament_id == t.id, Prereg.phone == phone, Prereg.status != "CANCELLED",
    ))).scalars().first()

    created = False
    if existing is None:
        pending_total = (await db.execute(select(func.count(Prereg.id)).where(
            Prereg.tournament_id == t.id, Prereg.status == "PENDING",
        ))).scalar() or 0
        if pending_total >= MAX_PENDING_PREREGS:
            raise HTTPException(status_code=400, detail="La lista de inscritos está llena.")
        prereg = Prereg(club_id=club.id, tournament_id=t.id, name=name, phone=phone,
                        status="PENDING", created_at=datetime.utcnow())
        db.add(prereg)
        try:
            await db.flush()
        except IntegrityError:
            # Doble envío en paralelo con el mismo teléfono: ganó el otro. El
            # rollback expira TODO lo cargado (t, club): se recargan antes de
            # tocarlos, o el acceso lazy revienta en async (MissingGreenlet).
            await db.rollback()
            t, club = await _get_club_tournament(db, public_token, tournament_id)
            existing = (await db.execute(select(Prereg).where(
                Prereg.tournament_id == t.id, Prereg.phone == phone, Prereg.status != "CANCELLED",
            ))).scalars().first()
            if existing is None:
                raise HTTPException(status_code=409, detail="Intenta de nuevo")
        else:
            created = True
            await log_action(
                db, request=request, club=club,
                action=AuditAction.TOURNAMENT_PREREG_CREATE,
                entity_type="TournamentPreregistration", entity_id=prereg.id,
                actor_type="PUBLIC", meta={"tournament_id": t.id},
            )
            await db.commit()
            existing = prereg

    if existing.status == "CONFIRMED":
        if await tournament_prereg.player_active_in(db, t.id, existing.player_id):
            return {"already_entered": True, "spot": "ENTERED", "waitlist_position": None,
                    "occupancy": _public_occupancy(await tournament_prereg.occupancy(db, t))}
        # Confirmada antes pero ya no juega (eliminado que quiere re-entrar, o el
        # staff le quitó la inscripción): la reserva se REABRE como nueva, al
        # final de la fila. El índice único (no CANCELLED) impide crear otra.
        existing.status = "PENDING"
        existing.name = name
        existing.created_at = datetime.utcnow()
        existing.confirmed_at = None
        created = True
        await log_action(
            db, request=request, club=club,
            action=AuditAction.TOURNAMENT_PREREG_CREATE,
            entity_type="TournamentPreregistration", entity_id=existing.id,
            actor_type="PUBLIC", meta={"tournament_id": t.id, "reopened": True},
        )
        await db.commit()

    entered = await tournament_prereg.entered_count(db, t.id)
    pending = await tournament_prereg.pending_preregs(db, t.id)
    place = tournament_prereg.place_of(existing.id, t.max_entries, entered, pending)
    return {
        "already_entered": False,
        "created": created,
        # El nombre que ESTA persona escribió, nunca el guardado: devolver
        # existing.name dejaría a cualquiera leer el nombre ligado a un teléfono.
        "name": name,
        **place,
        "occupancy": _public_occupancy(await tournament_prereg.occupancy(db, t)),
    }


async def _get_tournament_by_token(db: AsyncSession, token: str) -> tuple[models.Tournament, models.Club]:
    tournament = (await db.execute(
        select(models.Tournament).where(models.Tournament.public_token == token)
    )).scalars().first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    club = (await db.execute(
        select(models.Club).where(models.Club.id == tournament.club_id)
    )).scalars().first()
    if not club or not club.is_active:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return tournament, club


@router.get("/tournaments/{public_token}/tv")
async def get_tournament_tv(public_token: str, db: AsyncSession = Depends(get_db)):
    """Estado para la pantalla TV del torneo: reloj + blinds + conteo de jugadores.
    Cero datos sensibles."""
    t, club = await _get_tournament_by_token(db, public_token)
    registered = len(t.players)
    active = sum(1 for p in t.players if p.status == "ACTIVE")
    # Totales de rebuys/addons (rebuys_count/addons_count ya incluyen single+double).
    # Son conteos de jugadas, no plata: OK para la capa pública.
    rebuys = sum(p.rebuys_count or 0 for p in t.players)
    addons = sum(p.addons_count or 0 for p in t.players)
    return {
        "club_name": club.name,
        "tournament_name": t.name,
        "status": t.status,
        "players_registered": registered,
        "players_active": active,
        "rebuys_total": rebuys,
        "addons_total": addons,
        "starting_stack": t.starting_stack or 0,
        "average_stack": tournament_chips.chip_stats(t)["average_stack"],
        "clock": tournament_clock.clock_state(t),
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
