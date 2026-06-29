# app/routers/tournaments.py
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete
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
    # Verificar si ya hay un torneo corriendo
    result = await db.execute(
        select(models.Tournament)
        .where(models.Tournament.club_id == current_club.id)
        .where(models.Tournament.status.in_(["REGISTERING", "RUNNING"]))
    )
    active_tournament = result.scalars().first()
    
    if active_tournament:
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
        status="REGISTERING",
        start_time=datetime.utcnow(),
        blind_structure=blinds,
        starting_stack=tournament_data.starting_stack or 0,
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


@router.get("/{tournament_id}/clock")
async def get_tournament_clock(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Estado vivo del reloj (elapsed/remaining/nivel/blinds). Read-only."""
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    return tournament_clock.clock_state(tournament)


async def _apply_clock_action(
    db: AsyncSession, request: Request, current_club: models.Club,
    tournament_id: int, action: str,
) -> dict:
    tournament = await _get_owned_tournament(db, tournament_id, current_club.id)
    now = datetime.utcnow()
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

    # 2. Determinar precio según el tipo
    amount = 0
    desc = ""
    
    if request.type == "SINGLE":
        amount = tournament.rebuy_price
        desc = f"Rebuy Sencillo - Torneo #{tournament.id}"
    elif request.type == "DOUBLE":
        amount = tournament.double_rebuy_price
        desc = f"Rebuy Doble - Torneo #{tournament.id}"
        t_player.double_rebuys_count += 1
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

    # 4. Actualizar contador del jugador
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

    amount = 0
    desc = ""
    
    if request.type == "SINGLE":
        amount = tournament.addon_price
        desc = f"Add-on Sencillo - Torneo #{tournament.id}"
    elif request.type == "DOUBLE":
        amount = tournament.double_addon_price
        desc = f"Add-on Doble - Torneo #{tournament.id}"
        t_player.double_addons_count += 1
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
