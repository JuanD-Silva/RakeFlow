# app/routers/auth.py
import secrets
import logging
import threading
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, or_
from pydantic import BaseModel
from .. import models, schemas, auth_utils
from ..phone_utils import normalize_phone
from .. import accounts
from ..dependencies import get_db, get_current_club, get_current_user, require_role
from ..email_service import send_password_reset_email, send_verification_email
from ..rate_limit import limiter
from ..audit import log_action, log_standalone, AuditAction

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Authentication"])

class LoginJSON(BaseModel):
    username: str
    password: str

# ---------------------------------------------------------
# 1. REGISTRO DE NUEVO CLUB (ONBOARDING)
# ---------------------------------------------------------
@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("3/hour")
async def register_club(request: Request, club_data: schemas.ClubCreate, db: AsyncSession = Depends(get_db)):
    """
    Crea un nuevo Club (Cliente SaaS) y le configura reglas iniciales.
    """
    # A. Validar que el email no exista
    result = await db.execute(select(models.Club).where(models.Club.email == club_data.email))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="This email is already registered. Este email ya está registrado.")

    # B. Hash de password en thread (no bloquea el event loop)
    import asyncio
    loop = asyncio.get_event_loop()
    hashed_pwd = await loop.run_in_executor(None, auth_utils.get_password_hash, club_data.password)

    # C. Crear club + reglas + token en un solo commit
    verification_token = secrets.token_urlsafe(32)

    new_club = models.Club(
        name=club_data.name,
        email=club_data.email,
        hashed_password=hashed_pwd,
        plan_type="BASIC",
        is_active=True,
        email_verification_token=verification_token,
        public_token=secrets.token_urlsafe(16),  # link público del club
        terms_accepted_at=datetime.utcnow()
    )
    db.add(new_club)
    await db.flush()  # Obtiene el ID sin hacer commit

    # User OWNER inicial vinculado al Club
    owner_user = models.User(
        club_id=new_club.id,
        email=club_data.email,
        name=club_data.name,
        hashed_password=hashed_pwd,
        role=models.UserRole.OWNER,
        is_active=True,
    )
    db.add(owner_user)

    db.add_all([
        models.DistributionRule(club_id=new_club.id, name="Caja (Gastos Fijos)", rule_type=models.RuleType.MONTHLY_QUOTA, value=400000, priority=1, active=True),
        models.DistributionRule(club_id=new_club.id, name="Utilidad Socios", rule_type=models.RuleType.PERCENTAGE, value=1.00, priority=2, active=True),
    ])

    await db.commit()

    # D. Email en background
    threading.Thread(target=send_verification_email, args=(new_club.email, verification_token, new_club.name), daemon=True).start()

    return {"message": "Club creado exitosamente", "club_id": new_club.id, "email": new_club.email}


# ---------------------------------------------------------
# 2. LOGIN (OBTENER TOKEN) — Acepta form-urlencoded y JSON
# ---------------------------------------------------------
# Sin response_model: la respuesta es el access_token de siempre O —si la
# persona tiene varias cuentas— la lista para elegir (multi_account=True).
@router.post("/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Intercambia credenciales (Email/Pass) por un Token JWT de sesión.
    Acepta application/x-www-form-urlencoded (OAuth2) o application/json.
    """
    content_type = request.headers.get("content-type", "")

    if "application/json" in content_type:
        body = await request.json()
        username = body.get("username", "")
        password = body.get("password", "")
    else:
        form = await request.form()
        username = form.get("username", "")
        password = form.get("password", "")

    # Buscar User por email primero (match exacto). Si no hay y el input no parece
    # email, caer a teléfono (los dealers entran por número). Priorizar email
    # evita ambigüedad si dos filas distintas matchean por vías distintas.
    user = (await db.execute(
        select(models.User).where(models.User.email == username)
    )).scalars().first()
    if not user and "@" not in username:
        norm_phone = normalize_phone(username)
        if norm_phone:
            user = (await db.execute(
                select(models.User).where(models.User.phone == norm_phone)
            )).scalars().first()

    if not user or not user.is_active or user.hashed_password is None:
        logger.info("login_failed_unknown_or_pending email=%s", username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas (Email o Contraseña)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Cargar Club asociado (para campos como setup_completed, subscription, etc.)
    club_result = await db.execute(select(models.Club).where(models.Club.id == user.club_id))
    club = club_result.scalars().first()
    if not club:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Club no encontrado")

    import asyncio
    loop = asyncio.get_event_loop()
    valid = await loop.run_in_executor(None, auth_utils.verify_password, password, user.hashed_password)

    if not valid:
        await log_standalone(
            db, club_id=club.id, actor_email=user.email,
            action=AuditAction.LOGIN_FAILED, request=request,
            meta={"reason": "invalid_password", "user_id": user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas (Email o Contraseña)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # MULTI-CUENTA: una persona (un teléfono) puede ser jugador y dealer, o
    # jugador en dos clubes. Si la clave abre más de una cuenta, el login no
    # decide por ella: devuelve la lista y un token efímero para que elija.
    # (El staff entra por email → una sola cuenta → flujo intacto.)
    if user.phone:
        mine = await accounts.accounts_for_phone(db, user.phone)
        # Verificar la clave contra cada una: las cuentas del mismo teléfono
        # comparten hash (sync_password), pero una divergencia histórica no debe
        # ofrecer una cuenta cuya clave NO es la que acaba de escribir.
        matches = [u for u in mine if u.id == user.id or await loop.run_in_executor(
            None, auth_utils.verify_password, password, u.hashed_password)]
        if len(matches) > 1:
            await log_action(
                db, request=request, club=club,
                action=AuditAction.LOGIN_SUCCESS,
                meta={"user_id": user.id, "multi_account": True,
                      "accounts": len(matches)},
            )
            await db.commit()
            return {
                "multi_account": True,
                "accounts": await accounts.account_views(db, matches),
                "select_token": accounts.create_select_token(
                    user.phone, [u.id for u in matches]),
            }

    access_token = accounts.token_for(user, club)

    user.last_login_at = datetime.utcnow()
    await log_action(
        db, request=request, club=club,
        action=AuditAction.LOGIN_SUCCESS,
        meta={"user_id": user.id, "role": user.role.value if hasattr(user.role, "value") else str(user.role)},
    )
    await db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "setup_completed": club.setup_completed or False,
        "email_verified": club.email_verified or False,
        "subscription_active": club.subscription_active or False,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "user_name": user.name,
    }

class SelectAccountIn(BaseModel):
    select_token: str
    user_id: int


class SwitchAccountIn(BaseModel):
    user_id: int


async def _issue_for_account(db: AsyncSession, user_id: int, allowed_ids: list[int],
                             phone: str) -> dict:
    """Emite el access_token de la cuenta elegida. La cuenta DEBE estar en la
    lista autorizada (las que abrió la clave / las del teléfono autenticado):
    nadie canjea un token por una cuenta ajena."""
    if user_id not in allowed_ids:
        raise HTTPException(status_code=403, detail="Esa cuenta no es tuya")
    user = (await db.execute(
        select(models.User).where(models.User.id == user_id)
    )).scalars().first()
    if (not user or not user.is_active or user.hashed_password is None
            or user.phone != phone):
        raise HTTPException(status_code=401, detail="Cuenta no disponible")
    club = (await db.execute(
        select(models.Club).where(models.Club.id == user.club_id)
    )).scalars().first()
    if not club:
        raise HTTPException(status_code=401, detail="Club no encontrado")
    user.last_login_at = datetime.utcnow()
    await db.commit()
    return {"access_token": accounts.token_for(user, club), "token_type": "bearer"}


@router.post("/auth/select-account")
@limiter.limit("20/hour")
async def select_account(
    data: SelectAccountIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Paso 2 del login multi-cuenta: la persona ya probó su clave y ahora dice
    con cuál de SUS cuentas entra. Público, pero el select_token (10 min) es la
    prueba: lleva el teléfono y los ids permitidos."""
    payload = accounts.decode_select_token(data.select_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Sesión de selección vencida; volvé a entrar")
    return await _issue_for_account(db, data.user_id, payload["uids"], payload["phone"])


@router.get("/auth/my-accounts")
async def my_accounts(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Las cuentas de la persona logueada (para el switcher de la app). El staff
    por email ve solo la suya."""
    mine = await accounts.accounts_for_phone(db, current_user.phone)
    if not mine:
        mine = [current_user]
    return {"accounts": await accounts.account_views(db, mine, current_id=current_user.id)}


@router.post("/auth/switch-account")
async def switch_account(
    data: SwitchAccountIn,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Cambiar de cuenta SIN volver a escribir la clave: ya está autenticado como
    esa persona (mismo teléfono). Sin teléfono (staff por email) no hay a dónde
    cambiar."""
    if not current_user.phone:
        raise HTTPException(status_code=403, detail="Tu cuenta no tiene otras vinculadas")
    mine = await accounts.accounts_for_phone(db, current_user.phone)
    return await _issue_for_account(db, data.user_id, [u.id for u in mine], current_user.phone)


@router.get("/auth/me")
async def get_current_club_info(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    current_club: models.Club = Depends(get_current_club),
):
    return {
        # Datos del Club (cliente SaaS)
        "id": current_club.id,
        "name": current_club.name,
        "email": current_club.email,
        "setup_completed": current_club.setup_completed or False,
        "email_verified": current_club.email_verified or False,
        "subscription_active": current_club.subscription_active or False,
        "plan_type": current_club.plan_type,
        # Datos del Usuario autenticado
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "name": current_user.name,
            "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
        },
    }

@router.post("/auth/verify-email")
async def verify_email(data: dict, db: AsyncSession = Depends(get_db)):
    token = data.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Token requerido")

    result = await db.execute(
        select(models.Club).where(models.Club.email_verification_token == token)
    )
    club = result.scalars().first()

    if not club:
        raise HTTPException(status_code=400, detail="Token invalido")

    club.email_verified = True
    club.email_verification_token = None
    await db.commit()

    return {"message": "Email verificado correctamente"}


@router.post("/auth/resend-verification")
async def resend_verification(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    if current_club.email_verified:
        return {"message": "El email ya esta verificado"}

    token = secrets.token_urlsafe(32)
    current_club.email_verification_token = token
    await db.commit()

    threading.Thread(target=send_verification_email, args=(current_club.email, token, current_club.name), daemon=True).start()

    return {"message": "Email de verificacion reenviado"}


@router.delete("/me/delete-account")
async def delete_my_account(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """
    PELIGRO: Borra el club actual y TODOS sus datos (jugadores, sesiones, dinero).
    Útil para reiniciar el ejercicio de desarrollo.
    """
    cid = current_club.id
    await log_standalone(
        db, club_id=cid, actor_email=current_club.email,
        action=AuditAction.ACCOUNT_DELETE, request=request,
        meta={"club_name": current_club.name},
    )

    # No hay ON DELETE CASCADE en la DB: hay que borrar TODO lo que referencia
    # (directa o transitivamente) al club, hijos antes que padres. Mismo bug de
    # FKs que delete_session (#36): si falta una tabla, el DELETE final viola la
    # FK y el endpoint da 500.
    try:
        session_ids = select(models.Session.id).where(models.Session.club_id == cid)
        tournament_ids = select(models.Tournament.id).where(models.Tournament.club_id == cid)
        player_ids = select(models.Player.id).where(models.Player.club_id == cid)
        dealer_ids = select(models.Dealer.id).where(models.Dealer.club_id == cid)

        # 1. Distribuciones del cierre (FK -> sessions, sin club_id propio)
        await db.execute(delete(models.FinancialDistribution).where(
            models.FinancialDistribution.session_id.in_(session_ids)
        ))

        # 2. Transacciones: no tienen club_id; cuelgan de sesiones, torneos,
        # jugadores o dealers del club (cash, torneo, cortesías).
        await db.execute(delete(models.Transaction).where(or_(
            models.Transaction.session_id.in_(session_ids),
            models.Transaction.tournament_id.in_(tournament_ids),
            models.Transaction.player_id.in_(player_ids),
            models.Transaction.dealer_id.in_(dealer_ids),
        )))

        # 3. Todo lo de dealers (referencia sessions/tournaments/tables/users/dealers)
        await db.execute(delete(models.DealerAlert).where(models.DealerAlert.club_id == cid))
        await db.execute(delete(models.DealerShift).where(models.DealerShift.club_id == cid))
        await db.execute(delete(models.TournamentDealerShift).where(models.TournamentDealerShift.club_id == cid))
        await db.execute(delete(models.DealerPayout).where(models.DealerPayout.club_id == cid))

        # 4. Torneos: registros (FK -> tournaments/players/tables), luego mesas, luego torneos
        await db.execute(delete(models.TournamentPlayer).where(
            models.TournamentPlayer.tournament_id.in_(tournament_ids)
        ))
        await db.execute(delete(models.TournamentTable).where(models.TournamentTable.club_id == cid))
        await db.execute(delete(models.Tournament).where(models.Tournament.club_id == cid))

        # 5. Sesiones, jugadores y dealers (los dealers referencian users)
        await db.execute(delete(models.Session).where(models.Session.club_id == cid))
        await db.execute(delete(models.Player).where(models.Player.club_id == cid))
        await db.execute(delete(models.Dealer).where(models.Dealer.club_id == cid))

        # 6. Config del club
        await db.execute(delete(models.DistributionRule).where(models.DistributionRule.club_id == cid))
        await db.execute(delete(models.BlindTemplate).where(models.BlindTemplate.club_id == cid))

        # 7. Usuarios: al final de sus referentes (dealers, payouts, alertas,
        # suscripciones push — FK NOT NULL a users);
        # el self-FK invited_by_user_id se resuelve dentro del mismo DELETE.
        await db.execute(delete(models.PushSubscription).where(models.PushSubscription.club_id == cid))
        await db.execute(delete(models.User).where(models.User.club_id == cid))

        # 8. Audit logs (FK -> clubs) y el club
        await db.execute(delete(models.AuditLog).where(models.AuditLog.club_id == cid))
        await db.execute(delete(models.Club).where(models.Club.id == cid))

        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error("Error borrando la cuenta del club %d: %s", cid, e)
        raise HTTPException(status_code=500, detail="Error interno al eliminar la cuenta")

    return {"message": "Cuenta eliminada. Ahora puedes registrarte de nuevo desde cero."}


# ---------------------------------------------------------
# FORGOT PASSWORD
# ---------------------------------------------------------
class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@router.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Club).where(models.Club.email == data.email))
    club = result.scalars().first()

    if not club:
        # No revelar si el email existe o no
        return {"message": "Si el correo esta registrado, recibiras instrucciones para restablecer tu contrasena."}

    # Generar token seguro
    token = secrets.token_urlsafe(32)
    club.password_reset_token = token
    club.password_reset_expires = datetime.utcnow() + timedelta(hours=1)
    await db.commit()

    # Enviar email (en background)
    threading.Thread(target=send_password_reset_email, args=(club.email, token, club.name), daemon=True).start()

    return {"message": "Si el correo esta registrado, recibiras instrucciones para restablecer tu contrasena."}


@router.post("/auth/reset-password")
@limiter.limit("5/hour")
async def reset_password(request: Request, data: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="La contrasena debe tener al menos 6 caracteres.")

    result = await db.execute(
        select(models.Club).where(models.Club.password_reset_token == data.token)
    )
    club = result.scalars().first()

    if not club:
        raise HTTPException(status_code=400, detail="Token invalido o expirado.")

    if not club.password_reset_expires or club.password_reset_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Token expirado. Solicita uno nuevo.")

    import asyncio
    loop = asyncio.get_event_loop()
    club.hashed_password = await loop.run_in_executor(None, auth_utils.get_password_hash, data.new_password)
    club.password_reset_token = None
    club.password_reset_expires = None
    await log_action(
        db, request=request, club=club,
        action=AuditAction.PASSWORD_RESET,
    )
    await db.commit()

    return {"message": "Contrasena actualizada correctamente."}