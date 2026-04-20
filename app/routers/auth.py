# app/routers/auth.py
import secrets
import logging
import threading
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from pydantic import BaseModel
from .. import models, schemas, auth_utils
from ..dependencies import get_db, get_current_club
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
        terms_accepted_at=datetime.utcnow()
    )
    db.add(new_club)
    await db.flush()  # Obtiene el ID sin hacer commit

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
@router.post("/auth/login", response_model=schemas.Token)
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

    result = await db.execute(select(models.Club).where(models.Club.email == username))
    club = result.scalars().first()

    if not club:
        # Login fallido: email no existe. Solo logueamos en aplicacion, no en DB
        # para evitar polucion por intentos contra emails invalidos.
        logger.info("login_failed_unknown_email email=%s", username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas (Email o Contraseña)", headers={"WWW-Authenticate": "Bearer"})

    import asyncio
    loop = asyncio.get_event_loop()
    valid = await loop.run_in_executor(None, auth_utils.verify_password, password, club.hashed_password)

    if not valid:
        # Contrasena incorrecta contra un club real: si es importante auditarlo
        await log_standalone(
            db, club_id=club.id, actor_email=club.email,
            action=AuditAction.LOGIN_FAILED, request=request,
            meta={"reason": "invalid_password"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas (Email o Contraseña)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = auth_utils.create_access_token(
        data={"sub": club.email, "club_id": club.id}
    )

    await log_action(
        db, request=request, club=club,
        action=AuditAction.LOGIN_SUCCESS,
    )
    await db.commit()

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "setup_completed": club.setup_completed or False,
        "email_verified": club.email_verified or False,
        "subscription_active": club.subscription_active or False
    }

@router.get("/auth/me")
async def get_current_club_info(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    return {
        "id": current_club.id,
        "name": current_club.name,
        "email": current_club.email,
        "setup_completed": current_club.setup_completed or False,
        "email_verified": current_club.email_verified or False,
        "subscription_active": current_club.subscription_active or False,
        "plan_type": current_club.plan_type
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
    current_club: models.Club = Depends(get_current_club)
):
    """
    PELIGRO: Borra el club actual y TODOS sus datos (jugadores, sesiones, dinero).
    Útil para reiniciar el ejercicio de desarrollo.
    """
    cid = current_club.id
    # Log antes de borrar para preservar trazabilidad (el log sobrevive al delete)
    await log_standalone(
        db, club_id=cid, actor_email=current_club.email,
        action=AuditAction.ACCOUNT_DELETE, request=request,
        meta={"club_name": current_club.name},
    )

    # 1. Borrar Distribuciones (Dinero repartido)
    # Buscamos las sesiones del club para borrar sus distribuciones
    subquery_sessions = select(models.Session.id).where(models.Session.club_id == cid)
    await db.execute(delete(models.FinancialDistribution).where(
        models.FinancialDistribution.session_id.in_(subquery_sessions)
    ))

    # 2. Borrar Transacciones (Buyins, Cashouts)
    # Las transacciones están ligadas a sesiones o jugadores del club
    await db.execute(delete(models.Transaction).where(
        models.Transaction.session_id.in_(subquery_sessions)
    ))

    # 3. Borrar Sesiones
    await db.execute(delete(models.Session).where(models.Session.club_id == cid))

    # 4. Borrar Jugadores
    await db.execute(delete(models.Player).where(models.Player.club_id == cid))

    # 5. Borrar Reglas de Distribución
    await db.execute(delete(models.DistributionRule).where(models.DistributionRule.club_id == cid))

    # 6. Borrar audit logs del club (FK constraint hacia clubs.id)
    await db.execute(delete(models.AuditLog).where(models.AuditLog.club_id == cid))

    # 7. FINALMENTE: Borrar el Club
    await db.execute(delete(models.Club).where(models.Club.id == cid))

    await db.commit()

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