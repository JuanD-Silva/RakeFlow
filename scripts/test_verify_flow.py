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


# --- Mock de Twilio: send configurable; check aprueba SOLO "000000" ---
_send_ok = {"v": True}
pv.verify_enabled = lambda: True
async def _send(_e164): return _send_ok["v"]
async def _checkcode(_e164, code): return code.strip() == "000000"
pv.send_code = _send
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

    await engine.dispose()


asyncio.run(main())
print(f"\ntest verify flow: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
