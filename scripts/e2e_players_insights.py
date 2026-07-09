"""e2e HTTP del CRM del directorio (GET /players/insights): registra un club,
mueve plata en una mesa y verifica recencia/volumen/rake_est/neto por jugador +
gate de auth + aislamiento de tenant. Requiere uvicorn en :8010.
Correr: venv/bin/python scripts/e2e_players_insights.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()
PASS = "Insights123"

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


def register_login(c, name, email):
    r = c.post("/auth/register", json={
        "name": name, "email": email, "password": PASS, "accept_terms": True})
    check(f"registro {name} 201", r.status_code == 201)
    r = c.post("/auth/login", data={"username": email, "password": PASS})
    check(f"login {name} 200", r.status_code == 200)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


with httpx.Client(base_url=BASE, timeout=20) as c:
    h = register_login(c, "Club CRM", f"crm_{suffix}@test.local")

    # Sin auth => 401 (el insights es información financiera de clientes).
    r = c.get("/players/insights")
    check("insights sin token => 401", r.status_code == 401)

    # Jugadores: ganador, perdedor y uno sin actividad.
    p1 = c.post("/players/", json={"name": "Gana Torres", "phone": "3001234567", "club_id": 1}, headers=h).json()
    p2 = c.post("/players/", json={"name": "Pierde Pérez", "club_id": 1}, headers=h).json()
    p3 = c.post("/players/", json={"name": "Nunca Vino", "club_id": 1}, headers=h).json()
    check("3 jugadores creados", all(x.get("id") for x in (p1, p2, p3)))

    # Mesa: p1 compra 100k y cobra 250k (retira); p2 compra 300k y cobra 100k
    # (deja). Cierre con rake 40k + jackpot 10k => cuadre 400k in / 400k out.
    sid = c.post("/sessions/", json={}, headers=h).json()["id"]
    for pid, amt in ((p1["id"], 100000), (p2["id"], 300000)):
        r = c.post("/transactions/buyin", json={"player_id": pid, "amount": amt, "method": "CASH", "session_id": sid}, headers=h)
        check(f"buyin {amt} 200", r.status_code == 200)
    for pid, amt in ((p1["id"], 250000), (p2["id"], 100000)):
        r = c.post("/transactions/cashout", json={"player_id": pid, "amount": amt, "session_id": sid}, headers=h)
        check(f"cashout {amt} 200", r.status_code == 200)
    r = c.post(f"/sessions/{sid}/close", json={
        "declared_rake_cash": 40000, "declared_jackpot_cash": 10000, "force_close": True}, headers=h)
    check("cierre de mesa 200", r.status_code == 200)

    # Insights: yield = 40k/400k = 10% y por jugador recencia/volumen/rake/neto.
    r = c.get("/players/insights", headers=h)
    check("GET insights 200", r.status_code == 200)
    d = r.json()
    check("yield 10%", abs(d["yield_pct"] - 10.0) < 0.2)
    i1 = d["players"].get(str(p1["id"]))
    i2 = d["players"].get(str(p2["id"]))
    check("p1 presente", i1 is not None)
    check("p2 presente", i2 is not None)
    check("p3 (sin actividad) ausente", str(p3["id"]) not in d["players"])
    if i1 and i2:
        check("p1 volumen 100k", i1["volume"] == 100000)
        check("p2 volumen 300k", i2["volume"] == 300000)
        check("p1 rake_est 10k", abs(i1["rake_est"] - 10000) <= 100)
        check("p2 rake_est 30k", abs(i2["rake_est"] - 30000) <= 100)
        check("p1 neto +150k (retira)", i1["net"] == 150000)
        check("p2 neto -200k (deja)", i2["net"] == -200000)
        check("p1 visitas 1", i1["visits"] == 1)
        check("p1 vino hoy (days_inactive 0)", i1["days_inactive"] == 0)
        check("p1 last_visit presente", bool(i1["last_visit"]))

    # --- FICHA 360: GET /players/{id}/insights ---
    r = c.get(f"/players/{p1['id']}/insights", headers=h)
    check("ficha p1 200", r.status_code == 200)
    f1 = r.json()
    ft = f1["totals"]
    check("ficha visitas 1", ft["visits"] == 1)
    check("ficha invested 100k", ft["invested"] == 100000)
    check("ficha returned 250k", ft["returned"] == 250000)
    check("ficha net +150k", ft["net"] == 150000)
    check("ficha rake_est 10k", abs(ft["rake_est"] - 10000) <= 100)
    check("ficha cliente desde hoy", ft["first_visit"] == ft["last_visit"] and ft["days_inactive"] == 0)
    check("ficha monthly 6 meses", len(f1["monthly"]) == 6)
    check("ficha mes actual 1 visita", f1["monthly"][-1]["visits"] == 1)
    check("ficha recent 1 jugada", len(f1["recent"]) == 1 and f1["recent"][0]["kind"] == "cash")
    check("ficha recent net +150k", f1["recent"][0]["net"] == 150000)
    r = c.get(f"/players/{p3['id']}/insights", headers=h)
    check("ficha sin actividad 200 + ceros", r.status_code == 200 and r.json()["totals"]["visits"] == 0)
    r = c.get(f"/players/{p1['id']}/insights")
    check("ficha sin token => 401", r.status_code == 401)

    # Tenant: otro club NO ve nada de este.
    h2 = register_login(c, "Club Ajeno", f"ajeno_{suffix}@test.local")
    r = c.get("/players/insights", headers=h2)
    check("tenant: club ajeno insights 200", r.status_code == 200)
    d2 = r.json()
    check("tenant: sin jugadores del otro club", d2["players"] == {})
    check("tenant: yield 0 sin volumen", d2["yield_pct"] == 0)
    r = c.get(f"/players/{p1['id']}/insights", headers=h2)
    check("tenant: ficha de jugador ajeno => 404", r.status_code == 404)

print(f"\ne2e players insights: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
