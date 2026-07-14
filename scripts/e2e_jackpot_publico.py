"""e2e del jackpot visible a jugadores: misma cifra en el widget del staff
(/stats/jackpot-global), el link público (/public/clubs/{token}/activity) y el
panel del jugador (/player/club-info), incluyendo el AJUSTE manual del dueño.
Requiere uvicorn en :8010. Correr: venv/bin/python scripts/e2e_jackpot_publico.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()
phone = f"33{int.from_bytes(os.urandom(4), 'big') % 10**8:08d}"

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


with httpx.Client(base_url=BASE, timeout=30) as c:
    email = f"jack_{suffix}@test.local"
    r = c.post("/auth/register", json={"name": "Club Jackpot", "email": email,
                                       "password": "Jack12345", "accept_terms": True})
    assert r.status_code == 201, r.text
    h = {"Authorization": f"Bearer {c.post('/auth/login', data={'username': email, 'password': 'Jack12345'}).json()['access_token']}"}

    # Jugador con cuenta (para el panel)
    p = c.post("/players/", json={"name": "Jugador J", "phone": phone, "club_id": 1}, headers=h).json()
    code = c.post(f"/players/{p['id']}/invite", json={"phone": phone}, headers=h).json()["code"]
    hp = {"Authorization": f"Bearer {c.post('/players/activate', json={'phone': phone, 'code': code, 'password': 'Jugador123'}).json()['access_token']}"}

    token = c.get("/config/club-public", headers=h).json()["public_token"]
    cfg = c.get("/config/club-public", headers=h).json()
    check("show_jackpot arranca en True (default)", cfg["show_jackpot"] is True)

    def jackpots():
        staff = c.get("/stats/jackpot-global", headers=h).json()["total_jackpot"]
        pub = c.get(f"/public/clubs/{token}/activity").json()["jackpot"]
        panel = c.get("/player/club-info", headers=hp).json()["jackpot"]
        return staff, pub, panel

    # Club nuevo: 0 en las tres vistas
    s0, pu0, pa0 = jackpots()
    check("jackpot inicial 0 en las 3 vistas", s0 == 0 and pu0 == 0 and pa0 == 0)

    # Sesión con jackpot declarado al cerrar la caja
    sid = c.post("/sessions/", json={"name": "Mesa J"}, headers=h).json()["id"]
    c.post("/transactions/buyin", json={"player_id": p["id"], "amount": 100000,
                                        "method": "CASH", "session_id": sid}, headers=h)
    c.post("/transactions/cashout", json={"player_id": p["id"], "amount": 100000,
                                          "session_id": sid}, headers=h)
    r = c.post(f"/sessions/{sid}/close", json={"declared_rake_cash": 0,
                                               "declared_jackpot_cash": 500000,
                                               "force_close": True}, headers=h)
    check("cerrar caja con jackpot 500k", r.status_code in (200, 201))
    s1, pu1, pa1 = jackpots()
    check("500k idéntico en staff/público/panel", s1 == pu1 == pa1 == 500000)

    # Ajuste manual del dueño (el bug era que el KPI del dashboard lo ignoraba)
    r = c.post("/stats/jackpot-adjust", json={"amount": -200000, "reason": "e2e"}, headers=h)
    check("ajuste -200k → 200", r.status_code == 200)
    s2, pu2, pa2 = jackpots()
    check("el ajuste se refleja en las 3 vistas (300k)", s2 == pu2 == pa2 == 300000)
    dash = c.get("/stats/dashboard", headers=h).json()
    check("KPI del dashboard también respeta el ajuste (bug arreglado)",
          dash.get("jackpot") == 300000)

    # El club puede ocultarlo: público y panel dejan de exponerlo; el staff lo sigue viendo
    r = c.patch("/config/club-public", json={"show_jackpot": False}, headers=h)
    check("apagar show_jackpot → 200", r.status_code == 200 and r.json()["show_jackpot"] is False)
    s3, pu3, pa3 = jackpots()
    check("apagado: público y panel en null; staff intacto",
          pu3 is None and pa3 is None and s3 == 300000)

    # Guardar el anuncio NO pisa el flag
    c.patch("/config/club-public", json={"public_announcement": "Hoy se rompe"}, headers=h)
    check("el PATCH del anuncio no reactiva el jackpot",
          c.get("/config/club-public", headers=h).json()["show_jackpot"] is False)

    # Reactivar
    c.patch("/config/club-public", json={"show_jackpot": True}, headers=h)
    s4, pu4, pa4 = jackpots()
    check("reactivado: vuelve a las 3 vistas", pu4 == pa4 == s4 == 300000)

print(f"\ne2e jackpot público: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
