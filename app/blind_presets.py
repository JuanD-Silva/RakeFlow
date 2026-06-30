"""Presets fijos de estructuras de blinds (PR3).

Vienen para todos los clubes, no requieren fila en DB (son constantes). El editor
los ofrece en el selector "Cargar plantilla" junto a las plantillas propias del
club. Estándar reusa la estructura default del reloj (tournament_clock).

Cada preset: nombre + starting_stack sugerido + estructura de niveles. Cada nivel:
{level, small_blind, big_blind, ante, duration_min, is_break}.
"""
from . import tournament_clock


def _reindex(levels: list) -> list:
    """Reindexa el campo `level` 1-based según la posición."""
    return [{**lvl, "level": i + 1} for i, lvl in enumerate(levels)]


# Estándar: la estructura default del reloj (niveles de 20 min). Punto medio.
_ESTANDAR = [dict(lvl) for lvl in tournament_clock.DEFAULT_BLIND_STRUCTURE]

# Turbo: niveles de 10 min, saltos de ciegas más agresivos, un break a mitad.
_TURBO = _reindex([
    {"small_blind": 100, "big_blind": 200, "ante": 0, "duration_min": 10, "is_break": False},
    {"small_blind": 200, "big_blind": 400, "ante": 0, "duration_min": 10, "is_break": False},
    {"small_blind": 400, "big_blind": 800, "ante": 100, "duration_min": 10, "is_break": False},
    {"small_blind": 600, "big_blind": 1200, "ante": 200, "duration_min": 10, "is_break": False},
    {"small_blind": 0, "big_blind": 0, "ante": 0, "duration_min": 5, "is_break": True},
    {"small_blind": 1000, "big_blind": 2000, "ante": 300, "duration_min": 10, "is_break": False},
    {"small_blind": 1500, "big_blind": 3000, "ante": 400, "duration_min": 10, "is_break": False},
    {"small_blind": 2500, "big_blind": 5000, "ante": 500, "duration_min": 10, "is_break": False},
    {"small_blind": 4000, "big_blind": 8000, "ante": 1000, "duration_min": 10, "is_break": False},
    {"small_blind": 6000, "big_blind": 12000, "ante": 1000, "duration_min": 10, "is_break": False},
])

# Deep: stack profundo, niveles de 30 min, saltos suaves y más niveles. Dos breaks.
_DEEP = _reindex([
    {"small_blind": 100, "big_blind": 200, "ante": 0, "duration_min": 30, "is_break": False},
    {"small_blind": 150, "big_blind": 300, "ante": 0, "duration_min": 30, "is_break": False},
    {"small_blind": 200, "big_blind": 400, "ante": 0, "duration_min": 30, "is_break": False},
    {"small_blind": 300, "big_blind": 600, "ante": 75, "duration_min": 30, "is_break": False},
    {"small_blind": 0, "big_blind": 0, "ante": 0, "duration_min": 15, "is_break": True},
    {"small_blind": 400, "big_blind": 800, "ante": 100, "duration_min": 30, "is_break": False},
    {"small_blind": 600, "big_blind": 1200, "ante": 200, "duration_min": 30, "is_break": False},
    {"small_blind": 800, "big_blind": 1600, "ante": 200, "duration_min": 30, "is_break": False},
    {"small_blind": 1000, "big_blind": 2000, "ante": 300, "duration_min": 30, "is_break": False},
    {"small_blind": 0, "big_blind": 0, "ante": 0, "duration_min": 15, "is_break": True},
    {"small_blind": 1500, "big_blind": 3000, "ante": 400, "duration_min": 30, "is_break": False},
    {"small_blind": 2000, "big_blind": 4000, "ante": 500, "duration_min": 30, "is_break": False},
    {"small_blind": 3000, "big_blind": 6000, "ante": 1000, "duration_min": 30, "is_break": False},
    {"small_blind": 4000, "big_blind": 8000, "ante": 1000, "duration_min": 30, "is_break": False},
])

# Hyper: niveles de 5 min, saltos muy agresivos. Para torneos express.
_HYPER = _reindex([
    {"small_blind": 100, "big_blind": 200, "ante": 0, "duration_min": 5, "is_break": False},
    {"small_blind": 300, "big_blind": 600, "ante": 100, "duration_min": 5, "is_break": False},
    {"small_blind": 600, "big_blind": 1200, "ante": 200, "duration_min": 5, "is_break": False},
    {"small_blind": 1000, "big_blind": 2000, "ante": 300, "duration_min": 5, "is_break": False},
    {"small_blind": 2000, "big_blind": 4000, "ante": 500, "duration_min": 5, "is_break": False},
    {"small_blind": 3000, "big_blind": 6000, "ante": 1000, "duration_min": 5, "is_break": False},
    {"small_blind": 5000, "big_blind": 10000, "ante": 1000, "duration_min": 5, "is_break": False},
    {"small_blind": 8000, "big_blind": 16000, "ante": 2000, "duration_min": 5, "is_break": False},
])


# id estable string "preset:<slug>" para distinguirlos de las plantillas guardadas
# (que tienen id entero). El front no debe poder borrarlos.
BLIND_PRESETS = [
    {"id": "preset:estandar", "name": "Estándar", "starting_stack": 20000, "blind_structure": _ESTANDAR},
    {"id": "preset:turbo", "name": "Turbo", "starting_stack": 15000, "blind_structure": _TURBO},
    {"id": "preset:deep", "name": "Deep", "starting_stack": 50000, "blind_structure": _DEEP},
    {"id": "preset:hyper", "name": "Hyper", "starting_stack": 10000, "blind_structure": _HYPER},
]
