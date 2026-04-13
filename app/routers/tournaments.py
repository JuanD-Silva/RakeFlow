# app/routers/tournaments.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete
from sqlalchemy.orm import selectinload
from app import models, schemas
from datetime import datetime
from pydantic import BaseModel
import logging
from ..dependencies import get_db, get_current_club

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
        start_time=datetime.utcnow()
    )

    db.add(new_tournament)
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

    # C. Calcular Costos
    total_cost = 0
    desc_parts = [f"Inscripción Torneo #{tournament.id}"]

    if registration.pay_buyin:
        total_cost += tournament.buyin_amount
    
    if registration.pay_tip:
        total_cost += tournament.dealer_tip_amount
        desc_parts.append("Staff Bonus")

    # D. Cobrar (Crear Transacción)
    if total_cost > 0:
        new_transaction = models.Transaction(
            tournament_id=tournament.id,
            session_id=None, # No hay sesión de cash
            player_id=registration.player_id,
            
            # ✅ USO CORRECTO DEL ENUM Y TIMESTAMP
            type=models.TransactionType.TOURNAMENT_ENTRY, 
            amount=total_cost,
            description=" + ".join(desc_parts),
            timestamp=datetime.utcnow() 
        )
        db.add(new_transaction)

    # E. Crear Jugador en Torneo
    new_player = models.TournamentPlayer(
        tournament_id=tournament.id,
        player_id=registration.player_id,
        status="ACTIVE",
        rebuys_count=0,
        addons_count=0,
        is_tip_paid=registration.pay_tip 
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

    # Eliminar ultima transaccion correspondiente
    tx_type = models.TransactionType.TOURNAMENT_REBUY if request.action == "rebuy" else models.TransactionType.TOURNAMENT_ADDON
    last_tx = await db.execute(
        select(models.Transaction)
        .where(models.Transaction.tournament_id == tournament_id)
        .where(models.Transaction.player_id == request.player_id)
        .where(models.Transaction.type == tx_type)
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

        # Calcular gastos de este jugador
        p_rebuys_cost = (p.rebuys_count * t.rebuy_price) + (p.double_rebuys_count * t.double_rebuy_price)
        p_addons_cost = (p.addons_count * t.addon_price) + (p.double_addons_count * t.double_addon_price)
        p_invested = t.buyin_amount + p_rebuys_cost + p_addons_cost
        
        # Sumar a totales del torneo
        total_buyins += t.buyin_amount
        total_rebuys_money += p_rebuys_cost
        total_addons_money += p_addons_cost
        total_prizes_paid += (p.prize_collected or 0)

        players_data.append({
            "player_id": p.player_id,
            "name": p_name,
            "rank": p.rank if p.rank else 999,
            "rebuys_count": p.rebuys_count + p.double_rebuys_count,
            "addons_count": p.addons_count + p.double_addons_count,
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
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
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
        await db.commit()
        
        return None # 204 No Content

    except Exception as e:
        await db.rollback()
        logger.error("Error borrando torneo %d: %s", tournament_id, e)
        raise HTTPException(status_code=500, detail=f"Error interno BD: {str(e)}")