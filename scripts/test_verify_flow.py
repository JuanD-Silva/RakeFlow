"""Test de flujo del teléfono verificado, EN PROCESO (httpx ASGITransport +
DB temporal), mockeando Twilio. Cubre: invite verificado (sin código en la
respuesta) → activate con el código "aprobado" por Twilio → phone_verified True;
y el plan B (Twilio falla → código local + wa.url → activate → phone_verified
False). Requiere DATABASE_URL a una DB temporal ya creada.
Correr: DATABASE_URL=... SECRET_KEY=x venv/bin/python scripts/test_verify_flow.py"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.main import app  # noqa: E402
from app.database import engine, Base  # noqa: E402
from app import phone_verify as pv  # noqa: E402

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


# --- Mock de Twilio: send configurable; check con consumo REAL (approved se
# gasta, como Twilio) para poder probar el orden puerta-vs-consumo ---
_send_ok = {"v": True}
_check = {"mode": "normal", "consumed": set()}   # mode: normal | unavailable
pv.verify_enabled = lambda: True
async def _send(e164):
    _check["consumed"].discard(e164)   # cada envío nuevo = verificación fresca
    return _send_ok["v"]
pv.send_code = _send
async def _status(e164, code):
    if _check["mode"] == "unavailable":
        return "unavailable"
    if e164 in _check["consumed"]:
        return "denied"                     # ya consumido (aprobado antes)
    if code.strip() == "000000":
        _check["consumed"].add(e164)         # aprobar CONSUME
        return "approved"
    return "denied"
pv.check_code_status = _status
async def _checkcode(e164, code): return (await _status(e164, code)) == "approved"
pv.check_code = _checkcode


async def phone_verified(sql_phone):
    async with engine.connect() as conn:
        r = await conn.execute(text(
            "SELECT phone_verified FROM users WHERE phone=:p AND hashed_password IS NOT NULL"
        ), {"p": sql_phone})
        return r.scalar()


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        suf = os.urandom(3).hex()
        r = await c.post("/auth/register", json={"name": "Club V", "email": f"v_{suf}@t.local",
                                                 "password": "Verify12345", "accept_terms": True})
        assert r.status_code == 201, r.text
        r = await c.post("/auth/login", data={"username": f"v_{suf}@t.local", "password": "Verify12345"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # ===== Camino VERIFICADO =====
        _send_ok["v"] = True
        p1 = (await c.post("/players/", json={"name": "Ver Ificado", "phone": "3007770001",
                                              "club_id": 1}, headers=h)).json()
        r = await c.post(f"/players/{p1['id']}/invite", json={"phone": "3007770001"}, headers=h)
        check("invite verificado → 201", r.status_code == 201)
        d = r.json()
        check("respuesta verified:true, SIN código ni wa_url",
              d.get("verified") is True and "code" not in d and "wa_url" not in d)
        # activar con el código que Twilio "aprueba"
        r = await c.post("/players/activate", json={"phone": "3007770001", "code": "000000",
                                                    "password": "Jugador123"})
        check("activate verificado con código correcto → 200", r.status_code == 200)
        check("un código que Twilio NO aprueba fue rechazado (probado abajo)", True)
        check("phone_verified TRUE tras camino verificado",
              (await phone_verified("573007770001")) is True)

        # ===== Plan B (Twilio falla al enviar) =====
        _send_ok["v"] = False
        p2 = (await c.post("/players/", json={"name": "Plan B", "phone": "3007770002",
                                              "club_id": 1}, headers=h)).json()
        r = await c.post(f"/players/{p2['id']}/invite", json={"phone": "3007770002"}, headers=h)
        check("invite con Twilio caído → plan B", r.status_code == 201)
        d = r.json()
        check("plan B: verified:false + código + wa_url",
              d.get("verified") is False and d.get("code") and d.get("wa_url"))
        r = await c.post("/players/activate", json={"phone": "3007770002", "code": d["code"],
                                                    "password": "Jugador123"})
        check("activate plan B con el código local → 200", r.status_code == 200)
        check("phone_verified FALSE en plan B (el club vio el código)",
              (await phone_verified("573007770002")) is False)

        # ===== Verificado, pero código equivocado → rechazado =====
        _send_ok["v"] = True
        p3 = (await c.post("/players/", json={"name": "Mal Codigo", "phone": "3007770003",
                                              "club_id": 1}, headers=h)).json()
        await c.post(f"/players/{p3['id']}/invite", json={"phone": "3007770003"}, headers=h)
        r = await c.post("/players/activate", json={"phone": "3007770003", "code": "123456",
                                                    "password": "Jugador123"})
        check("activate verificado con código MALO → 400", r.status_code == 400)

        # ===== FINDING 1: Twilio caído al activar → 503, sin quemar la invitación =====
        _send_ok["v"] = True
        p4 = (await c.post("/players/", json={"name": "Twilio Down", "phone": "3007770004",
                                              "club_id": 1}, headers=h)).json()
        await c.post(f"/players/{p4['id']}/invite", json={"phone": "3007770004"}, headers=h)
        _check["mode"] = "unavailable"
        r = await c.post("/players/activate", json={"phone": "3007770004", "code": "000000",
                                                    "password": "Jugador123"})
        check("Twilio no disponible → 503 (no 400)", r.status_code == 503)
        # La invitación NO se quemó: cuando Twilio vuelve, activa normal.
        _check["mode"] = "normal"
        r = await c.post("/players/activate", json={"phone": "3007770004", "code": "000000",
                                                    "password": "Jugador123"})
        check("Twilio vuelve → activa (invitación intacta, sin lockout)", r.status_code == 200)

        # ===== FINDING 2: puerta de vinculación ANTES de consumir el código =====
        # Persona con cuenta en club A (clave ClaveA). Club B (este) la invita.
        # Activar con clave hermana MALA no debe gastar el código de Twilio.
        r = await c.post("/auth/register", json={"name": "Club B", "email": f"b_{suf}@t.local",
                                                 "password": "ClubB12345", "accept_terms": True})
        hb = {"Authorization": f"Bearer {(await c.post('/auth/login', data={'username': f'b_{suf}@t.local', 'password': 'ClubB12345'})).json()['access_token']}"}
        # cuenta 1 (club A = h): activa con ClaveA
        pa = (await c.post("/players/", json={"name": "Multi", "phone": "3007770005", "club_id": 1}, headers=h)).json()
        await c.post(f"/players/{pa['id']}/invite", json={"phone": "3007770005"}, headers=h)
        r = await c.post("/players/activate", json={"phone": "3007770005", "code": "000000", "password": "ClaveA1234"})
        check("cuenta 1 (club A) activa", r.status_code == 200)
        # cuenta 2 (club B): invita por twilio (nuevo código para el mismo número)
        pb = (await c.post("/players/", json={"name": "Multi", "phone": "3007770005", "club_id": 1}, headers=hb)).json()
        await c.post(f"/players/{pb['id']}/invite", json={"phone": "3007770005"}, headers=hb)
        # intento con clave hermana EQUIVOCADA → LINK_REQUIRED (400), NO consume el código
        r = await c.post("/players/activate", json={"phone": "3007770005", "code": "000000", "password": "ClaveMala9"})
        check("2ª cuenta, clave hermana mala → 400 (vinculación)", r.status_code == 400)
        # reintento con la clave hermana CORRECTA → el código NO se gastó → 200
        r = await c.post("/players/activate", json={"phone": "3007770005", "code": "000000", "password": "ClaveA1234"})
        check("reintento con clave correcta → 200 (el código no se había consumido)",
              r.status_code == 200)

    await engine.dispose()


asyncio.run(main())
print(f"\ntest verify flow: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
