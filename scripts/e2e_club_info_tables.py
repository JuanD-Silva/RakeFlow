"""e2e HTTP de las mesas abiertas en el panel del jugador
(GET /player/club-info ahora trae open_tables — misma info que /c/{token}).
Requiere uvicorn en :8010. Correr: venv/bin/python scripts/e2e_club_info_tables.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()
phone = f"32{int.from_bytes(os.urandom(4), 'big') % 10**8:08d}"

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


with httpx.Client(base_url=BASE, timeout=30) as c:
    email = f"mesa_{suffix}@test.local"
    r = c.post("/auth/register", json={"name": "Club Mesa", "email": email,
                                       "password": "Mesa12345", "accept_terms": True})
    assert r.status_code == 201, r.text
    r = c.post("/auth/login", data={"username": email, "password": "Mesa12345"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    p = c.post("/players/", json={"name": "Jugador Mesa", "phone": phone,
                                  "club_id": 1}, headers=h).json()
    r = c.post(f"/players/{p['id']}/invite", json={"phone": phone}, headers=h)
    code = r.json()["code"]
    r = c.post("/players/activate", json={"phone": phone, "code": code,
                                          "password": "Jugador123"})
    hp = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # Sin mesa: lista vacía (el front muestra "no hay mesa ahora")
    r = c.get("/player/club-info", headers=hp)
    check("club-info 200", r.status_code == 200)
    check("sin mesa: open_tables == []", r.json().get("open_tables") == [])

    # Mesa abierta con un jugador sentado
    r = c.post("/sessions/", json={"name": "Mesa VIP", "max_players": 9}, headers=h)
    sid = r.json()["id"]
    c.post("/transactions/buyin", json={"player_id": p["id"], "amount": 50000,
                                        "method": "CASH", "session_id": sid}, headers=h)
    r = c.get("/player/club-info", headers=hp)
    tables = r.json().get("open_tables") or []
    check("con mesa: 1 abierta", len(tables) == 1)
    m = tables[0] if tables else {}
    check("nombre y conteo", m.get("name") == "Mesa VIP" and m.get("players_count") == 1)
    check("puestos libres = 8", m.get("seats_available") == 8)

    # El cashout libera el cupo (misma semántica que el link público)
    c.post("/transactions/cashout", json={"player_id": p["id"], "amount": 50000,
                                          "session_id": sid}, headers=h)
    r = c.get("/player/club-info", headers=hp)
    m = (r.json().get("open_tables") or [{}])[0]
    check("tras cashout: 0 jugando", m.get("players_count") == 0)

    # Auth: sin token 401; staff 403 (endpoint del panel del jugador)
    check("sin token → 401", c.get("/player/club-info").status_code == 401)
    check("staff → 403", c.get("/player/club-info", headers=h).status_code == 403)

print(f"\ne2e club-info tables: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
