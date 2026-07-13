"""Unit tests de las funciones puras de app/push_triggers.py:
streak_payload, next_target, challenge_payload y _fmt.
Correr: venv/bin/python scripts/test_push_triggers.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@127.0.0.1:5433/dummy")
from app import push_triggers as pt  # noqa: E402

passed = failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}")


# --- streak_payload ---
check("racha 3 en riesgo → avisa con las semanas en el título",
      "3 semanas" in (pt.streak_payload({"at_risk": True, "weeks": 3}) or {}).get("title", ""))
check("racha 2 (mínimo) en riesgo → avisa",
      pt.streak_payload({"at_risk": True, "weeks": 2}) is not None)
check("racha 1 en riesgo → NO avisa (perderla no duele)",
      pt.streak_payload({"at_risk": True, "weeks": 1}) is None)
check("racha viva (no at_risk) → NO avisa",
      pt.streak_payload({"at_risk": False, "weeks": 5}) is None)
check("sin racha → NO avisa", pt.streak_payload({"at_risk": False, "weeks": 0}) is None)
p = pt.streak_payload({"at_risk": True, "weeks": 4})
check("payload de racha trae tag y url", p["tag"] == "rf-streak" and p["url"] == "/")

# --- next_target (meta única y escalonado) ---
check("meta única pendiente", pt.next_target(10, None, 7) == 10)
check("meta única cumplida → None", pt.next_target(10, None, 10) is None)
tiers = [{"target": 35}, {"target": 50}, {"target": 70}]
check("escalonado: primer tramo pendiente", pt.next_target(70, tiers, 10) == 35)
check("escalonado: tramo intermedio", pt.next_target(70, tiers, 40) == 50)
check("escalonado: todo cumplido → None", pt.next_target(70, tiers, 70) is None)

# --- challenge_payload ---
check("80% justo → avisa",
      pt.challenge_payload("Meta", "visitas", 4, 5) is not None)
check("79% → NO avisa", pt.challenge_payload("Meta", "horas", 39.5, 50) is None)
check("cumplido → NO avisa", pt.challenge_payload("Meta", "visitas", 5, 5) is None)
check("sin objetivo (None) → NO avisa", pt.challenge_payload("Meta", "visitas", 4, None) is None)
check("target 0 → NO avisa (sin división por cero)",
      pt.challenge_payload("Meta", "visitas", 0, 0) is None)
p = pt.challenge_payload("Festival de Cash", "horas", 42.5, 50)
check("payload de reto menciona título y progreso",
      "Festival de Cash" in p["body"] and "42.5" in p["body"] and "50" in p["body"])
check("payload de reto trae tag propio", p["tag"] == "rf-challenge")

# --- _fmt ---
check("_fmt entero limpio", pt._fmt(3.0) == "3")
check("_fmt decimal conservado", pt._fmt(3.5) == "3.5")
check("_fmt int directo", pt._fmt(7) == "7")

print(f"\ntest push_triggers: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
