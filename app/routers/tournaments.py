# app/routers/tournaments.py
import secrets
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from app import models, schemas
from datetime import datetime
from pydantic import BaseModel
import logging
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction
from .. import tournament_clock

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/tournaments",
    tags=["Tournaments"]
)

# --- ESQUEMAS INTERNOS (Input) ---
class PlayerRegistration(BaseModel):
    player_id: int
    pay_buyin: bool = True
    pay_tip: bool = False

class RebuyAddonRequest(BaseModel):
    player_id: int
    type: str  # "SINGLE" o "DOUBLE"

# --- ENDPOINTS ---

# 1. CREAR UN TORNEO NUEVO
@router.post("/", response_model=schemas.TournamentResponse)
async def create_tournament(
    tournament_data: schemas.TournamentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # Torneo PROGRAMADO: si viene scheduled_start, se crea como SCHEDULED y NO
    # cuenta como activo (se pueden programar varios a futuro aunque corra uno).
    is_scheduled = tournament_data.scheduled_start is not None

    if not is_scheduled:
        # Solo un torneo en juego (REGISTERING/RUNNING) por club. Los SCHEDULED no cuentan.
        result = await db.execute(
            select(models.Tournament)
            .where(models.Tournament.club_id == current_club.id)
            .where(models.Tournament.status.in_(["REGISTERING", "RUNNING"]))
        )
        if result.scalars().first():
            raise HTTPException(status_code=409, detail="Ya existe un torneo activo. Only one active tournament allowed.")

    # Estructura de blinds: la enviada (si vino) o la plantilla default editable.
    if tournament_data.blind_structure is not None:
        blinds = [lvl.model_dump() for lvl in tournament_data.blind_structure]
    else:
        blinds = [dict(lvl) for lvl in tournament_clock.DEFAULT_BLIND_STRUCTURE]

    # Crear el Torneo
    new_tournament = models.Tournament(
        name=tournament_data.name,
        buyin_amount=tournament_data.buyin_amount,
        rake_percentage=tournament_data.rake_percentage,
        payout_structure=tournament_data.payout_structure,
        dealer_tip_amount=tournament_data.dealer_tip_amount,
        bounty_amount=tournament_data.bounty_amount,
        rebuy_price=tournament_data.rebuy_price,
        double_rebuy_price=tournament_data.double_rebuy_price,
        addon_price=tournament_data.addon_price,
        double_addon_price=tournament_data.double_addon_price,
        club_id=current_club.id,
        status="SCHEDULED" if is_scheduled else "REGISTERING",
        start_time=datetime.utcnow(),
        scheduled_start=tournament_data.scheduled_start,
        blind_structure=blinds,
        starting_stack=tournament_data.starting_stack or 0,
        rebuy_chips=tournament_data.rebuy_chips or 0,
        double_rebuy_chips=tournament_data.double_rebuy_chips or 0,
        addon_chips=tournament_data.addon_chips or 0,
        double_addon_chips=tournament_data.double_addon_chips or 0,
        tip_chips=tournament_data.tip_chips or 0,
        rebuy_until_level=tournament_data.rebuy_until_level,
        addon_until_level=tournament_data.addon_until_level,
        current_level=1,
        clock_status="STOPPED",
        clock_elapsed_seconds=0,
        public_token=secrets.token_urlsafe(16),
    )

    db.add(new_tournament)
    await db.flush()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TOURNAMENT_CREATE,
        entity_type="Tournament", entity_id=new_tournament.id,
        meta={
            "name": tournament_data.name,
            "buyin_amount": tournament_data.buyin_amount,
            "rake_percentage": tournament_data.rake_percentage,
        },
    )
    await db.commit()
    await db.refresh(new_tournament)

    return new_tournament

# 2. OBTENER EL TORNEO ACTIVO
@router.get("/active", response_model=schemas.TournamentResponse | None)
async def get_active_tournament(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.club_id == current_club.id)
        .where(models.Tournament.status.in_(["REGISTERING", "RUNNING"]))
        .order_by(desc(models.Tournament.start_time))
    )
    tournament = result.scalars().first()

    return tournament


# 2.b TORNEOS PROGRAMADOS (status SCHEDULED) — listar y lanzar
@router.get("/scheduled", response_model=List[schemas.TournamentResponse])
async def list_scheduled_tournaments(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Torneos programados del club (status SCHEDULED), ordenados por fecha."""
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.club_id == current_club.id)
        .where(models.Tournament.status == "SCHEDULED")
        .order_by(models.Tournament.scheduled_start.asc().nullslast())
    )
    return result.scalars().all()


@router.post("/{tournament_id}/open", response_model=schemas.TournamentResponse)
async def open_scheduled_tournament(
    tournament_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Lanza un torneo programado: SCHEDULED -> REGISTERING. Respeta la regla de
    un solo torneo en juego por club (409 si ya hay uno activo)."""
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = result.scalars().first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    if tournament.status != "SCHEDULED":
        raise HTTPException(status_code=400, detail="Este torneo no está programado")

    active = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.club_id == current_club.id)
        .where(models.Tournament.status.in_(["REGISTERING", "RUNNING"]))
    )
    if active.scalars().first():
        raise HTTPException(status_code=409, detail="Ya hay un torneo activo. Cerralo antes de abrir el programado.")

    tournament.status = "REGISTERING"
    tournament.start_time = datetime.utcnow()
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TOURNAMENT_CREATE, entity_type="Tournament", entity_id=tournament.id,
        meta={"action": "open_scheduled", "name": tournament.name},
    )
    await db.commit()
    await db.refresh(tournament)
    return tournament


# ---------------------------------------------------------
# RELOJ DEL TORNEO (T3) — control del director + estado vivo.
# El reloj es server-authoritative: GET /clock devuelve elapsed/remaining
# calculados server-side y los clientes sólo tickean local. Mismo gate que
# registrar/rebuy (cualquier usuario del club; get_current_club rechaza DEALER).
# ---------------------------------------------------------
async def _get_owned_tournament(db: AsyncSession, tournament_id: int, club_id: int) -> models.Tournament:
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == club_id)
    )
    tournament = result.scalars().first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")
    return tournament


# ---------------------------------------------------------------------------
# MESAS DE TORNEO (Fase 1a): asientos + cupos. No toca plata.
# Ocupación de una mesa = jugadores ACTIVE con ese table_id (eliminar libera cupo).
# ---------------------------------------------------------------------------

async def _close_open_dealer_shifts(db, tournament_id, now=None) -> int:
    """Cierra todos los turnos de dealer ABIERTOS del torneo (al terminar/finalizar),
    para que no queden colgados (el dealer quedaría 'ocupado' y su pago sin cerrar)."""
    now = now or datetime.utcnow()
    shifts = (await db.execute(
        select(models.TournamentDealerShift)
        .where(models.TournamentDealerShift.tournament_id == tournament_id)
        .where(models.TournamentDealerShift.end_time.is_(None))
    )).scalars().all()
    for s in shifts:
        s.end_time = now
    return len(shifts)


async def _get_owned_table(db, tournament_id, table_id, club_id) -> models.TournamentTable:
    result = await db.execute(
        select(models.TournamentTable)
        .where(models.TournamentTable.id == table_id)
        .where(models.TournamentTable.tournament_id == tournament_id)
        .where(models.TournamentTable.club_id == club_id)
    )
    table = result.scalars().first()
    if not table:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return table


async def _active_counts_by_table(db, tournament_id) -> dict:
    rows = (await db.execute(
        select(models.TournamentPlayer.table_id, func.count())
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
        .where(models.TournamentPlayer.table_id.isnot(None))
        .group_by(models.TournamentPlayer.table_id)
    )).all()
    return {tid: c for tid, c in rows}


async def _used_seats(db, table_id, exclude_player_row_id=None) -> set:
    q = (
        select(models.TournamentPlayer.seat_number)
        .where(models.TournamentPlayer.table_id == table_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
        .where(models.TournamentPlayer.seat_number.isnot(None))
    )
    if exclude_player_row_id is not None:
        q = q.where(models.TournamentPlayer.id != exclude_player_row_id)
    return set((await db.execute(q)).scalars().all())


def _lowest_free_seat(used: set, max_seats: int):
    for s in range(1, max_seats + 1):
        if s not in used:
            return s
    return None


def _compute_rebalance(tables: list, waiting: list = None) -> dict:
    """Plan de NIVELADO asistido. Puro (no toca DB). Recibe las mesas OPEN como
    [{id, table_number, max_seats, player_ids:[...]}] y la lista de espera
    (player_ids ACTIVE sin mesa). Devuelve movimientos (from_id None = espera),
    mesas a cerrar y quiénes quedan en espera.

    Regla del club: (1) sentar la espera; una mesa VACÍA (reserva creada a mano)
    sólo se abre si hacen falta ≥2 lugares que no caben en las mesas en uso;
    (2) consolidar: romper la mesa más chica mientras sus jugadores quepan en las
    demás; (3) NIVELAR: todas las mesas en uso parejas (diferencia ≤ 1) — nunca
    8/5 ni 9/6. El mínimo de 5 emerge de (2): una mesa corta se une si cabe.
    No mueve a nadie en mitad de una mano (el director aplica cuando quiere)."""
    waiting = list(waiting or [])
    state = {t["id"]: {"id": t["id"], "number": t["table_number"], "max": t["max_seats"],
                       "players": list(t["player_ids"])} for t in tables}
    origin = {}
    for t in tables:
        for pid in t["player_ids"]:
            origin[pid] = t["id"]
    for pid in waiting:
        origin[pid] = None
    close_ids = []

    def opens():
        return [s for tid, s in state.items() if tid not in close_ids]

    in_use = [s for s in opens() if s["players"]]
    reserve = sorted([s for s in opens() if not s["players"]], key=lambda s: s["number"])
    if not in_use and reserve:
        # Arranque: sin mesas en uso, la primera reserva pasa a ser la mesa 1.
        in_use = [reserve.pop(0)]

    # (1) Abrir reservas sólo si faltan ≥2 lugares para la espera (regla del club:
    # no se abre una mesa nueva por un solo jugador; ese queda en espera).
    total = sum(len(s["players"]) for s in in_use) + len(waiting)
    capacity = sum(s["max"] for s in in_use)
    while total - capacity >= 2 and reserve:
        opened = reserve.pop(0)
        in_use.append(opened)
        capacity += opened["max"]

    # (2) Sentar la espera en la mesa con menos jugadores (con cupo). Va ANTES de
    # consolidar para que la reserva recién abierta reciba gente (si consolidáramos
    # primero, la reserva aún vacía se cerraría). Los que no caben siguen esperando.
    still_waiting = []
    for pid in waiting:
        target = min((s for s in in_use if len(s["players"]) < s["max"]),
                     key=lambda s: len(s["players"]), default=None)
        if target is None:
            still_waiting.append(pid)
        else:
            target["players"].append(pid)

    # (3) Consolidación: romper la mesa más chica mientras las demás la absorban.
    while len(in_use) > 1:
        cand = min(in_use, key=lambda s: len(s["players"]))
        others = [s for s in in_use if s["id"] != cand["id"]]
        free = sum(s["max"] - len(s["players"]) for s in others)
        if len(cand["players"]) > free:
            break
        for pid in list(cand["players"]):
            target = min((s for s in others if len(s["players"]) < s["max"]),
                         key=lambda s: len(s["players"]))
            target["players"].append(pid)
            cand["players"].remove(pid)
        close_ids.append(cand["id"])
        in_use = others

    # (4) NIVELAR: mover del más lleno al más vacío hasta que la diferencia sea ≤ 1.
    guard = 0
    while len(in_use) > 1 and guard < 1000:
        guard += 1
        fullest = max(in_use, key=lambda s: len(s["players"]))
        emptiest = min(in_use, key=lambda s: len(s["players"]))
        if len(fullest["players"]) - len(emptiest["players"]) < 2 or len(emptiest["players"]) >= emptiest["max"]:
            break
        emptiest["players"].append(fullest["players"].pop())

    # Movimiento NETO por jugador (origen → destino final), sin no-ops. Las
    # reservas no usadas quedan OPEN vacías (no se cierran: las maneja el director).
    final = {pid: tid for tid, s in state.items() for pid in s["players"] if tid not in close_ids}
    moves = [{"player_id": pid, "from_id": origin[pid], "to_id": final[pid]}
             for pid in origin if pid in final and final[pid] != origin[pid]]
    return {"moves": moves, "close_table_ids": close_ids, "still_waiting": still_waiting}


async def _auto_seat_one(db, tournament_id, t_player) -> bool:
    """Sienta UN jugador en la PRIMERA mesa OPEN (por número) con cupo — fill-first:
    se llena una mesa antes de usar la siguiente. Una mesa VACÍA (reserva) NO se
    estrena por un solo registro: el jugador queda en espera y el director la abre
    con "Nivelar" cuando hay ≥2 esperando. Recalcula desde DB (registro de a uno).
    No-op si no hay mesa disponible (queda en espera)."""
    tables = (await db.execute(
        select(models.TournamentTable)
        .where(models.TournamentTable.tournament_id == tournament_id)
        .where(models.TournamentTable.status == "OPEN")
        .order_by(models.TournamentTable.table_number)
    )).scalars().all()
    if not tables:
        return False
    counts = await _active_counts_by_table(db, tournament_id)
    in_use = [t for t in tables if counts.get(t.id, 0) > 0]
    if in_use:
        best = next((t for t in in_use if counts.get(t.id, 0) < t.max_seats), None)
    else:
        best = tables[0]  # arranque: torneo sin nadie sentado, se estrena la mesa 1
    if best is None:
        return False
    used = await _used_seats(db, best.id)
    t_player.table_id = best.id
    t_player.seat_number = _lowest_free_seat(used, best.max_seats)
    return True


async def _tables_response(db, tournament_id) -> schemas.TournamentTablesView:
    """Mesas con ocupación + jugadores ACTIVE sentados + los sin mesa + totales."""
    tables = (await db.execute(
        select(models.TournamentTable)
        .where(models.TournamentTable.tournament_id == tournament_id)
        .order_by(models.TournamentTable.table_number)
    )).scalars().all()
    rows = (await db.execute(
        select(models.TournamentPlayer, models.Player.name)
        .join(models.Player, models.Player.id == models.TournamentPlayer.player_id)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
    )).all()
    by_table = {}
    unseated = []
    for tp, name in rows:
        if tp.table_id is None:
            unseated.append(schemas.UnseatedPlayer(player_id=tp.player_id, name=name))
        else:
            by_table.setdefault(tp.table_id, []).append((tp, name))
    # Dealer con turno abierto por mesa (end_time NULL).
    dealer_rows = (await db.execute(
        select(models.TournamentDealerShift.table_id, models.TournamentDealerShift.dealer_id, models.Dealer.name)
        .join(models.Dealer, models.Dealer.id == models.TournamentDealerShift.dealer_id)
        .where(models.TournamentDealerShift.tournament_id == tournament_id)
        .where(models.TournamentDealerShift.end_time.is_(None))
    )).all()
    dealer_by_table = {tid: (did, name) for tid, did, name in dealer_rows}
    out_tables = []
    total_seats = total_seated = total_available = 0
    for t in tables:
        seated = by_table.get(t.id, [])
        seated.sort(key=lambda x: (x[0].seat_number or 999))
        avail = max(0, t.max_seats - len(seated))
        d = dealer_by_table.get(t.id)
        out_tables.append(schemas.TournamentTableResponse(
            id=t.id, table_number=t.table_number, max_seats=t.max_seats, status=t.status,
            seated_count=len(seated), seats_available=avail,
            players=[schemas.TableSeatPlayer(player_id=tp.player_id, name=name,
                                             seat_number=tp.seat_number, status=tp.status)
                     for tp, name in seated],
            dealer_id=(d[0] if d else None), dealer_name=(d[1] if d else None),
        ))
        if t.status == "OPEN":
            total_seats += t.max_seats
            total_seated += len(seated)
            total_available += avail
    return schemas.TournamentTablesView(
        tables=out_tables, unseated=unseated,
        total_seats=total_seats, total_seated=total_seated, total_available=total_available,
    )


@router.get("/{tournament_id}/tables", response_model=schemas.TournamentTablesView)
async def list_tournament_tables(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    await _get_owned_tournament(db, tournament_id, current_club.id)
    return await _tables_response(db, tournament_id)


@router.post("/{tournament_id}/tables", response_model=schemas.TournamentTablesView)
async def create_tournament_tables(
    tournament_id: int,
    data: schemas.TournamentTableCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    start_n = (await db.execute(
        select(func.max(models.TournamentTable.table_number))
        .where(models.TournamentTable.tournament_id == tournament_id)
    )).scalar() or 0
    for i in range(data.count):
        db.add(models.TournamentTable(
            club_id=current_club.id, tournament_id=tournament.id,
            table_number=start_n + i + 1, max_seats=data.max_seats, status="OPEN",
            public_token=secrets.token_urlsafe(16),
        ))
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_TABLE_CREATE,
        entity_type="Tournament", entity_id=tournament.id,
        meta={"count": data.count, "max_seats": data.max_seats},
    )
    await db.commit()
    return await _tables_response(db, tournament_id)


@router.patch("/{tournament_id}/tables/{table_id}", response_model=schemas.TournamentTablesView)
async def update_tournament_table(
    tournament_id: int,
    table_id: int,
    data: schemas.TournamentTableUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    await _get_owned_tournament(db, tournament_id, current_club.id)
    table = await _get_owned_table(db, tournament_id, table_id, current_club.id)
    if data.max_seats is not None:
        # No permitir achicar por debajo de los que ya están sentados.
        seated = (await _active_counts_by_table(db, tournament_id)).get(table_id, 0)
        if data.max_seats < seated:
            raise HTTPException(status_code=400, detail=f"Hay {seated} jugadores sentados; no podés bajar los cupos por debajo.")
        table.max_seats = data.max_seats
    if data.status in ("OPEN", "CLOSED"):
        table.status = data.status
        if data.status == "CLOSED":
            # Cerrar a mano desienta a sus ACTIVE (van a la espera); si no, quedan
            # varados en una mesa que el nivelado ya no ve (mismo patrón que delete).
            seated_rows = (await db.execute(
                select(models.TournamentPlayer)
                .where(models.TournamentPlayer.tournament_id == tournament_id)
                .where(models.TournamentPlayer.table_id == table_id)
                .where(models.TournamentPlayer.status == "ACTIVE")
            )).scalars().all()
            for tp in seated_rows:
                tp.table_id = None
                tp.seat_number = None
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_TABLE_UPDATE,
        entity_type="TournamentTable", entity_id=table.id, meta={"max_seats": table.max_seats, "status": table.status},
    )
    await db.commit()
    return await _tables_response(db, tournament_id)


@router.delete("/{tournament_id}/tables/{table_id}", response_model=schemas.TournamentTablesView)
async def delete_tournament_table(
    tournament_id: int,
    table_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    await _get_owned_tournament(db, tournament_id, current_club.id)
    table = await _get_owned_table(db, tournament_id, table_id, current_club.id)
    # Desentar a sus jugadores ACTIVE (vuelven al pool, se pueden auto-sentar de
    # nuevo). Filtra por tournament_id también (autodefensivo) y por status para
    # no contar de más (los eliminados ya tienen table_id NULL).
    seated = (await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.table_id == table_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
    )).scalars().all()
    for tp in seated:
        tp.table_id = None
        tp.seat_number = None
    await db.delete(table)
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_TABLE_DELETE,
        entity_type="TournamentTable", entity_id=table_id, meta={"unseated": len(seated)},
    )
    await db.commit()
    return await _tables_response(db, tournament_id)


@router.post("/{tournament_id}/tables/auto-seat", response_model=schemas.TournamentTablesView)
async def auto_seat_players(
    tournament_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Sienta a los que esperan, fill-first, SOLO en mesas ya en uso (una reserva
    vacía se abre con "Nivelar" cuando hay ≥2 esperando, no acá). Los que no caben
    siguen en espera."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    tables = (await db.execute(
        select(models.TournamentTable)
        .where(models.TournamentTable.tournament_id == tournament_id)
        .where(models.TournamentTable.status == "OPEN")
        .order_by(models.TournamentTable.table_number)
    )).scalars().all()
    if not tables:
        raise HTTPException(status_code=400, detail="Creá al menos una mesa antes de auto-sentar.")
    unseated = (await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
        .where(models.TournamentPlayer.table_id.is_(None))
    )).scalars().all()
    counts = await _active_counts_by_table(db, tournament_id)
    used_by_table = {t.id: await _used_seats(db, t.id) for t in tables}
    seated_n = 0
    for tp in unseated:
        in_use = [t for t in tables if counts.get(t.id, 0) > 0]
        if in_use:
            best = next((t for t in in_use if counts.get(t.id, 0) < t.max_seats), None)
        else:
            best = tables[0]  # arranque: nadie sentado aún
        if best is None:
            break  # mesas en uso llenas: el resto queda en espera (Nivelar abre reserva)
        seat = _lowest_free_seat(used_by_table[best.id], best.max_seats)
        tp.table_id = best.id
        tp.seat_number = seat
        counts[best.id] = counts.get(best.id, 0) + 1
        used_by_table[best.id].add(seat)
        seated_n += 1
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_PLAYER_SEAT,
        entity_type="Tournament", entity_id=tournament_id, meta={"auto_seated": seated_n},
    )
    try:
        await db.commit()
    except IntegrityError:
        # Carrera con otro registro/movimiento. Reintentá (los asientos se recalculan).
        await db.rollback()
        raise HTTPException(status_code=409, detail="Hubo movimiento simultáneo de asientos. Reintentá.")
    return await _tables_response(db, tournament_id)


@router.post("/{tournament_id}/players/{player_id}/move", response_model=schemas.TournamentTablesView)
async def move_player_to_table(
    tournament_id: int,
    player_id: int,
    data: schemas.MovePlayerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Mueve un jugador a otra mesa (reasiento manual). table_id None = sacar de mesa."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    t_player = (await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == player_id)
    )).scalars().first()
    if not t_player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado en el torneo")
    if t_player.status != "ACTIVE":
        raise HTTPException(status_code=400, detail="El jugador no está activo")

    if data.table_id is None:
        t_player.table_id = None
        t_player.seat_number = None
    else:
        table = await _get_owned_table(db, tournament_id, data.table_id, current_club.id)
        seated = await _used_seats(db, table.id, exclude_player_row_id=t_player.id)
        if len(seated) >= table.max_seats:
            raise HTTPException(status_code=409, detail="La mesa está llena.")
        seat = data.seat_number if (data.seat_number and data.seat_number not in seated and data.seat_number <= table.max_seats) else _lowest_free_seat(seated, table.max_seats)
        t_player.table_id = table.id
        t_player.seat_number = seat
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_PLAYER_SEAT,
        entity_type="TournamentPlayer", entity_id=t_player.id,
        meta={"player_id": player_id, "table_id": data.table_id},
    )
    try:
        await db.commit()
    except IntegrityError:
        # Carrera: otro movimiento tomó el asiento (índice único). Reintentá.
        await db.rollback()
        raise HTTPException(status_code=409, detail="El asiento se ocupó al mismo tiempo. Reintentá.")
    return await _tables_response(db, tournament_id)


# --- Balanceo asistido de mesas (Fase 3) ---
async def _open_tables_model(db, tournament_id):
    """Mesas OPEN + sus jugadores ACTIVE sentados (rows ORM + nombres) para
    planear/aplicar el balanceo."""
    tables = (await db.execute(
        select(models.TournamentTable)
        .where(models.TournamentTable.tournament_id == tournament_id)
        .where(models.TournamentTable.status == "OPEN")
        .order_by(models.TournamentTable.table_number)
    )).scalars().all()
    rows = (await db.execute(
        select(models.TournamentPlayer, models.Player.name)
        .join(models.Player, models.Player.id == models.TournamentPlayer.player_id)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.status == "ACTIVE")
    )).all()
    open_ids = {t.id for t in tables}
    by_table, names, tp_by_player = {}, {}, {}
    waiting = []
    for tp, name in rows:
        names[tp.player_id] = name
        tp_by_player[tp.player_id] = tp
        # Sentado en una mesa que ya no está OPEN (cerrada a mano) = en espera:
        # el nivelado lo recoloca en vez de dejarlo varado.
        if tp.table_id is None or tp.table_id not in open_ids:
            waiting.append(tp.player_id)
        else:
            by_table.setdefault(tp.table_id, []).append(tp)
    return tables, by_table, names, tp_by_player, waiting


def _plan_from_model(tables, by_table, waiting):
    model = [{"id": t.id, "table_number": t.table_number, "max_seats": t.max_seats,
              "player_ids": [tp.player_id for tp in by_table.get(t.id, [])]} for t in tables]
    return _compute_rebalance(model, waiting)


@router.get("/{tournament_id}/tables/rebalance-plan")
async def rebalance_plan(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Sugerencia de nivelado (read-only): movimientos (desde mesa o desde la
    espera) + mesas a cerrar + quiénes siguen esperando."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    tables, by_table, names, _, waiting = await _open_tables_model(db, tournament_id)
    plan = _plan_from_model(tables, by_table, waiting)
    num = {t.id: t.table_number for t in tables}
    return {
        "moves": [{
            "player_id": m["player_id"], "player_name": names.get(m["player_id"], "?"),
            "from_table_id": m["from_id"], "from_table_number": num.get(m["from_id"]),
            "to_table_id": m["to_id"], "to_table_number": num.get(m["to_id"]),
        } for m in plan["moves"]],
        "close_tables": [{"id": tid, "table_number": num.get(tid)} for tid in plan["close_table_ids"]],
        "still_waiting": [{"player_id": pid, "player_name": names.get(pid, "?")} for pid in plan["still_waiting"]],
        "any": bool(plan["moves"] or plan["close_table_ids"]),
    }


@router.post("/{tournament_id}/tables/rebalance", response_model=schemas.TournamentTablesView)
async def rebalance_apply(
    tournament_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Aplica el nivelado: recalcula el plan fresco (no confía en el cliente),
    sienta la espera, reasienta a los jugadores y cierra las mesas consolidadas
    (más su dealer)."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    tables, by_table, _, tp_by_player, waiting = await _open_tables_model(db, tournament_id)
    plan = _plan_from_model(tables, by_table, waiting)
    if not plan["moves"] and not plan["close_table_ids"]:
        return await _tables_response(db, tournament_id)

    max_by_id = {t.id: t.max_seats for t in tables}
    used = {t.id: {tp.seat_number for tp in by_table.get(t.id, []) if tp.seat_number} for t in tables}
    seat_by_player = {tp.player_id: tp.seat_number for tps in by_table.values() for tp in tps}
    for m in plan["moves"]:
        tp = tp_by_player[m["player_id"]]
        if m["from_id"] is not None:
            used.get(m["from_id"], set()).discard(seat_by_player.get(m["player_id"]))
        seat = _lowest_free_seat(used.setdefault(m["to_id"], set()), max_by_id.get(m["to_id"], 0))
        if seat is None:
            # No debería pasar (el plan garantiza cupo), pero no persistimos un
            # asiento nulo: abortamos y el director reintenta.
            await db.rollback()
            raise HTTPException(status_code=409, detail="No hay asiento libre al balancear. Reintentá.")
        tp.table_id = m["to_id"]
        tp.seat_number = seat
        used[m["to_id"]].add(seat)
        seat_by_player[m["player_id"]] = seat

    now = datetime.utcnow()
    for tid in plan["close_table_ids"]:
        table = next((t for t in tables if t.id == tid), None)
        if table:
            table.status = "CLOSED"
        sh = (await db.execute(
            select(models.TournamentDealerShift)
            .where(models.TournamentDealerShift.club_id == current_club.id)
            .where(models.TournamentDealerShift.table_id == tid)
            .where(models.TournamentDealerShift.end_time.is_(None))
        )).scalars().first()
        if sh:
            sh.end_time = now

    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_PLAYER_SEAT,
        entity_type="Tournament", entity_id=tournament_id,
        meta={"rebalance_moves": len(plan["moves"]), "closed_tables": len(plan["close_table_ids"])},
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Hubo movimiento simultáneo. Reintentá el balanceo.")
    return await _tables_response(db, tournament_id)


# --- Dealer por mesa de torneo (Fase 1b) ---
@router.post("/{tournament_id}/tables/{table_id}/dealer", response_model=schemas.TournamentTablesView)
async def assign_table_dealer(
    tournament_id: int,
    table_id: int,
    data: schemas.AssignDealerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Asigna un dealer a una mesa de torneo (abre un turno). Reemplaza al dealer
    anterior de la mesa si había. Snapshotea la tarifa de torneo del dealer."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    await _get_owned_table(db, tournament_id, table_id, current_club.id)
    dealer = (await db.execute(
        select(models.Dealer)
        .where(models.Dealer.id == data.dealer_id)
        .where(models.Dealer.club_id == current_club.id)
        .where(models.Dealer.is_active == True)  # noqa: E712
    )).scalars().first()
    if not dealer:
        raise HTTPException(status_code=404, detail="Dealer no encontrado o inactivo")

    # ¿El dealer ya tiene otra mesa de torneo abierta?
    other = (await db.execute(
        select(models.TournamentDealerShift)
        .where(models.TournamentDealerShift.club_id == current_club.id)
        .where(models.TournamentDealerShift.dealer_id == dealer.id)
        .where(models.TournamentDealerShift.end_time.is_(None))
        .where(models.TournamentDealerShift.table_id != table_id)
    )).scalars().first()
    if other and not data.force:
        raise HTTPException(status_code=409, detail="El dealer ya está en otra mesa de torneo. Usá 'force' para moverlo.")
    now = datetime.utcnow()
    if other:
        other.end_time = now
    # Cerrar el turno abierto de ESTA mesa (reemplazo de dealer).
    cur = (await db.execute(
        select(models.TournamentDealerShift)
        .where(models.TournamentDealerShift.club_id == current_club.id)
        .where(models.TournamentDealerShift.table_id == table_id)
        .where(models.TournamentDealerShift.end_time.is_(None))
    )).scalars().first()
    if cur:
        cur.end_time = now
    await db.flush()  # asegura que los cierres caigan antes del nuevo INSERT (índice único)

    db.add(models.TournamentDealerShift(
        club_id=current_club.id, tournament_id=tournament_id, table_id=table_id,
        dealer_id=dealer.id, tournament_hourly_rate_cop=dealer.tournament_hourly_rate_cop or 0.0,
        start_time=now,
    ))
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_DEALER_ASSIGN,
        entity_type="TournamentTable", entity_id=table_id, meta={"dealer_id": dealer.id, "dealer_name": dealer.name},
    )
    try:
        await db.commit()
    except IntegrityError:
        # Índice único (mesa o dealer abiertos): hubo asignación simultánea.
        await db.rollback()
        raise HTTPException(status_code=409, detail="Hubo una asignación simultánea de dealer. Reintentá.")
    return await _tables_response(db, tournament_id)


@router.delete("/{tournament_id}/tables/{table_id}/dealer", response_model=schemas.TournamentTablesView)
async def end_table_dealer(
    tournament_id: int,
    table_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Saca al dealer de una mesa de torneo (cierra su turno)."""
    await _get_owned_tournament(db, tournament_id, current_club.id)
    await _get_owned_table(db, tournament_id, table_id, current_club.id)
    cur = (await db.execute(
        select(models.TournamentDealerShift)
        .where(models.TournamentDealerShift.club_id == current_club.id)
        .where(models.TournamentDealerShift.table_id == table_id)
        .where(models.TournamentDealerShift.end_time.is_(None))
    )).scalars().first()
    if not cur:
        raise HTTPException(status_code=404, detail="La mesa no tiene dealer asignado")
    cur.end_time = datetime.utcnow()
    await log_action(
        db, request=request, club=current_club, action=AuditAction.TOURNAMENT_DEALER_END,
        entity_type="TournamentTable", entity_id=table_id, meta={"dealer_id": cur.dealer_id},
    )
    await db.commit()
    return await _tables_response(db, tournament_id)


@router.get("/{tournament_id}/clock")
async def get_tournament_clock(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Estado vivo del reloj. Persiste el auto-avance por tiempo si el nivel venció
    (el director polea acá cada 5s; así current_level se mantiene al día para las
    ventanas de rebuy/addon)."""
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    if tournament_clock.advance_clock_if_due(tournament):
        await db.commit()
    return tournament_clock.clock_state(tournament)


async def _apply_clock_action(
    db: AsyncSession, request: Request, current_club: models.Club,
    tournament_id: int, action: str,
) -> dict:
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    now = datetime.utcnow()
    # Ponerse al día con el auto-avance antes de la acción, así next/prev operan
    # sobre el nivel EN VIVO (no sobre uno viejo que el tiempo ya superó).
    tournament_clock.advance_clock_if_due(tournament, now)
    if action == "start":
        tournament_clock.start_clock(tournament, now)
    elif action == "pause":
        tournament_clock.pause_clock(tournament, now)
    elif action == "next":
        tournament_clock.go_to_level(tournament, tournament_clock.effective_level(tournament) + 1, now)
    elif action == "prev":
        tournament_clock.go_to_level(tournament, tournament_clock.effective_level(tournament) - 1, now)
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TOURNAMENT_CLOCK, entity_type="Tournament", entity_id=tournament.id,
        meta={"clock_action": action, "level": tournament.current_level, "status": tournament.clock_status},
    )
    await db.commit()
    await db.refresh(tournament)
    return tournament_clock.clock_state(tournament)


@router.post("/{tournament_id}/clock/start")
async def clock_start(tournament_id: int, request: Request, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    return await _apply_clock_action(db, request, current_club, tournament_id, "start")


@router.post("/{tournament_id}/clock/pause")
async def clock_pause(tournament_id: int, request: Request, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    return await _apply_clock_action(db, request, current_club, tournament_id, "pause")


@router.post("/{tournament_id}/clock/next-level")
async def clock_next_level(tournament_id: int, request: Request, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    return await _apply_clock_action(db, request, current_club, tournament_id, "next")


@router.post("/{tournament_id}/clock/prev-level")
async def clock_prev_level(tournament_id: int, request: Request, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    return await _apply_clock_action(db, request, current_club, tournament_id, "prev")


@router.patch("/{tournament_id}/blinds", response_model=schemas.TournamentResponse)
async def update_blind_structure(
    tournament_id: int,
    data: schemas.BlindStructureUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER, models.UserRole.MANAGER])),
):
    """Editar la estructura de blinds (OWNER/MANAGER). No reinicia el reloj; si el
    nivel actual quedó fuera de rango se acota al editar la próxima acción."""
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    tournament.blind_structure = [lvl.model_dump() for lvl in data.blind_structure]
    if data.starting_stack is not None:
        tournament.starting_stack = data.starting_stack
    # Si la estructura se encogió, acotar current_level para que no quede fuera de
    # rango (evita que next/prev queden "trabados" hasta volver al rango).
    tournament.current_level = tournament_clock.effective_level(tournament)
    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TOURNAMENT_BLINDS_UPDATE, entity_type="Tournament", entity_id=tournament.id,
        meta={"levels": len(tournament.blind_structure)},
    )
    await db.commit()
    await db.refresh(tournament)
    return tournament


# 3. FINALIZAR TORNEO
@router.post("/{tournament_id}/end", response_model=schemas.TournamentResponse)
async def end_tournament(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = result.scalars().first()

    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    if tournament.status == "FINISHED":
        raise HTTPException(status_code=400, detail="El torneo ya finalizó")

    tournament.status = "FINISHED"
    tournament.end_time = datetime.utcnow()
    await _close_open_dealer_shifts(db, tournament.id, tournament.end_time)

    await db.commit()
    await db.refresh(tournament)

    return tournament

# 4. REGISTRAR JUGADOR (INSCRIBIR)
@router.post("/{tournament_id}/register", response_model=schemas.TournamentPlayerSchema)
async def register_player(
    tournament_id: int,
    registration: PlayerRegistration,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # A. Obtener Torneo
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = result.scalars().first()

    if not tournament or tournament.status == "FINISHED":
        raise HTTPException(status_code=400, detail="Torneo no válido o finalizado")

    # B. Verificar duplicados
    existing = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == registration.player_id)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="El jugador ya está en el torneo")

    # C. Cobrar buy-in (Transaccion TOURNAMENT_ENTRY)
    if registration.pay_buyin and tournament.buyin_amount > 0:
        db.add(models.Transaction(
            tournament_id=tournament.id,
            session_id=None,
            player_id=registration.player_id,
            type=models.TransactionType.TOURNAMENT_ENTRY,
            amount=tournament.buyin_amount,
            description=f"Inscripcion Torneo #{tournament.id}",
            timestamp=datetime.utcnow(),
        ))

    # D. Cobrar dealer tip si aplica (Transaccion TOURNAMENT_TIP separada,
    # consistente con pay_late_dealer_tip)
    tips_count = 0
    if registration.pay_tip and tournament.dealer_tip_amount > 0:
        db.add(models.Transaction(
            tournament_id=tournament.id,
            session_id=None,
            player_id=registration.player_id,
            type=models.TransactionType.TOURNAMENT_TIP,
            amount=tournament.dealer_tip_amount,
            description=f"Staff Bonus - Torneo #{tournament.id}",
            timestamp=datetime.utcnow(),
        ))
        tips_count = 1

    # E. Crear Jugador en Torneo
    new_player = models.TournamentPlayer(
        tournament_id=tournament.id,
        player_id=registration.player_id,
        status="ACTIVE",
        rebuys_count=0,
        addons_count=0,
        is_tip_paid=registration.pay_tip,
        tips_count=tips_count,
    )
    db.add(new_player)
    await db.commit()
    await db.refresh(new_player)

    # Auto-sentar en la mesa OPEN más vacía con cupo (no-op si no hay mesas). Es
    # best-effort y va en commit aparte: si una carrera choca el asiento (índice
    # único), el jugador queda sin mesa (el staff usa "Auto-sentar"), pero el
    # registro NUNCA falla por esto.
    try:
        if await _auto_seat_one(db, tournament.id, new_player):
            await db.commit()
            await db.refresh(new_player)
    except IntegrityError:
        await db.rollback()
        await db.refresh(new_player)

    return new_player

# 5. PAGAR DEALER TIP TARDE
@router.post("/{tournament_id}/players/{player_id}/pay-tip", response_model=schemas.TournamentPlayerSchema)
async def pay_late_dealer_tip(
    tournament_id: int,
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # A. Buscar jugador
    result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == player_id)
    )
    t_player = result.scalars().first()

    if not t_player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado en este torneo")

    # B. Obtener monto del torneo (validando que pertenezca al club)
    tournament_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = tournament_result.scalars().first()

    if tournament.dealer_tip_amount <= 0:
        raise HTTPException(status_code=400, detail="Este torneo no tiene Dealer Tip configurado")

    # C. Cobrar
    new_transaction = models.Transaction(
        tournament_id=tournament_id,
        session_id=None,
        player_id=player_id,
        type=models.TransactionType.TOURNAMENT_TIP,
        amount=tournament.dealer_tip_amount,
        description=f"Staff Bonus #{(t_player.tips_count or 0) + 1} - Torneo #{tournament.id}",
        timestamp=datetime.utcnow()
    )
    db.add(new_transaction)

    # D. Actualizar estado
    t_player.is_tip_paid = True
    t_player.tips_count = (t_player.tips_count or 0) + 1

    await db.commit()
    await db.refresh(t_player)

    return t_player


# 6. REGISTRAR REBUY (Sencillo o Doble)
def _ensure_window_open(tournament: models.Tournament, until_level, label: str) -> None:
    """Ventana de rebuy/addon (T4): si hay un nivel límite y el reloj ya lo pasó,
    rechaza. NULL/0 = sin límite. Usa el nivel EFECTIVO (acotado a la estructura)."""
    if until_level and tournament_clock.live_level(tournament) > until_level:
        raise HTTPException(
            status_code=400,
            detail=f"El período de {label} cerró (disponible hasta el nivel {until_level}).",
        )


@router.post("/{tournament_id}/rebuy", response_model=schemas.TournamentPlayerSchema)
async def register_rebuy(
    tournament_id: int,
    request: RebuyAddonRequest,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # 1. Buscar Torneo y Jugador
    t_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = t_result.scalars().first()

    p_result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == request.player_id)
    )
    t_player = p_result.scalars().first()

    if not tournament or not t_player:
        raise HTTPException(status_code=404, detail="Torneo o Jugador no encontrado")

    _ensure_window_open(tournament, tournament.rebuy_until_level, "rebuys")

    # 2. Determinar precio según el tipo
    amount = 0
    desc = ""
    
    if request.type == "SINGLE":
        amount = tournament.rebuy_price
        desc = f"Rebuy Sencillo - Torneo #{tournament.id}"
    elif request.type == "DOUBLE":
        amount = tournament.double_rebuy_price
        desc = f"Rebuy Doble - Torneo #{tournament.id}"
    else:
        raise HTTPException(status_code=400, detail="Tipo inválido (Use SINGLE o DOUBLE)")

    if amount <= 0:
        raise HTTPException(status_code=400, detail="El precio de este Rebuy es 0 o no está configurado")

    # 3. Crear Transacción
    new_transaction = models.Transaction(
        tournament_id=tournament.id,
        session_id=None,
        player_id=request.player_id,
        type=models.TransactionType.TOURNAMENT_REBUY, # ✅ Usamos el Enum
        amount=amount,
        description=desc,
        timestamp=datetime.utcnow()
    )
    db.add(new_transaction)

    # 4. Actualizar contadores (después del guard de precio: el invariante
    # singles = total - dobles solo se toca si la jugada realmente procede).
    if request.type == "DOUBLE":
        t_player.double_rebuys_count += 1
    t_player.rebuys_count += 1

    await db.commit()
    await db.refresh(t_player)
    return t_player

# 7. REGISTRAR ADD-ON (Sencillo o Doble)
@router.post("/{tournament_id}/addon", response_model=schemas.TournamentPlayerSchema)
async def register_addon(
    tournament_id: int,
    request: RebuyAddonRequest,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # (Lógica casi idéntica a Rebuy, pero con Addon)
    t_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = t_result.scalars().first()
    
    p_result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == request.player_id)
    )
    t_player = p_result.scalars().first()

    if not tournament or not t_player:
        raise HTTPException(status_code=404, detail="Datos no encontrados")

    _ensure_window_open(tournament, tournament.addon_until_level, "add-ons")

    amount = 0
    desc = ""
    
    if request.type == "SINGLE":
        amount = tournament.addon_price
        desc = f"Add-on Sencillo - Torneo #{tournament.id}"
    elif request.type == "DOUBLE":
        amount = tournament.double_addon_price
        desc = f"Add-on Doble - Torneo #{tournament.id}"
    else:
        raise HTTPException(status_code=400, detail="Tipo inválido")

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Precio no configurado")

    new_transaction = models.Transaction(
        tournament_id=tournament.id,
        session_id=None,
        player_id=request.player_id,
        type=models.TransactionType.TOURNAMENT_ADDON, # ✅ Enum correcto
        amount=amount,
        description=desc,
        timestamp=datetime.utcnow()
    )
    db.add(new_transaction)

    # Contador doble después del guard de precio (invariante singles = total - dobles).
    if request.type == "DOUBLE":
        t_player.double_addons_count += 1

    t_player.addons_count += 1
    
    await db.commit()
    await db.refresh(t_player)
    return t_player

class UndoRequest(BaseModel):
    player_id: int
    action: str  # "rebuy" o "addon"
    type: str    # "SINGLE" o "DOUBLE"

@router.post("/{tournament_id}/undo", response_model=schemas.TournamentPlayerSchema)
async def undo_action(
    tournament_id: int,
    request: UndoRequest,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    t_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = t_result.scalars().first()

    p_result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == request.player_id)
    )
    t_player = p_result.scalars().first()

    if not tournament or not t_player:
        raise HTTPException(status_code=404, detail="Torneo o Jugador no encontrado")

    if request.action == "rebuy":
        if request.type == "SINGLE":
            single_count = t_player.rebuys_count - t_player.double_rebuys_count
            if single_count <= 0:
                raise HTTPException(status_code=400, detail="No hay rebuys sencillos para deshacer")
            t_player.rebuys_count -= 1
        elif request.type == "DOUBLE":
            if t_player.double_rebuys_count <= 0:
                raise HTTPException(status_code=400, detail="No hay rebuys dobles para deshacer")
            t_player.double_rebuys_count -= 1
            t_player.rebuys_count -= 1
        else:
            raise HTTPException(status_code=400, detail="Tipo invalido")
    elif request.action == "addon":
        if request.type == "SINGLE":
            single_count = t_player.addons_count - t_player.double_addons_count
            if single_count <= 0:
                raise HTTPException(status_code=400, detail="No hay add-ons sencillos para deshacer")
            t_player.addons_count -= 1
        elif request.type == "DOUBLE":
            if t_player.double_addons_count <= 0:
                raise HTTPException(status_code=400, detail="No hay add-ons dobles para deshacer")
            t_player.double_addons_count -= 1
            t_player.addons_count -= 1
        else:
            raise HTTPException(status_code=400, detail="Tipo invalido")
    else:
        raise HTTPException(status_code=400, detail="Accion invalida")

    # Eliminar la ultima transaccion del MISMO tipo (sencillo/doble) que se deshizo.
    # Las descripciones distinguen "Sencillo" vs "Doble"; sin este filtro se borraba
    # la transaccion mas reciente sin importar el tipo, desincronizando el ledger de
    # transacciones contra los contadores (ej: deshacer un single borraba un double).
    tx_type = models.TransactionType.TOURNAMENT_REBUY if request.action == "rebuy" else models.TransactionType.TOURNAMENT_ADDON
    desc_keyword = "Doble" if request.type == "DOUBLE" else "Sencillo"
    last_tx = await db.execute(
        select(models.Transaction)
        .where(models.Transaction.tournament_id == tournament_id)
        .where(models.Transaction.player_id == request.player_id)
        .where(models.Transaction.type == tx_type)
        .where(models.Transaction.description.ilike(f"%{desc_keyword}%"))
        .order_by(models.Transaction.timestamp.desc())
        .limit(1)
    )
    tx = last_tx.scalars().first()
    if tx:
        await db.execute(delete(models.Transaction).where(models.Transaction.id == tx.id))

    await db.commit()
    await db.refresh(t_player)
    return t_player

@router.post("/{tournament_id}/players/{player_id}/eliminate", response_model=schemas.TournamentPlayerSchema)
async def eliminate_player(
    tournament_id: int,
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # Verificar torneo pertenece al club
    t_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = t_result.scalars().first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    # Buscar jugador
    p_result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == player_id)
    )
    t_player = p_result.scalars().first()
    if not t_player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado en el torneo")

    if t_player.status == "ELIMINATED":
        raise HTTPException(status_code=400, detail="El jugador ya fue eliminado")

    t_player.status = "ELIMINATED"
    # Liberar el cupo: el eliminado deja de ocupar asiento en su mesa.
    t_player.table_id = None
    t_player.seat_number = None
    await db.commit()
    await db.refresh(t_player)
    return t_player

@router.post("/{tournament_id}/finalize", response_model=schemas.TournamentResponse)
async def finalize_tournament(
    tournament_id: int,
    data: schemas.TournamentFinalize,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # 1. Traer el Torneo y Jugadores
    result = await db.execute(
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    tournament = result.scalars().first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    # 2. Calcular el Pozo Final (Backend Source of Truth)
    total_buyins = len(tournament.players) * tournament.buyin_amount
    total_rebuys_money = sum([
        (p.rebuys_count - p.double_rebuys_count) * tournament.rebuy_price +
        p.double_rebuys_count * tournament.double_rebuy_price
        for p in tournament.players
    ])
    total_addons_money = sum([
        (p.addons_count - p.double_addons_count) * tournament.addon_price +
        p.double_addons_count * tournament.double_addon_price
        for p in tournament.players
    ])
    
    gross_pot = total_buyins + total_rebuys_money + total_addons_money
    rake_amount = gross_pot * (tournament.rake_percentage / 100)
    net_pot = gross_pot - rake_amount

    # 3. Procesar Ganadores
    winner_ids = [w.player_id for w in data.winners]
    
    # Mapa de porcentajes (posición -> %)
    # tournament.payout_structure es una lista [50, 30, 20]
    payout_map = {i+1: pct for i, pct in enumerate(tournament.payout_structure)}

    for p in tournament.players:
        # Buscamos si este jugador está en la lista de ganadores enviada
        winner_data = next((w for w in data.winners if w.player_id == p.player_id), None)
        
        if winner_data:
            rank = winner_data.rank
            pct = payout_map.get(rank, 0)
            prize = net_pot * (pct / 100)
            
            p.status = "WINNER"
            p.rank = rank
            p.prize_collected = int(prize)
        else:
            # Si no está en la lista de ganadores, es eliminado automáticamente
            p.status = "ELIMINATED"
            p.prize_collected = 0
            # Si no tenía rank, le ponemos 999 o calculamos (opcional, por ahora lo dejamos null o alto)
            if not p.rank: 
                p.rank = 0 

    # 4. Cerrar Torneo
    tournament.status = "COMPLETED"
    tournament.end_time = datetime.utcnow()
    await _close_open_dealer_shifts(db, tournament.id, tournament.end_time)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.TOURNAMENT_FINALIZE,
        entity_type="Tournament", entity_id=tournament.id,
        meta={
            "name": tournament.name,
            "gross_pot": gross_pot, "net_pot": net_pot, "rake_amount": rake_amount,
            "winners": [{"player_id": w.player_id, "rank": w.rank} for w in data.winners],
            "players_count": len(tournament.players),
        },
    )
    await db.commit()
    await db.refresh(tournament)
    return tournament

@router.get("/{tournament_id}/details")
async def get_tournament_details(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    # A. Buscar el torneo y sus jugadores
    result = await db.execute(
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    t = result.scalars().first()
    if not t:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    # B. Calcular finanzas y lista de jugadores
    total_buyins = 0
    total_rebuys_money = 0
    total_addons_money = 0
    total_prizes_paid = 0
    
    players_data = []

    for p in t.players:
        # Recuperar nombre del jugador
        p_name_res = await db.execute(select(models.Player.name).where(models.Player.id == p.player_id))
        p_name = p_name_res.scalar() or "Desconocido"

        # rebuys_count y addons_count son TOTALES (singles + doubles).
        # Para calcular costo: singles = total - dobles, dobles = como esten.
        single_rebuys = max(0, (p.rebuys_count or 0) - (p.double_rebuys_count or 0))
        single_addons = max(0, (p.addons_count or 0) - (p.double_addons_count or 0))

        p_rebuys_cost = single_rebuys * t.rebuy_price + (p.double_rebuys_count or 0) * t.double_rebuy_price
        p_addons_cost = single_addons * t.addon_price + (p.double_addons_count or 0) * t.double_addon_price
        p_tips_cost = (p.tips_count or 0) * (t.dealer_tip_amount or 0)
        p_invested = t.buyin_amount + p_rebuys_cost + p_addons_cost + p_tips_cost

        # Sumar a totales del torneo
        total_buyins += t.buyin_amount
        total_rebuys_money += p_rebuys_cost
        total_addons_money += p_addons_cost
        total_prizes_paid += (p.prize_collected or 0)

        players_data.append({
            "player_id": p.player_id,
            "name": p_name,
            "rank": p.rank if p.rank else 999,
            "rebuys_count": p.rebuys_count or 0,  # ya es el total (singles + dobles)
            "addons_count": p.addons_count or 0,
            "invested": p_invested,
            "prize": p.prize_collected or 0,
            "net_profit": (p.prize_collected or 0) - p_invested
        })

    # C. Calcular Rake y Totales
    gross_pot = total_buyins + total_rebuys_money + total_addons_money
    rake_total = gross_pot * (t.rake_percentage / 100)
    
    # Ordenar por Ranking
    players_data.sort(key=lambda x: x["rank"])

    return {
        "financials": {
            "gross_pot": gross_pot,
            "rake_total": rake_total,
            "prizes_paid": total_prizes_paid,
            "players_count": len(players_data)
        },
        "players": players_data
    }

@router.delete("/{tournament_id}", status_code=204)
async def delete_tournament(
    tournament_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    # A. Buscar el torneo
    result = await db.execute(select(models.Tournament).where(models.Tournament.id == tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    # B. Verificar seguridad (que sea del mismo club)
    if tournament.club_id != current_club.id:
        raise HTTPException(status_code=403, detail="No tienes permiso para eliminar este torneo")

    try:
        # C. LIMPIEZA EN CASCADA (El orden es vital) 🧹
        
        # 1. Borrar Transacciones vinculadas (Rebuys, Addons pagados, etc.)
        # Si no borras esto, la BD gritará porque hay dinero vinculado al ID del torneo.
        await db.execute(
            delete(models.Transaction).where(models.Transaction.tournament_id == tournament_id)
        )
        
        # 2. Borrar Jugadores Inscritos (TournamentPlayers)
        # Esto es único de torneos. Si no borras la lista de inscritos, no puedes borrar el torneo.
        await db.execute(
            delete(models.TournamentPlayer).where(models.TournamentPlayer.tournament_id == tournament_id)
        )

        # 3. Borrar el Torneo
        await db.execute(delete(models.Tournament).where(models.Tournament.id == tournament_id))
        await log_action(
            db, request=request, club=current_club,
            action=AuditAction.TOURNAMENT_DELETE,
            entity_type="Tournament", entity_id=tournament_id,
            meta={"name": tournament.name, "status": tournament.status},
        )
        await db.commit()

        return None # 204 No Content

    except Exception as e:
        await db.rollback()
        logger.error("Error borrando torneo %d: %s", tournament_id, e)
        raise HTTPException(status_code=500, detail=f"Error interno BD: {str(e)}")

@router.post("/{tournament_id}/players/{player_id}/toggle-paid", response_model=schemas.TournamentPlayerSchema)
async def toggle_tournament_buyin_paid(
    tournament_id: int,
    player_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """Toggle del estado de pago de la entrada del jugador en el torneo."""
    t_result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .where(models.Tournament.club_id == current_club.id)
    )
    if not t_result.scalars().first():
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    p_result = await db.execute(
        select(models.TournamentPlayer)
        .where(models.TournamentPlayer.tournament_id == tournament_id)
        .where(models.TournamentPlayer.player_id == player_id)
    )
    t_player = p_result.scalars().first()
    if not t_player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    t_player.is_buyin_paid = not (t_player.is_buyin_paid or False)
    await db.commit()
    await db.refresh(t_player)
    return t_player
