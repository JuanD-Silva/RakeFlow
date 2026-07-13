"""Genera el par de claves VAPID para Web Push (una vez por entorno).

Imprime los env vars listos para pegar en Railway:
  VAPID_PRIVATE_KEY  — clave privada EC P-256 en base64url crudo (no PEM)
  VAPID_PUBLIC_KEY   — punto público sin comprimir en base64url; es el
                       applicationServerKey que el backend le pasa al navegador
  VAPID_CLAIMS_SUB   — contacto del emisor (RFC 8292)

Correr: venv/bin/python scripts/generate_vapid_keys.py
JAMÁS commitear las claves. Regenerarlas invalida TODAS las suscripciones
existentes (los navegadores rechazan pushes firmados con otra clave)."""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
priv = _b64url(key.private_numbers().private_value.to_bytes(32, "big"))
pub = _b64url(key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

print("VAPID_PRIVATE_KEY=" + priv)
print("VAPID_PUBLIC_KEY=" + pub)
print("VAPID_CLAIMS_SUB=mailto:soporte@rakeflow.site")
