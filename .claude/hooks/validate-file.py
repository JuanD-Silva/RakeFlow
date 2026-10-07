#!/usr/bin/env python3
"""PostToolUse hook — valida el archivo recien tocado.

- *.py            -> ruff check  (o ./venv/bin/python -m py_compile como fallback)
- *.jsx / *.js    -> eslint local de poker-frontend (best-effort)

Silencioso en exito. Si encuentra problemas reales, sale con codigo 2 para que
el output (stderr) vuelva a Claude y los corrija. Degrada con elegancia: si no
hay herramienta, no dice nada.
"""
import json
import os
import shutil
import subprocess
import sys


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    ti = data.get("tool_input", {}) or {}
    fp = ti.get("file_path") or ""
    if not fp or not os.path.exists(fp):
        sys.exit(0)

    proj = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    msg = ""

    if fp.endswith(".py"):
        if shutil.which("ruff"):
            cmd = ["ruff", "check", fp]
        else:
            py = os.path.join(proj, "venv", "bin", "python")
            py = py if os.path.exists(py) else "python3"
            cmd = [py, "-m", "py_compile", fp]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60, cwd=proj)
            if r.returncode != 0:
                msg = (r.stdout + r.stderr).strip()
        except Exception:
            pass

    elif fp.endswith((".jsx", ".js")):
        fdir = os.path.join(proj, "poker-frontend")
        eslint = os.path.join(fdir, "node_modules", ".bin", "eslint")
        if os.path.exists(eslint) and os.path.abspath(fp).startswith(os.path.abspath(fdir)):
            rel = os.path.relpath(fp, fdir)
            try:
                r = subprocess.run([eslint, rel], capture_output=True, text=True,
                                   timeout=90, cwd=fdir)
                # eslint: 0 = limpio, 1 = lint errors, 2 = crash/config -> ignorar
                if r.returncode == 1 and r.stdout.strip():
                    msg = r.stdout.strip()
            except Exception:
                pass

    if msg:
        print(f"Validacion de {os.path.basename(fp)} encontro problemas:\n{msg}",
              file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
