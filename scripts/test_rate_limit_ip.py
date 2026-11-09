#!/usr/bin/env python3
"""Límites por IP REAL + freno por cuenta en el login — LOCAL, no toca prod.

Antes, detrás del proxy de Railway, todos los usuarios compartían una sola IP
(la del proxy): los límites eran globales para todo RakeFlow. Casos:
  1. Cupos separados por IP (X-Forwarded-For, la ÚLTIMA entrada).
  2. Falsificar la IP poniendo otra a la izquierda no da cupo nuevo.
  3. Login: 10 claves malas a UNA cuenta (aunque roten IPs) → 429, y no
     afecta a otras cuentas.
  4. Entrar bien reinicia el contador de esa cuenta.
  5. Activación de jugador: 30/h por IP (antes 8/h... en total).

Uso: python scripts/test_rate_limit_ip.py
"""
import os
import pathlib
import subprocess
import sys
import time

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8023
BASE = f"http://127.0.0.1:{PORT}"
TAG = "RL-"


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
sys.path.insert(0, str(ROOT))
from app import auth_utils  # noqa: E402


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


def main():
    proc = subprocess.Popen([str(ROOT / "venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1",
                             "--port", str(PORT)], cwd=ROOT, env={**os.environ},
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    club = None
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

        with httpx.Client(timeout=30) as c:
            def login(user, pw, ip):
                return c.post(f"{BASE}/auth/login", data={"username": user, "password": pw},
                              headers={"X-Forwarded-For": ip})

            c.post(f"{BASE}/auth/register", json={"name": "Club RL", "email": "rl@rakeflow.local",
                                                  "password": "OwnerPass123", "accept_terms": True},
                   headers={"X-Forwarded-For": "203.0.113.250"})
            club = int(psql("SELECT id FROM clubs WHERE email='rl@rakeflow.local'"))
            psql(f"DELETE FROM users WHERE name LIKE '{TAG}%';")
            for name, phone in (("A", "573008880001"), ("B", "573008880002")):
                h = auth_utils.get_password_hash("ClaveBuena1")
                psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, phone, name) "
                     f"VALUES ({club}, 'PLAYER', true, '{h}', '{phone}', '{TAG}{name}');")

            print("\n[1] Cupos por IP real")
            codes = [login(f"nadie{i}@x.co", "x", "198.51.100.1").status_code for i in range(10)]
            check(all(s == 401 for s in codes), "10 logins desde la IP 1 → pasan al chequeo (401)")
            check(login("nadie10@x.co", "x", "198.51.100.1").status_code == 429, "el 11.º desde la IP 1 → 429")
            check(login("nadie11@x.co", "x", "198.51.100.2").status_code == 401,
                  "otra IP tiene su propio cupo (antes: TODOS bloqueados)")

            print("\n[2] Falsificar la IP")
            r = login("nadie12@x.co", "x", "192.0.2.77, 198.51.100.1")
            check(r.status_code == 429, "poner otra IP a la izquierda no da cupo nuevo (cuenta la última)")

            print("\n[3] Freno por cuenta")
            for i in range(10):
                login("3008880001", "mala", f"198.51.101.{i}")
            r = login("3008880001", "ClaveBuena1", "198.51.101.200")
            check(r.status_code == 429 and "Espera 15 minutos" in r.json().get("detail", ""),
                  "10 claves malas a la cuenta A desde 10 IPs → bloqueada aunque ahora la clave sea buena")
            check(login("+57 300 888 0001", "ClaveBuena1", "198.51.101.201").status_code == 429,
                  "el mismo teléfono escrito distinto cuenta igual")
            check(login("3008880002", "ClaveBuena1", "198.51.101.202").status_code == 200,
                  "la cuenta B no se ve afectada")

            print("\n[4] Entrar bien reinicia el contador")
            for i in range(9):
                login("3008880002", "mala", f"198.51.102.{i}")
            check(login("3008880002", "ClaveBuena1", "198.51.102.100").status_code == 200, "9 malas + 1 buena → entra")
            for i in range(9):
                login("3008880002", "mala", f"198.51.103.{i}")
            check(login("3008880002", "ClaveBuena1", "198.51.103.100").status_code == 200,
                  "otras 9 malas no la bloquean (el contador se reinició)")

            print("\n[5] Activación de jugador")
            codes = [c.post(f"{BASE}/players/activate", headers={"X-Forwarded-For": "198.51.104.1"},
                            json={"phone": f"30077700{i:02d}", "code": "123456", "password": "ClaveBuena1"}).status_code
                     for i in range(12)]
            check(429 not in codes, f"12 activaciones desde el WiFi del club no se bloquean (antes: la 9.ª) {sorted(set(codes))}")
    finally:
        try:
            psql(f"DELETE FROM users WHERE name LIKE '{TAG}%';")
            if club:
                tok = httpx.post(f"{BASE}/auth/login", data={"username": "rl@rakeflow.local", "password": "OwnerPass123"},
                                 headers={"X-Forwarded-For": "203.0.113.251"}).json().get("access_token")
                if tok:
                    httpx.delete(f"{BASE}/me/delete-account", headers={"Authorization": f"Bearer {tok}"})
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")


if __name__ == "__main__":
    main()
