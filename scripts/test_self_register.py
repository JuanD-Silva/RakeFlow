#!/usr/bin/env python3
"""E2E del auto-registro por QR (POST /players/self-register). LOCAL, no toca prod.

Casos:
  1. NUEVO: teléfono sin ficha ni cuenta → crea Player + User, self_registered_at
     y stats_since seteados; el JWT devuelto abre /player/my-profile (auto-login).
  2. RECLAMAR FICHA: teléfono ya en el CRM sin cuenta → vincula a esa ficha (sin
     duplicar), self_registered_at seteado.
  3. DUPLICADO: teléfono ya activado → 409 (que inicie sesión).
  4. INVITACIÓN PENDIENTE: staff invitó (user sin password) → el self-register la
     completa, pero NO marca self_registered_at (nació de un invite).
  5. TOKEN MALO → 404.
  6. Password inválida (corta) → 422.

Requisitos: Docker Postgres :5433 arriba, .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_self_register.py
"""
import os
import sys
import time
import subprocess
import pathlib
from datetime import datetime, timedelta

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8015
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "selfreg-c1@rakeflow.local"
PASS_CLUB = "TestPass1234"
PW = "Jugador123"           # válida (8+, may, min, número)
TOKEN = "tok-selfreg-c1-test"
NAME_TAG = "SR-"
PHONE_TAG = "992"


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


for k, v in load_env(".env").items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(ROOT))
from app.phone_utils import normalize_phone  # noqa: E402

# Teléfonos reales (10 dígitos). La API recibe el crudo; la DB guarda el
# normalizado (57 + número). Consultamos por el normalizado.
RAW = {"new": "3009920001", "ficha": "3009920002", "pend": "3009920003", "x": "3009920009", "y": "3009920008"}
NORM = {k: normalize_phone(v) for k, v in RAW.items()}
PHONE_LIKE = "57300992"


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


def cleanup(c1):
    psql(f"DELETE FROM players WHERE club_id={c1} AND name LIKE '{NAME_TAG}%';")
    psql(f"DELETE FROM users WHERE club_id={c1} AND role='PLAYER' AND phone LIKE '{PHONE_LIKE}%';")


def register_or_reuse(c, email):
    r = c.post(f"{BASE}/auth/register",
               json={"name": f"Club {email}", "email": email, "password": PASS_CLUB, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register inesperado {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def reg(c, name, phone, token=TOKEN):
    return c.post(f"{BASE}/players/self-register",
                  json={"club_token": token, "name": name, "phone": phone, "password": PW})


def main():
    step(0, "Backend local en :8015")
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
            fail("el backend no levantó")
        ok(f"backend en {BASE}")

        with httpx.Client(timeout=30) as c:
            step(1, "Club de prueba + public_token fijo + limpieza")
            c1 = register_or_reuse(c, C1_EMAIL)
            cleanup(c1)
            psql(f"UPDATE clubs SET public_token='{TOKEN}', is_active=true WHERE id={c1};")
            ok(f"club1={c1}, token={TOKEN}")

            step(2, "NUEVO: teléfono sin ficha ni cuenta")
            r = reg(c, f"{NAME_TAG}Nuevo", RAW["new"])
            check(r.status_code == 200, f"self-register → 200 (got {r.status_code}: {r.text[:120]})")
            tok = r.json().get("access_token")
            check(bool(tok) and r.json().get("role") == "player", "devuelve JWT rol player")
            row = psql(f"SELECT p.user_id IS NOT NULL, p.self_registered_at IS NOT NULL, p.stats_since IS NOT NULL "
                       f"FROM players p WHERE p.club_id={c1} AND p.phone='{NORM['new']}';")
            check(row == "t\tt\tt", f"ficha creada con cuenta + self_registered_at + stats_since (got {row})")
            # Auto-login real: el token abre el panel
            pr = c.get(f"{BASE}/player/my-profile", headers={"Authorization": f"Bearer {tok}"})
            check(pr.status_code == 200, f"el JWT abre /player/my-profile → 200 (got {pr.status_code})")

            step(3, "RECLAMAR FICHA: teléfono ya en el CRM sin cuenta")
            psql(f"INSERT INTO players (club_id, name, phone) VALUES ({c1}, '{NAME_TAG}Ficha', '{NORM['ficha']}');")
            pid = int(psql(f"SELECT id FROM players WHERE club_id={c1} AND phone='{NORM['ficha']}';"))
            r = reg(c, f"{NAME_TAG}FichaOtroNombre", RAW["ficha"])
            check(r.status_code == 200, f"self-register → 200 (got {r.status_code})")
            cnt = int(psql(f"SELECT count(*) FROM players WHERE club_id={c1} AND phone='{NORM['ficha']}';"))
            check(cnt == 1, f"NO se duplica la ficha (sigue 1) — got {cnt}")
            row = psql(f"SELECT id, user_id IS NOT NULL, self_registered_at IS NOT NULL FROM players WHERE club_id={c1} AND phone='{NORM['ficha']}';")
            check(row == f"{pid}\tt\tt", f"misma ficha {pid}, ahora con cuenta + marcada (got {row})")

            step(4, "DUPLICADO: teléfono ya activado → 409")
            r = reg(c, f"{NAME_TAG}Nuevo", RAW["new"])
            check(r.status_code == 409, f"→ 409 (got {r.status_code})")

            step(5, "INVITACIÓN PENDIENTE: staff invitó, el self-register la completa")
            # user pendiente (sin password) + ficha vinculada
            psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, phone, name, invitation_token, invitation_expires_at) "
                 f"VALUES ({c1}, 'PLAYER', true, NULL, '{NORM['pend']}', '{NAME_TAG}Pend', 'ABC123', now() + interval '1 day');")
            uid = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND phone='{NORM['pend']}' AND role='PLAYER';"))
            psql(f"INSERT INTO players (club_id, name, phone, user_id) VALUES ({c1}, '{NAME_TAG}Pend', '{NORM['pend']}', {uid});")
            r = reg(c, f"{NAME_TAG}Pend", RAW["pend"])
            check(r.status_code == 200, f"completa la invitación → 200 (got {r.status_code})")
            hp = psql(f"SELECT hashed_password IS NOT NULL FROM users WHERE id={uid};")
            check(hp == "t", "el user pendiente quedó con contraseña")
            sr = psql(f"SELECT self_registered_at IS NULL FROM players WHERE club_id={c1} AND phone='{NORM['pend']}';")
            check(sr == "t", "NO se marca self_registered_at (nació de un invite del staff)")

            step(6, "TOKEN MALO → 404")
            r = reg(c, f"{NAME_TAG}X", RAW["x"], token="token-que-no-existe")
            check(r.status_code == 404, f"→ 404 (got {r.status_code})")

            step(7, "Password inválida (corta) → 422")
            r = c.post(f"{BASE}/players/self-register",
                       json={"club_token": TOKEN, "name": f"{NAME_TAG}Y", "phone": RAW["y"], "password": "corta"})
            check(r.status_code == 422, f"→ 422 (got {r.status_code})")

            step(8, "Limpieza")
            cleanup(c1)
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
