"""e2e HTTP del reto escalonado (lado staff): registra club, guarda un reto de 3
tramos, lo relee y prueba el rechazo de tramos no-ascendentes. Requiere uvicorn
en :8010. Correr: venv/bin/python scripts/e2e_reto_escalonado.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()
EMAIL = f"reto_{suffix}@test.local"
PASS = "Escalonado123"

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


with httpx.Client(base_url=BASE, timeout=20) as c:
    r = c.post("/auth/register", json={
        "name": "Club Reto", "email": EMAIL, "password": PASS, "accept_terms": True})
    check("registro 201", r.status_code == 201)
    r = c.post("/auth/login", data={"username": EMAIL, "password": PASS})
    check("login 200", r.status_code == 200)
    token = r.json().get("access_token")
    h = {"Authorization": f"Bearer {token}"}

    # PUT reto escalonado 35/50/70 con recompensa VIP en 2 tramos.
    payload = {
        "title": "Festival de Cash", "description": "Acumulá horas en cash",
        "metric": "horas", "target": 70,
        "tiers": [
            {"target": 35, "reward": "Bono $100.000", "reward_vip": "Bono $150.000"},
            {"target": 50, "reward": "Bono $200.000"},
            {"target": 70, "reward": "Bono $300.000", "reward_vip": "Bono $400.000"},
        ],
    }
    r = c.put("/config/monthly-challenge", json=payload, headers=h)
    check("PUT reto escalonado 200", r.status_code == 200)
    ch = r.json()["challenge"]
    check("target derivado = tramo mayor (70)", ch["target"] == 70)
    check("guardó 3 tramos", ch.get("tiers") and len(ch["tiers"]) == 3)
    check("tramo 1 conserva reward_vip", ch["tiers"][0]["reward_vip"] == "Bono $150.000")
    check("tramo 2 sin reward_vip (None)", ch["tiers"][1]["reward_vip"] is None)

    # GET relee lo mismo (JSON round-trip desde la columna).
    r = c.get("/config/monthly-challenge", headers=h)
    check("GET 200", r.status_code == 200)
    g = r.json()["challenge"]
    check("GET devuelve 3 tramos", g.get("tiers") and len(g["tiers"]) == 3)
    check("GET tramo 3 target 70", g["tiers"][2]["target"] == 70)

    # Validación: tramos NO ascendentes => 422.
    bad = dict(payload, tiers=[{"target": 50}, {"target": 35}])
    r = c.put("/config/monthly-challenge", json=bad, headers=h)
    check("tramos no ascendentes => 422", r.status_code == 422)

    # Reemplazar por meta única (tiers=None) sigue funcionando.
    r = c.put("/config/monthly-challenge", json={
        "title": "Meta simple", "metric": "visitas", "target": 4, "tiers": None}, headers=h)
    check("meta única (tiers None) 200", r.status_code == 200)
    check("meta única guarda tiers=None", r.json()["challenge"].get("tiers") is None)

print(f"\ne2e reto escalonado: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
