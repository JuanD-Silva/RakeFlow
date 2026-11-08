#!/usr/bin/env python3
"""E2E de la pre-inscripción pública a torneos. LOCAL, no toca prod.

Levanta su propio backend en :8017 y prueba, de punta a punta:
  1. Ficha pública: specs completas, SIN rake/premiación/nombres; contador.
  2. Pre-inscribir: cupo, lista de espera, idempotencia por teléfono, validación.
  3. Aislamiento: token de otro club no ve el torneo; staff de otro club no
     lista ni confirma; player_id de otro club no se puede usar.
  4. Staff: lista con sugerencia de ficha por teléfono; confirmar cobra el
     buy-in UNA vez con el mismo flujo que la inscripción manual; reusar ficha
     existente vs crear nueva; ya-inscrito no cobra doble; cancelar sube la espera.
  5. Cupo editable; cerrado cuando el torneo corre; borrar torneo con pre-inscritos.
  6. Regresión: la inscripción manual (register) sigue cobrando igual.

Requisitos: Docker Postgres :5433 arriba (docker compose up -d), .env local.
Uso: ./venv/bin/python scripts/e2e_preinscripcion.py
"""
import os
import pathlib
import subprocess
import sys
import time

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8017
BASE = f"http://127.0.0.1:{PORT}"
CONTAINER, DB_USER, DB_NAME = "poker_db", "poker_admin", "poker_treasury_db"
SUF = os.urandom(3).hex()
PASS = "Prereg12345"
BUYIN, TIP = 50000, 10000


def load_env(path):
    p = ROOT / path
    if not p.exists():
        return {}
    env = {}
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
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-F", "\t", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0


def check(cond, m):
    global _passed
    if cond:
        _passed += 1
        print(f"  \033[92m✓\033[0m {m}")
    else:
        print(f"  \033[91m✗ {m}\033[0m")
        sys.exit(1)


def step(n, m):
    print(f"\n\033[1m[{n}] {m}\033[0m")


_BASE_PHONE = 3000000000 + int(SUF, 16) % 10**6 * 1000


def phone(n):  # 10 dígitos CO únicos por corrida; la DB guarda 57 + número
    return str(_BASE_PHONE + n)


def new_club(c, tag):
    email = f"prereg-{tag}-{SUF}@rakeflow.local"
    r = c.post("/auth/register", json={"name": f"Club Prereg {tag}", "email": email,
                                       "password": PASS, "accept_terms": True})
    assert r.status_code == 201, r.text
    cid = int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))
    token = f"tok-prereg-{tag}-{SUF}"
    psql(f"UPDATE clubs SET public_token='{token}', is_active=true WHERE id={cid};")
    r = c.post("/auth/login", data={"username": email, "password": PASS})
    return cid, token, {"Authorization": f"Bearer {r.json()['access_token']}"}


def money_in(tid, ttype):
    return int(psql(f"SELECT coalesce(sum(amount),0) FROM transactions WHERE tournament_id={tid} AND type='{ttype}'") or 0)


def main():
    step(0, f"Backend local en :{PORT}")
    proc = subprocess.Popen(
        ["./venv/bin/uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    clubs = []
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
        check(True, f"backend en {BASE}")

        with httpx.Client(base_url=BASE, timeout=30) as c:
            step(1, "Dos clubes + torneo programado con cupo 2")
            c1, tok1, h1 = new_club(c, "a")
            c2, tok2, h2 = new_club(c, "b")
            clubs += [c1, c2]
            r = c.post("/tournaments/", headers=h1, json={
                "name": f"Prereg {SUF}", "buyin_amount": BUYIN, "rake_percentage": 15,
                "dealer_tip_amount": TIP, "bounty_amount": 20000,
                "rebuy_price": 40000, "double_rebuy_price": 70000,
                "addon_price": 30000, "double_addon_price": 0,
                "payout_structure": [60, 40], "starting_stack": 20000,
                "rebuy_chips": 20000, "addon_chips": 25000,
                "rebuy_until_level": 4, "addon_until_level": 6,
                "scheduled_start": "2026-12-20T00:00:00", "max_entries": 2,
            })
            check(r.status_code == 200, f"crear torneo → 200 (got {r.status_code}: {r.text[:120]})")
            t = r.json()
            tid = t["id"]
            check(t["status"] == "SCHEDULED" and t["max_entries"] == 2, "SCHEDULED con max_entries=2")

            step(2, "Ficha pública: specs completas y nada sensible")
            r = c.get(f"/public/clubs/{tok1}/tournaments/{tid}")
            check(r.status_code == 200, f"GET ficha → 200 (got {r.status_code})")
            body = r.json()
            ft = body["tournament"]
            check(ft["buyin"] == BUYIN and ft["dealer_tip"] == TIP and ft["bounty"] == 20000, "precios: entrada, propina, bounty")
            check(ft["rebuy_price"] == 40000 and ft["double_rebuy_price"] == 70000 and ft["rebuy_until_level"] == 4, "rebuys + hasta nivel 4")
            check(ft["addon_price"] == 30000 and ft["addon_until_level"] == 6, "add-on + hasta nivel 6")
            check(ft["starting_stack"] == 20000 and len(ft["blind_structure"]) > 0, "stack inicial + estructura de blinds")
            check(ft["registration_open"] is True, "inscripción abierta")
            check(ft["scheduled_start"] == "2026-12-20T00:00:00", "fecha = hora de pared del club, sin offset (igual que /activity)")
            flat = r.text.lower()
            check("rake" not in flat and "payout" not in flat and "prize" not in flat, "no expone rake ni premiación")
            check(body["occupancy"] == {"max_entries": 2, "taken": 0, "waitlist": 0, "full": False}, f"contador 0/2 (got {body['occupancy']})")
            check(body["currency"] == "COP", "moneda del club")

            step(3, "Pre-inscribir: cupo, espera, idempotencia, validación")
            A, B, C, D = phone(1), phone(2), phone(3), phone(4)
            # B ya tiene ficha en el directorio (debe reusarse al confirmar).
            psql(f"INSERT INTO players (club_id, name, phone) VALUES ({c1}, 'Ficha B {SUF}', '57{B}');")
            fichaB = int(psql(f"SELECT id FROM players WHERE club_id={c1} AND phone='57{B}'"))

            def pre(name, ph, tok=tok1, t_id=tid):
                return c.post(f"/public/clubs/{tok}/tournaments/{t_id}/preregister",
                              json={"name": name, "phone": ph})

            r = pre("  Ana   Pérez ", A)
            check(r.status_code == 200 and r.json()["spot"] == "CUPO" and r.json()["name"] == "Ana Pérez", f"A → CUPO, nombre limpio (got {r.text[:100]})")
            r = pre("Beto", B)
            check(r.json()["spot"] == "CUPO", "B → CUPO")
            r = pre("Caro", C)
            check(r.json()["spot"] == "WAITLIST" and r.json()["waitlist_position"] == 1, "C → espera #1")
            check(r.json()["occupancy"]["full"] is True and r.json()["occupancy"]["waitlist"] == 1, "contador lleno 2/2 + 1 en espera")
            r = pre("Ana otra vez", f"+57 {A[:3]} {A[3:]}")
            check(r.json()["spot"] == "CUPO" and r.json()["created"] is False, "repetir A (otro formato) → mismo lugar, sin duplicar")
            check(r.json()["name"] == "Ana otra vez" and "Ana Pérez" not in r.text, "repetir teléfono NO revela el nombre guardado (anti-enumeración)")
            check(psql(f"SELECT count(*) FROM tournament_preregistrations WHERE tournament_id={tid}") == "3", "3 pre-inscripciones en DB")
            check(pre("Xavi", "123").status_code == 422, "teléfono corto → 422")
            check(pre("Yoli", "abcdefghij").status_code == 400, "teléfono sin dígitos → 400")
            check(pre("Zoe", "3001234").status_code == 400, "7 dígitos (no es celular) → 400")
            check(pre("Z", phone(5)).status_code == 422, "nombre de 1 letra → 422")
            check(pre("Zoe", phone(8), tok=tok2).status_code == 404, "token de OTRO club → 404")
            check(c.get(f"/public/clubs/{tok2}/tournaments/{tid}").status_code == 404, "ficha con token ajeno → 404")
            check(psql(f"SELECT count(*) FROM players WHERE club_id={c1}") == "1", "el formulario NO creó fichas")
            check(money_in(tid, "TOURNAMENT_ENTRY") == 0, "el formulario NO movió plata")

            step(4, "Staff: lista, aislamiento y confirmar")
            r = c.get(f"/tournaments/{tid}/preregistrations", headers=h1)
            check(r.status_code == 200, "lista → 200")
            rows = r.json()["preregistrations"]
            check([x["spot"] for x in rows] == ["CUPO", "CUPO", "WAITLIST"], "orden: 2 en cupo + 1 en espera")
            byphone = {x["phone"]: x for x in rows}
            check(byphone[f"57{B}"]["match_player"]["id"] == fichaB, "sugiere la ficha existente de B")
            check(byphone[f"57{A}"]["match_player"] is None, "A sin ficha sugerida")
            check(c.get(f"/tournaments/{tid}/preregistrations", headers=h2).status_code == 404, "staff de OTRO club no lista → 404")
            pa = byphone[f"57{A}"]["id"]
            pb = byphone[f"57{B}"]["id"]
            pc = byphone[f"57{C}"]["id"]
            r = c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h1, json={"pay_buyin": True})
            check(r.status_code == 400, "confirmar con torneo SCHEDULED → 400 (abrir primero)")
            check(c.post(f"/tournaments/{tid}/open", headers=h1).status_code == 200, "abrir torneo → REGISTERING")
            check(c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h2, json={}).status_code == 404,
                  "staff de OTRO club no confirma → 404")
            r = c.post("/players/", headers=h2, json={"name": f"Ajeno {SUF}", "phone": phone(9), "club_id": c2})
            check(r.status_code in (200, 201), f"ficha en club B (got {r.status_code})")
            otro = int(r.json()["id"])
            r = c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h1, json={"player_id": otro})
            check(r.status_code == 404, f"player_id de OTRO club → 404 (got {r.status_code})")
            check(psql(f"SELECT status FROM tournament_preregistrations WHERE id={pa}") == "PENDING", "tras el 404 sigue PENDING (rollback)")

            r = c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h1, json={"pay_buyin": True, "pay_tip": True})
            check(r.status_code == 200, f"confirmar A → 200 (got {r.status_code}: {r.text[:120]})")
            check(psql(f"SELECT count(*) FROM players WHERE club_id={c1} AND phone='57{A}'") == "1", "A: ficha nueva creada al confirmar")
            check(money_in(tid, "TOURNAMENT_ENTRY") == BUYIN and money_in(tid, "TOURNAMENT_TIP") == TIP, "cobró buy-in + propina UNA vez")
            r = c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h1, json={"pay_buyin": True})
            check(r.status_code == 400 and money_in(tid, "TOURNAMENT_ENTRY") == BUYIN, "re-confirmar A → 400, sin cobro doble")

            # B: el staff lo inscribió a mano antes de ver la lista → confirmar no cobra otra vez.
            r = c.post(f"/tournaments/{tid}/register", headers=h1, json={"player_id": fichaB, "pay_buyin": True})
            check(r.status_code == 200, "regresión: inscripción manual de B → 200")
            check(money_in(tid, "TOURNAMENT_ENTRY") == 2 * BUYIN, "regresión: la manual cobró su buy-in")
            r = c.post(f"/tournaments/{tid}/preregistrations/{pb}/confirm", headers=h1, json={"pay_buyin": True})
            check(r.status_code == 200 and money_in(tid, "TOURNAMENT_ENTRY") == 2 * BUYIN, "confirmar B ya inscrito → 200 sin cobro doble")
            check(psql(f"SELECT count(*) FROM players WHERE club_id={c1} AND phone='57{B}'") == "1", "B: reusó su ficha (sin duplicar)")
            check(psql(f"SELECT player_id FROM tournament_preregistrations WHERE id={pb}") == str(fichaB), "B vinculada a su ficha")
            r = pre("Ana de nuevo", A)
            check(r.json()["already_entered"] is True, "A ya inscrito → el formulario lo dice")

            # Carrera: 4 inscripciones simultáneas del MISMO jugador (dos cajeros, o
            # Inscribir + "Llegó"). El advisory lock de _register_core deja pasar una.
            from concurrent.futures import ThreadPoolExecutor
            r = c.post("/tournaments/", headers=h1, json={
                "name": f"Carrera {SUF}", "buyin_amount": BUYIN, "rake_percentage": 10,
                "dealer_tip_amount": 0, "bounty_amount": 0, "rebuy_price": 0, "double_rebuy_price": 0,
                "addon_price": 0, "double_addon_price": 0, "payout_structure": [100]})
            tid_race = r.json()["id"]
            r = c.post("/players/", headers=h1, json={"name": f"Carrera {SUF}", "phone": phone(7), "club_id": c1})
            pid_race = r.json()["id"]

            def reg_once(_):
                with httpx.Client(base_url=BASE, timeout=30) as cc:
                    return cc.post(f"/tournaments/{tid_race}/register", headers=h1,
                                   json={"player_id": pid_race, "pay_buyin": True}).status_code
            with ThreadPoolExecutor(4) as ex:
                codes = list(ex.map(reg_once, range(4)))
            check(codes.count(200) == 1, f"carrera x4 → exactamente una inscripción OK (got {codes})")
            check(money_in(tid_race, "TOURNAMENT_ENTRY") == BUYIN, "carrera x4 → un solo buy-in cobrado")
            check(psql(f"SELECT count(*) FROM tournament_players WHERE tournament_id={tid_race}") == "1", "carrera x4 → una sola fila de jugador")

            step(5, "Cupo, espera y cancelar")
            occ = c.get(f"/tournaments/{tid}/preregistrations", headers=h1).json()["occupancy"]
            check(occ["entered"] == 2 and occ["waitlist"] == 1 and occ["full"], f"2 inscritos llenan el cupo; C sigue en espera (got {occ})")
            r = c.patch(f"/tournaments/{tid}/max-entries", headers=h1, json={"max_entries": 3})
            check(r.status_code == 200 and r.json()["max_entries"] == 3, "subir cupo a 3")
            r = pre("Caro", C)
            check(r.json()["spot"] == "CUPO", "C pasa sola a CUPO al subir el cupo")
            check(pre("Dani", D).json()["spot"] == "WAITLIST", "D → espera")
            r = c.post(f"/tournaments/{tid}/preregistrations/{pc}/cancel", headers=h1)
            check(r.status_code == 200, "cancelar C → 200")
            check(pre("Dani", D).json()["spot"] == "CUPO", "D sube a CUPO al cancelar C")
            check(c.post(f"/tournaments/{tid}/preregistrations/{pc}/cancel", headers=h1).status_code == 400, "cancelar dos veces → 400")
            r = pre("Caro vuelve", C)
            check(r.status_code == 200 and r.json()["created"] is True, "C cancelada puede volver a inscribirse")
            check(c.patch(f"/tournaments/{tid}/max-entries", headers=h1, json={"max_entries": None}).json()["max_entries"] is None, "quitar cupo → sin límite")
            check(c.patch(f"/tournaments/{tid}/max-entries", headers=h1, json={"max_entries": 0}).status_code == 422, "cupo 0 → 422")
            check(c.patch(f"/tournaments/{tid}/max-entries", headers=h2, json={"max_entries": 5}).status_code == 404, "cupo de torneo ajeno → 404")

            # Re-entrada por el link: A (confirmada) queda eliminada y vuelve a reservar.
            pidA = int(psql(f"SELECT player_id FROM tournament_preregistrations WHERE id={pa}"))
            antes = money_in(tid, "TOURNAMENT_ENTRY")
            r = c.post(f"/tournaments/{tid}/players/{pidA}/eliminate", headers=h1)
            check(r.status_code == 200, f"eliminar a A → 200 (got {r.status_code})")
            r = pre("Ana re-entra", A)
            check(r.json()["already_entered"] is False and r.json()["spot"] in ("CUPO", "WAITLIST") and r.json()["created"] is True,
                  f"A eliminada → puede reservar re-entrada (got {r.text[:120]})")
            check(psql(f"SELECT status FROM tournament_preregistrations WHERE id={pa}") == "PENDING", "su reserva se reabre (sin duplicar fila)")
            r = c.post(f"/tournaments/{tid}/preregistrations/{pa}/confirm", headers=h1, json={"pay_buyin": True})
            check(r.status_code == 200 and r.json()["status"] == "ACTIVE", "Llegó → A vuelve ACTIVE")
            check(money_in(tid, "TOURNAMENT_ENTRY") == antes + BUYIN, "la re-entrada cobra un buy-in más")
            check(pre("Ana otra vez", A).json()["already_entered"] is True, "A jugando de nuevo → 'ya inscrito'")

            step(6, "Cerrado cuando corre + borrar torneo con pre-inscritos")
            psql(f"UPDATE tournaments SET status='RUNNING' WHERE id={tid};")
            check(c.get(f"/public/clubs/{tok1}/tournaments/{tid}").json()["tournament"]["registration_open"] is False, "RUNNING → ficha visible, inscripción cerrada")
            check(pre("Tarde", phone(7)).status_code == 400, "RUNNING → pre-inscribir 400")
            r = c.delete(f"/tournaments/{tid}", headers=h1)
            check(r.status_code == 204, f"borrar torneo con pre-inscritos → 204 (got {r.status_code}: {r.text[:120]})")
            check(psql(f"SELECT count(*) FROM tournament_preregistrations WHERE tournament_id={tid}") == "0", "pre-inscripciones borradas")
            check(c.get(f"/public/clubs/{tok1}/tournaments/{tid}").status_code == 404, "ficha de torneo borrado → 404")

        print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")
    finally:
        for cid in clubs:  # limpieza de la data sintética de esta corrida
            try:
                psql(f"DELETE FROM tournament_preregistrations WHERE club_id={cid};")
                psql(f"DELETE FROM transactions WHERE player_id IN (SELECT id FROM players WHERE club_id={cid});")
                psql(f"DELETE FROM tournament_players WHERE player_id IN (SELECT id FROM players WHERE club_id={cid});")
                psql(f"DELETE FROM tournaments WHERE club_id={cid};")
                psql(f"DELETE FROM players WHERE club_id={cid};")
                psql(f"DELETE FROM audit_logs WHERE club_id={cid};")
                psql(f"DELETE FROM users WHERE club_id={cid};")
                psql(f"DELETE FROM distribution_rules WHERE club_id={cid};")
                psql(f"DELETE FROM clubs WHERE id={cid};")
            except Exception as e:
                print(f"  (limpieza club {cid}: {e})")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main()
