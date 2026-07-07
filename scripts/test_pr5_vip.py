"""PR5 — estatus VIP (pilar del club por volumen). Tests unitarios de is_vip
(función pura). Correr: python scripts/test_pr5_vip.py"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import player_stats  # noqa: E402


def _standings(volumes, visits=None):
    """Standings mínimas para is_vip. visits por defecto = 10 (pasa el piso)."""
    if visits is None:
        visits = {pid: 10 for pid in volumes}
    return {"volume": dict(volumes), "visits": dict(visits)}


passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


# 20 jugadores, volúmenes 100..2000. top 10% = top 2.
vol20 = {i: i * 100 for i in range(1, 21)}
st = _standings(vol20)
check("#1 por volumen es VIP", player_stats.is_vip(st, 20) is True)
check("#2 (pct=10) es VIP", player_stats.is_vip(st, 19) is True)
check("#3 (pct=15 > 10) NO es VIP", player_stats.is_vip(st, 18) is False)
check("mediano NO es VIP", player_stats.is_vip(st, 10) is False)

# Piso de fidelidad: el mayor volumen pero con pocas visitas NO califica.
st_turista = _standings(
    {1: 9_999_999, **{i: 100 for i in range(2, 21)}},
    {1: 2, **{i: 10 for i in range(2, 21)}},
)
check("turista (top volumen, <5 visitas) NO es VIP", player_stats.is_vip(st_turista, 1) is False)
check("turista con visitas=5 justo SÍ (si es top %)", player_stats.is_vip(
    _standings({1: 9_999_999, **{i: 100 for i in range(2, 21)}},
               {1: 5, **{i: 10 for i in range(2, 21)}}), 1) is True)

# Club chico: sin suficientes jugadores, nadie es VIP (percentil sin sentido).
st_chico = _standings({1: 100, 2: 200, 3: 300})
check("club chico (<10 jugadores) → nadie VIP", player_stats.is_vip(st_chico, 3) is False)

# Borde exacto del gate min_players: 10 jugadores justo → sí aplica (solo el #1);
# 9 jugadores → nadie (gate no alcanzado).
st10 = _standings({i: i * 100 for i in range(1, 11)})
check("club de exactamente 10: #1 es VIP", player_stats.is_vip(st10, 10) is True)
check("club de exactamente 10: #2 NO es VIP (pct=20)", player_stats.is_vip(st10, 9) is False)
st9 = _standings({i: i * 100 for i in range(1, 10)})
check("club de 9 (< min_players) → nadie VIP", player_stats.is_vip(st9, 9) is False)

# Bordes: sin volumen, jugador ausente, volumen 0.
check("jugador sin volumen NO es VIP", player_stats.is_vip(st, 999) is False)
check("volumen vacío NO rompe", player_stats.is_vip(_standings({}), 1) is False)
check("volumen 0 NO es VIP", player_stats.is_vip(
    _standings({1: 0, **{i: 100 for i in range(2, 21)}}), 1) is False)

# Empates: si varios comparten el volumen máximo, todos rankean #1 (competition
# ranking) y entran si el pct del grupo cae en el top %.
st_empate = _standings({i: (1000 if i <= 2 else 100) for i in range(1, 21)})
check("empate en el tope: ambos VIP", player_stats.is_vip(st_empate, 1) and player_stats.is_vip(st_empate, 2))

print(f"\nPR5 is_vip: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
