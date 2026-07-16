#!/usr/bin/env python3
"""E2E de pago por-dealer en la mesa (GET /sessions/{id}/dealer-payments +
marcar pagado ligado a la mesa). LOCAL, no toca prod.

Casos:
  1. Turno CERRADO exacto (horas × tarifa + %rake) y turno ABIERTO estimado
     (solo horas, rake 0, has_open_shift).
  2. Agregación por dealer + summary.
  3. Marcar pagado con session_id → paid/pending se actualizan.
  4. Aislamiento de pago por mesa: un payout de OTRA sesión (o NULL) NO cuenta.
  5. Tenant: sesión de otro club → 404.
  6. Autorización: PLAYER → 403.

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_session_dealer_payments.py
"""
import os
import sys
import time
import subprocess
import pathlib
from datetime import datetime, timedelta

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8016
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "dpay-c1@rakeflow.local"
C2_EMAIL = "dpay-c2@rakeflow.local"
PW = "TestPass1234"
TAG = "DPAY-"


def load_env(path):
    env = {}
    p = ROOT / path
    if not p.exists():
        return env
    for line in p.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


for k, v in load_env(".env").items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(ROOT))
from app import auth_utils  # noqa: E402


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0


def ok(m):
    global _passed
    _passed += 1
    print(f"  \033[92m✓\033[0m {m}")


def fail(m):
    print(f"  \033[91m✗ {m}\033[0m")
    sys.exit(1)


def check(cond, m):
    ok(m) if cond else fail(m)


def step(n, m):
    print(f"\n\033[1m[{n}] {m}\033[0m")


def jwt_for(uid, club, role="owner"):
    return auth_utils.create_access_token({"sub": f"u{uid}", "club_id": club, "user_id": uid, "role": role})


def cleanup(*clubs):
    ids = ",".join(str(c) for c in clubs)
    psql(f"DELETE FROM dealer_payouts WHERE club_id IN ({ids});")
    psql(f"DELETE FROM dealer_shifts WHERE club_id IN ({ids});")
    psql(f"DELETE FROM dealers WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM sessions WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")


def register(c, email):
    r = c.post(f"{BASE}/auth/register", json={"name": f"Club {email}", "email": email, "password": PW, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def seed_session(club):
    psql(f"INSERT INTO sessions (club_id, name, start_time, status) VALUES ({club}, '{TAG}mesa', now(), 'OPEN');")
    return int(psql(f"SELECT id FROM sessions WHERE club_id={club} AND name='{TAG}mesa' ORDER BY id DESC LIMIT 1;"))


def seed_dealer(club, name, rate, pct):
    psql(f"INSERT INTO dealers (club_id, name, hourly_rate_cop, rake_pct, is_active) VALUES ({club}, '{name}', {rate}, {pct}, true);")
    return int(psql(f"SELECT id FROM dealers WHERE club_id={club} AND name='{name}' ORDER BY id DESC LIMIT 1;"))


def seed_shift(club, session, dealer, start, end, declared_rake, rate, pct):
    end_sql = f"'{end.isoformat()}'" if end else "NULL"
    dr_sql = str(declared_rake) if declared_rake is not None else "NULL"
    psql(f"INSERT INTO dealer_shifts (club_id, session_id, dealer_id, start_time, end_time, declared_rake, hourly_rate_cop, rake_pct) "
         f"VALUES ({club}, {session}, {dealer}, '{start.isoformat()}', {end_sql}, {dr_sql}, {rate}, {pct});")


def main():
    step(0, "Backend local en :8016")
    proc = subprocess.Popen(
        ["./venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(25):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            fail("el backend no levantó")
        ok(f"backend en {BASE}")

        with httpx.Client(timeout=30) as c:
            step(1, "Clubs + limpieza")
            c1 = register(c, C1_EMAIL)
            c2 = register(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1, 'owner')}"}
            ok(f"club1={c1}, club2={c2}")

            step(2, "Sembrar mesa con 2 dealers: A cerrado (exacto), B abierto (estimado)")
            now = datetime.utcnow()
            sess = seed_session(c1)
            other_sess = seed_session(c1)  # segunda mesa, para probar aislamiento de pago
            a = seed_dealer(c1, f"{TAG}Ana", 10000, 5)     # 10k/h + 5% rake
            b = seed_dealer(c1, f"{TAG}Beto", 20000, 10)   # 20k/h + 10% rake
            # A: turno CERRADO de 2h, rake declarado 100000 → 2*10000 + 100000*5% = 25000
            seed_shift(c1, sess, a, now - timedelta(hours=2), now, 100000, 10000, 5)
            # B: turno ABIERTO desde hace 1h, rake NULL → 1*20000 + 0 = 20000 (estimado)
            seed_shift(c1, sess, b, now - timedelta(hours=1), None, None, 20000, 10)
            ok("sembrado")

            step(3, "GET /sessions/{id}/dealer-payments")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            check(r.status_code == 200, f"→ 200 (got {r.status_code}: {r.text[:120]})")
            data = r.json()
            check(data["session_open"] is True, "session_open == true")
            byname = {d["name"]: d for d in data["dealers"]}
            da, db_ = byname[f"{TAG}Ana"], byname[f"{TAG}Beto"]
            check(da["club_payment"] == 25000, f"Ana (cerrado) a pagar == 25000 (got {da['club_payment']})")
            check(da["has_open_shift"] is False, "Ana no tiene turno abierto")
            check(da["pending"] == 25000, f"Ana pendiente == 25000 (got {da['pending']})")
            check(db_["club_payment"] == 20000, f"Beto (abierto) estimado == 20000 solo horas (got {db_['club_payment']})")
            check(db_["has_open_shift"] is True, "Beto tiene turno abierto (estimado)")
            check(db_["rake_commission"] == 0, f"Beto rake_commission == 0 (aún no cerrado) (got {db_['rake_commission']})")
            check(data["summary"]["pending"] == 45000, f"summary pendiente == 45000 (got {data['summary']['pending']})")

            step(4, "Marcar pagado a Ana, ligado a ESTA mesa")
            r = c.post(f"{BASE}/dealers/{a}/payouts", headers=auth1, json={"amount": 25000, "method": "cash", "session_id": sess})
            check(r.status_code == 201, f"payout → 201 (got {r.status_code})")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            da = {d["name"]: d for d in r.json()["dealers"]}[f"{TAG}Ana"]
            check(da["paid"] == 25000 and da["pending"] == 0, f"Ana pagada (paid 25000, pending 0) (got paid={da['paid']}, pending={da['pending']})")

            step(5, "Aislamiento: un payout de OTRA mesa NO cuenta acá")
            r = c.post(f"{BASE}/dealers/{b}/payouts", headers=auth1, json={"amount": 20000, "method": "cash", "session_id": other_sess})
            check(r.status_code == 201, "payout de Beto en OTRA mesa → 201")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            db_ = {d["name"]: d for d in r.json()["dealers"]}[f"{TAG}Beto"]
            check(db_["paid"] == 0 and db_["pending"] == 20000,
                  f"Beto sigue pendiente en esta mesa (el pago fue en otra) (got paid={db_['paid']}, pending={db_['pending']})")

            step(6, "Tenant: sesión de otro club → 404")
            sess2 = seed_session(c2)
            r = c.get(f"{BASE}/sessions/{sess2}/dealer-payments", headers=auth1)
            check(r.status_code == 404, f"club1 no ve mesa de club2 → 404 (got {r.status_code})")

            step(7, "Autorización: PLAYER → 403")
            # require_role valida el rol REAL del usuario en la DB → hace falta un
            # user PLAYER de verdad, no el owner con un token de rol player.
            psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, phone, name) "
                 f"VALUES ({c1}, 'PLAYER', true, 'x', '570000000099', '{TAG}Player');")
            puid = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND phone='570000000099' AND role='PLAYER';"))
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments",
                      headers={"Authorization": f"Bearer {jwt_for(puid, c1, 'player')}"})
            check(r.status_code == 403, f"PLAYER → 403 (got {r.status_code})")
            psql(f"DELETE FROM users WHERE id={puid};")

            step(8, "Limpieza")
            cleanup(c1, c2)
            ok("borrado")

        print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
