#!/usr/bin/env python3
"""E2E del embudo de adopción del panel (GET /reports/adoption). LOCAL, no toca prod.

Valida sobre datos sembrados:
  1. Conteos del embudo: crm_total, con_panel, activos_7d/30d, activos_30d_con_panel,
     panel_abrieron, panel_activos_7d/30d — cada uno con su caso de borde.
  2. Tenant isolation: un club no ve la actividad/jugadores de otro.
  3. Autorización: PLAYER → 403, sin token → 401.

Márgenes anchos (3/5/20/40 días) a propósito: aunque la DB local no esté en UTC,
un corrimiento de horas no cruza ninguna ventana (7d/30d).

Requisitos: Docker Postgres :5433 arriba (clon), .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_adoption_funnel.py
"""
import os
import sys
import time
import subprocess
import pathlib
from datetime import datetime, timedelta

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8014
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "adopt-c1@rakeflow.local"
C2_EMAIL = "adopt-c2@rakeflow.local"
PASS = "TestPass1234"

# Marcadores para limpieza idempotente
NAME_TAG = "ADOPT-"
PHONE_TAG = "9910"


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


BASE_ENV = load_env(".env")
for k, v in BASE_ENV.items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(ROOT))
from app import auth_utils  # noqa: E402


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0


def ok(msg):
    global _passed
    _passed += 1
    print(f"  \033[92m✓\033[0m {msg}")


def fail(msg):
    print(f"  \033[91m✗ {msg}\033[0m")
    sys.exit(1)


def check(cond, msg):
    ok(msg) if cond else fail(msg)


def step(n, msg):
    print(f"\n\033[1m[{n}] {msg}\033[0m")


def jwt_for(user_id, club_id, role="player"):
    return auth_utils.create_access_token(
        {"sub": f"u{user_id}", "club_id": club_id, "user_id": user_id, "role": role})


# ---- seeders (devuelven ids) ----
def seed_player(club_id, name, phone=None, last_seen=None):
    """Crea un player. Si phone: crea también su user PLAYER (= tiene panel) y
    opcionalmente setea last_seen_at. Devuelve player_id."""
    uid = "NULL"
    if phone:
        psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, name, phone, created_at) "
             f"VALUES ({club_id}, 'PLAYER', true, 'x', '{name}', '{phone}', now());")
        u = int(psql(f"SELECT id FROM users WHERE club_id={club_id} AND phone='{phone}' AND role='PLAYER';"))
        if last_seen is not None:
            psql(f"UPDATE users SET last_seen_at = '{last_seen.isoformat()}' WHERE id={u};")
        uid = str(u)
    psql(f"INSERT INTO players (club_id, name, user_id) VALUES ({club_id}, '{name}', {uid});")
    return int(psql(f"SELECT id FROM players WHERE club_id={club_id} AND name='{name}' ORDER BY id DESC LIMIT 1;"))


def seed_play(club_id, player_id, when):
    """Registra que un player 'jugó en mesa': sesión cash + transacción buyin."""
    psql(f"INSERT INTO sessions (club_id, name, start_time, status) "
         f"VALUES ({club_id}, '{NAME_TAG}sesion', '{when.isoformat()}', 'CLOSED');")
    sid = int(psql(f"SELECT id FROM sessions WHERE club_id={club_id} AND name='{NAME_TAG}sesion' "
                   f"ORDER BY id DESC LIMIT 1;"))
    psql(f"INSERT INTO transactions (session_id, player_id, type, amount, timestamp) "
         f"VALUES ({sid}, {player_id}, 'BUYIN', 100000, '{when.isoformat()}');")


def cleanup(c1, c2):
    ids = f"{c1},{c2}"
    psql(f"DELETE FROM transactions WHERE session_id IN "
         f"(SELECT id FROM sessions WHERE club_id IN ({ids}) AND name='{NAME_TAG}sesion');")
    psql(f"DELETE FROM sessions WHERE club_id IN ({ids}) AND name='{NAME_TAG}sesion';")
    psql(f"DELETE FROM players WHERE club_id IN ({ids}) AND name LIKE '{NAME_TAG}%';")
    psql(f"DELETE FROM users WHERE club_id IN ({ids}) AND role='PLAYER' AND phone LIKE '{PHONE_TAG}%';")


def register_or_reuse(c, email):
    r = c.post(f"{BASE}/auth/register",
               json={"name": f"Club {email}", "email": email, "password": PASS, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {email} inesperado {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def main():
    step(0, "Levantando backend local en :8014")
    proc = subprocess.Popen(
        ["./venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(25):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            fail("el backend local no levantó")
        ok(f"backend en {BASE}")

        with httpx.Client(timeout=30) as c:
            step(1, "Clubs de prueba + limpieza idempotente")
            c1 = register_or_reuse(c, C1_EMAIL)
            c2 = register_or_reuse(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            owner2 = int(psql(f"SELECT id FROM users WHERE club_id={c2} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1, 'owner')}"}
            auth2 = {"Authorization": f"Bearer {jwt_for(owner2, c2, 'owner')}"}
            ok(f"club1={c1}, club2={c2}")

            step(2, "Sembrar embudo en club1")
            now = datetime.utcnow()
            # P1: panel + last_seen hoy + jugó hace 5d  → todo
            p1 = seed_player(c1, f"{NAME_TAG}P1", f"{PHONE_TAG}01", last_seen=now)
            seed_play(c1, p1, now - timedelta(days=5))
            # P2: panel + last_seen hace 20d + jugó hace 20d → activos_30d, panel_30d (no 7d)
            p2 = seed_player(c1, f"{NAME_TAG}P2", f"{PHONE_TAG}02", last_seen=now - timedelta(days=20))
            seed_play(c1, p2, now - timedelta(days=20))
            # P3: SIN panel + jugó hace 3d → activos_7d/30d, no con_panel
            p3 = seed_player(c1, f"{NAME_TAG}P3")
            seed_play(c1, p3, now - timedelta(days=3))
            # P4: panel pero nunca abrió (last_seen null) y nunca jugó → solo con_panel
            seed_player(c1, f"{NAME_TAG}P4", f"{PHONE_TAG}04")
            # P5: SIN panel + jugó hace 40d (fuera de 30d) → solo crm_total
            p5 = seed_player(c1, f"{NAME_TAG}P5")
            seed_play(c1, p5, now - timedelta(days=40))
            ok("5 jugadores sembrados con sus casos de borde")

            step(3, "GET /reports/adoption (club1)")
            r = c.get(f"{BASE}/reports/adoption", headers=auth1)
            check(r.status_code == 200, f"→ 200 (got {r.status_code})")
            d = r.json()
            check(d["club_id"] == c1, f"club_id == {c1}")
            check(d["crm_total"] == 5, f"crm_total == 5 (P1..P5) — got {d['crm_total']}")
            check(d["con_panel"] == 3, f"con_panel == 3 (P1,P2,P4) — got {d['con_panel']}")
            check(d["activos_7d"] == 2, f"activos_7d == 2 (P1@5d,P3@3d) — got {d['activos_7d']}")
            check(d["activos_30d"] == 3, f"activos_30d == 3 (P1,P2,P3; P5@40 fuera) — got {d['activos_30d']}")
            check(d["activos_30d_con_panel"] == 2,
                  f"activos_30d_con_panel == 2 (P1,P2; P3 sin panel) — got {d['activos_30d_con_panel']}")
            check(d["panel_abrieron"] == 2, f"panel_abrieron == 2 (P1,P2; P4 nunca abrió) — got {d['panel_abrieron']}")
            check(d["panel_activos_7d"] == 1, f"panel_activos_7d == 1 (P1) — got {d['panel_activos_7d']}")
            check(d["panel_activos_30d"] == 2, f"panel_activos_30d == 2 (P1,P2) — got {d['panel_activos_30d']}")

            step(4, "Tenant isolation: club2 no ve nada de club1")
            seed_player(c2, f"{NAME_TAG}Q1", f"{PHONE_TAG}91")  # 1 jugador con panel en club2
            r2 = c.get(f"{BASE}/reports/adoption", headers=auth2).json()
            check(r2["crm_total"] == 1, f"club2 crm_total == 1 (solo Q1) — got {r2['crm_total']}")
            check(r2["con_panel"] == 1, f"club2 con_panel == 1 — got {r2['con_panel']}")
            check(r2["activos_30d"] == 0, f"club2 activos_30d == 0 (Q1 no jugó) — got {r2['activos_30d']}")
            r1b = c.get(f"{BASE}/reports/adoption", headers=auth1).json()
            check(r1b["crm_total"] == 5, f"club1 sigue en 5 (no cuenta a Q1 de club2) — got {r1b['crm_total']}")

            step(5, "Autorización: solo OWNER/MANAGER")
            uid_p1 = int(psql(f"SELECT user_id FROM players WHERE id={p1}"))  # user real de P1
            authp = {"Authorization": f"Bearer {jwt_for(uid_p1, c1, 'player')}"}
            r = c.get(f"{BASE}/reports/adoption", headers=authp)
            check(r.status_code == 403, f"PLAYER → 403 (got {r.status_code})")
            r = c.get(f"{BASE}/reports/adoption")
            check(r.status_code == 401, f"sin token → 401 (got {r.status_code})")

            step(6, "Limpieza")
            cleanup(c1, c2)
            ok("data de prueba borrada")

        print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
