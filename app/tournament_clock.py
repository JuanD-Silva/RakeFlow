"""Reloj de torneo (T3): plantilla default de blinds + cálculo del estado.

El reloj es **server-authoritative**: el servidor calcula elapsed/remaining del
nivel actual y el cliente solo tickea localmente y resincroniza al pollear (mismo
patrón que el elapsed_minutes del dealer — nunca se parsea un datetime naive ni se
confía en el reloj del navegador).

Estado en el modelo Tournament:
- clock_status: STOPPED | RUNNING | PAUSED
- current_level: 1-based dentro de blind_structure
- level_started_at: cuándo arrancó a correr el nivel actual (sólo si RUNNING)
- clock_elapsed_seconds: segundos acumulados de este nivel antes de la última pausa
"""
from datetime import datetime
from typing import Optional


# Plantilla default editable: niveles de 20 min, antes desde el nivel 4, un break
# de 10 min a mitad. El director la ajusta si quiere (es sólo el punto de partida).
DEFAULT_BLIND_STRUCTURE = [
    {"level": 1, "small_blind": 100, "big_blind": 200, "ante": 0, "duration_min": 20, "is_break": False},
    {"level": 2, "small_blind": 200, "big_blind": 400, "ante": 0, "duration_min": 20, "is_break": False},
    {"level": 3, "small_blind": 300, "big_blind": 600, "ante": 0, "duration_min": 20, "is_break": False},
    {"level": 4, "small_blind": 500, "big_blind": 1000, "ante": 100, "duration_min": 20, "is_break": False},
    {"level": 5, "small_blind": 0, "big_blind": 0, "ante": 0, "duration_min": 10, "is_break": True},
    {"level": 6, "small_blind": 800, "big_blind": 1600, "ante": 200, "duration_min": 20, "is_break": False},
    {"level": 7, "small_blind": 1000, "big_blind": 2000, "ante": 300, "duration_min": 20, "is_break": False},
    {"level": 8, "small_blind": 1500, "big_blind": 3000, "ante": 400, "duration_min": 20, "is_break": False},
    {"level": 9, "small_blind": 2000, "big_blind": 4000, "ante": 500, "duration_min": 20, "is_break": False},
    {"level": 10, "small_blind": 0, "big_blind": 0, "ante": 0, "duration_min": 10, "is_break": True},
    {"level": 11, "small_blind": 3000, "big_blind": 6000, "ante": 1000, "duration_min": 20, "is_break": False},
    {"level": 12, "small_blind": 5000, "big_blind": 10000, "ante": 1000, "duration_min": 20, "is_break": False},
]


def _structure(tournament) -> list:
    return tournament.blind_structure or []


def _clamp_level(tournament, level: int) -> int:
    """Acota el nivel al rango [1, len(estructura)] (mínimo 1 aunque esté vacía)."""
    n = len(_structure(tournament))
    return min(max(1, level), n) if n else 1


def effective_level(tournament) -> int:
    """Nivel efectivo = current_level acotado a la estructura actual. Si la
    estructura se encogió por PATCH, current_level puede haber quedado fuera de
    rango; este es el nivel que realmente se muestra/usa."""
    return _clamp_level(tournament, tournament.current_level or 1)


def _due_advance(tournament, now: datetime) -> tuple:
    """Calcula el nivel y el elapsed-en-ese-nivel CONSIDERANDO el auto-avance por
    tiempo, sin mutar. Si el reloj corre y el nivel actual ya venció, "consume" su
    duración y pasa al siguiente (arrastrando el sobrante), hasta el último nivel.
    Devuelve (level_idx, elapsed_in_level)."""
    structure = _structure(tournament)
    n = len(structure)
    level_idx = _clamp_level(tournament, tournament.current_level or 1)
    elapsed = int(tournament.clock_elapsed_seconds or 0)
    if tournament.clock_status == "RUNNING" and tournament.level_started_at:
        elapsed += int((now - tournament.level_started_at).total_seconds())
    elapsed = max(0, elapsed)

    if tournament.clock_status == "RUNNING":
        while level_idx < n:
            duration = int(structure[level_idx - 1].get("duration_min", 0)) * 60
            if duration <= 0 or elapsed < duration:
                break
            elapsed -= duration
            level_idx += 1
    return level_idx, elapsed


def live_level(tournament, now: Optional[datetime] = None) -> int:
    """Nivel efectivo EN VIVO (con auto-avance por tiempo). Lo usan las ventanas de
    rebuy/addon para cerrar aunque el current_level persistido aún no se haya puesto
    al día."""
    now = now or datetime.utcnow()
    return _due_advance(tournament, now)[0]


def advance_clock_if_due(tournament, now: Optional[datetime] = None) -> bool:
    """Persiste el auto-avance: si el reloj corre y el nivel ya venció, mueve
    current_level/clock_elapsed_seconds/level_started_at al nivel en vivo. Devuelve
    True si avanzó. NO hace commit (lo hace el endpoint)."""
    now = now or datetime.utcnow()
    if tournament.clock_status != "RUNNING":
        return False
    level_idx, elapsed = _due_advance(tournament, now)
    if level_idx != _clamp_level(tournament, tournament.current_level or 1):
        tournament.current_level = level_idx
        tournament.clock_elapsed_seconds = elapsed
        tournament.level_started_at = now
        return True
    return False


def clock_state(tournament, now: Optional[datetime] = None) -> dict:
    """Estado vivo del reloj para los clientes. elapsed/remaining (y el nivel actual,
    que auto-avanza por tiempo) se calculan server-side; el cliente solo interpola
    local entre polls."""
    now = now or datetime.utcnow()
    structure = _structure(tournament)
    n = len(structure)
    level_idx, elapsed = _due_advance(tournament, now)
    current = structure[level_idx - 1] if n else None
    nxt = structure[level_idx] if level_idx < n else None

    status = tournament.clock_status or "STOPPED"
    duration_s = int((current or {}).get("duration_min", 0)) * 60
    remaining = max(0, duration_s - elapsed) if duration_s else 0

    return {
        "clock_status": status,
        "current_level": level_idx,
        "total_levels": n,
        "level": current,            # {level, small_blind, big_blind, ante, duration_min, is_break}
        "next_level": nxt,
        "elapsed_seconds": elapsed,
        "remaining_seconds": remaining,
        "level_over": bool(duration_s) and elapsed >= duration_s,
    }


# --- Mutaciones del reloj (no hacen commit; el endpoint commitea) ---

def start_clock(tournament, now: Optional[datetime] = None) -> None:
    """Arranca o reanuda el reloj. Si el torneo estaba en REGISTERING, pasa a
    RUNNING (el torneo arrancó)."""
    now = now or datetime.utcnow()
    if tournament.clock_status != "RUNNING":
        tournament.clock_status = "RUNNING"
        tournament.level_started_at = now
        if tournament.status == "REGISTERING":
            tournament.status = "RUNNING"


def pause_clock(tournament, now: Optional[datetime] = None) -> None:
    """Pausa el reloj acumulando el elapsed del nivel actual."""
    now = now or datetime.utcnow()
    if tournament.clock_status == "RUNNING":
        if tournament.level_started_at:
            tournament.clock_elapsed_seconds = int(tournament.clock_elapsed_seconds or 0) + int(
                (now - tournament.level_started_at).total_seconds()
            )
        tournament.clock_status = "PAUSED"
        tournament.level_started_at = None


def go_to_level(tournament, level: int, now: Optional[datetime] = None) -> None:
    """Salta a un nivel (acotado) y reinicia el reloj SÓLO si el nivel efectivo
    cambia. Persiste el clamp siempre (corrige el desync de current_level si la
    estructura se encogió). Mantiene RUNNING/PAUSED. Un salto en el borde (next en
    el último, prev en el primero) no resetea el reloj del nivel actual."""
    now = now or datetime.utcnow()
    base = effective_level(tournament)
    target = _clamp_level(tournament, level)
    tournament.current_level = target
    if target != base:
        tournament.clock_elapsed_seconds = 0
        tournament.level_started_at = now if tournament.clock_status == "RUNNING" else None
