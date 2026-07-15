"""Unit tests de app/phone_verify.py (sin DB ni red: httpx moqueado).
Correr: DATABASE_URL=... SECRET_KEY=x venv/bin/python scripts/test_phone_verify.py"""
import asyncio
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@127.0.0.1:5433/dummy")
os.environ.setdefault("SECRET_KEY", "test")
from app import phone_verify as pv  # noqa: E402

passed = failed = 0
run = asyncio.run


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


class FakeResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._p = payload
        self.text = str(payload)

    def json(self):
        return self._p


class FakeClient:
    """Doble de httpx.AsyncClient: devuelve la resp configurada y registra el POST."""
    last = {}

    def __init__(self, resp, boom=False):
        self._resp = resp
        self._boom = boom

    def __call__(self, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kw):
        FakeClient.last = {"url": url, **kw}
        if self._boom:
            raise RuntimeError("network down")
        return self._resp


def with_client(resp=None, boom=False):
    pv.httpx = SimpleNamespace(AsyncClient=FakeClient(resp, boom))


# --- helpers puros ---
check("to_e164 antepone +", pv.to_e164("573001234567") == "+573001234567")
check("to_e164 None", pv.to_e164(None) is None)
check("new_code 6 dígitos", len(pv.new_code()) == 6 and pv.new_code().isdigit())

# --- sin credenciales: deshabilitado, no llama a la red ---
pv.TWILIO_ACCOUNT_SID = None
pv.TWILIO_VERIFY_SERVICE_SID = None
check("verify_enabled False sin creds", pv.verify_enabled() is False)
check("send_code sin creds → False", run(pv.send_code("+573001234567")) is False)
ch, code = run(pv.start_invite("573001234567"))
check("start_invite sin creds → manual + código", ch == "manual" and code and len(code) == 6)

# --- con credenciales ---
pv.TWILIO_ACCOUNT_SID = "AC_test"
pv.TWILIO_AUTH_TOKEN = "tok"
pv.TWILIO_VERIFY_SERVICE_SID = "VA_test"
check("verify_enabled True con creds", pv.verify_enabled() is True)

with_client(FakeResp(201, {"status": "pending"}))
check("send_code pending → True", run(pv.send_code("+573001234567")) is True)
check("send_code usó el canal configurado", FakeClient.last["data"]["Channel"] == pv.TWILIO_VERIFY_CHANNEL)

with_client(FakeResp(201, {"status": "pending"}))
ch, code = run(pv.start_invite("573001234567"))
check("start_invite con Twilio OK → twilio, sin código local", ch == "twilio" and code is None)

with_client(FakeResp(429, {"message": "rate"}))
ch, code = run(pv.start_invite("573001234567"))
check("start_invite si Twilio falla → plan B manual", ch == "manual" and code and len(code) == 6)

with_client(boom=True)
check("send_code excepción de red → False (no rompe)", run(pv.send_code("+573001234567")) is False)

with_client(FakeResp(200, {"status": "approved"}))
check("check_code approved → True", run(pv.check_code("+573001234567", "123456")) is True)
with_client(FakeResp(200, {"status": "pending"}))
check("check_code no-approved → False", run(pv.check_code("+573001234567", "000000")) is False)

# --- match_pending ---
def u(channel, token, sent="2026-07-15"):
    from datetime import datetime
    return SimpleNamespace(verification_channel=channel, invitation_token=token,
                           invitation_sent_at=datetime.fromisoformat(sent))

# manual: compara token local, sin tocar Twilio
with_client(FakeResp(200, {"status": "denied"}))
m = run(pv.match_pending([u("manual", "482913"), u("manual", "111111")], "573001234567", "482913"))
check("match_pending manual: elige por token", m is not None and m.invitation_token == "482913")
m = run(pv.match_pending([u("manual", "482913")], "573001234567", "999999"))
check("match_pending manual código malo → None", m is None)

# twilio: valida con Twilio y toma la invitación más reciente
with_client(FakeResp(200, {"status": "approved"}))
m = run(pv.match_pending([u("twilio", None, "2026-07-10"), u("twilio", None, "2026-07-15")],
                         "573001234567", "654321"))
check("match_pending twilio approved → toma la más reciente",
      m is not None and m.invitation_sent_at.day == 15)
with_client(FakeResp(200, {"status": "pending"}))
m = run(pv.match_pending([u("twilio", None)], "573001234567", "000000"))
check("match_pending twilio código malo → None", m is None)

print(f"\ntest phone_verify: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
