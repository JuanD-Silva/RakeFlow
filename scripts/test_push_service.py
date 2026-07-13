"""Unit tests de app/push_service.py (sin DB ni red: webpush moqueado).
Cubre: no-op sin claves VAPID, envío OK, limpieza de suscripciones 404/410,
errores que NO borran, y claims frescos por envío (pywebpush los muta).
Correr: venv/bin/python scripts/test_push_service.py"""
import asyncio
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import push_service  # noqa: E402
from pywebpush import WebPushException  # noqa: E402

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


class FakeDB:
    """Registra las llamadas de limpieza (delete + commit)."""
    def __init__(self):
        self.executed = []
        self.commits = 0

    async def execute(self, stmt):
        self.executed.append(stmt)

    async def commit(self):
        self.commits += 1


def sub(i):
    return SimpleNamespace(id=i, endpoint=f"https://push.example/{i}",
                           p256dh="p", auth="a")


run = asyncio.run


# --- Sin claves VAPID: no-op total (jamás rompe al caller) ---
push_service.VAPID_PRIVATE_KEY = None
push_service.VAPID_PUBLIC_KEY = None
calls = []
push_service.webpush = lambda **kw: calls.append(kw)
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1)], {"title": "x"}))
check("sin claves: enabled False", push_service.push_enabled() is False)
check("sin claves: resultado 0/0/0", r == {"sent": 0, "gone": 0, "errors": 0})
check("sin claves: webpush NO llamado", calls == [])

# --- Con claves: envío OK a 2 suscripciones ---
push_service.VAPID_PRIVATE_KEY = "priv"
push_service.VAPID_PUBLIC_KEY = "pub"
calls = []
push_service.webpush = lambda **kw: calls.append(kw)
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1), sub(2)], {"title": "hola"}))
check("ok: sent=2", r == {"sent": 2, "gone": 0, "errors": 0})
check("ok: 2 llamadas a webpush", len(calls) == 2)
check("ok: payload JSON con title", '"title"' in calls[0]["data"] and "hola" in calls[0]["data"])
check("ok: claims dict NUEVO por envío (pywebpush lo muta)",
      calls[0]["vapid_claims"] is not calls[1]["vapid_claims"])
check("ok: sin borrados", db.executed == [] and db.commits == 0)

# --- 410 Gone: borra ESA suscripción, las demás siguen ---
def _webpush_410(**kw):
    if "/1" in kw["subscription_info"]["endpoint"]:
        raise WebPushException("gone", response=SimpleNamespace(status_code=410))

push_service.webpush = _webpush_410
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1), sub(2)], {"title": "x"}))
check("410: gone=1 sent=1", r == {"sent": 1, "gone": 1, "errors": 0})
check("410: ejecutó delete + commit", len(db.executed) == 1 and db.commits == 1)

# --- 404 también es muerte de la suscripción ---
push_service.webpush = lambda **kw: (_ for _ in ()).throw(
    WebPushException("nf", response=SimpleNamespace(status_code=404)))
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(3)], {"title": "x"}))
check("404: gone=1 y borra", r["gone"] == 1 and db.commits == 1)

# --- Error transitorio (500) NO borra la suscripción ---
push_service.webpush = lambda **kw: (_ for _ in ()).throw(
    WebPushException("boom", response=SimpleNamespace(status_code=500)))
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1)], {"title": "x"}))
check("500: errors=1 sin borrar", r == {"sent": 0, "gone": 0, "errors": 1}
      and db.executed == [] and db.commits == 0)

# --- WebPushException SIN response (p.ej. fallo de conexión) → error, no borra ---
push_service.webpush = lambda **kw: (_ for _ in ()).throw(WebPushException("conn"))
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1)], {"title": "x"}))
check("sin response: errors=1 sin borrar", r["errors"] == 1 and db.executed == [])

# --- Excepción inesperada → error, sigue con el resto ---
def _webpush_raro(**kw):
    if "/1" in kw["subscription_info"]["endpoint"]:
        raise RuntimeError("???")

push_service.webpush = _webpush_raro
db = FakeDB()
r = run(push_service.send_to_subscriptions(db, [sub(1), sub(2)], {"title": "x"}))
check("inesperada: errors=1 y el resto se envía", r == {"sent": 1, "gone": 0, "errors": 1})

# --- Lista vacía: no-op ---
r = run(push_service.send_to_subscriptions(FakeDB(), [], {"title": "x"}))
check("lista vacía: 0/0/0", r == {"sent": 0, "gone": 0, "errors": 0})

print(f"\ntest push_service: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
