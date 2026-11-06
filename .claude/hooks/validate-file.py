#!/usr/bin/env python3
"""PostToolUse hook — valida el archivo recien tocado.

- *.py            -> ruff check solo de errores reales (RUFF_SELECT), no
                     estilo. Sin ruff, o si ruff falla por config, compila
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

# Solo errores que rompen el codigo (sintaxis, formato de strings que falla
# en runtime, comparaciones invalidas, nombres no definidos); el estilo
# previo del archivo no es asunto de esta edicion.
RUFF_SELECT = "E9,F50,F52,F63,F7,F82"


def compile_check(fp: str) -> str:
    """Sintaxis via compile() en memoria (no deja __pycache__).

    Compila bytes, no str: asi Python respeta BOM y cookie de encoding
    (PEP 263) igual que py_compile, y un byte invalido es SyntaxError.
    """
    try:
        with open(fp, "rb") as f:
            compile(f.read(), fp, "exec")
    except SyntaxError as e:
        pos = f":{e.lineno}:{e.offset}" if e.lineno else ""
        return f"{fp}{pos}: SyntaxError: {e.msg}"
    except (ValueError, OSError):
        return ""
    return ""


def check_python(fp: str, proj: str) -> str:
    if shutil.which("ruff"):
        try:
            r = subprocess.run(
                ["ruff", "check", "--no-cache", "--select", RUFF_SELECT, fp],
                capture_output=True, text=True, timeout=60, cwd=proj)
            # ruff: 0 = limpio, 1 = hallazgos, 2 = config/crash
            if r.returncode == 0:
                return ""
            if r.returncode == 1:
                return (r.stdout + r.stderr).strip()
        except Exception:
            pass
        # ruff roto o ausente en la practica: no perder el chequeo de sintaxis.
    return compile_check(fp)


def check_js(fp: str, proj: str) -> str:
    fdir = os.path.realpath(os.path.join(proj, "poker-frontend"))
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
    # realpath: un poker-frontend accedido por symlink sigue contando.
    fp = os.path.realpath(os.path.join(proj, fp))
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
