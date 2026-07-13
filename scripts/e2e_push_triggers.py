"""e2e HTTP de los disparadores de Web Push: cron semanal (/player/push/run-weekly)
con racha en riesgo y reto casi logrado, hook "hoy hay mesa" y anuncio con dedupe.
Requiere uvicorn en :8010 con VAPID_* e INTERNAL_CRON_TOKEN en el env, y
E2E_DATABASE_URL apuntando a la MISMA DB temporal (para backdatear visitas:
la racha necesita historia y eso no se puede crear vía API con fechas de hoy).
Correr: E2E_DATABASE_URL=... venv/bin/python scripts/e2e_push_triggers.py"""
import asyncio
import os
import sys
import time
from datetime import datetime, timedelta

import asyncpg
import httpx

BASE = "http://127.0.0.1:8010"
CRON_TOKEN = os.environ.get("INTERNAL_CRON_TOKEN", "")
DB_DSN = os.environ.get("E2E_DATABASE_URL", "")
suffix = os.urandom(4).hex()
_pbase = int.from_bytes(os.urandom(4), "big") % 10**8

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


def phone_n(n):
    return f"31{(_pbase + n) % 10**8:08d}"


def club_con_jugador(c, tag, phone):
    """Registra club + jugador con cuenta PLAYER activada.
    Devuelve (headers_staff, headers_player, player_id)."""
    email = f"trig_{tag}_{suffix}@test.local"
    r = c.post("/auth/register", json={
        "name": f"Club Trig {tag}", "email": email,
        "password": "Push12345", "accept_terms": True})
    assert r.status_code == 201, f"register {tag}: {r.text}"
    r = c.post("/auth/login", data={"username": email, "password": "Push12345"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    p = c.post("/players/", json={"name": f"Jugador {tag}", "phone": phone,
                                  "club_id": 1}, headers=h).json()
    r = c.post(f"/players/{p['id']}/invite", json={"phone": phone}, headers=h)
    assert r.status_code == 201, f"invite {tag}: {r.text}"
    r = c.post("/players/activate", json={
        "phone": phone, "code": r.json()["code"], "password": "Jugador123"})
    assert r.status_code == 200, f"activate {tag}: {r.text}"
    hp = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return h, hp, p["id"]


def subscribe(c, hp, tag):
    r = c.post("/player/push/subscribe", json={
        "endpoint": f"https://push.example.test/trig/{suffix}-{tag}",
        "keys": {"p256dh": "BPk", "auth": "abc"}}, headers=hp)
    assert r.status_code == 200, f"subscribe {tag}: {r.text}"


def audit_count(c, h, action):
    r = c.get("/audit/logs", params={"action": action}, headers=h)
    assert r.status_code == 200, f"audit {action}: {r.text}"
    d = r.json()
    items = d["items"] if isinstance(d, dict) and "items" in d else d
    return len(items)


def sql(query, *args):
    async def _run():
        conn = await asyncpg.connect(DB_DSN.replace("postgresql+asyncpg://", "postgresql://"))
        try:
            return await conn.execute(query, *args)
        finally:
            await conn.close()
    return asyncio.run(_run())


def sql_fetch(query, *args):
    async def _run():
        conn = await asyncpg.connect(DB_DSN.replace("postgresql+asyncpg://", "postgresql://"))
        try:
            return await conn.fetch(query, *args)
        finally:
            await conn.close()
    return asyncio.run(_run())


assert CRON_TOKEN, "falta INTERNAL_CRON_TOKEN en el env"
assert DB_DSN, "falta E2E_DATABASE_URL en el env"
CRON_H = {"X-Internal-Token": CRON_TOKEN}

with httpx.Client(base_url=BASE, timeout=30) as c:
    hA, hpA, pidA = club_con_jugador(c, "a", phone_n(1))
    hB, hpB, pidB = club_con_jugador(c, "b", phone_n(2))

    # --- auth del endpoint interno ---
    r = c.post("/player/push/run-weekly")
    check("run-weekly sin token → 401", r.status_code == 401)
    r = c.post("/player/push/run-weekly", headers={"X-Internal-Token": "malo"})
    check("run-weekly token inválido → 401", r.status_code == 401)

    subscribe(c, hpA, "a")
    subscribe(c, hpB, "b")

    # --- corrida sin historia: nadie tiene nada que celebrar ---
    r = c.post("/player/push/run-weekly?dry_run=true", headers=CRON_H)
    check("dry-run 200", r.status_code == 200)
    d = r.json()
    check("dry-run: 2 suscritos, 0 mensajes", d["subscribed_users"] == 2
          and d["sent"] == 0 and d["no_message"] == 2)

    # --- hook "hoy hay mesa": 1ª mesa avisa, la 2ª no (dedupe diario) ---
    r = c.post("/sessions/", json={"name": "Mesa 1"}, headers=hA)
    check("abrir mesa 1 → 200", r.status_code == 200)
    sidA = r.json()["id"]
    time.sleep(1.2)  # el aviso es fire-and-forget
    check("mesa: audit PUSH_TABLE_OPEN == 1", audit_count(c, hA, "PUSH_TABLE_OPEN") == 1)
    r = c.post("/sessions/", json={"name": "Mesa 2"}, headers=hA)
    check("abrir mesa 2 → 200", r.status_code == 200)
    time.sleep(1.2)
    check("mesa: 2ª apertura NO re-avisa (dedupe diario)",
          audit_count(c, hA, "PUSH_TABLE_OPEN") == 1)

    # --- anuncio: avisa una vez; mismo texto no; texto nuevo cae al dedupe ---
    r = c.patch("/config/club-public", json={"public_announcement": "Hoy se rompe 8pm"}, headers=hA)
    check("anuncio → 200", r.status_code == 200)
    time.sleep(1.2)
    check("anuncio: audit PUSH_ANNOUNCEMENT == 1", audit_count(c, hA, "PUSH_ANNOUNCEMENT") == 1)
    c.patch("/config/club-public", json={"public_announcement": "Hoy se rompe 8pm"}, headers=hA)
    c.patch("/config/club-public", json={"public_announcement": "Bounty 9pm"}, headers=hA)
    time.sleep(1.2)
    check("anuncio: repetido y cambio el mismo día NO re-avisan",
          audit_count(c, hA, "PUSH_ANNOUNCEMENT") == 1)

    # --- racha en riesgo (club A): 2 buyins backdateados a -7 y -14 días ---
    for _ in range(2):
        r = c.post("/transactions/buyin", json={
            "player_id": pidA, "amount": 50000, "method": "CASH",
            "session_id": sidA}, headers=hA)
        assert r.status_code in (200, 201), f"buyin A: {r.text}"
    rows = sql_fetch(
        "SELECT t.id FROM transactions t WHERE t.session_id=$1 AND t.player_id=$2 ORDER BY t.id",
        sidA, pidA)
    assert len(rows) == 2, f"esperaba 2 buyins, hay {len(rows)}"
    now = datetime.utcnow()
    sql("UPDATE transactions SET timestamp=$1 WHERE id=$2", now - timedelta(days=7), rows[0]["id"])
    sql("UPDATE transactions SET timestamp=$1 WHERE id=$2", now - timedelta(days=14), rows[1]["id"])
    sql("UPDATE players SET stats_since=NULL WHERE id=$1", pidA)

    # --- reto casi logrado (club B): visitas 4/5 este mes ---
    r = c.put("/config/monthly-challenges", json={"challenges": [
        {"title": "Meta de visitas", "metric": "visitas", "target": 5}]}, headers=hB)
    check("PUT reto club B → 200", r.status_code == 200)
    sidsB = []
    for i in range(4):
        r = c.post("/sessions/", json={"name": f"Mesa B{i}"}, headers=hB)
        assert r.status_code == 200, f"mesa B{i}: {r.text}"
        sidsB.append(r.json()["id"])
        r = c.post("/transactions/buyin", json={
            "player_id": pidB, "amount": 50000, "method": "CASH",
            "session_id": sidsB[-1]}, headers=hB)
        assert r.status_code in (200, 201), f"buyin B{i}: {r.text}"
    # Cerrarlas por SQL con end_time de hace 2 días (mismo mes, misma semana:
    # la racha NO está en riesgo → el aviso debe ser el del reto).
    for sid in sidsB:
        sql("UPDATE sessions SET status='CLOSED', start_time=$1, end_time=$2 WHERE id=$3",
            now - timedelta(days=2, hours=3), now - timedelta(days=2), sid)
    sql("UPDATE players SET stats_since=NULL WHERE id=$1", pidB)

    # --- corrida real: racha para A, reto para B ---
    r = c.post("/player/push/run-weekly", headers=CRON_H)
    check("run-weekly real 200", r.status_code == 200)
    d = r.json()
    check("run-weekly: 2 enviados", d["sent"] == 2)
    reasons = sorted(x["reason"] for x in d["details"])
    check("motivos = challenge + streak", reasons == ["challenge", "streak"])

    # --- idempotencia semanal: la 2ª corrida no re-envía ---
    r = c.post("/player/push/run-weekly", headers=CRON_H)
    d = r.json()
    check("re-corrida: 0 enviados, 2 dedupe", d["sent"] == 0 and d["skipped_dedupe"] == 2)

print(f"\ne2e push triggers: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
