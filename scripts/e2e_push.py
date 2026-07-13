"""e2e HTTP de Web Push (/player/push/*): registra 2 clubes, invita y activa
un jugador en cada uno (el invite devuelve el código OTP en la respuesta) y
prueba config/subscribe/unsubscribe/test + roles + aislamiento entre clubes.
Requiere uvicorn en :8010 CON claves VAPID (efímeras) en el env.
Correr: venv/bin/python scripts/e2e_push.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


def club_con_jugador(c, tag, phone):
    """Registra club + jugador con cuenta PLAYER activada.
    Devuelve (headers_staff, headers_player)."""
    email = f"push_{tag}_{suffix}@test.local"
    r = c.post("/auth/register", json={
        "name": f"Club Push {tag}", "email": email,
        "password": "Push12345", "accept_terms": True})
    assert r.status_code == 201, f"register {tag}: {r.text}"
    r = c.post("/auth/login", data={"username": email, "password": "Push12345"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    p = c.post("/players/", json={"name": f"Jugador {tag}", "phone": phone,
                                  "club_id": 1}, headers=h).json()
    r = c.post(f"/players/{p['id']}/invite", json={"phone": phone}, headers=h)
    assert r.status_code == 201, f"invite {tag}: {r.text}"
    code = r.json()["code"]
    r = c.post("/players/activate", json={
        "phone": phone, "code": code, "password": "Jugador123"})
    assert r.status_code == 200, f"activate {tag}: {r.text}"
    hp = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return h, hp


EP1 = f"https://push.example.test/sub/{suffix}-1"

with httpx.Client(base_url=BASE, timeout=30) as c:
    h1, hp1 = club_con_jugador(c, "a", "3001110001")
    h2, hp2 = club_con_jugador(c, "b", "3001110002")

    # --- config: auth y rol ---
    r = c.get("/player/push/config")
    check("config sin token → 401", r.status_code == 401)
    r = c.get("/player/push/config", headers=h1)
    check("config con token OWNER → 403", r.status_code == 403)
    r = c.get("/player/push/config", headers=hp1)
    check("config PLAYER → 200", r.status_code == 200)
    cfg = r.json()
    check("config: push habilitado (claves del runner)", cfg["enabled"] is True)
    check("config: public_key presente", bool(cfg["public_key"]))

    # --- subscribe ---
    body = {"endpoint": EP1, "keys": {"p256dh": "BPk", "auth": "abc"}}
    r = c.post("/player/push/subscribe", json=body, headers=hp1)
    check("subscribe → 200 subscribed", r.status_code == 200 and r.json()["subscribed"] is True)
    r = c.post("/player/push/subscribe", json=body, headers=hp1)
    check("subscribe repetido (upsert) → 200", r.status_code == 200)
    r = c.post("/player/push/subscribe", json={
        "endpoint": "http://inseguro.test/x", "keys": {"p256dh": "p", "auth": "a"}},
        headers=hp1)
    check("subscribe endpoint http:// → 422", r.status_code == 422)
    r = c.post("/player/push/subscribe", json=body, headers=h1)
    check("subscribe como OWNER → 403", r.status_code == 403)

    # --- tenant: el jugador del club B no puede borrar la suscripción del A ---
    r = c.post("/player/push/unsubscribe", json={"endpoint": EP1}, headers=hp2)
    check("unsubscribe ajeno → no borra (false)",
          r.status_code == 200 and r.json()["unsubscribed"] is False)

    # --- test push: el endpoint fake no responde → errors, no sent ---
    # (el canal real se prueba en prod con el smoke: acá importa que el
    # endpoint exista, cargue las suscripciones propias y no explote)
    r = c.post("/player/push/test", headers=hp1)
    check("test → 200 con intento fallido contable",
          r.status_code == 200 and r.json()["errors"] >= 1 and r.json()["sent"] == 0)
    r = c.post("/player/push/test", headers=hp2)
    check("test sin suscripciones → 404", r.status_code == 404)

    # --- unsubscribe propio ---
    r = c.post("/player/push/unsubscribe", json={"endpoint": EP1}, headers=hp1)
    check("unsubscribe propio → true", r.status_code == 200 and r.json()["unsubscribed"] is True)
    r = c.post("/player/push/unsubscribe", json={"endpoint": EP1}, headers=hp1)
    check("unsubscribe repetido → false (ya no existe)",
          r.status_code == 200 and r.json()["unsubscribed"] is False)
    r = c.post("/player/push/test", headers=hp1)
    check("test tras unsubscribe → 404", r.status_code == 404)

print(f"\ne2e push: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
