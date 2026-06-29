"""Normalización de teléfonos para login/WhatsApp del dealer.

Guardamos siempre dígitos con código de país (Colombia 57) para que el match de
login sea consistente sin importar cómo lo escriba el dealer, y para armar el
link wa.me. Best-effort: si no parece CO, devuelve los dígitos tal cual."""
import re


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    # 10 dígitos => celular CO sin indicativo => anteponer 57.
    if len(digits) == 10:
        digits = "57" + digits
    # 0057... o 057... => limpiar ceros de salida internacional.
    elif digits.startswith("0057"):
        digits = digits[2:]
    return digits
