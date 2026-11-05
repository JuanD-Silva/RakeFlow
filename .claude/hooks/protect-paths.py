#!/usr/bin/env python3
"""PreToolUse hook — protege rutas peligrosas de RakeFlow.

- .env                  -> deny  (DATABASE_URL, SECRET_KEY, llaves Wompi)
- lockfiles / pins      -> deny  (usar npm/pip, no editar a mano)
- alembic/versions/*.py -> deny  (editar una migracion existente rompe el
                                   historial de Alembic contra la DB de Mambo
                                   en prod; crear una nueva si se permite).
                                   Era "ask", pero en modo bypass el ask se
                                   auto-aprueba sin mostrar nada.

Silencioso (allow implicito) para todo lo demas. Degrada con elegancia: si el
input no parsea, no bloquea nada.
"""
import json
import os
import sys


def decide(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    ti = data.get("tool_input", {}) or {}
    fp = ti.get("file_path") or ti.get("notebook_path") or ""
    if not fp:
        sys.exit(0)

    base = os.path.basename(fp)

    if base == ".env" or fp.endswith("/.env"):
        decide("deny",
               ".env contiene secretos (DATABASE_URL, SECRET_KEY, llaves Wompi). "
               "Editalo a mano fuera de Claude.")

    if base in ("package-lock.json", "requirements.txt"):
        decide("deny",
               f"{base} es lockfile/pins. Cambialo con npm/pip, no a mano, "
               "para no desincronizar el arbol de dependencias.")

    if "/alembic/versions/" in fp and fp.endswith(".py") and os.path.exists(fp):
        decide("deny",
               "Editar una migracion existente esta bloqueado. Si ya se aplico a la "
               "DB de Mambo (prod), editarla rompe el historial de Alembic. Crea una "
               "migracion nueva (/crear-migracion). Si es recien generada y aun no "
               "aplicada, editala a mano fuera de Claude.")

    sys.exit(0)


if __name__ == "__main__":
    main()
