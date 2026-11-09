#!/usr/bin/env python3
"""Hotfix de seguridad (auditoría nov-2026) — LOCAL, no toca prod.

  1. Un club NO puede registrar movimientos con un jugador de OTRO club
     (buy-in, cashout, gasto, propina, jackpot, bono, salió) → 404.
  2. /users/accept-invitation ya no acepta OTPs de JUGADOR (fuerza bruta
     contra todos los clubes a la vez) y tiene límite.
  3. Webhook de Wompi sin WOMPI_EVENTS_KEY → rechazado (antes: aceptado).
  4. /payments/activate-test sin WOMPI_TEST=true explícito → 403.
  5. Restablecer clave cambia la clave del LOGIN (antes solo clubs) y exige 8+.

Uso: python scripts/test_security_hotfix.py
"""
import os
import pathlib
import secrets
import subprocess
import sys
import time

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8024
BASE = f"http://127.0.0.1:{PORT}"


def load_env(path):
    env = {}
    p = ROOT / path
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


for k, v in load_env(".env").items():
    os.environ.setdefault(k, v)
assert "localhost:5433" in os.environ.get("DATABASE_URL", ""), "DATABASE_URL debe ser la DB LOCAL"


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", "poker_db", "psql", "-U", "poker_admin", "-d", "poker_treasury_db",
         "-t", "-A", "-F", "\t", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0


def check(cond, m):
    global _passed
    if not cond:
        print(f"  \033[91m✗ {m}\033[0m")
        sys.exit(1)
    _passed += 1
    print(f"  \033[92m✓\033[0m {m}")


EMAILS = ("sec-a@rakeflow.local", "sec-b@rakeflow.local")
PW = "OwnerPass123"


def main():
    env = {**os.environ, "WOMPI_EVENTS_KEY": "", "WOMPI_TEST": ""}
    proc = subprocess.Popen([str(ROOT / "venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1",
                             "--port", str(PORT)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    new_pw = PW
    try:
        for _ in range(25):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            check(False, "el backend no levantó")

        c = httpx.Client(base_url=BASE, timeout=30)
        tok = {}
        for i, em in enumerate(EMAILS):
            c.post("/auth/register", json={"name": f"Club Sec {i}", "email": em, "password": PW, "accept_terms": True},
                   headers={"X-Real-IP": f"203.0.113.{10 + i}"})
            psql(f"UPDATE clubs SET is_active=true, setup_completed=true, subscription_active=true WHERE email='{em}';")
            r = c.post("/auth/login", data={"username": em, "password": PW})
            tok[em] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        ha, hb = tok[EMAILS[0]], tok[EMAILS[1]]

        print("\n[1] Jugador de otro club")
        pb = c.post("/players/", headers=hb, json={"name": "Víctima Club B", "phone": "573005550001"}).json()["id"]
        pa = c.post("/players/", headers=ha, json={"name": "Jugador Club A"}).json()["id"]
        sa = c.post("/sessions/", headers=ha, json={"name": "Mesa A"}).json()["id"]
        for path in ("buyin", "cashout", "spend", "tip", "jackpot-payout", "bonus"):
            r = c.post(f"/transactions/{path}", headers=ha, json={"player_id": pb, "session_id": sa, "amount": 1000})
            check(r.status_code == 404, f"{path} con jugador del club B → 404 ({r.status_code})")
        r = c.post("/transactions/bust", headers=ha, json={"player_id": pb, "session_id": sa})
        check(r.status_code == 404, f"salió con jugador del club B → 404 ({r.status_code})")
        r = c.post("/transactions/buyin", headers=ha, json={"player_id": pa, "session_id": sa, "amount": 50000})
        check(r.status_code == 200, "con su propio jugador sigue funcionando")
        stats = c.get(f"/sessions/{sa}/players-stats", headers=ha).json()
        txt = str(stats)
        check("Víctima" not in txt and "573005550001" not in txt, "las estadísticas no muestran al jugador ajeno")
        check(psql(f"SELECT count(*) FROM transactions WHERE player_id={pb}") == "0", "no quedó ningún movimiento ajeno")

        print("\n[2] accept-invitation")
        cb = psql(f"SELECT id FROM clubs WHERE email='{EMAILS[1]}'")
        psql(f"INSERT INTO users (club_id, role, is_active, phone, name, invitation_token, invitation_expires_at, "
             f"verification_channel) VALUES ({cb}, 'PLAYER', true, '573005550002', 'SEC-pend', '424242', "
             f"now() + interval '1 day', 'manual');")
        r = c.post("/users/accept-invitation", json={"token": "424242", "password": "Atacante123", "name": "x"})
        check(r.status_code == 400, f"OTP de jugador por esta ruta → rechazado ({r.status_code})")
        check(psql("SELECT hashed_password IS NULL FROM users WHERE name='SEC-pend'") == "t", "la cuenta del jugador sigue intacta")
        codes = [c.post("/users/accept-invitation", headers={"X-Real-IP": "198.51.110.1"},
                        json={"token": secrets.token_hex(3), "password": "Atacante123", "name": "x"}).status_code
                 for _ in range(21)]
        check(codes[-1] == 429, f"probar códigos en serie → 429 al pasar 20/h ({codes[-1]})")

        print("\n[3] Webhook de Wompi sin clave")
        r = c.post("/payments/wompi/webhook", json={
            "event": "transaction.updated",
            "data": {"transaction": {"id": "fake-1", "status": "APPROVED", "reference": f"rakeflow-club-{cb}-x",
                                     "amount_in_cents": 100}},
            "signature": {"properties": [], "checksum": "x"}, "timestamp": int(time.time())})
        check(psql(f"SELECT COALESCE(plan_type,'') FROM clubs WHERE id={cb}") != "PRO" or r.status_code >= 400,
              f"evento sin firma verificable no activa el plan ({r.status_code})")
        check(psql(f"SELECT count(*) FROM audit_logs WHERE club_id={cb} AND action='SUBSCRIPTION_PAID'") == "0",
              "no quedó pago registrado")

        print("\n[4] activate-test")
        r = c.post("/payments/activate-test", headers=hb)
        check(r.status_code == 403, f"sin WOMPI_TEST=true → 403 ({r.status_code})")

        print("\n[5] Restablecer clave")
        c.post("/auth/forgot-password", json={"email": EMAILS[0]})
        token = psql(f"SELECT password_reset_token FROM clubs WHERE email='{EMAILS[0]}'")
        check(len(token) > 20, "se generó el token de reset")
        r = c.post("/auth/reset-password", json={"token": token, "new_password": "corta1"})
        check(r.status_code == 400, "clave de 6 → 400")
        r = c.post("/auth/reset-password", json={"token": token, "new_password": "NuevaClave2026"})
        check(r.status_code == 200, f"clave válida → 200 ({r.status_code})")
        new_pw = "NuevaClave2026"
        check(c.post("/auth/login", data={"username": EMAILS[0], "password": "NuevaClave2026"}).status_code == 200,
              "el login acepta la clave NUEVA (antes no)")
        check(c.post("/auth/login", data={"username": EMAILS[0], "password": PW}).status_code == 401,
              "y la VIEJA ya no sirve")
    finally:
        try:
            psql("DELETE FROM users WHERE name='SEC-pend';")
            for em in EMAILS:
                pw = new_pw if em == EMAILS[0] else PW
                r = httpx.post(f"{BASE}/auth/login", data={"username": em, "password": pw}, timeout=10)
                t = r.json().get("access_token") if r.status_code == 200 else None
                if t:
                    httpx.delete(f"{BASE}/me/delete-account", headers={"Authorization": f"Bearer {t}"}, timeout=30)
        except Exception as e:
            print("limpieza:", e)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")


if __name__ == "__main__":
    main()
