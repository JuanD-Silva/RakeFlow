#!/usr/bin/env python3
"""E2E del detalle de sesión (GET /sessions/{id}/details) con BONO. LOCAL, no toca prod.

Casos:
  1. Jugador con bono individual: la respuesta trae `bonus` y el balance lo suma
     (misma fórmula que la mesa en vivo): (cashout + jackpot + bono) − buyin − consumo.
  2. Jugador sin bono: bonus == 0 y balance clásico.
  3. Bono de MESA (player_id NULL, tipo pizza): NO aparece ni infla a nadie.
  4. Tenant: sesión de otro club → 404.

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_details_bonus.py
"""
import os
import sys
import time
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8017
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "bono-c1@rakeflow.local"
C2_EMAIL = "bono-c2@rakeflow.local"
PW = "TestPass1234"
TAG = "BONO-"


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
    psql(f"DELETE FROM transactions WHERE session_id IN (SELECT id FROM sessions WHERE club_id IN ({ids}) AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM players WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM sessions WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")


def register(c, email):
    r = c.post(f"{BASE}/auth/register", json={"name": f"Club {email}", "email": email, "password": PW, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def seed_session(club):
    psql(f"INSERT INTO sessions (club_id, name, start_time, status) VALUES ({club}, '{TAG}mesa', now(), 'CLOSED');")
    return int(psql(f"SELECT id FROM sessions WHERE club_id={club} AND name='{TAG}mesa' ORDER BY id DESC LIMIT 1;"))


def seed_player(club, name):
    psql(f"INSERT INTO players (club_id, name) VALUES ({club}, '{name}');")
    return int(psql(f"SELECT id FROM players WHERE club_id={club} AND name='{name}' ORDER BY id DESC LIMIT 1;"))


def seed_tx(session, player, tx_type, amount):
    pid = str(player) if player is not None else "NULL"
    psql(f"INSERT INTO transactions (session_id, player_id, type, amount, timestamp) "
         f"VALUES ({session}, {pid}, '{tx_type}', {amount}, now());")


def main():
    step(0, "Backend local en :8017")
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

            step(2, "Sembrar mesa: Ana con bono, Beto sin bono, + bono de MESA (NULL)")
            sess = seed_session(c1)
            ana = seed_player(c1, f"{TAG}Ana")
            beto = seed_player(c1, f"{TAG}Beto")
            # Ana: replica el caso real de la sesión 186 + consumo
            seed_tx(sess, ana, "BUYIN", 150000)
            seed_tx(sess, ana, "CASHOUT", 400000)
            seed_tx(sess, ana, "BONUS", 50000)
            seed_tx(sess, ana, "SPEND", 21000)
            # Beto: solo compra
            seed_tx(sess, beto, "BUYIN", 200000)
            # Bono de mesa (pizza): player_id NULL, no debe tocar a nadie
            seed_tx(sess, None, "BONUS", 53000)
            ok("sembrado")

            step(3, "GET /sessions/{id}/details")
            r = c.get(f"{BASE}/sessions/{sess}/details", headers=auth1)
            check(r.status_code == 200, f"→ 200 (got {r.status_code}: {r.text[:120]})")
            players = {p["name"]: p for p in r.json()["players"]}
            a = players.get(f"{TAG}Ana")
            b = players.get(f"{TAG}Beto")
            check(a is not None and b is not None, "Ana y Beto en la respuesta")
            check(a["bonus"] == 50000, f"Ana bonus == 50000 (got {a['bonus']})")
            check(a["balance"] == 279000,
                  f"Ana balance == 400k+50k−150k−21k = 279000 (got {a['balance']})")
            check(a["spend"] == 21000, f"Ana spend == 21000 (got {a['spend']})")
            check(b["bonus"] == 0, f"Beto bonus == 0 (got {b['bonus']})")
            check(b["balance"] == -200000, f"Beto balance == −200000 (got {b['balance']})")

            step(4, "El bono de MESA no aparece ni infla a nadie")
            total_bonus = sum(p["bonus"] for p in players.values())
            check(total_bonus == 50000,
                  f"Σ bonus por jugador == 50000 (el de mesa de 53k queda fuera) (got {total_bonus})")
            check(len(players) == 2, f"solo 2 jugadores en la respuesta (got {len(players)})")

            step(5, "Tenant: sesión de otro club → 404")
            sess2 = seed_session(c2)
            r = c.get(f"{BASE}/sessions/{sess2}/details", headers=auth1)
            check(r.status_code == 404, f"club1 no ve mesa de club2 → 404 (got {r.status_code})")

            cleanup(c1, c2)
        print(f"\n\033[92m✔ {_passed} chequeos OK\033[0m")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
