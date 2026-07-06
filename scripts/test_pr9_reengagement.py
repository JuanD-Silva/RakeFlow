#!/usr/bin/env python3
"""E2E + unit de PR9: reactivación de inactivos como experimento con control. LOCAL, no toca prod.

Valida:
  UNIT  assign_reengagement_group (estable, determinista, ~CONTROL_PCT% control) +
        _compute_lift (maduros, ventana, lift, inmaduros).
  E2E   1. POST /reports/reengagement/refresh: asigna grupos a inactivos con teléfono,
           devuelve SOLO tratamiento, el control NO aparece; activos y sin-teléfono no califican.
        2. Estabilidad: 2º refresh no cambia grupos ni qualified_at.
        3. POST .../{id}/sent: tratamiento→200+audit; control→400; otro club/inexistente→404.
        4. GET /reports/reengagement/lift: % retorno tratamiento vs control.
        5. Tenant isolation entre clubes.
        6. GET /player/weekly-summary: recap de la semana del jugador.

Requisitos: Docker Postgres :5433 arriba (clon), .env con SECRET_KEY + DATABASE_URL local.
Uso: python scripts/test_pr9_reengagement.py
"""
import os
import sys
import time
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

C1_EMAIL = "pr9-c1@rakeflow.local"
C2_EMAIL = "pr9-c2@rakeflow.local"
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


BASE_ENV = load_env(".env")
for k, v in BASE_ENV.items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(ROOT))
from app import auth_utils                                                # noqa: E402
from app.routers.reports import assign_reengagement_group, _compute_lift  # noqa: E402


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


# --------------------------------------------------------------------------- UNIT
def test_unit():
    step("U1", "Unit: assign_reengagement_group (estable + ~30% control)")
    check(assign_reengagement_group(3, 100) == assign_reengagement_group(3, 100),
          "mismo (club,player) → mismo grupo (estable)")
    groups = [assign_reengagement_group(3, i) for i in range(3000)]
    ctrl_frac = groups.count("control") / len(groups)
    check(0.25 <= ctrl_frac <= 0.35, f"~30% control sobre 3000 ids → {ctrl_frac:.3f}")
    check(set(groups) == {"control", "treatment"}, "solo etiquetas treatment/control")

    step("U2", "Unit: _compute_lift (maduros, ventana, lift, inmaduros)")
    now = datetime(2026, 7, 6, 12, 0, 0)

    def ago(d):
        return now - timedelta(days=d)

    rows = [
        ("treatment", ago(40), ago(35)),   # maduro, retornó (5d post-qat, ≤30)
        ("treatment", ago(40), ago(20)),   # maduro, retornó (20d post-qat, ≤30)
        ("treatment", ago(40), None),      # maduro, no retornó
        ("control",   ago(40), None),      # maduro, no retornó
        ("control",   ago(40), None),      # maduro, no retornó
        ("treatment", ago(5),  None),      # inmaduro (ventana sin cerrar) → no cuenta
    ]
    r = _compute_lift(rows, now, 30)
    check(r["treatment"] == {"mature": 3, "returned": 2, "pct": 0.6667},
          f"treatment 3 maduros / 2 retornos → {r['treatment']}")
    check(r["control"] == {"mature": 2, "returned": 0, "pct": 0.0},
          f"control 2 maduros / 0 retornos → {r['control']}")
    check(r["lift"] == 0.6667, f"lift = 0.6667 → {r['lift']}")
    # rama sin maduros → pct null → lift null
    r2 = _compute_lift([("treatment", ago(5), None)], now, 30)
    check(r2["lift"] is None and r2["treatment"]["pct"] is None,
          "todo inmaduro → pct/lift = null")


# --------------------------------------------------------------------------- E2E helpers
def register_or_reuse(c, email):
    r = c.post(f"{BASE}/auth/register",
               json={"name": f"Club {email}", "email": email, "password": PASS, "accept_terms": True})
    if r.status_code not in (201, 400):
        fail(f"register {email} inesperado {r.status_code}: {r.text}")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def cleanup(c1, c2):
    ids = f"{c1},{c2}"
    psql(f"DELETE FROM audit_logs WHERE club_id IN ({ids}) AND action IN ('REENGAGEMENT_SENT','PANEL_OPEN','LOGIN_SUCCESS') AND (meta->>'role')='player';")
    psql(f"DELETE FROM audit_logs WHERE club_id IN ({ids}) AND action='REENGAGEMENT_SENT';")
    psql(f"DELETE FROM transactions WHERE player_id IN (SELECT id FROM players WHERE club_id IN ({ids}) AND name LIKE 'PR9-%');")
    psql(f"DELETE FROM players WHERE club_id IN ({ids}) AND name LIKE 'PR9-%';")
    psql(f"DELETE FROM users WHERE club_id IN ({ids}) AND role='PLAYER' AND phone LIKE '9910%';")
    psql(f"DELETE FROM sessions WHERE club_id IN ({ids}) AND name='PR9-sess';")


def seed_session(club_id, days_ago=400):
    # end_time = fecha de la visita para cash_rows_for_player (fecha por sesión).
    when = (datetime.utcnow() - timedelta(days=days_ago)).isoformat()
    psql(f"INSERT INTO sessions (club_id, status, name, start_time, end_time) "
         f"VALUES ({club_id}, 'CLOSED', 'PR9-sess', '{when}', '{when}');")
    return int(psql(f"SELECT id FROM sessions WHERE club_id={club_id} AND name='PR9-sess' ORDER BY id DESC LIMIT 1;"))


def seed_player(club_id, name, phone):
    ph = f"'{phone}'" if phone else "NULL"
    psql(f"INSERT INTO players (club_id, name, phone) VALUES ({club_id}, '{name}', {ph});")
    return int(psql(f"SELECT id FROM players WHERE club_id={club_id} AND name='{name}' ORDER BY id DESC LIMIT 1;"))


def seed_player_with_app(club_id, name, phone):
    """Player con cuenta PLAYER (para weekly-summary). Devuelve (player_id, user_id)."""
    psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, name, phone, created_at) "
         f"VALUES ({club_id}, 'PLAYER', true, 'x', '{name}', '{phone}', now());")
    uid = int(psql(f"SELECT id FROM users WHERE club_id={club_id} AND phone='{phone}' AND role='PLAYER';"))
    psql(f"INSERT INTO players (club_id, name, phone, user_id) VALUES ({club_id}, '{name}', '{phone}', {uid});")
    pid = int(psql(f"SELECT id FROM players WHERE club_id={club_id} AND name='{name}' ORDER BY id DESC LIMIT 1;"))
    return pid, uid


def seed_visit(session_id, player_id, days_ago, amount=50000):
    when = (datetime.utcnow() - timedelta(days=days_ago)).isoformat()
    psql(f"INSERT INTO transactions (player_id, session_id, type, amount, timestamp) "
         f"VALUES ({player_id}, {session_id}, 'BUYIN', {amount}, '{when}');")


def group_of(pid):
    return psql(f"SELECT COALESCE(reengagement_group,'') FROM players WHERE id={pid};")


def audit_sent_count(club_id, pid):
    return int(psql(f"SELECT count(*) FROM audit_logs WHERE club_id={club_id} "
                    f"AND action='REENGAGEMENT_SENT' AND (meta->>'player_id')='{pid}';"))


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
            step(1, "Clubs + limpieza + sembrado de inactivos (club1)")
            c1 = register_or_reuse(c, C1_EMAIL)
            c2 = register_or_reuse(c, C2_EMAIL)
            cleanup(c1, c2)
            owner1 = int(psql(f"SELECT id FROM users WHERE club_id={c1} AND role='OWNER' ORDER BY id LIMIT 1"))
            owner2 = int(psql(f"SELECT id FROM users WHERE club_id={c2} AND role='OWNER' ORDER BY id LIMIT 1"))
            auth1 = {"Authorization": f"Bearer {jwt_for(owner1, c1, 'owner')}"}
            auth2 = {"Authorization": f"Bearer {jwt_for(owner2, c2, 'owner')}"}
            s1 = seed_session(c1)

            # 6 inactivos con teléfono (visita hace 30d), 1 activo (3d), 1 inactivo sin teléfono
            inactivos = []
            for i in range(1, 7):
                pid = seed_player(c1, f"PR9-I{i}", f"9910{i}")
                seed_visit(s1, pid, days_ago=30)
                inactivos.append(pid)
            act = seed_player(c1, "PR9-ACT", "99109")
            seed_visit(s1, act, days_ago=3)                      # activo → no califica
            noph = seed_player(c1, "PR9-NOPH", None)
            seed_visit(s1, noph, days_ago=30)                    # sin teléfono → no califica
            ok(f"club1={c1}: 6 inactivos + 1 activo + 1 sin-teléfono")

            step(2, "POST /reports/reengagement/refresh — asigna grupos, devuelve solo tratamiento")
            r = c.post(f"{BASE}/reports/reengagement/refresh", headers=auth1)
            check(r.status_code == 200, f"refresh → 200 (got {r.status_code}: {r.text[:120]})")
            data = r.json()
            tq = data["counts"]["total_qualified"]
            check(tq == 6, f"6 calificados (solo inactivos con teléfono) — got {tq}")
            check(data["counts"]["treatment"] + data["counts"]["control"] == 6, "treatment + control == 6")
            listed = {it["player_id"] for it in data["treatment"]}
            check(len(data["treatment"]) == data["counts"]["treatment"], "lista == count de tratamiento")
            check(all(group_of(p) == "treatment" for p in listed), "todos los listados son tratamiento en DB")
            controls = [p for p in inactivos if group_of(p) == "control"]
            check(controls, f"hay {len(controls)} control(es) sembrados")
            check(all(p not in listed for p in controls), "NINGÚN control aparece en la lista")
            check(group_of(act) == "" and group_of(noph) == "", "activo y sin-teléfono NO calificaron (group NULL)")

            step(3, "Estabilidad: 2º refresh no cambia grupos ni qualified_at")
            before = {p: group_of(p) for p in inactivos}
            qat_before = psql(f"SELECT string_agg(id||':'||reengagement_qualified_at, ',' ORDER BY id) FROM players WHERE id IN ({','.join(map(str,inactivos))});")
            c.post(f"{BASE}/reports/reengagement/refresh", headers=auth1)
            after = {p: group_of(p) for p in inactivos}
            qat_after = psql(f"SELECT string_agg(id||':'||reengagement_qualified_at, ',' ORDER BY id) FROM players WHERE id IN ({','.join(map(str,inactivos))});")
            check(before == after, "grupos idénticos tras 2º refresh")
            check(qat_before == qat_after, "qualified_at sin cambios (baseline estable)")

            step(4, "POST .../{id}/sent — tratamiento 200, control 400, otro club/inexistente 404")
            t_pid = next(iter(listed))
            r = c.post(f"{BASE}/reports/reengagement/{t_pid}/sent", headers=auth1)
            check(r.status_code == 200, f"marcar tratamiento → 200 (got {r.status_code})")
            check(audit_sent_count(c1, t_pid) == 1, "audit REENGAGEMENT_SENT registrado")
            r = c.post(f"{BASE}/reports/reengagement/{controls[0]}/sent", headers=auth1)
            check(r.status_code == 400, f"marcar control → 400 (protege el experimento) (got {r.status_code})")
            r = c.post(f"{BASE}/reports/reengagement/999999/sent", headers=auth1)
            check(r.status_code == 404, f"player inexistente → 404 (got {r.status_code})")
            # player de c2 marcado desde c1 → 404
            foreign = seed_player(c2, "PR9-FOREIGN", "99108")
            r = c.post(f"{BASE}/reports/reengagement/{foreign}/sent", headers=auth1)
            check(r.status_code == 404, f"player de otro club → 404 (got {r.status_code})")
            # last_sent_at aparece en el siguiente refresh
            r = c.post(f"{BASE}/reports/reengagement/refresh", headers=auth1).json()
            sent_item = next(it for it in r["treatment"] if it["player_id"] == t_pid)
            check(sent_item["last_sent_at"] is not None, "last_sent_at visible en el refresh siguiente")

            step(5, "Tenant isolation entre clubes")
            s2 = seed_session(c2)
            c2i = seed_player(c2, "PR9-C2I", "99104")
            seed_visit(s2, c2i, days_ago=30)
            r2 = c.post(f"{BASE}/reports/reengagement/refresh", headers=auth2).json()
            check(r2["counts"]["total_qualified"] == 1, f"club2 solo ve su 1 inactivo — got {r2['counts']['total_qualified']}")
            r1 = c.post(f"{BASE}/reports/reengagement/refresh", headers=auth1).json()
            check(c2i not in {it["player_id"] for it in r1["treatment"]}, "club1 NO ve al inactivo de club2")
            check(r1["counts"]["total_qualified"] == 6, "club1 sigue en 6 (no contamina con c2)")

            step(6, "GET /reports/reengagement/lift — retorno tratamiento vs control")
            # Players dedicados con qualified_at viejo (maduros) + retornos controlados.
            # Van al final para no alterar los conteos del refresh de arriba.
            lt1 = seed_player(c1, "PR9-LT1", "99201")
            lt2 = seed_player(c1, "PR9-LT2", "99202")
            lc1 = seed_player(c1, "PR9-LC1", "99203")
            qat = (datetime.utcnow() - timedelta(days=40)).isoformat()
            for pid, grp in [(lt1, "treatment"), (lt2, "treatment"), (lc1, "control")]:
                psql(f"UPDATE players SET reengagement_group='{grp}', reengagement_qualified_at='{qat}' WHERE id={pid};")
            seed_visit(s1, lt1, days_ago=35)   # retorno 5d post-qat (dentro de ventana 30)
            # lt2 y lc1 sin retorno
            r = c.get(f"{BASE}/reports/reengagement/lift", headers=auth1)
            check(r.status_code == 200, f"lift → 200 (got {r.status_code})")
            lift = r.json()
            check(lift["treatment"] == {"mature": 2, "returned": 1, "pct": 0.5},
                  f"treatment 2 maduros / 1 retorno → {lift['treatment']}")
            check(lift["control"] == {"mature": 1, "returned": 0, "pct": 0.0},
                  f"control 1 maduro / 0 retornos → {lift['control']}")
            check(lift["lift"] == 0.5, f"lift 0.5 → {lift['lift']}")

            step(7, "GET /player/weekly-summary — recap de la semana")
            wp, wu = seed_player_with_app(c1, "PR9-WEEK", "99105")
            # cash_rows fecha por s.end_time → necesito una sesión de ESTA semana
            sw = seed_session(c1, days_ago=0)
            seed_visit(sw, wp, days_ago=0)      # visita de hoy → cae en la semana ISO
            authw = {"Authorization": f"Bearer {jwt_for(wu, c1, 'player')}"}
            r = c.get(f"{BASE}/player/weekly-summary", headers=authw)
            check(r.status_code == 200, f"weekly-summary → 200 (got {r.status_code})")
            wk = r.json()
            check(wk["visits"] >= 1, f"visitas de la semana >= 1 → {wk['visits']}")
            check("streak_weeks" in wk and "best_session" in wk, "recap trae racha + mejor noche")

            step(8, "Autz: PLAYER no accede a /reports/*, sin token 401")
            r = c.post(f"{BASE}/reports/reengagement/refresh", headers=authw)
            check(r.status_code == 403, f"PLAYER en refresh → 403 (got {r.status_code})")
            r = c.get(f"{BASE}/reports/reengagement/lift")
            check(r.status_code == 401, f"sin token → 401 (got {r.status_code})")

            step(9, "Limpieza")
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
