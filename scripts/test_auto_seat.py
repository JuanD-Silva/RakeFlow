#!/usr/bin/env python3
"""E2E del Auto-sentar (POST /tournaments/{id}/tables/auto-seat). LOCAL, no toca prod.

Bug que cubre (2026-07-23): con muchos jugadores sin puesto y varias mesas
creadas VACÍAS, el auto-sentar llenaba UNA mesa y cortaba (las vacías eran
"reservas" que solo abría Nivelar). Ahora abre la siguiente reserva cuando
las mesas en uso se llenan y quedan ≥2 por sentar.

Casos:
  1. Arranque: 3 mesas vacías (max 9) + 20 sin puesto → 9/9/2, nadie en espera.
  2. Regla del jugador solo: mesa en uso llena + 1 sin puesto + reserva vacía →
     NO se abre la reserva; el jugador queda en espera.
  3. Sin reservas y mesas llenas: los sobrantes quedan en espera.

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_auto_seat.py
"""
import os
import sys
import time
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8020
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "aseat-c1@rakeflow.local"
PW = "TestPass1234"
TAG = "ASEAT-"


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


def cleanup(club):
    psql(f"DELETE FROM tournament_players WHERE tournament_id IN (SELECT id FROM tournaments WHERE club_id={club} AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM tournament_tables WHERE tournament_id IN (SELECT id FROM tournaments WHERE club_id={club} AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM tournaments WHERE club_id={club} AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM players WHERE club_id={club} AND name LIKE '{TAG}%';")


def seed_tournament(club, name):
    psql(f"INSERT INTO tournaments (club_id, name, status, buyin_amount) VALUES ({club}, '{name}', 'REGISTERING', 0);")
    return int(psql(f"SELECT id FROM tournaments WHERE club_id={club} AND name='{name}';"))


def seed_table(club, tid, num, max_seats=9):
    psql(f"INSERT INTO tournament_tables (club_id, tournament_id, table_number, max_seats, status) VALUES ({club}, {tid}, {num}, {max_seats}, 'OPEN');")
    return int(psql(f"SELECT id FROM tournament_tables WHERE tournament_id={tid} AND table_number={num};"))


def seed_unseated(club, tid, n, offset=0):
    for i in range(n):
        nm = f"{TAG}P{offset + i}"
        psql(f"INSERT INTO players (club_id, name) VALUES ({club}, '{nm}');")
        pid = int(psql(f"SELECT id FROM players WHERE club_id={club} AND name='{nm}';"))
        psql(f"INSERT INTO tournament_players (tournament_id, player_id, status) VALUES ({tid}, {pid}, 'ACTIVE');")


def table_counts(tid):
    rows = psql(
        "SELECT tt.table_number, COUNT(tp.id) FROM tournament_tables tt "
        f"LEFT JOIN tournament_players tp ON tp.table_id = tt.id AND tp.status='ACTIVE' "
        f"WHERE tt.tournament_id={tid} GROUP BY tt.table_number ORDER BY tt.table_number;")
    return {int(a): int(b) for a, b in (r.split("\t") for r in rows.splitlines())}


def waiting_count(tid):
    return int(psql(f"SELECT COUNT(*) FROM tournament_players WHERE tournament_id={tid} AND status='ACTIVE' AND table_id IS NULL;"))


def main():
    step(0, "Backend local en :8020")
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
            step(1, "Club + limpieza")
            r = c.post(f"{BASE}/auth/register", json={"name": "Club aseat", "email": C1_EMAIL, "password": PW, "accept_terms": True})
            if r.status_code not in (201, 400):
                fail(f"register {r.status_code}: {r.text}")
            c1 = int(psql(f"SELECT id FROM clubs WHERE email='{C1_EMAIL}'"))
            cleanup(c1)
            owner = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth = {"Authorization": f"Bearer {auth_utils.create_access_token({'sub': f'u{owner}', 'club_id': c1, 'user_id': owner, 'role': 'owner'})}"}
            ok(f"club={c1}")

            step(2, "Arranque: 3 mesas vacías + 20 sin puesto → 9/9/2, espera 0")
            tid = seed_tournament(c1, f"{TAG}Arranque")
            for n in (1, 2, 3):
                seed_table(c1, tid, n)
            seed_unseated(c1, tid, 20)
            r = c.post(f"{BASE}/tournaments/{tid}/tables/auto-seat", headers=auth)
            check(r.status_code == 200, f"auto-seat → 200 (got {r.status_code}: {r.text[:120]})")
            counts = table_counts(tid)
            check(counts == {1: 9, 2: 9, 3: 2}, f"9/9/2 fill-first (got {counts})")
            check(waiting_count(tid) == 0, f"nadie en espera (got {waiting_count(tid)})")

            step(3, "Jugador solo NO estrena reserva: mesa llena + 1 sin puesto")
            tid2 = seed_tournament(c1, f"{TAG}Solo")
            m1 = seed_table(c1, tid2, 1)
            seed_table(c1, tid2, 2)  # reserva vacía
            seed_unseated(c1, tid2, 9, offset=100)
            r = c.post(f"{BASE}/tournaments/{tid2}/tables/auto-seat", headers=auth)
            check(r.status_code == 200 and table_counts(tid2)[1] == 9, "mesa 1 llena (9)")
            seed_unseated(c1, tid2, 1, offset=200)   # llega UNO más
            r = c.post(f"{BASE}/tournaments/{tid2}/tables/auto-seat", headers=auth)
            check(r.status_code == 200, f"auto-seat → 200 (got {r.status_code})")
            counts = table_counts(tid2)
            check(counts == {1: 9, 2: 0}, f"la reserva NO se estrena por uno (got {counts})")
            check(waiting_count(tid2) == 1, f"el solitario queda en espera (got {waiting_count(tid2)})")
            # ...pero cuando llega el segundo, se abre la reserva con los DOS.
            seed_unseated(c1, tid2, 1, offset=300)
            r = c.post(f"{BASE}/tournaments/{tid2}/tables/auto-seat", headers=auth)
            counts = table_counts(tid2)
            check(r.status_code == 200 and counts == {1: 9, 2: 2}, f"con 2 esperando la reserva abre (got {counts})")
            check(waiting_count(tid2) == 0, "espera vacía")

            step(4, "Sin reservas: los que no caben quedan en espera")
            tid3 = seed_tournament(c1, f"{TAG}Lleno")
            seed_table(c1, tid3, 1, max_seats=2)
            seed_unseated(c1, tid3, 5, offset=400)
            r = c.post(f"{BASE}/tournaments/{tid3}/tables/auto-seat", headers=auth)
            counts = table_counts(tid3)
            check(r.status_code == 200 and counts == {1: 2}, f"mesa llena a su max (got {counts})")
            check(waiting_count(tid3) == 3, f"3 en espera sin dónde sentarlos (got {waiting_count(tid3)})")

            cleanup(c1)
        print(f"\n\033[92m✔ {_passed} chequeos OK\033[0m")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
