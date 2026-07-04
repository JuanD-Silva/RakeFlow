"""Fase 0.3/0.4 del Panel del Jugador: limpieza de datos de jugadores (Mambo).

Ejecuta la LISTA FIRMADA por Juan (2026-07-04, Fase 0.2 del plan):
  1. 26 fusiones de fichas duplicadas (el duplicado transfiere TODO su
     historial al sobreviviente y se borra).
  2. Vaciar teléfonos basura (000, 1111111111, formato no-CO) de jugadores
     activos: campo honesto para que el staff recolecte el número real.
  3. Borrar las 6 fichas fantasma (cero transacciones y cero torneos).

Seguridad:
  - DRY-RUN por defecto: hace todo dentro de una transacción y ROLLBACK al
    final, imprimiendo el reporte completo. Solo escribe con --execute.
  - Backup JSON de TODAS las filas afectadas antes de tocar nada.
  - Invariante: la suma de transactions.amount del club debe ser IDÉNTICA
    pre/post (las fusiones mueven plata de ficha, jamás crean/borran plata).
  - Pre-check por par: si ambas fichas jugaron el MISMO torneo, el par se
    SALTA y se reporta (mezclar contadores corrompe el pozo; caso a caso).
  - Deja rastro en audit_logs (PLAYER_MERGE / PLAYER_PHONE_CLEANUP /
    PLAYER_GHOST_DELETE) con snapshot en meta.

Uso:
  python scripts/merge_players.py "$DATABASE_URL" [--execute] [--backup out.json]
"""
import asyncio
import json
import re
import ssl
import sys
from datetime import datetime

import asyncpg

CLUB_ID = 3  # Mambo

# --- LISTA FIRMADA (Fase 0.2, Juan 2026-07-04). id_par: (sobrevive, duplicado) ---
MERGES = [
    ("A1", 21, 314),   # Juan David <- juan vallejo (mismo tel real)
    ("A2", 145, 204),  # Diego Sánchez <- Diego Sanchez
    ("A3", 154, 210),  # Jhorman Araque <- Yorman Araque
    ("A4", 151, 162),  # Juan Barrera <- Juan Barrero
    ("A5", 116, 133),  # mateo rojas <- Joseph Rojas
    ("A6", 163, 231),  # Santiago Vanegas <- Santiago Vargas
    ("A7", 149, 227),  # Diego Ramirez <- juan diego ramirez
    ("A8", 186, 215),  # John Varela <- jhon varela
    ("A9", 39, 157),   # steven forero <- stiven forero
    ("A10", 199, 313), # Marco Castellanos <- marco castellano
    ("A11", 64, 170),  # Daniel Aldana <- daniel aldana
    ("M1", 161, 243),  # Andrés Ramirez <- andres ramirez
    ("M3a", 194, 279), # David Herrera <- DAVID HERRERA
    ("M3b", 194, 297), # David Herrera <- david herrera
    ("M4", 46, 270),   # jerónimo valencia <- jeronimo valencia
    ("M6", 111, 138),  # julián jara <- julian jara
    ("M7", 63, 139),   # Leonardo Guio <- leonardo guio
    ("M8", 260, 277),  # Luis Guerrero <- LUIS GUERRERO
    ("M9", 247, 248),  # nicolas rubiano <- Nicolas Rubiano
    ("M10", 229, 262), # Sebastián Rangel <- sebastian rangel
    ("B3", 117, 249),  # wiliam pachon <- william pachon
    ("B4", 147, 274),  # Juan tique <- juan tike
    ("B7", 201, 312),  # William ramirez <- wiliam ramirez
    ("S1a", 169, 179), # juan bejarano <- Cristian Bejarano (Juan: las 3 son una persona)
    ("S1b", 169, 180), # juan bejarano <- cristian bejarano
    ("S2", 209, 208),  # MIguel Santana (#209, elegido por Juan) <- Miguel mon
    # --- Segunda ronda (revisión de la lista sin-teléfono, Juan 2026-07-04) ---
    ("N1", 5, 261),    # Sebastian Garcia <- "Sebastian Garcias 2"
    ("N2", 271, 287),  # cian buitrago <- zian
    ("N3", 285, 306),  # durek <- nuerk
    ("N4", 57, 284),   # Ivan Quiroz <- chinche
    ("P1", 271, 320),  # cian buitrago <- cyan og (tercera variante del apodo)
    ("P2", 285, 317),  # durek <- darek
    ("P3a", 228, 214), # Juan Andrés Camacho <- andres camacho (trío de la misma semana)
    ("P3b", 228, 217), # Juan Andrés Camacho <- Juan andres
]
# En STAND-BY (Juan, 2026-07-04 — no ejecutar sin nueva confirmación):
# P4 gabriel antonio #332 -> gabriel forero #328 · P5 David nuevo #233 / Diego
# Nuevo #322 · P6 juan jose #283 -> ¿Cely #254 o Martinez #256? · P7 javier
# (negro) #286 -> ¿henao #30 o fernandez #266? · P8 jhon rastas #263 / #253.

# Resolución de conflictos "mismo torneo en ambas fichas" (revisados a mano):
# - S1b: re-entrada REAL al freeroll 36 (ambas filas tienen rebuys pagados) ->
#   se mueven AMBOS registros al sobreviviente; el pozo no cambia y el
#   historial muestra las dos entradas, que es lo que pasó.
# - S2: el registro del dup en el torneo 39 está VACÍO (0 contadores, 0 tx) ->
#   se borra esa fila muerta y se fusiona normal.
# - P3b: torneo 40 "Todo a 10k": una ficha tiene el juego real (15 rebuys) y
#   la otra una 2ª entrada PAGADA ($10k) sin jugadas -> ambas filas viajan.
ALLOW_DOUBLE_ENTRY = {"S1b", "P3b"}
DROP_EMPTY_DUP_ROW = {"S2"}

# Fichas fantasma confirmadas (0 tx y 0 torneos; se re-verifica al ejecutar)
GHOSTS = [72, 73, 268, 293, 295, 302]

ACTOR = dict(actor_type="SYSTEM", actor_email="fase0-limpieza-datos")


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
    if not normalized:
        return True
    if re.fullmatch(r"(\d)\1+", normalized):
        return True
    return not re.fullmatch(r"573\d{9}", normalized)


async def audit(conn, action, entity_id, meta):
    await conn.execute(
        "INSERT INTO audit_logs (club_id, actor_type, actor_email, action, entity_type, entity_id, meta) "
        "VALUES ($1, $2, $3, $4, 'Player', $5, $6::jsonb)",
        CLUB_ID, ACTOR["actor_type"], ACTOR["actor_email"], action, entity_id,
        json.dumps(meta, default=str),
    )


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dsn = args[0]
    execute = "--execute" in sys.argv
    backup_path = None
    if "--backup" in sys.argv:
        backup_path = sys.argv[sys.argv.index("--backup") + 1]

    if "localhost" in dsn or "127.0.0.1" in dsn:
        conn = await asyncpg.connect(dsn.split("?")[0])
    else:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = await asyncpg.connect(dsn.split("?")[0], ssl=ctx)

    mode = "EJECUCIÓN REAL" if execute else "DRY-RUN (rollback al final)"
    print(f"== Limpieza de jugadores Mambo — {mode} ==\n")

    all_ids = {k for _, k, d in MERGES} | {d for _, k, d in MERGES} | set(GHOSTS)
    rows = await conn.fetch(
        "SELECT * FROM players WHERE id = ANY($1::int[])", list(all_ids))
    pmap = {r["id"]: dict(r) for r in rows}

    # Guard global: todas las fichas existen y son del club
    problems = [pid for pid in all_ids
                if pid not in pmap or pmap[pid]["club_id"] != CLUB_ID]
    if problems:
        print(f"ABORT: fichas inexistentes o de otro club: {problems}")
        await conn.close()
        return 1

    # --- BACKUP de todo lo afectado (antes de abrir la transacción) ---
    backup = {"generated_at": str(datetime.utcnow()), "players": {}}
    for pid in sorted(all_ids):
        backup["players"][pid] = {
            "row": {k: str(v) for k, v in pmap[pid].items()},
            "transaction_ids": [r["id"] for r in await conn.fetch(
                "SELECT id FROM transactions WHERE player_id=$1", pid)],
            "tournament_player_ids": [r["id"] for r in await conn.fetch(
                "SELECT id FROM tournament_players WHERE player_id=$1", pid)],
        }
    if backup_path:
        with open(backup_path, "w") as f:
            json.dump(backup, f, ensure_ascii=False, indent=1)
        print(f"Backup: {backup_path} ({len(all_ids)} fichas)\n")

    inv_sql = """
      SELECT COALESCE(SUM(t.amount),0) FROM transactions t
      LEFT JOIN sessions s ON s.id = t.session_id
      LEFT JOIN tournaments tor ON tor.id = t.tournament_id
      WHERE s.club_id = $1 OR tor.club_id = $1
    """
    sum_pre = await conn.fetchval(inv_sql, CLUB_ID)
    n_tx_pre = await conn.fetchval(
        inv_sql.replace("COALESCE(SUM(t.amount),0)", "COUNT(*)"), CLUB_ID)

    tr = conn.transaction()
    await tr.start()
    merged, skipped = [], []
    try:
        # ---- 1. FUSIONES ----
        for pair_id, keep, dup in MERGES:
            # Conflicto: mismo torneo en ambas fichas -> resolver según política
            conflict = await conn.fetch(
                "SELECT a.tournament_id FROM tournament_players a "
                "JOIN tournament_players b ON b.tournament_id = a.tournament_id "
                "WHERE a.player_id=$1 AND b.player_id=$2", keep, dup)
            if conflict:
                tor_ids = [c["tournament_id"] for c in conflict]
                if pair_id in DROP_EMPTY_DUP_ROW:
                    # Solo procede si la fila del dup está realmente vacía
                    dead = await conn.fetch(
                        "SELECT tp.id FROM tournament_players tp "
                        "WHERE tp.player_id=$1 AND tp.tournament_id = ANY($2::int[]) "
                        "AND COALESCE(tp.rebuys_count,0)=0 AND COALESCE(tp.addons_count,0)=0 "
                        "AND COALESCE(tp.tips_count,0)=0 AND COALESCE(tp.prize_collected,0)=0 "
                        "AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.player_id=tp.player_id "
                        "                AND t.tournament_id=tp.tournament_id)",
                        dup, tor_ids)
                    if len(dead) != len(tor_ids):
                        skipped.append((pair_id, keep, dup,
                                        [f"fila del dup NO está vacía en torneos {tor_ids}"]))
                        continue
                    for row in dead:
                        await conn.execute(
                            "DELETE FROM tournament_players WHERE id=$1", row["id"])
                    # actualizar lo esperado: esas filas ya no se mueven
                    backup["players"][dup]["tournament_player_ids"] = [
                        i for i in backup["players"][dup]["tournament_player_ids"]
                        if i not in {row["id"] for row in dead}]
                elif pair_id in ALLOW_DOUBLE_ENTRY:
                    pass  # re-entrada real: ambas filas viajan al sobreviviente
                else:
                    skipped.append((pair_id, keep, dup, tor_ids))
                    continue
            if pmap[dup].get("user_id") or pmap[keep].get("user_id"):
                skipped.append((pair_id, keep, dup, ["tiene cuenta vinculada"]))
                continue

            tx_n = int((await conn.execute(
                "UPDATE transactions SET player_id=$1 WHERE player_id=$2",
                keep, dup)).split()[-1])
            tp_n = int((await conn.execute(
                "UPDATE tournament_players SET player_id=$1 WHERE player_id=$2",
                keep, dup)).split()[-1])

            exp_tx = len(backup["players"][dup]["transaction_ids"])
            exp_tp = len(backup["players"][dup]["tournament_player_ids"])
            if (tx_n, tp_n) != (exp_tx, exp_tp):
                raise RuntimeError(
                    f"{pair_id}: movidas {tx_n}/{tp_n} filas, esperaba {exp_tx}/{exp_tp}")

            # Teléfono: si el sobreviviente tiene basura y el dup uno real, tomarlo
            phone_note = ""
            if is_junk_phone(normalize_phone(pmap[keep]["phone"])) and \
               not is_junk_phone(normalize_phone(pmap[dup]["phone"])):
                await conn.execute("UPDATE players SET phone=$1 WHERE id=$2",
                                   pmap[dup]["phone"], keep)
                phone_note = f" (hereda tel {pmap[dup]['phone']})"

            await conn.execute("DELETE FROM players WHERE id=$1", dup)
            await audit(conn, "PLAYER_MERGE", keep, {
                "pair": pair_id, "kept": keep, "kept_name": pmap[keep]["name"],
                "deleted": dup, "deleted_name": pmap[dup]["name"],
                "deleted_phone": pmap[dup]["phone"],
                "tx_moved": tx_n, "tp_moved": tp_n,
            })
            merged.append((pair_id, keep, dup, tx_n, tp_n, phone_note))

        # ---- 2. TELÉFONOS BASURA -> NULL ----
        club_players = await conn.fetch(
            "SELECT id, name, phone FROM players WHERE club_id=$1 AND phone IS NOT NULL",
            CLUB_ID)
        junk = [p for p in club_players
                if is_junk_phone(normalize_phone(p["phone"]))]
        for p in junk:
            await conn.execute("UPDATE players SET phone=NULL WHERE id=$1", p["id"])
        if junk:
            await audit(conn, "PLAYER_PHONE_CLEANUP", None, {
                "cleared": [{"id": p["id"], "name": p["name"], "was": p["phone"]}
                            for p in junk],
            })

        # ---- 3. FANTASMAS ----
        deleted_ghosts = []
        for gid in GHOSTS:
            n_tx = await conn.fetchval(
                "SELECT COUNT(*) FROM transactions WHERE player_id=$1", gid)
            n_tp = await conn.fetchval(
                "SELECT COUNT(*) FROM tournament_players WHERE player_id=$1", gid)
            if n_tx or n_tp:
                skipped.append((f"fantasma#{gid}", gid, None,
                                [f"ya no está vacía (tx={n_tx}, torneos={n_tp})"]))
                continue
            await conn.execute("DELETE FROM players WHERE id=$1", gid)
            await audit(conn, "PLAYER_GHOST_DELETE", gid, {
                "name": pmap[gid]["name"], "phone": pmap[gid]["phone"]})
            deleted_ghosts.append(gid)

        # ---- INVARIANTE ----
        sum_post = await conn.fetchval(inv_sql, CLUB_ID)
        n_tx_post = await conn.fetchval(
            inv_sql.replace("COALESCE(SUM(t.amount),0)", "COUNT(*)"), CLUB_ID)
        if sum_pre != sum_post or n_tx_pre != n_tx_post:
            raise RuntimeError(
                f"INVARIANTE ROTO: suma {sum_pre} -> {sum_post}, filas {n_tx_pre} -> {n_tx_post}")

        if execute:
            await tr.commit()
            estado = "COMMIT"
        else:
            await tr.rollback()
            estado = "ROLLBACK (dry-run)"
    except Exception as e:
        await tr.rollback()
        print(f"\nERROR — ROLLBACK COMPLETO: {e}")
        await conn.close()
        return 1

    print(f"FUSIONES: {len(merged)} hechas, {len(skipped)} saltadas")
    for pid, keep, dup, tx, tp, note in merged:
        print(f"  {pid:>4}: #{dup} -> #{keep}  ({tx} tx, {tp} torneos){note}")
    for item in skipped:
        print(f"  SALTADO {item[0]}: {item[3]}")
    print(f"TELÉFONOS basura vaciados: {len(junk)}")
    print(f"FANTASMAS borradas: {deleted_ghosts}")
    print(f"INVARIANTE: suma de plata del club {float(sum_pre):,.0f} == {float(sum_post):,.0f} ✓ · filas {n_tx_pre} == {n_tx_post} ✓")
    print(f"\nResultado: {estado}")
    await conn.close()
    return 0


sys.exit(asyncio.run(main()))
