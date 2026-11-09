# app/routers/passkeys.py
"""Entrar con huella o cara (passkeys / WebAuthn) — panel del jugador.

Flujo:
  ACTIVAR (jugador con sesión):
    1. POST /player/passkeys/register/options {password}
       La clave se confirma UNA vez: la huella abrirá exactamente las cuentas
       que esa clave abre HOY (igual que el login multi-cuenta). No se usa el
       claim `uids` del token porque puede tener hasta 30 días y una de esas
       cuentas pudo cambiar de clave (o de dueño) desde entonces.
    2. El teléfono crea la passkey (huella/cara) → POST .../register/verify.
  ENTRAR (sin sesión):
    1. POST /auth/passkey/options → desafío (sin usuario: la passkey es
       "descubrible", el teléfono ofrece las suyas).
    2. POST /auth/passkey/verify → mismo resultado que /auth/login: el token, o
       la lista de cuentas para elegir (multi_account + select_token).

Seguridad:
  - La huella nunca sale del teléfono; acá solo se guarda la llave pública.
  - Desafíos de UN solo uso que vencen en 5 min. Activar: fila en DB ligada
    al usuario (DELETE ... RETURNING). Entrar: desafío FIRMADO sin estado (el
    login anónimo no escribe nada en la DB); recién tras una firma válida se
    anota como usado (índice único → un replay choca).
  - Abre SOLO cuentas de jugador, aunque la misma clave abra una de staff.
  - La passkey guarda la huella digital del hash de clave de cada cuenta que
    abre: si la clave cambia (o la cuenta se libera y la activa otra persona),
    esa cuenta deja de abrirse con la huella. Sin cuentas vigentes, la passkey
    se borra y el teléfono vuelve a la clave.
  - RP ID = rakeflow.site: las passkeys no sirven en ningún otro sitio
    (protección anti-phishing nativa).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from .. import accounts, auth_utils, models
from ..audit import AuditAction, log_action, log_standalone
from ..dependencies import get_current_user, get_db, get_token_claims
from ..rate_limit import client_ip, limiter
from .auth import _issue_for_account, _session_uids

logger = logging.getLogger(__name__)

# rakeflow.site en prod. Local: WEBAUTHN_RP_ID=localhost y
# WEBAUTHN_ORIGINS=http://localhost:5173 (WebAuthn exige https salvo localhost).
RP_ID = os.getenv("WEBAUTHN_RP_ID", "rakeflow.site")
ORIGINS = [o.strip() for o in os.getenv(
    "WEBAUTHN_ORIGINS", "https://rakeflow.site,https://www.rakeflow.site").split(",") if o.strip()]
RP_NAME = "RakeFlow"
CHALLENGE_MINUTES = 5
MAX_PASSKEYS_PER_USER = 10

player_router = APIRouter(prefix="/player/passkeys", tags=["Passkeys"])
auth_router = APIRouter(prefix="/auth/passkey", tags=["Passkeys"])


def password_fp(hashed_password: str | None) -> str | None:
    """Huella digital del hash de clave: cambia cuando la clave cambia."""
    if not hashed_password:
        return None
    return hashlib.sha256(hashed_password.encode()).hexdigest()


def device_label(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if "iphone" in ua:
        return "iPhone"
    if "ipad" in ua:
        return "iPad"
    if "android" in ua:
        return "Android"
    if "macintosh" in ua or "mac os" in ua:
        return "Mac"
    if "windows" in ua:
        return "Windows"
    return "Este dispositivo"


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _norm_cred_id(credential: dict) -> str:
    raw = credential.get("rawId") or credential.get("id")
    if not isinstance(raw, str) or not raw:
        raise _err(400, "bad_credential", "La respuesta del teléfono vino incompleta.")
    try:
        return bytes_to_base64url(base64url_to_bytes(raw))
    except Exception:
        raise _err(400, "bad_credential", "La respuesta del teléfono vino incompleta.")


def _challenge_from_client_data(credential: dict) -> bytes:
    """El desafío que el teléfono firmó viene dentro de clientDataJSON."""
    try:
        cdj = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
        return base64url_to_bytes(cdj["challenge"])
    except Exception:
        raise _err(400, "bad_credential", "La respuesta del teléfono vino incompleta.")


def _new_login_challenge() -> bytes:
    """nonce(16) + vence(8) + firma(16): se valida sin guardar nada."""
    body = os.urandom(16) + int(time.time() + CHALLENGE_MINUTES * 60).to_bytes(8, "big")
    mac = hmac.new(auth_utils.SECRET_KEY.encode(), b"rf-passkey-login|" + body, hashlib.sha256).digest()[:16]
    return body + mac


def _login_challenge_ok(raw: bytes) -> bool:
    if len(raw) != 40:
        return False
    body, mac = raw[:24], raw[24:]
    good = hmac.new(auth_utils.SECRET_KEY.encode(), b"rf-passkey-login|" + body, hashlib.sha256).digest()[:16]
    return hmac.compare_digest(mac, good) and int.from_bytes(body[16:24], "big") >= time.time()


def _require_player(user: models.User) -> None:
    if user.role != models.UserRole.PLAYER:
        raise _err(403, "not_player", "El ingreso con huella es para jugadores.")


async def _new_challenge(db: AsyncSession, *, purpose: str, challenge: bytes,
                         user_id: int | None = None, opens: list | None = None) -> int:
    now = datetime.utcnow()
    # Limpieza oportunista: los vencidos no sirven para nada.
    await db.execute(delete(models.PasskeyChallenge).where(models.PasskeyChallenge.expires_at < now))
    row = models.PasskeyChallenge(
        challenge=bytes_to_base64url(challenge), purpose=purpose, user_id=user_id,
        opens=opens, expires_at=now + timedelta(minutes=CHALLENGE_MINUTES),
    )
    db.add(row)
    await db.flush()
    return row.id


async def _consume_register_challenge(db: AsyncSession, challenge_id: int, user_id: int):
    """Borra el desafío de activación y lo devuelve: un solo uso aunque lleguen
    dos pedidos a la vez (DELETE ... RETURNING le devuelve la fila a uno). El
    dueño va en el WHERE: nadie puede quemar el desafío de otro jugador. Se
    confirma de una: aunque la verificación falle después, ya no se reusa."""
    row = (await db.execute(
        delete(models.PasskeyChallenge)
        .where(models.PasskeyChallenge.id == challenge_id,
               models.PasskeyChallenge.purpose == "register",
               models.PasskeyChallenge.user_id == user_id)
        .returning(models.PasskeyChallenge.challenge, models.PasskeyChallenge.opens,
                   models.PasskeyChallenge.expires_at)
    )).first()
    await db.commit()
    if not row or row.expires_at < datetime.utcnow():
        raise _err(400, "challenge_expired", "Se venció el intento. Vuelve a intentarlo.")
    return row


async def valid_accounts(db: AsyncSession, opens: list) -> list[models.User]:
    """Las cuentas de JUGADOR de `opens` que siguen activas y con la MISMA
    clave que cuando se activó la huella."""
    fp_by_uid = {}
    for o in opens or []:
        try:
            fp_by_uid[int(o["uid"])] = o.get("fp")
        except (KeyError, TypeError, ValueError):
            continue
    if not fp_by_uid:
        return []
    users = (await db.execute(
        select(models.User).where(
            models.User.id.in_(list(fp_by_uid)),
            models.User.is_active == True,  # noqa: E712
            models.User.hashed_password.isnot(None),
            models.User.role == models.UserRole.PLAYER,
        ).order_by(models.User.club_id, models.User.id)
    )).scalars().all()
    return [u for u in users if fp_by_uid.get(u.id) and password_fp(u.hashed_password) == fp_by_uid[u.id]]


# ---------------------------------------------------------------------------
# ACTIVAR (jugador con sesión)
# ---------------------------------------------------------------------------
class RegisterOptionsIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class CredentialIn(BaseModel):
    challenge_id: int
    credential: dict


@player_router.post("/register/options")
@limiter.limit("10/hour", key_func=client_ip)
async def register_options(
    data: RegisterOptionsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_player(user)
    loop = asyncio.get_event_loop()
    # Igual que el login: la clave agrupa a la persona, nunca el teléfono.
    if user.phone:
        opened = await accounts.accounts_opened_by(db, user.phone, data.password, loop)
    else:
        ok = user.hashed_password and await loop.run_in_executor(
            None, auth_utils.verify_password, data.password, user.hashed_password)
        opened = [user] if ok else []
    # La huella es del panel del JUGADOR: aunque la misma clave abra una
    # cuenta de staff (dueño, cajero) o de dealer, esa no entra por huella.
    opened = [u for u in opened if u.role == models.UserRole.PLAYER]
    if user.id not in {u.id for u in opened}:
        # 400 (no 401): el interceptor del front cierra sesión con un 401.
        raise _err(400, "bad_password", "Esa no es tu clave. Revísala e intenta de nuevo.")

    existing = (await db.execute(
        select(models.PasskeyCredential.credential_id)
        .where(models.PasskeyCredential.user_id == user.id)
    )).scalars().all()
    if len(existing) >= MAX_PASSKEYS_PER_USER:
        raise _err(400, "too_many", "Ya tienes muchos dispositivos con huella. Quita alguno primero.")

    opts = generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=f"rf-u{user.id}".encode(),
        user_name=user.phone or user.email or f"jugador-{user.id}",
        user_display_name=user.name or "Jugador",
        timeout=120000,
        authenticator_selection=AuthenticatorSelectionCriteria(
            # La huella/cara del PROPIO teléfono (no llaves USB ni QR).
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        # Si este teléfono ya tiene una passkey de esta cuenta, no se duplica.
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c)) for c in existing],
    )
    opens = [{"uid": u.id, "fp": password_fp(u.hashed_password)} for u in opened]
    challenge_id = await _new_challenge(db, purpose="register", challenge=opts.challenge,
                                        user_id=user.id, opens=opens)
    await db.commit()
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(opts))}


@player_router.post("/register/verify", status_code=201)
@limiter.limit("20/hour", key_func=client_ip)
async def register_verify(
    data: CredentialIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    _require_player(user)
    row = await _consume_register_challenge(db, data.challenge_id, user.id)
    try:
        verified = verify_registration_response(
            credential=data.credential,
            expected_challenge=base64url_to_bytes(row.challenge),
            expected_rp_id=RP_ID,
            expected_origin=ORIGINS,
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, KeyError, TypeError):
        raise _err(400, "verify_failed", "No pudimos verificar la huella. Intenta de nuevo.")

    cred_id = bytes_to_base64url(verified.credential_id)
    taken = (await db.execute(
        select(models.PasskeyCredential).where(models.PasskeyCredential.credential_id == cred_id)
    )).scalars().first()
    if taken:
        if taken.user_id != user.id:
            raise _err(409, "taken", "Esa huella ya está registrada en otra cuenta.")
        return {"id": taken.id, "credential_id": cred_id, "device_label": taken.device_label}

    transports = (data.credential.get("response") or {}).get("transports") or []
    label = device_label(request.headers.get("user-agent", ""))
    pk = models.PasskeyCredential(
        user_id=user.id,
        credential_id=cred_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        transports=",".join(t for t in transports if isinstance(t, str))[:200] or None,
        device_label=label,
        opens=row.opens or [],
    )
    db.add(pk)
    await db.flush()
    club = await db.get(models.Club, user.club_id)
    if club:
        await log_action(db, club=club, user=user, action=AuditAction.PASSKEY_ADDED, request=request,
                         entity_type="passkey", entity_id=pk.id,
                         meta={"device": label, "accounts": len(pk.opens or [])})
    await db.commit()
    return {"id": pk.id, "credential_id": cred_id, "device_label": label}


@player_router.get("")
async def list_passkeys(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
    claims: dict = Depends(get_token_claims),
):
    # Las de TODAS las cuentas de esta sesión (multi-cuenta): la huella de este
    # celular pudo activarse desde la otra cuenta de la misma persona.
    rows = (await db.execute(
        select(models.PasskeyCredential)
        .where(models.PasskeyCredential.user_id.in_(_session_uids(claims, user)))
        .order_by(models.PasskeyCredential.created_at)
    )).scalars().all()
    return {"passkeys": [{
        "id": r.id, "credential_id": r.credential_id, "device_label": r.device_label,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
    } for r in rows]}


@player_router.delete("/{passkey_id}")
async def delete_passkey(
    passkey_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
    claims: dict = Depends(get_token_claims),
):
    pk = (await db.execute(
        select(models.PasskeyCredential).where(
            models.PasskeyCredential.id == passkey_id,
            # solo las propias (cuentas que la clave de esta sesión abrió)
            models.PasskeyCredential.user_id.in_(_session_uids(claims, user)),
        )
    )).scalars().first()
    if not pk:
        raise _err(404, "not_found", "Esa huella ya no está activa.")
    label = pk.device_label
    await db.delete(pk)
    club = await db.get(models.Club, user.club_id)
    if club:
        await log_action(db, club=club, user=user, action=AuditAction.PASSKEY_REMOVED, request=request,
                         entity_type="passkey", entity_id=passkey_id, meta={"device": label})
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# ENTRAR (sin sesión)
# ---------------------------------------------------------------------------
@auth_router.post("/options")
@limiter.limit("300/hour", key_func=client_ip)
async def login_options(request: Request):
    # Sin DB: el login anónimo (y el pre-cargado del botón) no escribe nada.
    opts = generate_authentication_options(
        rp_id=RP_ID,
        challenge=_new_login_challenge(),
        timeout=120000,
        user_verification=UserVerificationRequirement.REQUIRED,
        # Sin allow_credentials: el teléfono ofrece sus passkeys de rakeflow.site.
    )
    return {"options": json.loads(options_to_json(opts))}


class LoginVerifyIn(BaseModel):
    credential: dict


@auth_router.post("/verify")
@limiter.limit("60/hour", key_func=client_ip)
async def login_verify(data: LoginVerifyIn, request: Request, db: AsyncSession = Depends(get_db)):
    challenge = _challenge_from_client_data(data.credential)
    if not _login_challenge_ok(challenge):
        raise _err(400, "challenge_expired", "Se venció el intento. Vuelve a intentarlo.")
    cred_id = _norm_cred_id(data.credential)
    pk = (await db.execute(
        select(models.PasskeyCredential).where(models.PasskeyCredential.credential_id == cred_id)
    )).scalars().first()
    if not pk:
        # Se quitó desde el panel (o la cuenta ya no existe): el front borra su
        # marca local y vuelve a la clave.
        logger.info("passkey_login_unknown_credential")
        raise _err(401, "passkey_unknown", "Esta huella ya no está activa. Entra con tu clave.")
    owner = await db.get(models.User, pk.user_id)
    try:
        verified = verify_authentication_response(
            credential=data.credential,
            expected_challenge=challenge,
            expected_rp_id=RP_ID,
            expected_origin=ORIGINS,
            credential_public_key=base64url_to_bytes(pk.public_key),
            credential_current_sign_count=int(pk.sign_count or 0),
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, KeyError, TypeError):
        if owner:
            await log_standalone(db, club_id=owner.club_id, actor_email=owner.email,
                                 action=AuditAction.LOGIN_FAILED, request=request,
                                 meta={"user_id": owner.id, "method": "passkey", "reason": "verify_failed"})
        raise _err(401, "verify_failed", "No pudimos verificar la huella. Entra con tu clave.")

    # Un solo uso: se anota DESPUÉS de una firma válida (el índice único hace
    # que reenviar la misma firma choque, incluso con dos pedidos a la vez).
    now = datetime.utcnow()
    await db.execute(delete(models.PasskeyChallenge).where(models.PasskeyChallenge.expires_at < now))
    db.add(models.PasskeyChallenge(challenge=bytes_to_base64url(challenge), purpose="login_used",
                                   expires_at=now + timedelta(minutes=CHALLENGE_MINUTES)))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _err(400, "challenge_expired", "Se venció el intento. Vuelve a intentarlo.")

    users = await valid_accounts(db, pk.opens)
    if not users:
        # Todas las cuentas que abría cambiaron de clave o ya no están: la
        # passkey no sirve más.
        await db.delete(pk)
        if owner:
            await log_standalone(db, club_id=owner.club_id, actor_email=owner.email,
                                 action=AuditAction.PASSKEY_REMOVED, request=request,
                                 meta={"user_id": owner.id, "reason": "password_changed"})
        await db.commit()
        raise _err(401, "passkey_revoked",
                   "Cambiaste tu clave: entra con la clave nueva y vuelve a activar la huella.")

    pk.sign_count = verified.new_sign_count
    pk.last_used_at = now
    uids = [u.id for u in users]
    first = users[0]
    await log_standalone(db, club_id=first.club_id, actor_email=first.email,
                         action=AuditAction.LOGIN_SUCCESS, request=request,
                         meta={"user_id": first.id, "method": "passkey", "passkey_id": pk.id,
                               "accounts": len(users)})
    if len(users) > 1:
        await db.commit()
        return {
            "multi_account": True,
            "accounts": await accounts.account_views(db, users),
            "select_token": accounts.create_select_token(first.phone, uids),
        }
    # _issue_for_account confirma (commit) el sign_count y el log de arriba.
    return await _issue_for_account(db, first.id, uids)
