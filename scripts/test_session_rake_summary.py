#!/usr/bin/env python3
"""E2E de GET /sessions/{id}/rake-summary (rake + gastos de una mesa cash).
LOCAL, no toca prod.

Casos:
  1. Mesa ABIERTA: rake = Σ rake declarado por turno; gastos = pago a dealers
     (horas × tarifa + % rake, misma fórmula que dealer-payments/cierre) +
     cortesías (Σ BONUS); neto = rake − gastos.
  2. Turno abierto sin declarar → open_shift_undeclared.
  3. Mesa sin dealer → has_live_source false, rake 0.
  4. Mesa CERRADA → números persistidos del cierre (no recálculo).
  5. Tenant: mesa de otro club → 404.  6. CASHIER → 403.

Uso: python scripts/test_session_rake_summary.py
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
C1_EMAIL = "rks-c1@rakeflow.local"
C2_EMAIL = "rks-c2@rakeflow.local"
PW = "TestPass1234"
TAG = "RKS-"


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


def jwt_for(uid, club, role="owner"):
    return auth_utils.create_access_token({"sub": f"u{uid}", "club_id": club, "user_id": uid, "role": role})


def cleanup(*clubs):
    ids = ",".join(str(c) for c in clubs)
    psql(f"DELETE FROM transactions WHERE session_id IN (SELECT id FROM sessions WHERE club_id IN ({ids}) AND name LIKE '{TAG}%');")
    psql(f"DELETE FROM dealer_shifts WHERE club_id IN ({ids});")
    psql(f"DELETE FROM dealers WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM sessions WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")
    psql(f"DELETE FROM users WHERE club_id IN ({ids}) AND name LIKE '{TAG}%';")


def register(c, email):
    r = c.post(f"{BASE}/auth/register", json={"name": f"Club {email}", "email": email, "password": PW, "accept_terms": True})
    check(r.status_code in (201, 400), f"club {email} listo")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def seed_session(club, name, status="OPEN", extra_cols="", extra_vals=""):
    psql(f"INSERT INTO sessions (club_id, name, start_time, status{extra_cols}) "
         f"VALUES ({club}, '{TAG}{name}', now(), '{status}'{extra_vals});")
    return int(psql(f"SELECT id FROM sessions WHERE club_id={club} AND name='{TAG}{name}' ORDER BY id DESC LIMIT 1;"))


def seed_dealer(club, name):
    psql(f"INSERT INTO dealers (club_id, name, hourly_rate_cop, rake_pct, tournament_hourly_rate_cop, is_active) VALUES ({club}, '{TAG}{name}', 0, 0, 0, true);")
    return int(psql(f"SELECT id FROM dealers WHERE club_id={club} AND name='{TAG}{name}' ORDER BY id DESC LIMIT 1;"))


def seed_shift(club, session, dealer, start, end, declared_rake, rate, pct):
    end_sql = f"'{end.isoformat()}'" if end else "NULL"
    dr_sql = str(declared_rake) if declared_rake is not None else "NULL"
    psql(f"INSERT INTO dealer_shifts (club_id, session_id, dealer_id, start_time, end_time, declared_rake, hourly_rate_cop, rake_pct) "
         f"VALUES ({club}, {session}, {dealer}, '{start.isoformat()}', {end_sql}, {dr_sql}, {rate}, {pct});")


def main():
    proc = subprocess.Popen(
        [str(ROOT / "venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    c1 = c2 = None
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
            c1, c2 = register(c, C1_EMAIL), register(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1)}"}
            url = lambda s: f"{BASE}/sessions/{s}/rake-summary"  # noqa: E731

            print("\n[1] Mesa ABIERTA con 2 turnos + cortesía")
            now = datetime.utcnow()
            sess = seed_session(c1, "mesa")
            a, b = seed_dealer(c1, "Ana"), seed_dealer(c1, "Beto")
            # Ana: cerrado 2h, rake 200.000, 20k/h + 10% → 40.000 + 20.000 = 60.000
            seed_shift(c1, sess, a, now - timedelta(hours=3), now - timedelta(hours=1), 200000, 20000, 10)
            # Beto: abierto, rake declarado hasta ahora 50.000, solo 10% (sin tarifa: exacto) → 5.000
            seed_shift(c1, sess, b, now - timedelta(hours=1), None, 50000, 0, 10)
            psql(f"INSERT INTO transactions (session_id, type, amount, timestamp) VALUES ({sess}, 'BONUS', 20000, now());")

            r = c.get(url(sess), headers=auth1)
            check(r.status_code == 200, f"→ 200 (got {r.status_code}: {r.text[:120]})")
            d = r.json()
            check(d["session_open"] is True and d["has_live_source"] is True, "abierta, con fuente en vivo")
            check(d["rake_total"] == 250000, f"rake = 200.000 + 50.000 (got {d['rake_total']})")
            check([s["rake"] for s in d["shifts"]] == [200000, 50000], "rake por turno, en orden")
            check(d["shifts"][1]["open"] is True and d["open_shift_undeclared"] is False, "turno en curso declarado")
            check(d["expenses"]["dealers"] == 65000, f"dealers = 60.000 + 5.000 (got {d['expenses']['dealers']})")
            check(d["expenses"]["courtesies"] == 20000, f"cortesías = 20.000 (got {d['expenses']['courtesies']})")
            check(d["net"] == 165000, f"neto = 250.000 − 65.000 − 20.000 (got {d['net']})")
            dp = c.get(f"{BASE}/sessions/{sess}/dealer-payments", headers=auth1).json()
            check(dp["summary"]["club_payment"] == d["expenses"]["dealers"], "gasto en dealers == lo que muestra dealer-payments")

            print("\n[2] Turno en curso sin declarar")
            s_und = seed_session(c1, "sin-declarar")
            seed_shift(c1, s_und, a, now - timedelta(minutes=30), None, None, 0, 10)
            d = c.get(url(s_und), headers=auth1).json()
            check(d["open_shift_undeclared"] is True and d["rake_total"] == 0, "avisa: turno abierto sin rake declarado")

            print("\n[3] Mesa sin dealer")
            s_nod = seed_session(c1, "sin-dealer")
            d = c.get(url(s_nod), headers=auth1).json()
            check(d["has_live_source"] is False and d["rake_total"] == 0 and d["shifts"] == [], "sin fuente en vivo: rake al cierre")

            print("\n[4] Mesa CERRADA: números persistidos del cierre")
            s_cl = seed_session(c1, "cerrada", "CLOSED",
                                ", declared_rake_cash, declared_jackpot_cash, dealer_cost, courtesy_cost, net_rake",
                                ", 300000, 40000, 70000, 20000, 210000")
            seed_shift(c1, s_cl, a, now - timedelta(hours=2), now, 999999, 50000, 50)  # recálculo daría otra cosa
            d = c.get(url(s_cl), headers=auth1).json()
            check(d["session_open"] is False and d["rake_total"] == 300000, f"rake = declarado al cerrar (got {d['rake_total']})")
            check(d["expenses"] == {"dealers": 70000, "courtesies": 20000, "total": 90000}, f"gastos persistidos (got {d['expenses']})")
            check(d["net"] == 210000 and d["jackpot_declared"] == 40000, "neto y jackpot del cierre")

            print("\n[4b] Redondeo y mesa cerrada sin dealer")
            s_dec = seed_session(c1, "decimales")
            seed_shift(c1, s_dec, a, now - timedelta(hours=2), now - timedelta(hours=1), 100000.6, 0, 7)
            psql(f"INSERT INTO transactions (session_id, type, amount, timestamp) VALUES ({s_dec}, 'BONUS', 1000.4, now());")
            d = c.get(url(s_dec), headers=auth1).json()
            check(d["net"] == d["rake_total"] - d["expenses"]["dealers"] - d["expenses"]["courtesies"],
                  f"neto cuadra al peso con lo mostrado (got {d['rake_total']} − {d['expenses']} = {d['net']})")
            s_cl2 = seed_session(c1, "cerrada-sin-dealer", "CLOSED",
                                 ", declared_rake_cash, dealer_cost, courtesy_cost, net_rake", ", 150000, 0, 0, 150000")
            d = c.get(url(s_cl2), headers=auth1).json()
            check(d["has_live_source"] is True and d["rake_total"] == 150000, "cerrada sin dealer: muestra el rake del cierre")

            print("\n[5] Tenant y roles")
            s2 = seed_session(c2, "ajena")
            check(c.get(url(s2), headers=auth1).status_code == 404, "mesa de otro club → 404")
            psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, email, name) "
                 f"VALUES ({c1}, 'CASHIER', true, 'x', 'rks-cajero-{c1}@rakeflow.local', '{TAG}Cajero');")
            cuid = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND name='{TAG}Cajero';"))
            r = c.get(url(sess), headers={"Authorization": f"Bearer {jwt_for(cuid, c1, 'cashier')}"})
            check(r.status_code == 403, f"CASHIER → 403 (got {r.status_code})")
    finally:
        if c1 and c2:
            cleanup(c1, c2)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")


if __name__ == "__main__":
    main()
