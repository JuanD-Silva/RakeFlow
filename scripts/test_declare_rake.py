#!/usr/bin/env python3
"""E2E de declarar rake en el turno ABIERTO (POST /sessions/{id}/dealer-shifts/declare-rake).
LOCAL, no toca prod.

Semántica: es el TOTAL acumulado del turno (cada declaración PISA la anterior,
no suma). Con eso el estimado de pago del dealer (dealer-payments y el dict del
turno) incluye su % del rake en vivo, no solo al cerrar.

Casos:
  1. Declarar 100k → dealer-payments estima horas + 5% de 100k (turno abierto).
  2. Re-declarar 150k → pisa (comisión del 5% de 150k, NO de 250k).
  3. Cerrar con total final 200k → pago definitivo con 200k.
  4. Sin turno abierto → 409. Rake negativo → 422.
  5. Tenant: mesa de otro club → 404.

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_declare_rake.py
"""
import os
import sys
import time
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8021
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "drake-c1@rakeflow.local"
C2_EMAIL = "drake-c2@rakeflow.local"
PW = "TestPass1234"
TAG = "DRAKE-"


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


def jwt_for(uid, club):
    return auth_utils.create_access_token({"sub": f"u{uid}", "club_id": club, "user_id": uid, "role": "owner"})


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


def main():
    step(0, "Backend local en :8021")
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
            step(1, "Clubs + mesa + dealer (10k/h + 5% rake)")
            c1 = register(c, C1_EMAIL)
            c2 = register(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1)}"}
            psql(f"INSERT INTO sessions (club_id, name, start_time, status) VALUES ({c1}, '{TAG}mesa', now(), 'OPEN');")
            sess = int(psql(f"SELECT id FROM sessions WHERE club_id={c1} AND name='{TAG}mesa';"))
            psql(f"INSERT INTO dealers (club_id, name, hourly_rate_cop, rake_pct, is_active) VALUES ({c1}, '{TAG}Ana', 10000, 5, true);")
            dealer = int(psql(f"SELECT id FROM dealers WHERE club_id={c1} AND name='{TAG}Ana';"))
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/start", headers=auth1, json={"dealer_id": dealer})
            check(r.status_code == 200, f"turno iniciado (got {r.status_code}: {r.text[:100]})")
            ok(f"club1={c1}, mesa={sess}, dealer={dealer}")

            step(2, "Declarar 100k en el turno abierto → estimado con rake")
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/declare-rake", headers=auth1, json={"declared_rake": 100000})
            check(r.status_code == 200, f"declare → 200 (got {r.status_code}: {r.text[:120]})")
            d = r.json()
            check(d["declared_rake"] == 100000, f"turno abierto con declared_rake=100000 (got {d['declared_rake']})")
            check(d["end_time"] is None, "el turno sigue ABIERTO")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            da = {x["name"]: x for x in r.json()["dealers"]}[f"{TAG}Ana"]
            check(da["has_open_shift"] is True, "dealer-payments lo ve abierto")
            check(da["rake_commission"] == 5000, f"comisión = 5% de 100k = 5000 (got {da['rake_commission']})")

            step(3, "Re-declarar 150k PISA (no suma)")
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/declare-rake", headers=auth1, json={"declared_rake": 150000})
            check(r.status_code == 200, "re-declare → 200")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            da = {x["name"]: x for x in r.json()["dealers"]}[f"{TAG}Ana"]
            check(da["rake_commission"] == 7500, f"comisión = 5% de 150k = 7500, NO 12500 (got {da['rake_commission']})")

            step(4, "Cerrar el turno con total final 200k → definitivo")
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/end", headers=auth1, json={"declared_rake": 200000})
            check(r.status_code == 200, f"end → 200 (got {r.status_code})")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            da = {x["name"]: x for x in r.json()["dealers"]}[f"{TAG}Ana"]
            check(da["rake_commission"] == 10000, f"comisión final = 5% de 200k (got {da['rake_commission']})")
            check(da["has_open_shift"] is False, "turno cerrado")
            check(da["overpaid"] == 0, f"sin sobre-pago (got {da.get('overpaid')})")

            step("4b", "Sobre-pago VISIBLE: pagar más que el devengado no se esconde")
            r = c.post(f"{BASE}/dealers/{dealer}/payouts", headers=auth1,
                       json={"amount": da["club_payment"] + 30000, "method": "cash", "session_id": sess})
            check(r.status_code == 201, f"payout mayor al devengado → 201 (got {r.status_code})")
            r = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1)
            da = {x["name"]: x for x in r.json()["dealers"]}[f"{TAG}Ana"]
            check(da["pending"] == 0 and da["overpaid"] == 30000,
                  f"overpaid=30000 expuesto, pending 0 (got pending={da['pending']}, overpaid={da['overpaid']})")

            step(5, "Guardas: sin turno abierto 409, negativo 422")
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/declare-rake", headers=auth1, json={"declared_rake": 50000})
            check(r.status_code == 409, f"sin turno abierto → 409 (got {r.status_code})")
            psql(f"INSERT INTO dealer_shifts (club_id, session_id, dealer_id, start_time, hourly_rate_cop, rake_pct) "
                 f"VALUES ({c1}, {sess}, {dealer}, now(), 10000, 5);")
            r = c.post(f"{BASE}/sessions/{sess}/dealer-shifts/declare-rake", headers=auth1, json={"declared_rake": -1})
            check(r.status_code == 422, f"rake negativo → 422 (got {r.status_code})")

            step(6, "Tenant: mesa de otro club → 404")
            psql(f"INSERT INTO sessions (club_id, name, start_time, status) VALUES ({c2}, '{TAG}ajena', now(), 'OPEN');")
            sess2 = int(psql(f"SELECT id FROM sessions WHERE club_id={c2} AND name='{TAG}ajena';"))
            r = c.post(f"{BASE}/sessions/{sess2}/dealer-shifts/declare-rake", headers=auth1, json={"declared_rake": 1000})
            check(r.status_code == 404, f"mesa del club2 con token del club1 → 404 (got {r.status_code})")

            cleanup(c1, c2)
        print(f"\n\033[92m✔ {_passed} chequeos OK\033[0m")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
