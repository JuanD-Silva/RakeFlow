#!/usr/bin/env python3
"""PostToolUse hook — valida el archivo recien tocado.

- *.py            -> ruff check solo de errores reales (sintaxis, nombres no
                     definidos: E9,F63,F7,F82), no estilo. Sin ruff, compila
                     en memoria con compile() (no deja __pycache__).
- *.jsx / *.js    -> eslint local de poker-frontend (best-effort)

Silencioso en exito. Si encuentra problemas reales, sale con codigo 2 para que
el output (stderr) vuelva a Claude y los corrija. Degrada con elegancia: si no
hay herramienta o la herramienta falla por config, no dice nada.
"""
import json
import os
import shutil
import subprocess
import sys

# Solo errores que rompen el codigo; el estilo previo del archivo no es
# asunto de esta edicion.
RUFF_SELECT = "E9,F63,F7,F82"


def check_python(fp: str, proj: str) -> str:
    if shutil.which("ruff"):
        try:
            r = subprocess.run(
                ["ruff", "check", "--no-cache", "--select", RUFF_SELECT, fp],
                capture_output=True, text=True, timeout=60, cwd=proj)
        except Exception:
            return ""
        # ruff: 0 = limpio, 1 = hallazgos, 2 = config/crash -> ignorar
        return (r.stdout + r.stderr).strip() if r.returncode == 1 else ""

    try:
        with open(fp, encoding="utf-8") as f:
            src = f.read()
        compile(src, fp, "exec")
    except SyntaxError as e:
        return f"{fp}:{e.lineno}:{e.offset}: SyntaxError: {e.msg}"
    except Exception:
        return ""
    return ""


def check_js(fp: str, proj: str) -> str:
    fdir = os.path.abspath(os.path.join(proj, "poker-frontend"))
    eslint = os.path.join(fdir, "node_modules", ".bin", "eslint")
    # Con separador: "poker-frontend-old/x.js" no debe contar como poker-frontend.
    if not os.path.exists(eslint) or not fp.startswith(fdir + os.sep):
        return ""
    try:
        r = subprocess.run([eslint, os.path.relpath(fp, fdir)],
                           capture_output=True, text=True, timeout=90, cwd=fdir)
    except Exception:
        return ""
    # eslint: 0 = limpio, 1 = lint errors, 2 = crash/config -> ignorar
    return r.stdout.strip() if r.returncode == 1 else ""


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
    fp = ti.get("file_path") or ""
    if not fp or not isinstance(fp, str):
        sys.exit(0)

    proj = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    fp = os.path.abspath(os.path.join(proj, fp))
    if not os.path.isfile(fp):
        sys.exit(0)

    if fp.endswith(".py"):
        msg = check_python(fp, proj)
    elif fp.endswith((".jsx", ".js")):
        msg = check_js(fp, proj)
    else:
        msg = ""

    if msg:
        print(f"Validacion de {os.path.basename(fp)} encontro problemas:\n{msg}",
              file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
