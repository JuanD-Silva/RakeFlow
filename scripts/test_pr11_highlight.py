#!/usr/bin/env python3
"""E2E + unit de PR11: card de destaque del jugador + baja de la reactivación (PR9).
Todo LOCAL contra el clon, no toca prod.

Valida:
  UNIT  best_highlight: elige la mejor métrica, respeta el umbral (tercio superior),
        min_total, y devuelve None cuando el jugador es flojo en todo (no top falso).
  E2E   1. GET /player/my-highlight con un jugador de alto volumen → Top X% real.
        2. Jugador sin actividad → highlight null (cae al reencuadre).
        3. Los endpoints /reports/reengagement/* quedaron en 404 (PR9 dado de baja).
        4. GET /reports/retention (PR8) sigue vivo (200) — no lo rompimos.

Requisitos: Docker Postgres :5433 (clon con Mambo = club 3), .env con SECRET_KEY + DATABASE_URL.
Uso: python scripts/test_pr11_highlight.py
"""
import os
import sys
import time
import subprocess
import pathlib

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8013
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"
CLUB = 3            # Mambo (clon con historia real)
OWNER_ID = 7
TOP_PLAYER = 4     # Juan Silva: #1 en horas del club


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
from app import auth_utils                       # noqa: E402
from app.player_stats import best_highlight      # noqa: E402


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", sql],
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


def check(c, m):
    ok(m) if c else fail(m)


def step(n, m):
    print(f"\n\033[1m[{n}] {m}\033[0m")


def jwt_for(uid, role="player"):
    return auth_utils.create_access_token({"sub": f"u{uid}", "club_id": CLUB, "user_id": uid, "role": role})


def link_player_account(player_id, phone):
    """Cuenta PLAYER temporal vinculada a un player existente del clon."""
    psql(f"DELETE FROM users WHERE club_id={CLUB} AND phone='{phone}';")
    psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, name, phone, created_at) "
         f"VALUES ({CLUB}, 'PLAYER', true, 'x', 'test', '{phone}', now());")
    uid = int(psql(f"SELECT id FROM users WHERE club_id={CLUB} AND phone='{phone}';"))
    psql(f"UPDATE players SET user_id={uid}, stats_since=NULL WHERE id={player_id};")
    return uid


def new_player_with_account(name, phone):
    """Player nuevo SIN actividad + cuenta PLAYER (para el caso highlight=null)."""
    psql(f"DELETE FROM users WHERE club_id={CLUB} AND phone='{phone}';")
    psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, name, phone, created_at) "
         f"VALUES ({CLUB}, 'PLAYER', true, 'x', '{name}', '{phone}', now());")
    uid = int(psql(f"SELECT id FROM users WHERE club_id={CLUB} AND phone='{phone}';"))
    psql(f"INSERT INTO players (club_id, name, phone, user_id) VALUES ({CLUB}, '{name}', '{phone}', {uid});")
    pid = int(psql(f"SELECT id FROM players WHERE club_id={CLUB} AND name='{name}' ORDER BY id DESC LIMIT 1;"))
    return pid, uid


def cleanup():
    # Revertir cuentas de prueba (el player TOP vuelve a user_id NULL)
    psql(f"UPDATE players SET user_id=NULL WHERE id={TOP_PLAYER} "
         f"AND user_id IN (SELECT id FROM users WHERE club_id={CLUB} AND phone='99000000011');")
    psql(f"DELETE FROM players WHERE club_id={CLUB} AND name='PR11-VACIO';")
    psql(f"DELETE FROM users WHERE club_id={CLUB} AND phone IN ('99000000011','99000000012');")


def test_unit():
    step("U", "Unit: best_highlight (mejor métrica, umbral, min_total, None honesto)")
    base = {i: 5 for i in range(4, 30)}
    st = {
        "hours": {1: 100, 2: 50, 3: 10, **base},        # player 1 = #1 en horas
        "visits": {1: 3, 2: 40, 3: 30, **{i: 20 for i in range(4, 30)}},   # player 2 = #1
        "constancy": {1: 1, 2: 2, 3: 3, **{i: 2 for i in range(4, 30)}},
    }
    h1 = best_highlight(st, 1)
    check(h1 and h1["metric"] == "hours" and h1["rank"] == 1, f"player 1 → mejor métrica horas #1 → {h1}")
    h2 = best_highlight(st, 2)
    check(h2 and h2["metric"] == "visits" and h2["rank"] == 1, f"player 2 → visitas #1 → {h2}")
    # Jugador flojo en todo (valor bajo, percentil malo) → None
    weak = {"hours": {i: i for i in range(1, 50)}, "visits": {i: i for i in range(1, 50)},
            "constancy": {i: i for i in range(1, 50)}}
    check(best_highlight(weak, 5) is None, "jugador en el fondo de todo → None (sin top falso)")
    # min_total: métrica con < 8 jugadores no cuenta
    tiny = {"hours": {1: 100, 2: 1}, "visits": {}, "constancy": {}}
    check(best_highlight(tiny, 1) is None, "métrica con pocos jugadores (<min_total) → None")
    # label formateado
    check(h1["label"].startswith("Top ") and "horas" in h1["label"], f"label legible → '{h1['label']}'")


def main():
    test_unit()

    step(0, "Backend local :8013")
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
        cleanup()

        with httpx.Client(timeout=30) as c:
            step(1, "GET /player/my-highlight — jugador de alto volumen → Top X% real")
            uid_top = link_player_account(TOP_PLAYER, "99000000011")
            authp = {"Authorization": f"Bearer {jwt_for(uid_top, 'player')}"}
            r = c.get(f"{BASE}/player/my-highlight", headers=authp)
            check(r.status_code == 200, f"my-highlight → 200 (got {r.status_code})")
            hl = r.json().get("highlight")
            check(hl and hl["metric"] in ("hours", "visits", "constancy"), f"trae destaque válido → {hl}")
            check(hl["pct"] <= 33 and hl["label"].startswith("Top "), f"top del tercio superior → {hl['label']}")

            step(2, "Jugador sin actividad → highlight null (cae al reencuadre)")
            _, uid_empty = new_player_with_account("PR11-VACIO", "99000000012")
            authe = {"Authorization": f"Bearer {jwt_for(uid_empty, 'player')}"}
            r = c.get(f"{BASE}/player/my-highlight", headers=authe)
            check(r.status_code == 200 and r.json().get("highlight") is None,
                  f"sin actividad → highlight null (got {r.status_code}, {r.json().get('highlight')})")

            step(3, "PR9 dado de baja: /reports/reengagement/* → 404")
            autho = {"Authorization": f"Bearer {jwt_for(OWNER_ID, 'owner')}"}
            for method, path in [("get", "/reports/reengagement/lift"),
                                 ("post", "/reports/reengagement/refresh"),
                                 ("post", "/reports/reengagement/1/sent")]:
                r = getattr(c, method)(f"{BASE}{path}", headers=autho)
                check(r.status_code == 404, f"{method.upper()} {path} → 404 (got {r.status_code})")

            step(4, "PR8 intacto: /reports/retention sigue 200")
            r = c.get(f"{BASE}/reports/retention", headers=autho)
            check(r.status_code == 200, f"retention → 200 (got {r.status_code})")

            step(5, "Autz: el destaque es solo del rol PLAYER")
            r = c.get(f"{BASE}/player/my-highlight", headers=autho)
            check(r.status_code == 403, f"OWNER en my-highlight → 403 (got {r.status_code})")
            r = c.get(f"{BASE}/player/my-highlight")
            check(r.status_code == 401, f"sin token → 401 (got {r.status_code})")

        step(6, "Limpieza")
        cleanup()
        ok("cuentas de prueba revertidas")
        print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
