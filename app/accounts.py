# app/accounts.py
"""Identidad multi-cuenta: una PERSONA (un teléfono) puede tener varias cuentas.

Hasta ahora el teléfono era identidad única global (un teléfono = una cuenta =
un club y un rol), así que el que juega y dealea en el mismo club —o juega en
dos clubes— chocaba con "ese teléfono ya está registrado en otra cuenta".

Ahora la unicidad es (teléfono, club, rol): la misma persona puede tener fila de
PLAYER y de DEALER en Mambo, y de PLAYER en otro club. El login por teléfono
devuelve TODAS sus cuentas y la persona elige con cuál entra (o cambia sin
cerrar sesión con /auth/switch-account).

UNA PERSONA, UNA CLAVE: las cuentas del mismo teléfono comparten hash. Cada
activación (que exige OTP al número, o sea prueba de posesión) sincroniza la
clave en todas — equivale a un reset. Así el login por teléfono no es ambiguo.
"""
from datetime import datetime, timedelta

from jose import JWTError, jwt
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from . import auth_utils, models

# El token de selección solo sirve para elegir cuenta tras validar la clave.
# Vida corta: es un paso intermedio del login, no una sesión.
SELECT_TOKEN_MINUTES = 10


async def accounts_for_phone(db: AsyncSession, phone: str | None) -> list[models.User]:
    """Cuentas ACTIVAS y ya activadas de esa persona (todas sus membresías).
    Lista vacía si no hay teléfono (el staff entra por email: no aplica)."""
    if not phone:
        return []
    return list((await db.execute(
        select(models.User)
        .where(
            models.User.phone == phone,
            models.User.is_active == True,  # noqa: E712
            models.User.hashed_password.isnot(None),
        )
        .order_by(models.User.club_id, models.User.id)
    )).scalars().all())


async def account_views(db: AsyncSession, users: list[models.User],
                        current_id: int | None = None) -> list[dict]:
    """Lo que la pantalla de elección necesita: con qué club y en qué rol entra.
    Jamás expone hashes, emails de otros ni datos del club más allá del nombre."""
    if not users:
        return []
    club_ids = {u.club_id for u in users}
    clubs = {c.id: c for c in (await db.execute(
        select(models.Club).where(models.Club.id.in_(club_ids))
    )).scalars().all()}
    out = []
    for u in users:
        club = clubs.get(u.club_id)
        out.append({
            "user_id": u.id,
            "club_id": u.club_id,
            "club_name": club.name if club else "Club",
            "role": u.role.value if hasattr(u.role, "value") else str(u.role),
            "name": u.name,
            "current": u.id == current_id,
        })
    return out


async def sync_password(db: AsyncSession, phone: str, hashed: str, keep_id: int) -> int:
    """Una persona, una clave: propaga el hash al resto de cuentas del teléfono.

    Se llama SOLO tras una activación con OTP verificado (prueba de posesión del
    número), así que equivale a un reset de clave de esa identidad. Devuelve
    cuántas filas se sincronizaron (0 si es su única cuenta)."""
    if not phone:
        return 0
    result = await db.execute(
        update(models.User)
        .where(
            models.User.phone == phone,
            models.User.id != keep_id,
            models.User.hashed_password.isnot(None),  # las pendientes se activan solas
        )
        .values(hashed_password=hashed)
    )
    return result.rowcount or 0


async def phone_taken_by_other(db: AsyncSession, phone: str, club_id: int,
                               role: models.UserRole, own_user_id: int | None) -> bool:
    """¿Ese teléfono ya tiene cuenta EN ESTE CLUB CON ESTE ROL (y no es la suya)?

    Es el único conflicto que queda: la misma persona puede tener cuentas en
    otros clubes u otros roles. Espeja el índice único (phone, club_id, role)."""
    other = (await db.execute(
        select(models.User.id).where(
            models.User.phone == phone,
            models.User.club_id == club_id,
            models.User.role == role,
        )
    )).scalars().first()
    return other is not None and other != own_user_id


def create_select_token(phone: str, user_ids: list[int]) -> str:
    """Token efímero del paso 'elegí con qué cuenta entrás'. Lleva los ids
    permitidos: nadie puede canjearlo por una cuenta que no sea suya."""
    expire = datetime.utcnow() + timedelta(minutes=SELECT_TOKEN_MINUTES)
    return jwt.encode(
        {"purpose": "select", "phone": phone, "uids": user_ids, "exp": expire},
        auth_utils.SECRET_KEY, algorithm=auth_utils.ALGORITHM,
    )


def decode_select_token(token: str) -> dict | None:
    """None si es inválido, venció o NO es un token de selección (un access_token
    no sirve acá: purpose lo separa)."""
    try:
        payload = jwt.decode(token, auth_utils.SECRET_KEY, algorithms=[auth_utils.ALGORITHM])
    except JWTError:
        return None
    if payload.get("purpose") != "select" or not payload.get("uids"):
        return None
    return payload


def token_for(user: models.User, club: models.Club) -> str:
    """access_token de UNA cuenta concreta (mismo payload que el login simple)."""
    return auth_utils.create_access_token({
        "sub": user.email or user.phone,
        "club_id": club.id,
        "user_id": user.id,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
    })
