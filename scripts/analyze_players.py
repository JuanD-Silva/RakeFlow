"""Fase 0.1 del Panel del Jugador: análisis de calidad de datos de jugadores.

100% READ-ONLY (corre con el rol rakeflow_ro). Genera el insumo para decidir
qué fichas fusionar/borrar ANTES de vender el histórico a los jugadores:

  1. Censo y actividad por jugador (dimensiona el mercado del histórico).
  2. Duplicados candidatos por confianza (teléfono > nombre exacto > typo).
  3. Calidad para invitaciones (sin teléfono / no normalizable / fantasmas).
  4. Chequeos de integridad que distorsionarían las stats del panel.

Uso:
  python scripts/analyze_players.py "$RO_DATABASE_URL" [club_id] [--json salida.json]

El DSN puede llevar ?sslmode=require; se conecta con ssl sin verificar cert
(cadena self-signed de Railway, mismo workaround de la auditoría 2026-05-22).
"""
import asyncio
import json
import re
import ssl
import sys
import unicodedata
from collections import defaultdict

import asyncpg


# --- normalizadores (copia fiel de app/phone_utils.normalize_phone) ---------

def normalize_phone(raw):
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if len(digits) == 10:
        digits = "57" + digits
    elif digits.startswith("0057"):
        digits = digits[2:]
    return digits


def is_junk_phone(normalized):
    """Teléfono de relleno del staff: corto, todos los dígitos iguales, o que
    no da un celular CO válido (57 + 10 dígitos empezando en 3)."""
    if not normalized:
        return True
    if re.fullmatch(r"(\d)\1+", normalized):  # 000, 1111111111...
        return True
    return not re.fullmatch(r"573\d{9}", normalized)


def normalize_name(raw):
    """lower, sin tildes, espacios colapsados."""
    if not raw:
        return ""
    s = unicodedata.normalize("NFKD", raw)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower().strip())


def edit_distance(a, b, cap=3):
    """Levenshtein con corte temprano (solo nos importa <= 2)."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            best = min(best, cur[j])
        if best > cap:
            return cap + 1
        prev = cur
    return prev[-1]


# --- queries (todas por club_id, todas read-only) ----------------------------

CENSO_SQL = """
SELECT p.id, p.name, p.phone, p.created_at,
       COUNT(DISTINCT t.session_id) FILTER (WHERE t.type IN ('BUYIN','REBUY'))   AS cash_sessions,
       COUNT(t.id)                                                                AS tx_count,
       COALESCE(SUM(t.amount), 0)                                                 AS total_moved,
       MIN(t.timestamp)                                                           AS first_tx,
       MAX(t.timestamp)                                                           AS last_tx,
       (SELECT COUNT(*) FROM tournament_players tp
         JOIN tournaments tor ON tor.id = tp.tournament_id
        WHERE tp.player_id = p.id AND tor.club_id = p.club_id)                    AS tournaments
FROM players p
LEFT JOIN transactions t ON t.player_id = p.id
WHERE p.club_id = $1
GROUP BY p.id
"""

# Torneo cuyo jugador es de OTRO club (residuo cross-tenant, bug pre-5ac2120)
CROSS_TENANT_TP_SQL = """
SELECT tp.id AS tp_id, tp.tournament_id, tp.player_id,
       tor.club_id AS tournament_club, p.club_id AS player_club
FROM tournament_players tp
JOIN tournaments tor ON tor.id = tp.tournament_id
JOIN players p ON p.id = tp.player_id
WHERE tor.club_id <> p.club_id
"""

BAD_COUNTERS_SQL = """
SELECT tp.id, tp.tournament_id, tp.player_id, tp.rebuys_count, tp.double_rebuys_count,
       tp.addons_count, tp.double_addons_count
FROM tournament_players tp
JOIN tournaments tor ON tor.id = tp.tournament_id
WHERE tor.club_id = $1
  AND (tp.double_rebuys_count > tp.rebuys_count
       OR tp.double_addons_count > tp.addons_count
       OR tp.rebuys_count < 0 OR tp.addons_count < 0)
"""

ANON_MONEY_TX_SQL = """
SELECT t.type, COUNT(*) AS n, COALESCE(SUM(t.amount),0) AS total
FROM transactions t
JOIN sessions s ON s.id = t.session_id
WHERE s.club_id = $1 AND t.player_id IS NULL
  AND t.type IN ('BUYIN','REBUY','CASHOUT')
GROUP BY t.type
"""

STALE_OPEN_SQL = """
SELECT id, name, start_time FROM sessions
WHERE club_id = $1 AND status = 'OPEN' AND start_time < now() - interval '2 days'
"""


def row_summary(p):
    return {
        "id": p["id"], "name": p["name"], "phone": p["phone"],
        "created_at": str(p["created_at"])[:10],
        "cash_sessions": p["cash_sessions"], "tournaments": p["tournaments"],
        "tx_count": p["tx_count"], "total_moved": float(p["total_moved"]),
        "last_activity": str(p["last_tx"])[:10] if p["last_tx"] else None,
    }


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dsn = args[0]
    club_id = int(args[1]) if len(args) > 1 else 3  # Mambo
    json_out = None
    if "--json" in sys.argv:
        json_out = sys.argv[sys.argv.index("--json") + 1]

    if "localhost" in dsn or "127.0.0.1" in dsn:
        conn = await asyncpg.connect(dsn.split("?")[0])
    else:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = await asyncpg.connect(dsn.split("?")[0], ssl=ctx)
    ro = await conn.fetchval("SELECT current_user")
    print(f"Conectado como {ro} (club_id={club_id})\n")

    players = await conn.fetch(CENSO_SQL, club_id)
    report = {"club_id": club_id, "as_of": str(await conn.fetchval("SELECT now()"))}

    # ---- 1. CENSO ----
    total = len(players)
    active = [p for p in players if p["tx_count"] > 0 or p["tournaments"] > 0]
    ghosts = [p for p in players if p["tx_count"] == 0 and p["tournaments"] == 0]
    buckets = {"1-4": 0, "5-9": 0, "10-24": 0, "25+": 0}
    for p in active:
        visits = p["cash_sessions"] + p["tournaments"]
        if visits >= 25:
            buckets["25+"] += 1
        elif visits >= 10:
            buckets["10-24"] += 1
        elif visits >= 5:
            buckets["5-9"] += 1
        elif visits >= 1:
            buckets["1-4"] += 1
    report["censo"] = {
        "total_players": total,
        "con_actividad": len(active),
        "fantasmas_sin_actividad": [row_summary(p) for p in ghosts],
        "distribucion_visitas": buckets,
        "top20_por_actividad": [row_summary(p) for p in sorted(
            active, key=lambda p: p["cash_sessions"] + p["tournaments"], reverse=True)[:20]],
    }

    # ---- 2. DUPLICADOS ----
    # Solo teléfonos REALES agrupan con confianza alta; los de relleno (000,
    # 1111111111, cortos) se tratan como "sin teléfono".
    by_phone, by_name = defaultdict(list), defaultdict(list)
    for p in players:
        np_ = normalize_phone(p["phone"])
        if np_ and not is_junk_phone(np_):
            by_phone[np_].append(p)
        nn = normalize_name(p["name"])
        if nn:
            by_name[nn].append(p)

    dup_phone = [{"clave": k, "fichas": [row_summary(p) for p in v]}
                 for k, v in sorted(by_phone.items()) if len(v) == 2]
    # 3+ fichas con el mismo teléfono real: más probable teléfono compartido
    # (amigos/hermanos) que duplicado — bucket aparte para revisar distinto.
    shared_phone = [{"clave": k, "fichas": [row_summary(p) for p in v]}
                    for k, v in sorted(by_phone.items()) if len(v) > 2]
    seen_pairs = {frozenset(x["id"] for x in g["fichas"]) for g in dup_phone}
    seen_pairs |= {frozenset(x["id"] for x in g["fichas"]) for g in shared_phone}

    dup_name = []
    for k, v in sorted(by_name.items()):
        if len(v) > 1 and frozenset(p["id"] for p in v) not in seen_pairs:
            dup_name.append({"clave": k, "fichas": [row_summary(p) for p in v]})
            seen_pairs.add(frozenset(p["id"] for p in v))

    dup_fuzzy = []
    norm = [(p, normalize_name(p["name"])) for p in players if normalize_name(p["name"])]
    for i in range(len(norm)):
        for j in range(i + 1, len(norm)):
            a, na = norm[i]
            b, nb = norm[j]
            if na == nb or len(na) < 6 or len(nb) < 6:
                continue
            if frozenset((a["id"], b["id"])) in seen_pairs:
                continue
            if edit_distance(na, nb, cap=2) <= 2:
                dup_fuzzy.append({"clave": f"{na} ~ {nb}",
                                  "fichas": [row_summary(a), row_summary(b)]})
                seen_pairs.add(frozenset((a["id"], b["id"])))
    report["duplicados"] = {
        "alta_confianza_mismo_telefono": dup_phone,
        "telefono_real_compartido_3mas": shared_phone,
        "media_mismo_nombre": dup_name,
        "baja_nombre_similar": dup_fuzzy,
    }

    # ---- 3. CALIDAD PARA INVITACIONES ----
    # Sin teléfono UTILIZABLE = NULL, vacío o de relleno: no se puede invitar.
    sin_tel = [row_summary(p) for p in active
               if is_junk_phone(normalize_phone(p["phone"]))]
    report["invitaciones"] = {
        "activos_sin_telefono_util": sin_tel,
    }

    # ---- 4. INTEGRIDAD ----
    cross = await conn.fetch(CROSS_TENANT_TP_SQL)
    bad_counters = await conn.fetch(BAD_COUNTERS_SQL, club_id)
    anon = await conn.fetch(ANON_MONEY_TX_SQL, club_id)
    stale = await conn.fetch(STALE_OPEN_SQL, club_id)
    report["integridad"] = {
        "tournament_players_cross_club": [dict(r) for r in cross],
        "contadores_torneo_inconsistentes": [dict(r) for r in bad_counters],
        "plata_cash_sin_jugador": [dict(r) for r in anon],
        "sesiones_open_viejas": [{"id": r["id"], "name": r["name"],
                                  "start": str(r["start_time"])} for r in stale],
    }

    await conn.close()

    # ---- salida ----
    print(f"CENSO: {total} jugadores, {len(active)} con actividad, {len(ghosts)} fantasmas")
    print(f"Distribución de visitas: {buckets}")
    print(f"DUPLICADOS: {len(dup_phone)} pares por teléfono real (ALTA), "
          f"{len(shared_phone)} teléfonos compartidos 3+, "
          f"{len(dup_name)} por nombre exacto (MEDIA), {len(dup_fuzzy)} por typo (BAJA)")
    print(f"INVITACIONES: {len(sin_tel)} activos sin teléfono utilizable")
    print(f"INTEGRIDAD: {len(cross)} registros de torneo cross-club, "
          f"{len(bad_counters)} contadores rotos, {len(stale)} sesiones OPEN viejas")
    if json_out:
        with open(json_out, "w") as f:
            json.dump(report, f, ensure_ascii=False, indent=2, default=str)
        print(f"\nReporte completo: {json_out}")


asyncio.run(main())
