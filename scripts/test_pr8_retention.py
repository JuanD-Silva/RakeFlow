#!/usr/bin/env python3
"""E2E + unit de PR8: medición de retención D7/D30 del panel. Todo LOCAL, no toca prod.

Valida:
  UNIT  should_log_panel_open (throttle por día Colombia) + _compute_retention
        (cohortes por semana, ventanas D1/D7/D30, cohortes inmaduras → pct null).
  E2E   1. GET /player/my-profile deja rastro PANEL_OPEN con throttle 1/día
           (2ª llamada el mismo día NO duplica; last_seen_at de ayer sí).
        2. GET /reports/retention computa cohortes/buckets sobre audit_logs sembrados.
        3. Tenant isolation: un club NO ve la actividad de otro.

Requisitos: Docker Postgres :5433 arriba (clon), .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_pr8_retention.py
"""
import os
import sys
import time
import json
import subprocess
import pathlib
from datetime import datetime, timedelta

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8013
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER = "poker_db"
DB_USER = "poker_admin"
DB_NAME = "poker_treasury_db"

C1_EMAIL = "pr8-c1@rakeflow.local"
C2_EMAIL = "pr8-c2@rakeflow.local"
PASS = "TestPass1234"


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


# Cargar .env en el entorno ANTES de importar auth_utils (necesita SECRET_KEY)
BASE_ENV = load_env(".env")
for k, v in BASE_ENV.items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(ROOT))
from app import auth_utils, player_stats            # noqa: E402
from app.routers.reports import _compute_retention  # noqa: E402


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
    if cond:
        ok(msg)
    else:
        fail(msg)


def step(n, msg):
    print(f"\n\033[1m[{n}] {msg}\033[0m")


def jwt_for(user_id, club_id, role="player"):
    return auth_utils.create_access_token(
        {"sub": f"u{user_id}", "club_id": club_id, "user_id": user_id, "role": role})


# ---------------------------------------------------------------------------
# UNIT (sin servidor)
# ---------------------------------------------------------------------------
def test_unit():
    step("U1", "Unit: should_log_panel_open (throttle por día Colombia, COL = UTC−5)")
    now = datetime(2026, 7, 6, 15, 0, 0)          # 10:00 COL del 6-jul
    check(player_stats.should_log_panel_open(None, now) is True, "sin last_seen → registra")
    check(player_stats.should_log_panel_open(datetime(2026, 7, 6, 14, 0, 0), now) is False,
          "mismo día COL → no duplica")
    check(player_stats.should_log_panel_open(datetime(2026, 7, 5, 10, 0, 0), now) is True,
          "ayer COL → registra")
    # Borde: 06-jul 03:00 UTC = 05-jul 22:00 COL (día COL anterior) → debe registrar
    check(player_stats.should_log_panel_open(datetime(2026, 7, 6, 3, 0, 0), now) is True,
          "borde: mismo día UTC pero día COL anterior → registra (throttle es por día COL)")

    step("U2", "Unit: _compute_retention (cohortes, ventanas, inmadurez)")
    now = datetime(2026, 7, 6, 12, 0, 0)

    def ago(days):
        return now - timedelta(days=days)

    # A: activó hace 45d, volvió a delta 7 (día-semana) y delta 30 (día-mes) → maduro para todo
    # B: activó hace 2d → inmaduro para todos los buckets
    # C: activó hace 45d, nunca volvió → maduro pero no retenido
    events = [
        (1, ago(45)), (1, ago(38)), (1, ago(15)),
        (2, ago(2)),
        (3, ago(45)),
    ]
    r = _compute_retention(events, now)
    ov = r["overall"]
    check(ov["activated"] == 3, f"overall.activated == 3 (A,B,C) — got {ov['activated']}")
    d1, d7, d30 = ov["retention"]["d1"], ov["retention"]["d7"], ov["retention"]["d30"]
    check(d1 == {"mature": 2, "retained": 0, "pct": 0.0},
          f"d1: maduros A,C, retenidos 0 → {d1}")
    check(d7 == {"mature": 2, "retained": 1, "pct": 0.5},
          f"d7: maduros A,C, retenido A → {d7}")
    check(d30 == {"mature": 2, "retained": 1, "pct": 0.5},
          f"d30: maduros A,C (age45≥40), retenido A → {d30}")
    # Cohortes: {A,C} misma semana (hace 45d) + {B} otra semana
    weeks = {c["week_start"]: c["activated"] for c in r["cohorts"]}
    check(len(r["cohorts"]) == 2, f"2 cohortes semanales — got {len(r['cohorts'])}")
    check(sorted(weeks.values()) == [1, 2], f"cohortes de tamaño 1 y 2 — got {sorted(weeks.values())}")

    # B solo: su bucket d7 debe salir inmaduro (mature 0 → pct null)
    rb = _compute_retention([(2, ago(2))], now)
    check(rb["overall"]["retention"]["d7"]["pct"] is None,
          "cohorte inmadura (2 días) → d7.pct = null (no reporta % engañoso)")


# ---------------------------------------------------------------------------
# E2E (con servidor)
# ---------------------------------------------------------------------------
def register_or_reuse(c, email):
    r = c.post(f"{BASE}/auth/register",
               json={"name": f"Club {email}", "email": email, "password": PASS, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {email} inesperado {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def cleanup(c1, c2):
    ids = f"{c1},{c2}"
    # Orden: audit → players (FK a users) → users
    psql(f"DELETE FROM audit_logs WHERE club_id IN ({ids}) "
         f"AND action IN ('PANEL_OPEN','LOGIN_SUCCESS') AND (meta->>'role')='player';")
    psql(f"DELETE FROM players WHERE club_id IN ({ids}) AND name LIKE 'PR8-%';")
    psql(f"DELETE FROM users WHERE club_id IN ({ids}) AND role='PLAYER' AND phone LIKE '9900%';")


def seed_player(club_id, name, phone):
    """Crea user PLAYER (hashed_password dummy: get_current_user solo exige no-null)
    + player vinculado. Devuelve user_id."""
    psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, name, phone, created_at) "
         f"VALUES ({club_id}, 'PLAYER', true, 'x', '{name}', '{phone}', now());")
    uid = int(psql(f"SELECT id FROM users WHERE club_id={club_id} AND phone='{phone}' AND role='PLAYER';"))
    psql(f"INSERT INTO players (club_id, name, user_id) VALUES ({club_id}, '{name}', {uid});")
    return uid


def seed_event(club_id, uid, action, when: datetime):
    meta = json.dumps({"user_id": uid, "role": "player"})
    psql(f"INSERT INTO audit_logs (club_id, actor_type, actor_id, action, meta, created_at) "
         f"VALUES ({club_id}, 'USER', {uid}, '{action}', '{meta}'::jsonb, '{when.isoformat()}');")


def count_panel_open(uid):
    # El jugador se identifica por meta->>'user_id' (igual que el reporte);
    # log_standalone deja actor_id NULL, como LOGIN_SUCCESS.
    return int(psql(f"SELECT count(*) FROM audit_logs "
                    f"WHERE action='PANEL_OPEN' AND (meta->>'user_id')='{uid}';"))


def main():
    test_unit()

    step(0, "Levantando backend local en :8013")
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
            step(1, "Clubs de prueba (register o reuse) + limpieza idempotente")
            c1 = register_or_reuse(c, C1_EMAIL)
            c2 = register_or_reuse(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            owner2 = int(psql(f"SELECT id FROM users WHERE club_id={c2} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1, 'owner')}"}
            auth2 = {"Authorization": f"Bearer {jwt_for(owner2, c2, 'owner')}"}
            ok(f"club1={c1} (owner {owner1}), club2={c2} (owner {owner2})")

            # ---- ENDPOINT sobre cohortes sembradas (club1) ----
            step(2, "Sembrar cohortes A/B/C en club1 y verificar /reports/retention")
            now = datetime.utcnow()
            a = seed_player(c1, "PR8-A", "99001")
            b = seed_player(c1, "PR8-B", "99002")
            cc = seed_player(c1, "PR8-C", "99003")
            # A: activó hace 45d (LOGIN), volvió a delta 7 y delta 30 (PANEL_OPEN)
            seed_event(c1, a, "LOGIN_SUCCESS", now - timedelta(days=45))
            seed_event(c1, a, "PANEL_OPEN", now - timedelta(days=38))
            seed_event(c1, a, "PANEL_OPEN", now - timedelta(days=15))
            # B: activó hace 2d (inmaduro)
            seed_event(c1, b, "LOGIN_SUCCESS", now - timedelta(days=2))
            # C: activó hace 45d, nunca volvió
            seed_event(c1, cc, "LOGIN_SUCCESS", now - timedelta(days=45))

            r = c.get(f"{BASE}/reports/retention", headers=auth1)
            check(r.status_code == 200, f"GET /reports/retention (owner1) → 200 (got {r.status_code})")
            data = r.json()
            check(data["club_id"] == c1, f"club_id == {c1}")
            ov = data["overall"]
            check(ov["activated"] == 3, f"overall.activated == 3 — got {ov['activated']}")
            check(ov["retention"]["d7"] == {"mature": 2, "retained": 1, "pct": 0.5},
                  f"d7 == maduros 2 / retenido 1 (A) — got {ov['retention']['d7']}")
            check(ov["retention"]["d30"] == {"mature": 2, "retained": 1, "pct": 0.5},
                  f"d30 == maduros 2 / retenido 1 (A) — got {ov['retention']['d30']}")
            check(len(data["cohorts"]) == 2, f"2 cohortes semanales — got {len(data['cohorts'])}")

            # ---- THROTTLE: my-profile deja 1 PANEL_OPEN/día (club2, player D) ----
            step(3, "Throttle de PANEL_OPEN en /player/my-profile (club2, player D)")
            d = seed_player(c2, "PR8-D", "99004")
            authd = {"Authorization": f"Bearer {jwt_for(d, c2, 'player')}"}
            check(count_panel_open(d) == 0, "D arranca sin PANEL_OPEN")
            r = c.get(f"{BASE}/player/my-profile", headers=authd)
            check(r.status_code == 200, f"my-profile(D) 1ª vez → 200 (got {r.status_code})")
            check(count_panel_open(d) == 1, "1ª apertura → 1 PANEL_OPEN")
            r = c.get(f"{BASE}/player/my-profile", headers=authd)
            check(count_panel_open(d) == 1, "2ª apertura mismo día → sigue 1 (throttle)")
            last_seen = psql(f"SELECT last_seen_at FROM users WHERE id={d}")
            check(last_seen not in ("", None), f"last_seen_at seteado ({last_seen[:19]})")
            # Retroceder last_seen_at 2 días → nueva apertura debe registrar
            psql(f"UPDATE users SET last_seen_at = now() - interval '2 days' WHERE id={d};")
            r = c.get(f"{BASE}/player/my-profile", headers=authd)
            check(count_panel_open(d) == 2, "apertura al día siguiente (last_seen −2d) → 2 PANEL_OPEN")

            # ---- TENANT ISOLATION ----
            step(4, "Tenant isolation: club1 no ve a club2 y viceversa")
            r1 = c.get(f"{BASE}/reports/retention", headers=auth1).json()
            r2 = c.get(f"{BASE}/reports/retention", headers=auth2).json()
            check(r1["overall"]["activated"] == 3,
                  f"reporte club1 sigue en 3 (no cuenta a D de club2) — got {r1['overall']['activated']}")
            check(r2["overall"]["activated"] == 1,
                  f"reporte club2 solo ve a D — got {r2['overall']['activated']}")

            # ---- AUTZ: player/cajero no pueden ver el reporte ----
            step(5, "El endpoint es solo staff OWNER/MANAGER")
            r = c.get(f"{BASE}/reports/retention", headers=authd)
            check(r.status_code == 403, f"PLAYER → 403 en /reports/retention (got {r.status_code})")
            r = c.get(f"{BASE}/reports/retention")
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
