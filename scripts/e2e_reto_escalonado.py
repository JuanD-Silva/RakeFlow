"""e2e HTTP de los retos del mes (lado staff): registra club y prueba tramos
escalonados + reemplazo en bloque de hasta 3 retos (API plural /monthly-challenges).
Requiere uvicorn en :8010. Correr: venv/bin/python scripts/e2e_reto_escalonado.py"""
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

    # PUT (bloque) con UN reto escalonado 35/50/70 con recompensa VIP en 2 tramos.
    escalonado = {
        "title": "Festival de Cash", "description": "Acumulá horas en cash",
        "metric": "horas", "target": 70,
        "tiers": [
            {"target": 35, "reward": "Bono $100.000", "reward_vip": "Bono $150.000"},
            {"target": 50, "reward": "Bono $200.000"},
            {"target": 70, "reward": "Bono $300.000", "reward_vip": "Bono $400.000"},
        ],
    }
    r = c.put("/config/monthly-challenges", json={"challenges": [escalonado]}, headers=h)
    check("PUT set con reto escalonado 200", r.status_code == 200)
    chs = r.json()["challenges"]
    check("devuelve 1 reto", len(chs) == 1)
    ch = chs[0]
    check("target derivado = tramo mayor (70)", ch["target"] == 70)
    check("guardó 3 tramos", ch.get("tiers") and len(ch["tiers"]) == 3)
    check("tramo 1 conserva reward_vip", ch["tiers"][0]["reward_vip"] == "Bono $150.000")
    check("tramo 2 sin reward_vip (None)", ch["tiers"][1]["reward_vip"] is None)

    # GET relee lo mismo (JSON round-trip desde la columna).
    r = c.get("/config/monthly-challenges", headers=h)
    check("GET 200", r.status_code == 200)
    g = r.json()["challenges"]
    check("GET devuelve 1 reto con 3 tramos", len(g) == 1 and len(g[0]["tiers"]) == 3)
    check("GET tramo 3 target 70", g[0]["tiers"][2]["target"] == 70)

    # Validación: tramos NO ascendentes => 422.
    bad = dict(escalonado, tiers=[{"target": 50}, {"target": 35}])
    r = c.put("/config/monthly-challenges", json={"challenges": [bad]}, headers=h)
    check("tramos no ascendentes => 422", r.status_code == 422)

    # --- MULTI-RETO: reemplazo en bloque de hasta 3 ---
    tres = [
        {"title": "Constancia", "metric": "visitas", "target": 8, "reward_text": "Ficha $20.000"},
        {"title": "Maratón", "metric": "horas", "target": 40, "tiers": [
            {"target": 20, "reward": "Bono $50.000"}, {"target": 40, "reward": "Bono $120.000"}]},
        {"title": "Torneante", "metric": "torneos", "target": 4, "reward_text": "Buy-in gratis"},
    ]
    r = c.put("/config/monthly-challenges", json={"challenges": tres}, headers=h)
    check("PUT 3 retos 200", r.status_code == 200)
    check("devuelve 3 retos", len(r.json()["challenges"]) == 3)
    r = c.get("/config/monthly-challenges", headers=h)
    got = r.json()["challenges"]
    check("GET devuelve 3 activos (reemplazó al escalonado)", len(got) == 3)
    check("orden estable: 1º Constancia", got[0]["title"] == "Constancia")
    check("2º reto conserva sus tramos", len(got[1].get("tiers") or []) == 2)

    # Tope de 3: un 4º => 422.
    cuatro = tres + [{"title": "De más", "metric": "visitas", "target": 2}]
    r = c.put("/config/monthly-challenges", json={"challenges": cuatro}, headers=h)
    check("4 retos => 422", r.status_code == 422)

    # Lista vacía => quita todos (equivale al DELETE).
    r = c.put("/config/monthly-challenges", json={"challenges": []}, headers=h)
    check("PUT vacío 200", r.status_code == 200)
    r = c.get("/config/monthly-challenges", headers=h)
    check("GET vacío tras limpiar", r.json()["challenges"] == [])

    # DELETE también limpia (idempotente sobre vacío).
    r = c.delete("/config/monthly-challenges", headers=h)
    check("DELETE 204", r.status_code == 204)

print(f"\ne2e retos (tramos + multi): {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
