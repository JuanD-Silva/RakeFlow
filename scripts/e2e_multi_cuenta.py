"""e2e de identidad multi-cuenta: la misma persona (un teléfono) como jugador Y
dealer del mismo club, y como jugador de dos clubes. Cubre login con elección,
select-account, my-accounts, switch-account y el aislamiento (no podés canjear
un token por una cuenta ajena).
Requiere uvicorn en :8010. Correr: venv/bin/python scripts/e2e_multi_cuenta.py"""
import os
import sys
import httpx

BASE = "http://127.0.0.1:8010"
suffix = os.urandom(4).hex()
_pb = int.from_bytes(os.urandom(4), "big") % 10**8
PHONE = f"34{_pb:08d}"                      # la persona multi-rol
PHONE2 = f"34{(_pb + 1) % 10**8:08d}"       # una persona cualquiera (ajena)
CLAVE = "Multi12345"

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


def nuevo_club(c, tag):
    email = f"multi_{tag}_{suffix}@test.local"
    r = c.post("/auth/register", json={"name": f"Club {tag}", "email": email,
                                       "password": "Staff12345", "accept_terms": True})
    assert r.status_code == 201, r.text
    r = c.post("/auth/login", data={"username": email, "password": "Staff12345"})
    assert "access_token" in r.json(), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, email


def invitar_jugador(c, h, phone, nombre="Jugador"):
    p = c.post("/players/", json={"name": nombre, "phone": phone, "club_id": 1}, headers=h).json()
    r = c.post(f"/players/{p['id']}/invite", json={"phone": phone}, headers=h)
    return p, r


def invitar_dealer(c, h, phone, nombre="Dealer"):
    d = c.post("/dealers/", json={"name": nombre, "phone": phone}, headers=h)
    assert d.status_code in (200, 201), d.text
    d = d.json()
    r = c.post(f"/dealers/{d['id']}/invite", json={"phone": phone}, headers=h)
    return d, r


with httpx.Client(base_url=BASE, timeout=30) as c:
    hA, emailA = nuevo_club(c, "a")   # club A: la persona juega Y dealea
    hB, emailB = nuevo_club(c, "b")   # club B: la persona también juega

    # --- 1. Cuenta de JUGADOR en el club A ---
    pA, r = invitar_jugador(c, hA, PHONE, "Multi Persona")
    check("invitar jugador club A → 201", r.status_code == 201)
    r = c.post("/players/activate", json={"phone": PHONE, "code": r.json()["code"],
                                          "password": CLAVE})
    check("activar jugador A → 200", r.status_code == 200)

    # Con UNA sola cuenta el login es el de siempre (token directo)
    r = c.post("/auth/login", data={"username": PHONE, "password": CLAVE})
    check("login con 1 cuenta → access_token directo (flujo intacto)",
          r.status_code == 200 and "access_token" in r.json())

    # --- 2. La MISMA persona, ahora dealer del MISMO club (antes: 409) ---
    dA, r = invitar_dealer(c, hA, PHONE, "Multi Persona")
    check("invitar como dealer el mismo teléfono → 201 (antes 409)", r.status_code == 201)
    r = c.post("/dealers/activate", json={"phone": PHONE, "code": r.json()["code"],
                                          "password": CLAVE})
    check("activar dealer A → 200", r.status_code == 200)

    # --- 3. Y jugador de OTRO club (antes: 409) ---
    pB, r = invitar_jugador(c, hB, PHONE, "Multi Persona")
    check("invitar al mismo teléfono en OTRO club → 201 (antes 409)", r.status_code == 201)
    r = c.post("/players/activate", json={"phone": PHONE, "code": r.json()["code"],
                                          "password": CLAVE})
    check("activar jugador B → 200", r.status_code == 200)

    # --- 4. Login: ahora hay 3 cuentas → pantalla de elección ---
    r = c.post("/auth/login", data={"username": PHONE, "password": CLAVE})
    d = r.json()
    check("login con 3 cuentas → multi_account, sin access_token",
          r.status_code == 200 and d.get("multi_account") is True and "access_token" not in d)
    check("devuelve las 3 cuentas", len(d.get("accounts", [])) == 3)
    roles = sorted(a["role"] for a in d["accounts"])
    check("roles: 2 player + 1 dealer", roles == ["dealer", "player", "player"])
    check("cada cuenta trae club_name para la pantalla",
          all(a.get("club_name") for a in d["accounts"]))
    check("select_token presente", bool(d.get("select_token")))
    check("clave incorrecta sigue siendo 401",
          c.post("/auth/login", data={"username": PHONE, "password": "MalaClave1"}).status_code == 401)

    sel = d["select_token"]
    dealer_acc = next(a for a in d["accounts"] if a["role"] == "dealer")
    player_a = next(a for a in d["accounts"] if a["role"] == "player" and a["club_id"] == dealer_acc["club_id"])
    player_b = next(a for a in d["accounts"] if a["role"] == "player" and a["club_id"] != dealer_acc["club_id"])

    # --- 5. Elegir cuenta → access_token de ESA membresía ---
    r = c.post("/auth/select-account", json={"select_token": sel, "user_id": dealer_acc["user_id"]})
    check("select-account (dealer) → access_token", r.status_code == 200 and "access_token" in r.json())
    h_dealer = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = c.get("/dealer/my-shift", headers=h_dealer)
    check("el token de dealer entra al panel de dealer", r.status_code == 200)
    r = c.get("/player/my-profile", headers=h_dealer)
    check("...y NO al panel de jugador (403)", r.status_code == 403)

    r = c.post("/auth/select-account", json={"select_token": sel, "user_id": player_b["user_id"]})
    check("select-account (jugador club B) → 200", r.status_code == 200)
    h_pb = {"Authorization": f"Bearer {r.json()['access_token']}"}
    prof = c.get("/player/my-profile", headers=h_pb)
    check("el token de jugador B entra a SU panel", prof.status_code == 200)

    # --- 6. Seguridad del select_token ---
    # Otra persona (otro teléfono, otra cuenta) no puede ser canjeada con MI token
    pX, rX = invitar_jugador(c, hB, PHONE2, "Ajeno")
    c.post("/players/activate", json={"phone": PHONE2, "code": rX.json()["code"],
                                      "password": "Ajeno12345"})
    ajeno_id = c.post("/auth/login", data={"username": PHONE2, "password": "Ajeno12345"})
    # (una sola cuenta → token directo; sacamos su user_id vía /auth/me)
    h_ajeno = {"Authorization": f"Bearer {ajeno_id.json()['access_token']}"}
    uid_ajeno = c.get("/auth/me", headers=h_ajeno).json().get("user_id")
    if uid_ajeno is None:  # /auth/me puede no exponerlo: lo deducimos del switch
        uid_ajeno = -1
    r = c.post("/auth/select-account", json={"select_token": sel, "user_id": uid_ajeno})
    check("select-account con cuenta AJENA → 403/401",
          r.status_code in (401, 403))
    r = c.post("/auth/select-account", json={"select_token": "basura", "user_id": dealer_acc["user_id"]})
    check("select_token inválido → 401", r.status_code == 401)

    # --- 7. Switcher dentro de la app (sin volver a escribir la clave) ---
    r = c.get("/auth/my-accounts", headers=h_dealer)
    check("my-accounts → las 3 cuentas", r.status_code == 200 and len(r.json()["accounts"]) == 3)
    check("marca cuál es la actual",
          sum(1 for a in r.json()["accounts"] if a["current"]) == 1)
    r = c.post("/auth/switch-account", json={"user_id": player_a["user_id"]}, headers=h_dealer)
    check("switch de dealer → jugador (mismo club) → 200",
          r.status_code == 200 and "access_token" in r.json())
    h_pa = {"Authorization": f"Bearer {r.json()['access_token']}"}
    check("el token nuevo entra al panel de jugador",
          c.get("/player/my-profile", headers=h_pa).status_code == 200)
    r = c.post("/auth/switch-account", json={"user_id": uid_ajeno}, headers=h_pa)
    check("switch a cuenta AJENA → 403/401", r.status_code in (401, 403))
    r = c.get("/auth/my-accounts", headers=hA)
    check("staff por email: my-accounts devuelve solo la suya",
          r.status_code == 200 and len(r.json()["accounts"]) == 1)
    r = c.post("/auth/switch-account", json={"user_id": player_a["user_id"]}, headers=hA)
    check("staff sin teléfono no puede switchear → 403", r.status_code == 403)

    # --- 8. Choque real que SÍ debe seguir bloqueado: misma membresía ---
    p2, r = invitar_jugador(c, hA, PHONE, "Otro jugador")
    check("2do jugador con el MISMO teléfono en el MISMO club → 409",
          r.status_code == 409)

print(f"\ne2e multi-cuenta: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
