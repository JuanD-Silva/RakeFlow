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

    # Club nuevo (sin jackpot): staff ve 0; a los jugadores NO se les publica
    # una card de "🎰 $0" (los clubes que no manejan jackpot no publican nada).
    s0, pu0, pa0 = jackpots()
    check("club sin jackpot: staff 0, jugadores null",
          s0 == 0 and pu0 is None and pa0 is None)

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

    # PATCH parcial en AMBAS direcciones (blocker: el toggle borraba el anuncio)
    c.patch("/config/club-public", json={"public_announcement": "Hoy se rompe"}, headers=h)
    check("el PATCH del anuncio no reactiva el jackpot",
          c.get("/config/club-public", headers=h).json()["show_jackpot"] is False)
    c.patch("/config/club-public", json={"show_jackpot": True}, headers=h)
    cfg2 = c.get("/config/club-public", headers=h).json()
    check("el PATCH del flag NO borra el anuncio",
          cfg2["public_announcement"] == "Hoy se rompe" and cfg2["show_jackpot"] is True)
    r = c.patch("/config/club-public", json={"public_announcement": ""}, headers=h)
    check('anuncio vacío ("") sí lo limpia', r.json()["public_announcement"] is None)

    s4, pu4, pa4 = jackpots()
    check("reactivado: vuelve a las 3 vistas", pu4 == pa4 == s4 == 300000)

    # GUARD DE PAGO (blocker): el ajuste negativo debe reducir lo pagable.
    # Saldo real 300k → un pago de 400k tiene que ser rechazado (antes el guard
    # veía 500k porque ignoraba el ajuste de -200k y lo autorizaba).
    sid2 = c.post("/sessions/", json={"name": "Mesa J2"}, headers=h).json()["id"]
    c.post("/transactions/buyin", json={"player_id": p["id"], "amount": 10000,
                                        "method": "CASH", "session_id": sid2}, headers=h)
    r = c.post("/transactions/jackpot-payout", json={"player_id": p["id"], "amount": 400000,
                                                     "session_id": sid2}, headers=h)
    check("pago > saldo real (con ajuste) → rechazado", r.status_code == 400)
    r = c.post("/transactions/jackpot-payout", json={"player_id": p["id"], "amount": 100000,
                                                     "session_id": sid2}, headers=h)
    check("pago dentro del saldo real → aceptado", r.status_code in (200, 201))
    s5, pu5, pa5 = jackpots()
    check("tras pagar 100k: 200k en las 3 vistas", s5 == pu5 == pa5 == 200000)

    # NEGATIVO: el staff ve la verdad; al jugador NO se le publica
    c.post("/stats/jackpot-adjust", json={"amount": -500000, "reason": "e2e neg"}, headers=h)
    s6, pu6, pa6 = jackpots()
    check("staff ve el saldo negativo real (-300k)", s6 == -300000)
    check("jugadores NO ven negativo (null)", pu6 is None and pa6 is None)

    # CERO: un club que no maneja jackpot no publica "🎰 $0"
    c.post("/stats/jackpot-adjust", json={"amount": 300000, "reason": "e2e cero"}, headers=h)
    s7, pu7, pa7 = jackpots()
    check("saldo 0 → staff 0, jugadores null (sin card de $0)",
          s7 == 0 and pu7 is None and pa7 is None)

print(f"\ne2e jackpot público: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
