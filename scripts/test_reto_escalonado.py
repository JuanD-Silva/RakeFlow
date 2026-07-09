"""Reto ESCALONADO — tests unitarios (sin DB):
 (A) validación del schema MonthlyChallengeUpsert.tiers
 (B) función pura _tiers_view (estado por tramo, barra al próximo, recompensa VIP)
Correr: python scripts/test_reto_escalonado.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pydantic import ValidationError  # noqa: E402
from app import schemas  # noqa: E402
from app.routers.player_self import _tiers_view  # noqa: E402

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


def rejects(name, **kw):
    try:
        schemas.MonthlyChallengeUpsert(**kw)
        check(name, False)
    except ValidationError:
        check(name, True)


BASE = dict(title="Festival de Cash", metric="horas", target=70)

# ---------- (A) Schema ----------
m = schemas.MonthlyChallengeUpsert(**BASE, tiers=[
    {"target": 35, "reward": "Bono $100.000", "reward_vip": "Bono $150.000"},
    {"target": 50, "reward": "Bono $200.000"},
    {"target": 70, "reward": "Bono $300.000", "reward_vip": "Bono $400.000"},
])
check("3 tramos ascendentes válidos", m.tiers is not None and len(m.tiers) == 3)
check("reward_vip opcional (tramo 2 sin VIP)", m.tiers[1].reward_vip is None)

check("tiers=None => meta única", schemas.MonthlyChallengeUpsert(**BASE, tiers=None).tiers is None)
check("tiers=[] => normalizado a None", schemas.MonthlyChallengeUpsert(**BASE, tiers=[]).tiers is None)
check("sin la clave tiers => None", schemas.MonthlyChallengeUpsert(**BASE).tiers is None)

rejects("tramos NO ascendentes", **BASE, tiers=[{"target": 50}, {"target": 35}])
rejects("tramos con metas iguales", **BASE, tiers=[{"target": 35}, {"target": 35}])
rejects("6 tramos (> máx 5)", **BASE, tiers=[{"target": t} for t in (10, 20, 30, 40, 50, 60)])
rejects("meta de tramo > 1000", **BASE, tiers=[{"target": 1001}])
rejects("meta de tramo = 0", **BASE, tiers=[{"target": 0}])
check("exactamente 5 tramos OK", len(schemas.MonthlyChallengeUpsert(
    **BASE, tiers=[{"target": t} for t in (10, 20, 30, 40, 50)]).tiers) == 5)

# ---------- (B) _tiers_view ----------
TIERS = [
    {"target": 35, "reward": "b35", "reward_vip": "v35"},
    {"target": 50, "reward": "b50"},                       # sin VIP
    {"target": 70, "reward": "b70", "reward_vip": "v70"},
]

# Nadie cumplido: barra al primer tramo, 0 completados.
v = _tiers_view(TIERS, current=28, vip=False)
check("28h: barra al tramo 1 (35)", v["progress"]["target"] == 35)
check("28h: 0 completados", v["progress"]["completed"] == 0)
check("28h: reto no logrado", v["progress"]["done"] is False)
check("28h: ningún tramo done", all(t["done"] is False for t in v["tiers"]))
check("28h no-VIP: recompensa base tramo 1", v["tiers"][0]["reward"] == "b35")

# VIP ve reward_vip donde exista, base donde no.
vv = _tiers_view(TIERS, current=28, vip=True)
check("28h VIP: tramo 1 => v35", vv["tiers"][0]["reward"] == "v35")
check("28h VIP: tramo 2 sin VIP => base b50", vv["tiers"][1]["reward"] == "b50")
check("28h VIP: tramo 3 => v70", vv["tiers"][2]["reward"] == "v70")

# A mitad de camino: 2 tramos cumplidos, barra al tercero.
v2 = _tiers_view(TIERS, current=52, vip=False)
check("52h: 2 completados", v2["progress"]["completed"] == 2)
check("52h: barra al tramo 3 (70)", v2["progress"]["target"] == 70)
check("52h: no logrado (falta el 3)", v2["progress"]["done"] is False)
check("52h: tramo1 y 2 done, 3 no",
      v2["tiers"][0]["done"] and v2["tiers"][1]["done"] and not v2["tiers"][2]["done"])

# Justo en el tope y por encima: todo cumplido.
v3 = _tiers_view(TIERS, current=70, vip=False)
check("70h: todos completados", v3["progress"]["completed"] == 3)
check("70h: reto logrado", v3["progress"]["done"] is True)
check("70h: barra queda en el tope (70)", v3["progress"]["target"] == 70)
check("100h: sigue logrado", _tiers_view(TIERS, current=100, vip=False)["progress"]["done"] is True)

# Borde: lista vacía no rompe.
ve = _tiers_view([], current=10, vip=False)
check("tiers vacío: no logrado", ve["progress"]["done"] is False)
check("tiers vacío: target 0", ve["progress"]["target"] == 0)
check("tiers vacío: 0 tramos", ve["tiers"] == [])

print(f"\nReto escalonado: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
