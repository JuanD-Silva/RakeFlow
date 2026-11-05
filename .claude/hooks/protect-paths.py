#!/usr/bin/env python3
"""PreToolUse hook — protege rutas peligrosas de RakeFlow.

- .env, .env.*          -> deny  (DATABASE_URL, SECRET_KEY, llaves Wompi);
                                   .env.example se permite
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

    if not isinstance(data, dict):
        sys.exit(0)
    ti = data.get("tool_input") or {}
    if not isinstance(ti, dict):
        sys.exit(0)
    fp = ti.get("file_path") or ti.get("notebook_path") or ""
    if not fp or not isinstance(fp, str):
        sys.exit(0)

    # Ruta absoluta para que "alembic/versions/x.py" relativo tambien caiga.
    fp = os.path.abspath(fp)
    base = os.path.basename(fp)

    # .env, .env.local, .env.production, ... (pero no .env.example).
    if base == ".env" or (base.startswith(".env.") and base != ".env.example"):
        decide("deny",
               f"{base} contiene secretos (DATABASE_URL, SECRET_KEY, llaves Wompi). "
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
