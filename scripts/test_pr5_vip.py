"""PR5 — estatus VIP (pilar del club por volumen). Tests unitarios de is_vip
(función pura). Correr: python scripts/test_pr5_vip.py

2026-07-21: VIP exclusivo — cupo (min(max_vips=10, top 10%)) + recencia (sin
visita en 45 días se pierde el título y se libera el cupo) + frecuencia
(mínimo 4 días de actividad en los últimos 90)."""
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import player_stats  # noqa: E402

RECENT = datetime.utcnow() - timedelta(days=1)
OLD = datetime.utcnow() - timedelta(days=73)   # el caso Orlando


def _standings(volumes, visits=None, last_seen=None, recent_visits=None):
    """Standings mínimas para is_vip. visits por defecto = 10 (pasa el piso);
    last_seen por defecto = ayer (pasa la recencia); recent_visits por defecto
    = 10 (pasa la frecuencia)."""
    if visits is None:
        visits = {pid: 10 for pid in volumes}
    if last_seen is None:
        last_seen = {pid: RECENT for pid in volumes}
    if recent_visits is None:
        recent_visits = {pid: 10 for pid in volumes}
    return {"volume": dict(volumes), "visits": dict(visits),
            "last_seen": dict(last_seen), "recent_visits": dict(recent_visits)}


passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


# 20 jugadores, volúmenes 100..2000. cupo = min(10, ceil(20*10%)) = 2.
vol20 = {i: i * 100 for i in range(1, 21)}
st = _standings(vol20)
check("#1 por volumen es VIP", player_stats.is_vip(st, 20) is True)
check("#2 (dentro del cupo) es VIP", player_stats.is_vip(st, 19) is True)
check("#3 (fuera del cupo) NO es VIP", player_stats.is_vip(st, 18) is False)
check("mediano NO es VIP", player_stats.is_vip(st, 10) is False)

# Piso de fidelidad: el mayor volumen pero con pocas visitas NO califica.
st_turista = _standings(
    {1: 9_999_999, **{i: 100 for i in range(2, 21)}},
    {1: 2, **{i: 10 for i in range(2, 21)}},
)
check("turista (top volumen, <5 visitas) NO es VIP", player_stats.is_vip(st_turista, 1) is False)
check("turista con visitas=5 justo SÍ (si hay cupo)", player_stats.is_vip(
    _standings({1: 9_999_999, **{i: 100 for i in range(2, 21)}},
               {1: 5, **{i: 10 for i in range(2, 21)}}), 1) is True)

# Club chico: sin suficientes jugadores, nadie es VIP (percentil sin sentido).
st_chico = _standings({1: 100, 2: 200, 3: 300})
check("club chico (<10 jugadores) → nadie VIP", player_stats.is_vip(st_chico, 3) is False)

# Borde exacto del gate min_players: 10 jugadores justo → sí aplica (solo el #1);
# 9 jugadores → nadie (gate no alcanzado).
st10 = _standings({i: i * 100 for i in range(1, 11)})
check("club de exactamente 10: #1 es VIP", player_stats.is_vip(st10, 10) is True)
check("club de exactamente 10: #2 NO es VIP (cupo=1)", player_stats.is_vip(st10, 9) is False)
st9 = _standings({i: i * 100 for i in range(1, 10)})
check("club de 9 (< min_players) → nadie VIP", player_stats.is_vip(st9, 9) is False)

# Bordes: sin volumen, jugador ausente, volumen 0.
check("jugador sin volumen NO es VIP", player_stats.is_vip(st, 999) is False)
check("volumen vacío NO rompe", player_stats.is_vip(_standings({}), 1) is False)
check("volumen 0 NO es VIP", player_stats.is_vip(
    _standings({1: 0, **{i: 100 for i in range(2, 21)}}), 1) is False)

# Empates: si varios comparten el volumen máximo, todos rankean #1 (competition
# ranking) y entran si hay cupo.
st_empate = _standings({i: (1000 if i <= 2 else 100) for i in range(1, 21)})
check("empate en el tope: ambos VIP", player_stats.is_vip(st_empate, 1) and player_stats.is_vip(st_empate, 2))

# ---------------------------------------------------------
# RECENCIA (caso Orlando): mucho volumen pero 73 días sin venir → pierde el VIP.
# ---------------------------------------------------------
st_orlando = _standings(
    vol20, last_seen={**{i: RECENT for i in range(1, 21)}, 20: OLD})
check("ausente 73 días (aunque #1 en volumen) NO es VIP", player_stats.is_vip(st_orlando, 20) is False)
# ...y su cupo lo hereda el siguiente en volumen que SÍ viene: con el #20 fuera,
# el #18 (antes fuera del cupo de 2) entra.
check("el ausente libera su cupo (el #3 hereda)", player_stats.is_vip(st_orlando, 18) is True)
check("44 días justo SÍ conserva el VIP", player_stats.is_vip(
    _standings(vol20, last_seen={**{i: RECENT for i in range(1, 21)},
                                 20: datetime.utcnow() - timedelta(days=44)}), 20) is True)
check("sin last_seen (nunca visto) NO es VIP", player_stats.is_vip(
    _standings(vol20, last_seen={i: RECENT for i in range(1, 20)}), 20) is False)

# ---------------------------------------------------------
# CUPO máximo: club grande (100 jugadores) → 10% daría 10, techo max_vips=10.
# Club gigante (200) → 10% daría 20 pero el techo lo corta en 10.
# ---------------------------------------------------------
vol200 = {i: i * 100 for i in range(1, 201)}
st200 = _standings(vol200)
check("club de 200: #10 por volumen es VIP (cupo=10)", player_stats.is_vip(st200, 191) is True)
check("club de 200: #11 (top 10% pero sin cupo) NO es VIP", player_stats.is_vip(st200, 190) is False)
# En el club de 200 con los 5 primeros ausentes, el cupo corre hasta el #15.
st200_aus = _standings(
    vol200, last_seen={**{i: RECENT for i in range(1, 201)},
                       **{i: OLD for i in range(196, 201)}})
check("5 ausentes arriba → el cupo corre (el #15 entra)", player_stats.is_vip(st200_aus, 186) is True)
check("5 ausentes arriba → el #16 sigue fuera", player_stats.is_vip(st200_aus, 185) is False)

# ---------------------------------------------------------
# FRECUENCIA (caso Deivi vs Sergio): última visita IGUAL de fresca, pero el que
# casi nunca viene (3 días/90d < 4) pierde el VIP; el frecuente (12) lo conserva.
# ---------------------------------------------------------
st_freq = _standings(
    vol20, recent_visits={**{i: 10 for i in range(1, 21)}, 20: 3, 19: 12})
check("infrecuente (3 días/90d, aunque #1 en volumen) NO es VIP", player_stats.is_vip(st_freq, 20) is False)
check("frecuente (12 días/90d) SÍ conserva", player_stats.is_vip(st_freq, 19) is True)
check("4 días/90d justo SÍ pasa la frecuencia", player_stats.is_vip(
    _standings(vol20, recent_visits={**{i: 10 for i in range(1, 21)}, 20: 4}), 20) is True)
# El infrecuente también libera su cupo: con el #20 en 3 días/90d, el #18 entra.
check("el infrecuente libera su cupo (el #3 hereda)", player_stats.is_vip(st_freq, 18) is True)
check("sin recent_visits (mapa vacío) NO es VIP", player_stats.is_vip(
    _standings(vol20, recent_visits={i: 10 for i in range(1, 20)}), 20) is False)

print(f"\nPR5 is_vip: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
