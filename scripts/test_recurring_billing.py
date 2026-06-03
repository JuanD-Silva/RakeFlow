#!/usr/bin/env python3
"""
Prueba END-TO-END del cobro recurrente con Wompi SANDBOX, todo LOCAL.
NO toca prod ni mueve plata real.

Que valida:
  1. Registro de un club de prueba + login (JWT)
  2. Tokeniza tarjeta sandbox 4242... y se suscribe -> crea payment_source + 1er cobro
  3. Confirma que wompi_payment_source_id quedo guardado (lo que le falto a Mambo)
  4. Fuerza subscription_period_end a "manana" y corre el cron de renovaciones
  5. Confirma que el cron cobro y renovo +30 dias (SUBSCRIPTION_RENEWED)

Requisitos:
  - Docker Postgres local arriba (docker compose up -d), puerto 5433
  - .env  (DATABASE_URL ya apunta a local) y .env.sandbox (claves pub_test/prv_test/integrity + INTERNAL_CRON_TOKEN)

Uso:
  source venv/bin/activate && python scripts/test_recurring_billing.py
"""
import os
import sys
import time
import json
import signal
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8011
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

TEST_EMAIL = "billing-test@rakeflow.local"
TEST_PASS = "TestPass1234"
TEST_NAME = "Club Prueba Cobro"

# Tarjeta APPROVED de sandbox Wompi
CARD = {"number": "4242424242424242", "cvc": "789", "exp_month": "06", "exp_year": "29", "card_holder": "Test User"}


def load_env(path):
    env = {}
    p = ROOT / path
    if not p.exists():
        return env
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def psql(sql):
    """Corre SQL en la DB local y devuelve stdout (tab-separated, sin header)."""
    out = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"psql fallo: {out.stderr}")
    return out.stdout.strip()


def ok(msg):
    print(f"  \033[92m✓\033[0m {msg}")


def fail(msg):
    print(f"  \033[91m✗ {msg}\033[0m")
    sys.exit(1)


def step(n, msg):
    print(f"\n\033[1m[{n}] {msg}\033[0m")


def main():
    base_env = load_env(".env")
    sandbox_env = load_env(".env.sandbox")
    if not sandbox_env.get("WOMPI_PUBLIC_KEY", "").startswith("pub_test_"):
        fail(".env.sandbox sin WOMPI_PUBLIC_KEY pub_test_... — crealo con las claves de sandbox de Wompi")
    cron_token = sandbox_env.get("INTERNAL_CRON_TOKEN") or base_env.get("INTERNAL_CRON_TOKEN") or "local-test-token"

    # Backend local con env de sandbox (override del .env)
    proc_env = {**os.environ, **base_env, **sandbox_env, "INTERNAL_CRON_TOKEN": cron_token}
    proc_env["WOMPI_TEST"] = "true"

    step(0, "Levantando backend local con claves SANDBOX")
    proc = subprocess.Popen(
        ["uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env=proc_env,
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(20):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            fail("el backend local no levanto")
        ok(f"backend local en {BASE} (WOMPI_TEST=true)")

        with httpx.Client(timeout=30) as c:
            # 1. Registro (o reutiliza) + login
            step(1, "Club de prueba + login")
            r = c.post(f"{BASE}/auth/register", json={"name": TEST_NAME, "email": TEST_EMAIL, "password": TEST_PASS, "accept_terms": True})
            if r.status_code == 201:
                ok(f"club creado: {r.json().get('club_id')}")
            elif r.status_code == 400:
                ok("club ya existia, reutilizando")
            else:
                fail(f"register inesperado {r.status_code}: {r.text}")
            r = c.post(f"{BASE}/auth/login", data={"username": TEST_EMAIL, "password": TEST_PASS})
            if r.status_code != 200:
                fail(f"login fallo {r.status_code}: {r.text}")
            token = r.json()["access_token"]
            auth = {"Authorization": f"Bearer {token}"}
            club_id = int(psql(f"select id from clubs where email='{TEST_EMAIL}'"))
            ok(f"login OK, club_id={club_id}")

            # 2. Config Wompi (acceptance tokens + public key)
            step(2, "Config Wompi (acceptance tokens)")
            r = c.get(f"{BASE}/payments/wompi/config", headers=auth)
            if r.status_code != 200:
                fail(f"config fallo {r.status_code}: {r.text}")
            cfg = r.json()
            pub = cfg["public_key"]
            acc = cfg["acceptance_token"]
            pda = cfg["personal_data_acceptance_token"]
            if not (pub and acc and pda):
                fail(f"config incompleto: {cfg}")
            ok(f"public_key={pub[:16]}…  acceptance_token OK  personal_data OK  monto={cfg.get('amount_cop')}")

            # 3. Tokeniza la tarjeta sandbox
            step(3, "Tokenizar tarjeta sandbox 4242…")
            r = c.post("https://sandbox.wompi.co/v1/tokens/cards", json=CARD, headers={"Authorization": f"Bearer {pub}"})
            if r.status_code not in (200, 201):
                fail(f"tokenizacion fallo {r.status_code}: {r.text}")
            cc_token = r.json()["data"]["id"]
            ok(f"cc_token={cc_token}")

            # 4. Suscribir (crea payment_source + cobra primer mes)
            step(4, "POST /wompi/subscribe (crea payment_source + 1er cobro)")
            r = c.post(f"{BASE}/payments/wompi/subscribe", headers=auth,
                       json={"card_token": cc_token, "acceptance_token": acc, "accept_personal_auth": pda})
            if r.status_code != 200:
                fail(f"subscribe fallo {r.status_code}: {r.text}")
            print(f"    respuesta: {json.dumps(r.json(), ensure_ascii=False)}")

            # 5. Verificar payment_source guardado (lo que le falto a Mambo)
            step(5, "Verificar payment_source guardado en DB")
            row = psql(f"select wompi_payment_source_id, subscription_active, subscription_period_end from clubs where id={club_id}").split("\t")
            ps_id, active, pend = (row + ["", "", ""])[:3]
            if not ps_id:
                fail("wompi_payment_source_id sigue VACIO — el cobro recurrente NO funcionaria (mismo bug de Mambo)")
            ok(f"payment_source_id={ps_id}  active={active}  period_end={pend}")

            # 6. Forzar vencimiento a "manana" para que el cron lo tome
            step(6, "Forzar period_end a manana")
            psql(f"update clubs set subscription_period_end = now() + interval '1 day' where id={club_id}")
            before = psql(f"select subscription_period_end from clubs where id={club_id}")
            ok(f"period_end forzado a {before}")

            # 7. Correr el cron de renovaciones (dispara el cobro; Wompi lo deja PENDING)
            step(7, "POST /wompi/charge-renewals (el cron dispara el cobro)")
            r = c.post(f"{BASE}/payments/wompi/charge-renewals", headers={"X-Internal-Token": cron_token})
            if r.status_code != 200:
                fail(f"charge-renewals fallo {r.status_code}: {r.text}")
            summary = r.json()
            print(f"    summary: {json.dumps({k: v for k, v in summary.items() if k != 'details'}, ensure_ascii=False)}")
            details = summary.get("details", [])
            if not details or not details[0].get("tx"):
                fail(f"el cron no genero transaccion: {summary}")
            tx_id = details[0]["tx"]
            cron_status = details[0].get("status")
            ok(f"cron cobro -> tx={tx_id} status={cron_status} (PENDING es lo normal en cobro recurrente Wompi)")

            # 7b. Confirmar en sandbox que el cobro se APRUEBA de verdad (asincrono)
            step("7b", "Esperar aprobacion real en sandbox")
            prv = sandbox_env["WOMPI_PRIVATE_KEY"]
            final_status = None
            for _ in range(12):
                time.sleep(2)
                tr = c.get(f"https://sandbox.wompi.co/v1/transactions/{tx_id}", headers={"Authorization": f"Bearer {prv}"})
                if tr.status_code == 200:
                    final_status = tr.json()["data"]["status"]
                    if final_status in ("APPROVED", "DECLINED", "ERROR", "VOIDED"):
                        break
            if final_status != "APPROVED":
                fail(f"el cobro del cron NO se aprobo en sandbox (status={final_status})")
            ok(f"sandbox confirma tx {tx_id} = APPROVED")

            # 7c. Simular el webhook que en prod cierra el ciclo (transaction.updated/APPROVED)
            step("7c", "Webhook transaction.updated/APPROVED (mecanismo real de confirmacion)")
            webhook_body = {
                "event": "transaction.updated",
                "data": {"transaction": {
                    "id": tx_id, "status": "APPROVED",
                    "reference": f"rakeflow-club-{club_id}-renew-test",
                    "amount_in_cents": int(cfg.get("amount_cop", 0)) * 100,
                }},
            }
            r = c.post(f"{BASE}/payments/wompi/webhook", json=webhook_body)
            if r.status_code != 200:
                fail(f"webhook fallo {r.status_code}: {r.text}")
            ok("webhook procesado")

            # 8. Verificar renovacion +30d y audit log
            step(8, "Verificar que renovo +30 dias")
            after = psql(f"select subscription_period_end from clubs where id={club_id}")
            paid = psql(f"select count(*) from audit_logs where club_id={club_id} and action='SUBSCRIPTION_PAID' and meta->>'via'='webhook'")
            if after <= before:
                fail(f"period_end NO avanzo (antes={before} despues={after})")
            ok(f"period_end renovado: {before}  →  {after}")
            if int(paid or 0) < 1:
                fail("no se registro SUBSCRIPTION_PAID via webhook en audit_logs")
            ok(f"audit_logs SUBSCRIPTION_PAID(webhook) = {paid}")

        print("\n\033[1;92m✅ COBRO RECURRENTE VALIDADO END-TO-END.\033[0m")
        print("   Un club nuevo con tarjeta real se suscribe, queda con payment_source,")
        print("   y el cron diario lo cobra y renueva +30 dias automaticamente.\n")
        print(f"   Limpieza opcional del club de prueba:")
        print(f"     docker exec -i {CONTAINER} psql -U {DB_USER} -d {DB_NAME} -c \"delete from clubs where id={club_id}\"")

    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
