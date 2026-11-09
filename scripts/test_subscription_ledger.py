#!/usr/bin/env python3
"""Libro de pagos de suscripción — LOCAL, Wompi simulado (no toca prod ni plata).

Usado por: a mano antes de mergear cambios en app/routers/payments.py,
app/subscription_renewals.py o app/subscription_ledger.py.

Valida que ningún camino sume 30 días dos veces por el mismo pago:
  1. /wompi/confirm: aplica una vez; reusar la transacción no suma; monto
     menor al plan o moneda distinta → 400; transacción legacy (backfill) no suma.
  2. webhook: reintentos de la misma entrega suman una vez; el webhook de un
     pago ya confirmado no suma; DECLINED libera la reserva de subscribe.
  3. /wompi/subscribe: doble toque → 409; timeout al cobrar → PENDING que
     bloquea reintentos; APPROVED por polling + webhook posterior = una vez.
  4. cron: dos corridas simultáneas cobran UNA vez; el webhook del cobro del
     cron no suma; conciliación de PENDING viejo aplica y no vuelve a cobrar.

Uso: venv/bin/python scripts/test_subscription_ledger.py
"""
import asyncio
import os
import pathlib
import secrets
import subprocess
import sys
import types
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
for line in (ROOT / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
assert "localhost:5433" in os.environ.get("DATABASE_URL", ""), "DATABASE_URL debe ser la DB LOCAL"

import httpx  # noqa: E402
from app.main import app  # noqa: E402
from app import payments_wompi, subscription_renewals, models  # noqa: E402
from app import subscription_ledger as ledger  # noqa: E402
from app.routers import payments as payments_router  # noqa: E402
from app.database import AsyncSessionLocal  # noqa: E402


def psql(sql):
    out = subprocess.run(["docker", "exec", "-i", "poker_db", "psql", "-U", "poker_admin", "-d", "poker_treasury_db",
                          "-t", "-A", "-F", "\t", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0
_failed = 0


def check(cond, msg):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  \033[92m✓\033[0m {msg}")
    else:
        _failed += 1
        print(f"  \033[91m✗ {msg}\033[0m")


# ---------- Wompi simulado ----------
TXS: dict[str, dict] = {}       # transaction_id -> respuesta de get_transaction
CHARGES: list[dict] = []        # cobros pedidos a charge_payment_source
CHARGE_MODE = {"mode": "approved", "delay": 0.0}


async def fake_get_transaction(tx_id):
    return dict(TXS[tx_id])


async def fake_create_payment_source(**kw):
    return {"id": 777}


async def fake_charge(*, payment_source_id, customer_email, amount_cop, reference, recurrent=True):
    CHARGES.append({"reference": reference, "amount_cop": amount_cop})
    if CHARGE_MODE["delay"]:
        await asyncio.sleep(CHARGE_MODE["delay"])
    if CHARGE_MODE["mode"] == "timeout":
        raise httpx.ReadTimeout("simulado")
    tx_id = f"tx-{secrets.token_hex(4)}"
    final = "APPROVED" if CHARGE_MODE["mode"] in ("approved", "pending_then_approved") else CHARGE_MODE["mode"].upper()
    TXS[tx_id] = {"id": tx_id, "status": final, "reference": reference,
                  "amount_in_cents": amount_cop * 100, "currency": "COP"}
    first = "PENDING" if CHARGE_MODE["mode"] == "pending_then_approved" else final
    return {**TXS[tx_id], "status": first}


async def fast_sleep(_):
    return None


payments_wompi.get_transaction = fake_get_transaction
payments_wompi.create_payment_source = fake_create_payment_source
payments_wompi.charge_payment_source = fake_charge
payments_wompi.verify_webhook_signature = lambda raw, h: True
payments_router.asyncio = types.SimpleNamespace(sleep=fast_sleep)
from app import email_service  # noqa: E402
email_service.send_payment_succeeded_email = lambda **kw: None
email_service.send_payment_failed_email = lambda **kw: None

EMAIL = f"ledger-{secrets.token_hex(3)}@rakeflow.local"
PW = "LedgerPass2026"


def period_end(cid):
    v = psql(f"SELECT subscription_period_end FROM clubs WHERE id={cid}")
    return datetime.fromisoformat(v) if v else None


def days(a, b):
    return round((a - b).total_seconds() / 86400)


def add_tx(reference, cents=None, currency="COP", status="APPROVED"):
    tx_id = f"tx-{secrets.token_hex(4)}"
    TXS[tx_id] = {"id": tx_id, "status": status, "reference": reference,
                  "amount_in_cents": cents if cents is not None else ledger.PLAN_PRICE * 100, "currency": currency}
    return tx_id


def webhook_body(tx_id):
    return {"event": "transaction.updated", "data": {"transaction": TXS[tx_id]}}


async def main():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=30) as c:
        r = await c.post("/auth/register", json={"name": "Club Ledger", "email": EMAIL, "password": PW, "accept_terms": True})
        assert r.status_code in (200, 201), r.text
        cid = int(psql(f"SELECT id FROM clubs WHERE email='{EMAIL}'"))
        psql(f"UPDATE clubs SET is_active=true, setup_completed=true, subscription_active=false, "
             f"subscription_period_end=NULL WHERE id={cid}")
        tok = (await c.post("/auth/login", data={"username": EMAIL, "password": PW})).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        try:
            print("\n[1] /wompi/confirm")
            t1 = add_tx(f"rakeflow-club-{cid}-chk-1")
            r = await c.post("/payments/wompi/confirm", headers=h, json={"transaction_id": t1})
            pe1 = period_end(cid)
            check(r.status_code == 200 and r.json()["subscription_active"] and pe1 is not None, "primer confirm activa")
            check(days(pe1, datetime.utcnow()) == 30, "suma 30 días")
            r = await c.post("/payments/wompi/confirm", headers=h, json={"transaction_id": t1})
            check(r.status_code == 200 and r.json().get("already_applied") and period_end(cid) == pe1,
                  "reusar la MISMA transacción no suma días")
            r = await c.post("/payments/wompi/confirm", headers=h,
                             json={"transaction_id": add_tx(f"rakeflow-club-{cid}-chk-2", cents=100000)})
            check(r.status_code == 400 and period_end(cid) == pe1, "monto de $1.000 → 400, no suma")
            r = await c.post("/payments/wompi/confirm", headers=h,
                             json={"transaction_id": add_tx(f"rakeflow-club-{cid}-chk-3", currency="USD")})
            check(r.status_code == 400 and period_end(cid) == pe1, "moneda USD → 400, no suma")
            check(psql(f"SELECT count(*) FROM audit_logs WHERE club_id={cid} AND action='SUBSCRIPTION_PAYMENT_REJECTED'") == "1",
                  "el monto rechazado queda en auditoría")
            legacy_tx = add_tx(f"rakeflow-club-{cid}-old-9")
            psql(f"INSERT INTO subscription_payments (club_id, reference, provider_tx_id, kind, status) "
                 f"VALUES ({cid}, 'legacy-{legacy_tx}', '{legacy_tx}', 'legacy', 'APPROVED')")
            r = await c.post("/payments/wompi/confirm", headers=h, json={"transaction_id": legacy_tx})
            check(r.status_code == 200 and period_end(cid) == pe1, "transacción legacy (backfill) no vuelve a sumar")
            other = add_tx("rakeflow-club-999999-chk-1")
            r = await c.post("/payments/wompi/confirm", headers=h, json={"transaction_id": other})
            check(r.status_code == 400, "referencia de otro club → 400")

            print("\n[2] webhook")
            for _ in range(3):
                await c.post("/payments/wompi/webhook", json=webhook_body(t1))
            check(period_end(cid) == pe1, "3 entregas del webhook del pago ya confirmado → no suman")
            t2 = add_tx(f"rakeflow-club-{cid}-chk-4")
            for _ in range(3):
                r = await c.post("/payments/wompi/webhook", json=webhook_body(t2))
            pe2 = period_end(cid)
            check(r.status_code == 200 and days(pe2, pe1) == 30, "pago nuevo reintentado 3 veces → suma 30 días UNA vez")
            t_low = add_tx(f"rakeflow-club-{cid}-chk-5", cents=500000)
            await c.post("/payments/wompi/webhook", json=webhook_body(t_low))
            check(period_end(cid) == pe2, "webhook con monto menor al plan → no suma")

            print("\n[3] /wompi/subscribe")
            sub = {"card_token": "tok", "acceptance_token": "acc", "accept_personal_auth": "pa"}
            CHARGE_MODE.update(mode="pending_then_approved", delay=0)
            n0 = len(CHARGES)
            r = await c.post("/payments/wompi/subscribe", headers=h, json=sub)
            pe3 = period_end(cid)
            check(r.status_code == 200 and r.json()["subscription_active"] and days(pe3, pe2) == 30,
                  "subscribe APPROVED por polling suma 30 días (desde el vencimiento vigente)")
            check(len(CHARGES) == n0 + 1, "un solo cobro")
            sub_ref = CHARGES[-1]["reference"]
            sub_tx = psql(f"SELECT provider_tx_id FROM subscription_payments WHERE reference='{sub_ref}'")
            await c.post("/payments/wompi/webhook", json=webhook_body(sub_tx))
            check(period_end(cid) == pe3, "el webhook del cobro de subscribe no vuelve a sumar")

            CHARGE_MODE.update(mode="timeout")
            r = await c.post("/payments/wompi/subscribe", headers=h, json=sub)
            check(r.status_code == 200 and r.json()["wompi_status"] == "PENDING", "timeout al cobrar → PENDING (no error)")
            check(psql(f"SELECT count(*) FROM subscription_payments WHERE club_id={cid} AND kind='subscribe' AND status='PENDING'") == "1",
                  "la reserva queda PENDING")
            n1 = len(CHARGES)
            r = await c.post("/payments/wompi/subscribe", headers=h, json=sub)
            check(r.status_code == 409 and len(CHARGES) == n1, "reintento con un cobro en el aire → 409, sin cobrar")
            pend_ref = psql(f"SELECT reference FROM subscription_payments WHERE club_id={cid} AND kind='subscribe' AND status='PENDING'")
            t_dec = add_tx(pend_ref, status="DECLINED")
            await c.post("/payments/wompi/webhook", json=webhook_body(t_dec))
            check(psql(f"SELECT status FROM subscription_payments WHERE reference='{pend_ref}'") == "DECLINED",
                  "webhook DECLINED libera la reserva")
            CHARGE_MODE.update(mode="declined")
            r = await c.post("/payments/wompi/subscribe", headers=h, json=sub)
            check(r.status_code == 200 and not r.json()["subscription_active"] and period_end(cid) == pe3,
                  "tras liberar se puede reintentar; DECLINED no suma")

            print("\n[4] cron de renovaciones")
            tomorrow = datetime.utcnow() + timedelta(days=1)
            psql(f"UPDATE clubs SET subscription_period_end='{tomorrow.isoformat()}', wompi_payment_source_id='777' WHERE id={cid}")
            psql(f"DELETE FROM audit_logs WHERE club_id={cid} AND action LIKE 'SUBSCRIPTION_RENEW%'")
            CHARGE_MODE.update(mode="approved", delay=0.3)
            n2 = len(CHARGES)

            async def run():
                async with AsyncSessionLocal() as db:
                    return await subscription_renewals.run_renewals(db, plan_price_cop=ledger.PLAN_PRICE)
            s1, s2 = await asyncio.gather(run(), run())
            mine = [x for x in CHARGES[n2:] if x["reference"].startswith(f"rakeflow-club-{cid}-")]
            pe4 = period_end(cid)
            check(len(mine) == 1, f"dos corridas simultáneas → UN cobro ({len(mine)})")
            check(days(pe4, tomorrow) == 30, "renovó +30 días una vez")
            renew_tx = psql(f"SELECT provider_tx_id FROM subscription_payments WHERE club_id={cid} AND kind='renew' AND status='APPROVED'")
            await c.post("/payments/wompi/webhook", json=webhook_body(renew_tx))
            check(period_end(cid) == pe4, "el webhook del cobro del cron no vuelve a sumar")

            # Conciliación: reserva PENDING vieja cuyo cobro sí salió.
            soon = datetime.utcnow() + timedelta(days=2)
            psql(f"UPDATE clubs SET subscription_period_end='{soon.isoformat()}' WHERE id={cid}")
            key = soon.date().isoformat()
            ref = f"rakeflow-club-{cid}-renew-{key}-old"
            t_old = add_tx(ref)
            psql(f"INSERT INTO subscription_payments (club_id, reference, provider_tx_id, kind, status, period_key, created_at) "
                 f"VALUES ({cid}, '{ref}', '{t_old}', 'renew', 'PENDING', '{key}', now() - interval '3 hours')")
            CHARGE_MODE.update(delay=0)
            n3 = len(CHARGES)
            s = await run()
            mine = [x for x in CHARGES[n3:] if x["reference"].startswith(f"rakeflow-club-{cid}-")]
            check(s["reconciled"] >= 1 and days(period_end(cid), soon) == 30, "concilia el PENDING aprobado (+30)")
            check(len(mine) == 0, "y no vuelve a cobrar ese club en la misma corrida")

            # DECLINED libera el periodo para reintentar otro día.
            psql(f"DELETE FROM audit_logs WHERE club_id={cid} AND action LIKE 'SUBSCRIPTION_RENEW%'")
            psql(f"UPDATE clubs SET subscription_period_end='{tomorrow.isoformat()}' WHERE id={cid}")
            psql(f"DELETE FROM subscription_payments WHERE club_id={cid} AND kind='renew'")
            CHARGE_MODE.update(mode="declined")
            await run()
            check(psql(f"SELECT status FROM subscription_payments WHERE club_id={cid} AND kind='renew'") == "DECLINED"
                  and period_end(cid).date() == tomorrow.date(), "cobro rechazado → DECLINED, no suma")
            async with AsyncSessionLocal() as db:
                club = await db.get(models.Club, cid)
                again = await ledger.reserve(db, club, reference=f"rakeflow-club-{cid}-renew-x", kind="renew",
                                             amount_cop=1, period_key=tomorrow.date().isoformat())
            check(again is not None, "el mismo vencimiento se puede reintentar tras un DECLINED")
        finally:
            r = await c.post("/auth/login", data={"username": EMAIL, "password": PW})
            if r.status_code == 200:
                await c.delete("/me/delete-account", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
            left = psql(f"SELECT count(*) FROM clubs WHERE email='{EMAIL}'")
            if left != "0":
                print("  (limpieza manual) club de prueba sigue:", EMAIL)

    print(f"\n{_passed} ok, {_failed} fallos")
    sys.exit(1 if _failed else 0)


asyncio.run(main())
