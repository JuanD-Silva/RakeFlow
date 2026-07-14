# app/accounts.py
"""Identidad multi-cuenta: una PERSONA (un teléfono) puede tener varias cuentas.

Hasta ahora el teléfono era identidad única global (un teléfono = una cuenta =
un club y un rol), así que el que juega y dealea en el mismo club —o juega en
dos clubes— chocaba con "ese teléfono ya está registrado en otra cuenta".

Ahora la unicidad es (teléfono, club, rol): la misma persona puede tener fila de
PLAYER y de DEALER en Mambo, y de PLAYER en otro club. El login por teléfono
devuelve TODAS sus cuentas y la persona elige con cuál entra (o cambia sin
cerrar sesión con /auth/switch-account).

BASE DE CONFIANZA (importante): el OTP de invitación NO prueba posesión del
teléfono — RakeFlow no manda el WhatsApp, le devuelve el código al STAFF que
invita. Un club puede emitir un código contra cualquier número. Por eso:

- Cada cuenta guarda su PROPIO hash: un club jamás puede cambiar la clave de
  una cuenta de otro club (si se sincronizaran, cualquiera podría abrir un club
  de prueba, invitar el teléfono de un jugador de Mambo y sobrescribirle la
  clave → toma de cuenta).
- Lo que agrupa las cuentas de una persona en el selector es LA CLAVE, no el
  teléfono: el login prueba la clave contra cada cuenta de ese número y solo
  ofrece las que abre. Quien reusa su clave habitual al activar ve todas juntas.
- El access_token lleva `uids` = las cuentas que esa clave abrió. my-accounts y
  switch-account NO pueden salirse de ese set (ni listar cuentas ajenas del
  mismo número, ni saltar a ellas).
"""
from datetime import datetime, timedelta

from jose import JWTError, jwt
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


async def accounts_opened_by(db: AsyncSession, phone: str | None, password: str,
                             loop) -> list[models.User]:
    """Las cuentas de ese teléfono que ESTA clave abre. Es el corazón del
    modelo: la clave —no el número— es lo que agrupa a la persona.

    Una cuenta creada por un club ajeno (con OTRA clave) jamás entra acá, así
    que no se puede listar ni tomar la cuenta de nadie."""
    out = []
    for u in await accounts_for_phone(db, phone):
        ok = await loop.run_in_executor(
            None, auth_utils.verify_password, password, u.hashed_password)
        if ok:
            out.append(u)
    return out


async def other_activated_accounts(db: AsyncSession, phone: str,
                                  exclude_id: int) -> list[models.User]:
    """Cuentas YA activadas de este teléfono, distintas de la que se activa.
    Si hay alguna, la nueva activación es una SEGUNDA cuenta sobre el número."""
    return [u for u in await accounts_for_phone(db, phone) if u.id != exclude_id]


async def accounts_opening(users: list[models.User], password: str, loop) -> list[models.User]:
    """De `users`, las que esta clave abre. Prueba de que quien activa la 2da
    cuenta es la MISMA persona que ya tiene cuenta en este número."""
    out = []
    for u in users:
        if await loop.run_in_executor(
                None, auth_utils.verify_password, password, u.hashed_password):
            out.append(u)
    return out


LINK_REQUIRED_MSG = (
    "Ya tenés una cuenta en RakeFlow con este número. Para vincular esta nueva, "
    "ingresá la contraseña de tu cuenta actual."
)


async def phone_taken_by_other(db: AsyncSession, phone: str, club_id: int,
                               role: models.UserRole, own_user_id: int | None) -> bool:
    """¿Ese teléfono ya tiene cuenta EN ESTE CLUB CON ESTE ROL (y no es la suya)?

    Espeja el índice único (phone, club_id, role); NO es un control de
    seguridad entre clubes (esa garantía la da el hash por cuenta: un club no
    puede tocar la clave —ni ver— la cuenta que la persona tiene en otro club).
    """
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


def token_for(user: models.User, club: models.Club,
              uids: list[int] | None = None) -> str:
    """access_token de UNA cuenta concreta.

    `uids` = las cuentas que la clave de esta sesión abrió. Viaja en el token y
    es el ÚNICO set al que my-accounts/switch-account pueden referirse: sin él
    (tokens viejos) la sesión no puede cambiar de cuenta, solo re-loguear."""
    return auth_utils.create_access_token({
        "sub": user.email or user.phone,
        "club_id": club.id,
        "user_id": user.id,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "uids": uids or [user.id],
    })
