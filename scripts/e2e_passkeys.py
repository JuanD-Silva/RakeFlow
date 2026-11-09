#!/usr/bin/env python3
"""E2E de passkeys (huella/cara) del jugador — LOCAL, no toca prod.

Usa un autenticador por SOFTWARE (llave P-256 de verdad + CBOR + firmas
ECDSA), así se prueba el backend completo sin navegador:

  1. Activar: clave incorrecta → 400; dealer → 403; OK → 201 y la passkey
     abre SOLO las cuentas que la clave abre (no la de otra clave).
  2. Un desafío = un intento (replay → 400). Origen ajeno → rechazo.
  3. Entrar: multi-cuenta → selector; firma falsa, sin verificación de
     usuario (UV) o credencial desconocida → 401.
  4. Cambio de clave: esa cuenta deja de abrirse; si cambian todas, la
     passkey se borra (passkey_revoked).
  5. Quitar: solo las propias (otro jugador → 404); después ya no entra.
  6. Desafío vencido → 400. Borrar el usuario borra sus passkeys (CASCADE).

Uso: python scripts/e2e_passkeys.py
"""
import base64
import hashlib
import json
import os
import pathlib
import struct
import subprocess
import sys
import time

import cbor2
import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwt

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8022
BASE = f"http://127.0.0.1:{PORT}"
RP_ID = "localhost"
ORIGIN = "http://localhost:5173"
PHONE = "573009990111"
PW = "ClaveJugador1"
TAG = "PK-"


def load_env(path):
    env = {}
    p = ROOT / path
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


for k, v in load_env(".env").items():
    os.environ.setdefault(k, v)
assert "localhost:5433" in os.environ.get("DATABASE_URL", ""), "DATABASE_URL debe ser la DB LOCAL"
sys.path.insert(0, str(ROOT))
from app import auth_utils  # noqa: E402


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", "poker_db", "psql", "-U", "poker_admin", "-d", "poker_treasury_db",
         "-t", "-A", "-F", "\t", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql falló: {out.stderr}\nSQL: {sql}")
    return out.stdout.strip()


_passed = 0


def check(cond, m):
    global _passed
    if not cond:
        print(f"  \033[91m✗ {m}\033[0m")
        sys.exit(1)
    _passed += 1
    print(f"  \033[92m✓\033[0m {m}")


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


class SoftAuthenticator:
    """Un 'teléfono' con huella: guarda una llave P-256 por credencial."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(32)
        self.count = 0

    def _cose(self):
        n = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})

    def create(self, options, origin=ORIGIN):
        cdj = json.dumps({"type": "webauthn.create", "challenge": options["challenge"],
                          "origin": origin, "crossOrigin": False}).encode()
        auth_data = (hashlib.sha256(options["rp"]["id"].encode()).digest()
                     + bytes([0x45]) + struct.pack(">I", self.count)
                     + bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + self._cose())
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64(cdj), "attestationObject": b64(att), "transports": ["internal"]},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}

    def get(self, options, user_handle=b"", flags=0x05, signer=None):
        self.count += 1
        cdj = json.dumps({"type": "webauthn.get", "challenge": options["challenge"],
                          "origin": ORIGIN, "crossOrigin": False}).encode()
        auth_data = hashlib.sha256(RP_ID.encode()).digest() + bytes([flags]) + struct.pack(">I", self.count)
        sig = (signer or self.key).sign(auth_data + hashlib.sha256(cdj).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.cred_id), "rawId": b64(self.cred_id), "type": "public-key",
                "response": {"authenticatorData": b64(auth_data), "clientDataJSON": b64(cdj),
                             "signature": b64(sig), "userHandle": b64(user_handle)},
                "clientExtensionResults": {}, "authenticatorAttachment": "platform"}


def jwt_for(uid, club, role, uids=None):
    return auth_utils.create_access_token({"sub": PHONE, "club_id": club, "user_id": uid,
                                           "role": role, "uids": uids or [uid]})


def new_hash(password):
    return auth_utils.get_password_hash(password).replace("'", "''")


def seed_user(club, role, name, password, phone=PHONE):
    psql(f"INSERT INTO users (club_id, role, is_active, hashed_password, phone, name) "
         f"VALUES ({club}, '{role}', true, '{new_hash(password)}', '{phone}', '{TAG}{name}');")
    return int(psql(f"SELECT id FROM users WHERE club_id={club} AND name='{TAG}{name}'"))


def register_club(c, email):
    r = c.post(f"{BASE}/auth/register", json={"name": f"Club {email}", "email": email,
                                              "password": "OwnerPass123", "accept_terms": True})
    check(r.status_code in (201, 400), f"club {email} listo")
    return int(psql(f"SELECT id FROM clubs WHERE email='{email}'"))


def cleanup_users():
    psql(f"DELETE FROM passkey_challenges WHERE user_id IN (SELECT id FROM users WHERE name LIKE '{TAG}%');")
    psql(f"DELETE FROM users WHERE name LIKE '{TAG}%';")


def main():
    env = {**os.environ, "WEBAUTHN_RP_ID": RP_ID, "WEBAUTHN_ORIGINS": ORIGIN}
    proc = subprocess.Popen([str(ROOT / "venv/bin/uvicorn"), "app.main:app", "--host", "127.0.0.1",
                             "--port", str(PORT)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(25):
            time.sleep(1)
            try:
                if httpx.get(f"{BASE}/", timeout=3).status_code == 200:
                    break
            except Exception:
                pass
        else:
            check(False, "el backend no levantó")

        with httpx.Client(timeout=30) as c:
            print("\n[0] Datos")
            cleanup_users()
            ca, cb = register_club(c, "pk-a@rakeflow.local"), register_club(c, "pk-b@rakeflow.local")
            p_a = seed_user(ca, "PLAYER", "JugadorA", PW)
            p_b = seed_user(cb, "PLAYER", "JugadorB", PW)              # misma persona, otro club, MISMA clave
            d_a = seed_user(ca, "DEALER", "DealerA", "OtraClave999")   # mismo número, OTRA clave
            q_a = seed_user(ca, "PLAYER", "OtroJugador", "ClaveQ1234", phone="573009990222")
            h_pa = {"Authorization": f"Bearer {jwt_for(p_a, ca, 'player', [p_a, p_b])}"}
            h_q = {"Authorization": f"Bearer {jwt_for(q_a, ca, 'player')}"}
            h_d = {"Authorization": f"Bearer {jwt_for(d_a, ca, 'dealer')}"}
            check(True, f"jugador A={p_a} (club {ca}), B={p_b} (club {cb}), dealer={d_a}, otro={q_a}")

            print("\n[1] Activar")
            r = c.post(f"{BASE}/player/passkeys/register/options", headers=h_pa, json={"password": "mala"})
            check(r.status_code == 400 and r.json()["detail"]["code"] == "bad_password", "clave incorrecta → 400 bad_password")
            r = c.post(f"{BASE}/player/passkeys/register/options", headers=h_d, json={"password": "OtraClave999"})
            check(r.status_code == 403, f"dealer → 403 (got {r.status_code})")
            r = c.post(f"{BASE}/player/passkeys/register/options", headers=h_pa, json={"password": PW})
            check(r.status_code == 200, f"options → 200 (got {r.status_code}: {r.text[:100]})")
            opt = r.json()
            sel = opt["options"]["authenticatorSelection"]
            check(sel["residentKey"] == "required" and sel["userVerification"] == "required"
                  and sel["authenticatorAttachment"] == "platform", "pide huella del propio teléfono (platform + UV)")
            phone = SoftAuthenticator()
            r = c.post(f"{BASE}/player/passkeys/register/verify", headers=h_pa,
                       json={"challenge_id": opt["challenge_id"], "credential": phone.create(opt["options"])})
            check(r.status_code == 201, f"verify → 201 (got {r.status_code}: {r.text[:120]})")
            opens = json.loads(psql(f"SELECT opens FROM passkey_credentials WHERE credential_id='{b64(phone.cred_id)}'"))
            got = sorted(o["uid"] for o in opens)
            check(got == sorted([p_a, p_b]), f"abre jugador A y B (misma clave), NO el dealer (otra clave): {got}")
            r = c.post(f"{BASE}/player/passkeys/register/verify", headers=h_pa,
                       json={"challenge_id": opt["challenge_id"], "credential": phone.create(opt["options"])})
            check(r.status_code == 400 and r.json()["detail"]["code"] == "challenge_expired", "reusar el desafío → 400")
            opt2 = c.post(f"{BASE}/player/passkeys/register/options", headers=h_pa, json={"password": PW}).json()
            check(len(opt2["options"]["excludeCredentials"]) == 1, "no duplica: excluye la huella ya activa")
            r = c.post(f"{BASE}/player/passkeys/register/verify", headers=h_pa,
                       json={"challenge_id": opt2["challenge_id"],
                             "credential": SoftAuthenticator().create(opt2["options"], origin="https://evil.example")})
            check(r.status_code == 400 and r.json()["detail"]["code"] == "verify_failed", "origen ajeno (phishing) → rechazado")
            lst = c.get(f"{BASE}/player/passkeys", headers=h_pa).json()["passkeys"]
            check(len(lst) == 1, "lista: 1 dispositivo")

            def login(auth, **kw):
                o = c.post(f"{BASE}/auth/passkey/options").json()
                cred = auth.get(o["options"], user_handle=f"rf-u{p_a}".encode(), **kw)
                return o, cred, c.post(f"{BASE}/auth/passkey/verify",
                                       json={"challenge_id": o["challenge_id"], "credential": cred})

            print("\n[2] Entrar")
            o, cred, r = login(phone)
            check(r.status_code == 200 and r.json().get("multi_account") is True, "huella → selector multi-cuenta")
            ids = sorted(a["user_id"] for a in r.json()["accounts"])
            check(ids == sorted([p_a, p_b]), f"ofrece A y B, no el dealer: {ids}")
            r2 = c.post(f"{BASE}/auth/select-account", json={"select_token": r.json()["select_token"], "user_id": p_a})
            check(r2.status_code == 200 and r2.json()["role"] == "player", "elegir cuenta → token de jugador")
            r = c.post(f"{BASE}/auth/passkey/verify", json={"challenge_id": o["challenge_id"], "credential": cred})
            check(r.status_code == 400, "reenviar la misma firma (replay) → 400")
            _, _, r = login(phone, signer=ec.generate_private_key(ec.SECP256R1()))
            check(r.status_code == 401 and r.json()["detail"]["code"] == "verify_failed", "firma falsa → 401")
            _, _, r = login(phone, flags=0x01)
            check(r.status_code == 401, "sin verificación de usuario (sin huella) → 401")
            _, _, r = login(SoftAuthenticator())
            check(r.status_code == 401 and r.json()["detail"]["code"] == "passkey_unknown",
                  "credencial desconocida → 401 passkey_unknown")

            print("\n[3] Cambio de clave")
            psql(f"UPDATE users SET hashed_password='{new_hash('NuevaB1234')}' WHERE id={p_b};")
            _, _, r = login(phone)
            check(r.status_code == 200 and "access_token" in r.json() and not r.json().get("multi_account"),
                  "B cambió de clave → la huella entra directo solo a A")
            claims = jwt.decode(r.json()["access_token"], auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
            check(claims["user_id"] == p_a and claims["uids"] == [p_a], f"token de A con uids=[A] (got {claims['uids']})")
            psql(f"UPDATE users SET hashed_password='{new_hash('NuevaA1234')}' WHERE id={p_a};")
            _, _, r = login(phone)
            check(r.status_code == 401 and r.json()["detail"]["code"] == "passkey_revoked", "todas cambiaron → passkey_revoked")
            check(psql(f"SELECT count(*) FROM passkey_credentials WHERE user_id={p_a}") == "0", "y la passkey se borró")

            print("\n[4] Quitar")
            h_pa = {"Authorization": f"Bearer {jwt_for(p_a, ca, 'player')}"}
            opt = c.post(f"{BASE}/player/passkeys/register/options", headers=h_pa, json={"password": "NuevaA1234"}).json()
            phone2 = SoftAuthenticator()
            pk_id = c.post(f"{BASE}/player/passkeys/register/verify", headers=h_pa,
                           json={"challenge_id": opt["challenge_id"], "credential": phone2.create(opt["options"])}).json()["id"]
            check(c.delete(f"{BASE}/player/passkeys/{pk_id}", headers=h_q).status_code == 404, "otro jugador no puede quitarla → 404")
            check(c.delete(f"{BASE}/player/passkeys/{pk_id}", headers=h_pa).status_code == 200, "el dueño la quita → 200")
            _, _, r = login(phone2)
            check(r.status_code == 401 and r.json()["detail"]["code"] == "passkey_unknown", "quitada → ya no entra")
            n_audit = int(psql(f"SELECT count(*) FROM audit_logs WHERE action IN ('PASSKEY_ADDED','PASSKEY_REMOVED') "
                               f"AND club_id={ca} AND created_at > now() - interval '5 minutes'"))
            check(n_audit >= 4, f"auditoría: activaciones y retiros registrados ({n_audit})")

            print("\n[5] Desafío vencido + borrado en cascada")
            o = c.post(f"{BASE}/auth/passkey/options").json()
            psql(f"UPDATE passkey_challenges SET expires_at = now() - interval '1 minute' WHERE id={o['challenge_id']};")
            r = c.post(f"{BASE}/auth/passkey/verify", json={"challenge_id": o["challenge_id"], "credential": phone2.get(o["options"])})
            check(r.status_code == 400 and r.json()["detail"]["code"] == "challenge_expired", "desafío vencido → 400")
            opt = c.post(f"{BASE}/player/passkeys/register/options", headers=h_pa, json={"password": "NuevaA1234"}).json()
            c.post(f"{BASE}/player/passkeys/register/verify", headers=h_pa,
                   json={"challenge_id": opt["challenge_id"], "credential": SoftAuthenticator().create(opt["options"])})
            check(psql(f"SELECT count(*) FROM passkey_credentials WHERE user_id={p_a}") == "1", "passkey activa antes de borrar")
            cleanup_users()
            check(psql(f"SELECT count(*) FROM passkey_credentials WHERE user_id={p_a}") == "0",
                  "borrar el usuario borra sus passkeys (ON DELETE CASCADE)")
    finally:
        try:
            cleanup_users()
        except Exception:
            pass
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    print(f"\n\033[92m\033[1m✓ TODO OK — {_passed} chequeos pasaron\033[0m")


if __name__ == "__main__":
    main()
