#!/usr/bin/env python3
"""E2E del sorteo de sillas público + mi silla en el panel. LOCAL, no toca prod.

Casos:
  1. GET /public/clubs/{token}/tournaments/{id}/seating: mesas ordenadas,
     sillas ordenadas, lista de espera (ACTIVE sin mesa), ELIMINATED excluido.
  2. Torneo COMPLETED → 404 (no se expone el sorteo de torneos terminados).
  3. Tenant: torneo de OTRO club con mi token → 404; token inexistente → 404.
  4. /player/club-info trae my_seats con la silla del jugador logueado (y la
     lista de espera como table/seat NULL).

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_tournament_seating.py
"""
import os
import sys
import time
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8018
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "silla-c1@rakeflow.local"
C2_EMAIL = "silla-c2@rakeflow.local"
PW = "TestPass1234"
TAG = "SILLA-"


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
    psql(f"DELETE FROM tournament_players WHERE tournament_id IN (SELECT id FROM tournaments WHERE club_id IN ({ids}) AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM tournament_tables WHERE tournament_id IN (SELECT id FROM tournaments WHERE club_id IN ({ids}) AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM tournaments WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM players WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM users WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")


def register(c, email):
    r = c.post(f"{BASE}/auth/register", json={"name": f"Club {email}", "email": email, "password": PW, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def seed_player(club, name):
    psql(f"INSERT INTO players (club_id, name) VALUES ({club}, '{name}');")
    return int(psql(f"SELECT id FROM players WHERE club_id={club} AND name='{name}' ORDER BY id DESC LIMIT 1;"))


def main():
    step(0, "Backend local en :8018")
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
            tok1 = psql(f"SELECT public_token FROM clubs WHERE id={c1};")
            if not tok1:
                fail("club1 sin public_token")
            ok(f"club1={c1}, club2={c2}")

            step(2, "Sembrar torneo REGISTERING: 2 mesas, 3 sentados, 1 espera, 1 eliminado")
            psql(f"INSERT INTO tournaments (club_id, name, status, buyin_amount) VALUES ({c1}, '{TAG}Torneo', 'REGISTERING', 50000);")
            tid = int(psql(f"SELECT id FROM tournaments WHERE club_id={c1} AND name='{TAG}Torneo';"))
            psql(f"INSERT INTO tournament_tables (club_id, tournament_id, table_number, max_seats, status) VALUES ({c1}, {tid}, 1, 9, 'OPEN'), ({c1}, {tid}, 2, 9, 'OPEN');")
            m1 = int(psql(f"SELECT id FROM tournament_tables WHERE tournament_id={tid} AND table_number=1;"))
            m2 = int(psql(f"SELECT id FROM tournament_tables WHERE tournament_id={tid} AND table_number=2;"))
            ana = seed_player(c1, f"{TAG}Ana")
            beto = seed_player(c1, f"{TAG}Beto")
            caro = seed_player(c1, f"{TAG}Caro")
            dani = seed_player(c1, f"{TAG}Dani")   # en espera
            eli = seed_player(c1, f"{TAG}Eli")     # eliminado
            psql(f"INSERT INTO tournament_players (tournament_id, player_id, status, table_id, seat_number) VALUES "
                 f"({tid}, {ana}, 'ACTIVE', {m1}, 3), ({tid}, {beto}, 'ACTIVE', {m1}, 1), "
                 f"({tid}, {caro}, 'ACTIVE', {m2}, 5), ({tid}, {dani}, 'ACTIVE', NULL, NULL), "
                 f"({tid}, {eli}, 'ELIMINATED', NULL, NULL);")
            ok("sembrado")

            step(3, "GET seating público")
            r = c.get(f"{BASE}/public/clubs/{tok1}/tournaments/{tid}/seating")
            check(r.status_code == 200, f"→ 200 (got {r.status_code}: {r.text[:120]})")
            d = r.json()
            check(d["tournament_name"] == f"{TAG}Torneo", "nombre del torneo")
            check([t["table_number"] for t in d["tables"]] == [1, 2], f"mesas ordenadas (got {[t['table_number'] for t in d['tables']]})")
            mesa1 = d["tables"][0]["seats"]
            check([s["seat"] for s in mesa1] == [1, 3], f"sillas de mesa 1 ordenadas (got {[s['seat'] for s in mesa1]})")
            check(mesa1[0]["name"] == f"{TAG}Beto" and mesa1[1]["name"] == f"{TAG}Ana", "nombres en su silla")
            check(d["tables"][1]["seats"] == [{"seat": 5, "name": f"{TAG}Caro"}], "mesa 2 con Caro en silla 5")
            check(d["waiting"] == [f"{TAG}Dani"], f"espera = solo Dani (got {d['waiting']})")
            todos = [s["name"] for t in d["tables"] for s in t["seats"]] + d["waiting"]
            check(f"{TAG}Eli" not in todos, "ELIMINATED excluido")

            step(4, "COMPLETED → 404")
            psql(f"INSERT INTO tournaments (club_id, name, status, buyin_amount) VALUES ({c1}, '{TAG}Viejo', 'COMPLETED', 0);")
            tid_done = int(psql(f"SELECT id FROM tournaments WHERE club_id={c1} AND name='{TAG}Viejo';"))
            r = c.get(f"{BASE}/public/clubs/{tok1}/tournaments/{tid_done}/seating")
            check(r.status_code == 404, f"torneo COMPLETED → 404 (got {r.status_code})")

            step(5, "Tenant: torneo de otro club → 404; token falso → 404")
            psql(f"INSERT INTO tournaments (club_id, name, status, buyin_amount) VALUES ({c2}, '{TAG}Ajeno', 'REGISTERING', 0);")
            tid2 = int(psql(f"SELECT id FROM tournaments WHERE club_id={c2} AND name='{TAG}Ajeno';"))
            r = c.get(f"{BASE}/public/clubs/{tok1}/tournaments/{tid2}/seating")
            check(r.status_code == 404, f"torneo del club2 con token del club1 → 404 (got {r.status_code})")
            r = c.get(f"{BASE}/public/clubs/token-falso/tournaments/{tid}/seating")
            check(r.status_code == 404, f"token inexistente → 404 (got {r.status_code})")

            step(6, "/player/club-info trae my_seats del jugador logueado")
            psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, phone, name) "
                 f"VALUES ({c1}, 'PLAYER', true, 'x', '570000000077', '{TAG}UserAna');")
            uid = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND phone='570000000077';"))
            psql(f"UPDATE players SET user_id={uid} WHERE id={ana};")
            r = c.get(f"{BASE}/player/club-info",
                      headers={"Authorization": f"Bearer {jwt_for(uid, c1, 'player')}"})
            check(r.status_code == 200, f"club-info → 200 (got {r.status_code}: {r.text[:120]})")
            info = r.json()
            seats = info.get("my_seats") or []
            check(len(seats) == 1 and seats[0]["tournament_id"] == tid, f"my_seats del torneo (got {seats})")
            check(seats[0]["table_number"] == 1 and seats[0]["seat_number"] == 3, f"Ana: mesa 1 silla 3 (got {seats[0]})")
            lts = info.get("live_tournaments") or []
            check(any(t.get("id") == tid for t in lts), "live_tournaments trae el id del torneo")
            # El que está en espera: table/seat NULL
            psql(f"UPDATE players SET user_id=NULL WHERE id={ana};")
            psql(f"UPDATE players SET user_id={uid} WHERE id={dani};")
            r = c.get(f"{BASE}/player/club-info",
                      headers={"Authorization": f"Bearer {jwt_for(uid, c1, 'player')}"})
            seats = (r.json().get("my_seats") or [])
            check(len(seats) == 1 and seats[0]["table_number"] is None and seats[0]["seat_number"] is None,
                  f"Dani en espera: mesa/silla NULL (got {seats})")

            cleanup(c1, c2)
        print(f"\n\033[92m✔ {_passed} chequeos OK\033[0m")
    finally:
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    main()
