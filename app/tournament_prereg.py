"""Pre-inscripción pública a torneos: cupo, lista de espera y apertura.

Reglas (decisión de Juan, 2026-11-06):
- El formulario público pide nombre + teléfono, sin cuenta. NO crea ficha ni
  TournamentPlayer: queda una TournamentPreregistration PENDING. El staff la
  confirma al llegar el jugador (ahí se busca/crea la ficha y se cobra con el
  flujo normal de inscripción) o la cancela.
- Cupo opcional (Tournament.max_entries). Ocupan cupo los inscritos reales
  (TournamentPlayer, cualquiera de sus estados: un eliminado ya usó su lugar) y
  las pre-inscripciones PENDING por orden de llegada. Las PENDING que no caben
  quedan en lista de espera. Nada de esto se guarda: se deriva en cada lectura,
  así una cancelación o un inscrito de más mueve la espera solo.
- Públicamente solo se expone el contador, nunca nombres ni teléfonos.
"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .phone_utils import normalize_phone

# Estados en los que el formulario público acepta pre-inscripciones. Un torneo
# ya corriendo (RUNNING) se inscribe en persona con el staff.
PREREG_OPEN_STATUSES = ("SCHEDULED", "REGISTERING")


def registration_open(tournament: models.Tournament) -> bool:
    return tournament.status in PREREG_OPEN_STATUSES and tournament.end_time is None


async def pending_preregs(db: AsyncSession, tournament_id: int) -> list:
    """PENDING en orden de llegada (el orden define cupo vs espera)."""
    return (await db.execute(
        select(models.TournamentPreregistration).where(
            models.TournamentPreregistration.tournament_id == tournament_id,
            models.TournamentPreregistration.status == "PENDING",
        ).order_by(models.TournamentPreregistration.created_at.asc(),
                   models.TournamentPreregistration.id.asc())
    )).scalars().all()


async def entered_count(db: AsyncSession, tournament_id: int) -> int:
    return (await db.execute(
        select(func.count(models.TournamentPlayer.id))
        .where(models.TournamentPlayer.tournament_id == tournament_id)
    )).scalar() or 0


def split_pending(max_entries, entered: int, pending: list) -> tuple[list, list]:
    """(en_cupo, en_espera). Sin cupo (None) todas caben."""
    if max_entries is None:
        return list(pending), []
    free = max(max_entries - entered, 0)
    return list(pending[:free]), list(pending[free:])


async def occupancy(db: AsyncSession, tournament: models.Tournament) -> dict:
    """Contador para la ficha pública y el panel del staff."""
    entered = await entered_count(db, tournament.id)
    pending = await pending_preregs(db, tournament.id)
    in_cupo, waitlist = split_pending(tournament.max_entries, entered, pending)
    return {
        "max_entries": tournament.max_entries,
        "entered": entered,
        "preregistered": len(in_cupo),
        # Lugares tomados = inscritos + pre-inscritos dentro del cupo.
        "taken": entered + len(in_cupo),
        "waitlist": len(waitlist),
        "full": tournament.max_entries is not None and entered + len(in_cupo) >= tournament.max_entries,
    }


def place_of(prereg_id: int, max_entries, entered: int, pending: list) -> dict:
    """Dónde quedó una pre-inscripción PENDING: en cupo o #N en espera."""
    _, waitlist = split_pending(max_entries, entered, pending)
    for i, p in enumerate(waitlist):
        if p.id == prereg_id:
            return {"spot": "WAITLIST", "waitlist_position": i + 1}
    return {"spot": "CUPO", "waitlist_position": None}


async def find_club_player_by_phone(db: AsyncSession, club_id: int, phone: str):
    """Ficha del club cuyo teléfono normaliza al dado. Prefiere la que tiene
    cuenta del panel (es la "oficial" de esa persona); si no, la primera ficha.
    Compara normalizados en Python: fichas viejas pueden tener el teléfono sin
    normalizar (mismo criterio que players._find_ficha_by_phone)."""
    rows = (await db.execute(
        select(models.Player).where(
            models.Player.club_id == club_id,
            models.Player.phone.isnot(None),
        ).order_by(models.Player.id.asc())
    )).scalars().all()
    matches = [p for p in rows if normalize_phone(p.phone) == phone]
    if not matches:
        return None
    with_account = [p for p in matches if p.user_id is not None]
    return (with_account or matches)[0]


async def phone_already_entered(db: AsyncSession, tournament_id: int, phone: str) -> bool:
    """¿Esa persona ya está inscrita de verdad en el torneo (TournamentPlayer)?"""
    phones = (await db.execute(
        select(models.Player.phone)
        .join(models.TournamentPlayer, models.TournamentPlayer.player_id == models.Player.id)
        .where(models.TournamentPlayer.tournament_id == tournament_id,
               models.Player.phone.isnot(None))
    )).scalars().all()
    return any(normalize_phone(p) == phone for p in phones)
