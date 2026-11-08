#!/usr/bin/env python3
"""E2E: borrar un torneo que tuvo mesas, turnos de dealer y alertas. LOCAL.

Antes del fix, DELETE /tournaments/{id} reventaba con FK (500) si el torneo
alguna vez tuvo mesas. Levanta su propio backend en :8019 contra la DB local
(docker poker_db) y limpia su club sintético al final vía delete-account.

    ./venv/bin/python scripts/e2e_delete_torneo.py
    E2E_ROOT=/otro/checkout ./venv/bin/python scripts/e2e_delete_torneo.py   # correr contra otro código
"""
import os
import pathlib
import subprocess
import sys
import time

import httpx

ROOT = pathlib.Path(os.environ.get("E2E_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
PORT = 8019
BASE = f"http://127.0.0.1:{PORT}"
SUF = os.urandom(3).hex()
PASS = "DelTorneo12345"


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


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", "poker_db", "psql", "-U", "poker_admin", "-d", "poker_treasury_db",
         "-t", "-A", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_ok = 0


def check(cond, msg):
    global _ok
    if not cond:
        print(f"  \033[91m✗ {msg}\033[0m")
        raise SystemExit(1)
    _ok += 1
    print(f"  \033[92m✓\033[0m {msg}")


def main():
    proc = subprocess.Popen(
        [str(ROOT / "venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    headers = None
    try:
        for _ in range(30):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            check(False, "el backend no levantó")

        with httpx.Client(base_url=BASE, timeout=30) as c:
            email = f"del-torneo-{SUF}@rakeflow.local"
            r = c.post("/auth/register", json={"name": f"Club Del {SUF}", "email": email,
                                               "password": PASS, "accept_terms": True})
            check(r.status_code == 201, "club sintético creado")
            cid = int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))
            psql(f"UPDATE clubs SET is_active=true, setup_completed=true WHERE id={cid};")
            tok = c.post("/auth/login", data={"username": email, "password": PASS}).json()["access_token"]
            headers = {"Authorization": f"Bearer {tok}"}

            r = c.post("/tournaments/", headers=headers, json={
                "name": f"Del {SUF}", "buyin_amount": 50000, "rake_percentage": 10,
                "dealer_tip_amount": 0, "bounty_amount": 0, "rebuy_price": 0, "double_rebuy_price": 0,
                "addon_price": 0, "double_addon_price": 0, "payout_structure": [100]})
            check(r.status_code == 200, "torneo creado")
            tid = r.json()["id"]

            r = c.post(f"/tournaments/{tid}/tables", headers=headers, json={"max_seats": 9, "count": 2})
            check(r.status_code == 200, f"2 mesas creadas (got {r.status_code}: {r.text[:120]})")
            table_ids = [int(x) for x in psql(f"SELECT id FROM tournament_tables WHERE tournament_id={tid} ORDER BY id").split()]

            r = c.post("/dealers/", headers=headers, json={"name": f"Dealer {SUF}", "tournament_hourly_rate_cop": 20000})
            check(r.status_code == 201, "dealer creado")
            r = c.post(f"/tournaments/{tid}/tables/{table_ids[0]}/dealer", headers=headers,
                       json={"dealer_id": r.json()["id"]})
            check(r.status_code == 200, f"turno de dealer abierto en la mesa 1 (got {r.status_code}: {r.text[:120]})")
            psql(f"INSERT INTO dealer_alerts (club_id, tournament_table_id, alert_type, status, created_at) "
                 f"VALUES ({cid}, {table_ids[0]}, 'CHIPS', 'PENDING', now());")

            r = c.post("/players/", headers=headers, json={"name": f"Jugador {SUF}", "club_id": cid})
            r = c.post(f"/tournaments/{tid}/register", headers=headers,
                       json={"player_id": r.json()["id"], "pay_buyin": True})
            check(r.status_code == 200, "jugador inscrito (y sentado en una mesa)")

            q = (f"SELECT (SELECT count(*) FROM tournament_tables WHERE tournament_id={tid}),"
                 f"(SELECT count(*) FROM tournament_dealer_shifts WHERE tournament_id={tid}),"
                 f"(SELECT count(*) FROM dealer_alerts WHERE tournament_table_id IN ({','.join(map(str, table_ids))})),"
                 f"(SELECT count(*) FROM tournament_players WHERE tournament_id={tid}),"
                 f"(SELECT count(*) FROM transactions WHERE tournament_id={tid})")
            check(psql(q) == "2|1|1|1|1", f"antes: 2 mesas, 1 turno, 1 alerta, 1 jugador, 1 cobro (got {psql(q)})")

            r = c.delete(f"/tournaments/{tid}", headers=headers)
            check(r.status_code == 204, f"borrar torneo con mesas/turnos/alertas → 204 (got {r.status_code}: {r.text[:150]})")
            check(psql(q) == "0|0|0|0|0", f"después: todo lo del torneo borrado (got {psql(q)})")
            check(psql(f"SELECT count(*) FROM tournaments WHERE id={tid}") == "0", "el torneo ya no existe")

            # --- Borrar UNA mesa en pleno torneo ---
            r = c.post("/tournaments/", headers=headers, json={
                "name": f"Mesas {SUF}", "buyin_amount": 50000, "rake_percentage": 10,
                "dealer_tip_amount": 0, "bounty_amount": 0, "rebuy_price": 0, "double_rebuy_price": 0,
                "addon_price": 0, "double_addon_price": 0, "payout_structure": [100]})
            tid2 = r.json()["id"]
            c.post(f"/tournaments/{tid2}/tables", headers=headers, json={"max_seats": 9, "count": 2})
            t_dealer, t_vacia = [int(x) for x in psql(f"SELECT id FROM tournament_tables WHERE tournament_id={tid2} ORDER BY id").split()]
            r = c.post("/dealers/", headers=headers, json={"name": f"Dealer2 {SUF}", "tournament_hourly_rate_cop": 20000})
            check(r.status_code == 201, "segundo dealer creado")
            r = c.post(f"/tournaments/{tid2}/tables/{t_dealer}/dealer", headers=headers, json={"dealer_id": r.json()["id"]})
            check(r.status_code == 200, "turno abierto en la mesa con dealer")
            for tt in (t_dealer, t_vacia):
                psql(f"INSERT INTO dealer_alerts (club_id, tournament_table_id, alert_type, status, created_at) "
                     f"VALUES ({cid}, {tt}, 'WAITER', 'PENDING', now());")

            r = c.delete(f"/tournaments/{tid2}/tables/{t_vacia}", headers=headers)
            check(r.status_code == 200, f"borrar mesa SIN dealer con alerta → 200 (got {r.status_code}: {r.text[:150]})")
            check(psql(f"SELECT count(*) FROM tournament_tables WHERE id={t_vacia}") == "0", "mesa sin dealer: borrada de verdad")
            check(psql(f"SELECT count(*) FROM dealer_alerts WHERE tournament_table_id={t_vacia}") == "0", "sus alertas también")

            r = c.delete(f"/tournaments/{tid2}/tables/{t_dealer}", headers=headers)
            check(r.status_code == 200, f"borrar mesa CON dealer → 200, no 500 (got {r.status_code}: {r.text[:150]})")
            check(psql(f"SELECT status FROM tournament_tables WHERE id={t_dealer}") == "CLOSED", "mesa con dealer: queda CERRADA, no borrada")
            check(psql(f"SELECT count(*) FROM tournament_dealer_shifts WHERE table_id={t_dealer} AND end_time IS NOT NULL") == "1",
                  "su turno se cerró y se conserva (pago del dealer intacto)")

            check(psql(f"SELECT count(*) FROM audit_logs WHERE club_id={cid} AND action='TOURNAMENT_DEALER_END'") == "1",
                  "auditoría: el cierre del turno queda registrado")
            r = c.post(f"/tournaments/{tid2}/tables/{t_dealer}/dealer", headers=headers,
                       json={"dealer_id": int(psql(f"SELECT dealer_id FROM tournament_dealer_shifts WHERE table_id={t_dealer}"))})
            check(r.status_code == 409, f"asignar dealer a mesa CERRADA → 409 (got {r.status_code})")
            r = c.delete(f"/tournaments/{tid2}", headers=headers)
            check(r.status_code == 204, "y el torneo completo se borra limpio después")
    finally:
        if headers:
            try:
                httpx.delete(f"{BASE}/me/delete-account", headers=headers, timeout=30)
            except Exception as e:
                print(f"  (limpieza falló: {e})")
        proc.terminate()
        proc.wait(timeout=10)
    print(f"\n\033[92m\033[1m✓ TODO OK — {_ok} chequeos pasaron\033[0m")


if __name__ == "__main__":
    sys.exit(main())
