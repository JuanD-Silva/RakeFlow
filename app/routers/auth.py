# app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from .. import models, schemas, auth_utils
from ..dependencies import get_db, get_current_club

router = APIRouter(tags=["Authentication"])

# ---------------------------------------------------------
# 1. REGISTRO DE NUEVO CLUB (ONBOARDING)
# ---------------------------------------------------------
@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register_club(club_data: schemas.ClubCreate, db: AsyncSession = Depends(get_db)):
    """
    Crea un nuevo Club (Cliente SaaS) y le configura reglas iniciales.
    """
    # A. Validar que el email no exista
    result = await db.execute(select(models.Club).where(models.Club.email == club_data.email))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Este email ya está registrado.")

    # B. Crear el Club
    hashed_pwd = auth_utils.get_password_hash(club_data.password)
    
    new_club = models.Club(
        name=club_data.name,
        email=club_data.email,
        hashed_password=hashed_pwd,
        plan_type="BASIC",
        is_active=True
    )
    db.add(new_club)
    await db.commit()
    await db.refresh(new_club)

    # C. ONBOARDING AUTOMÁTICO: Crear Reglas por Defecto 🚀
    # Esto es clave para que el usuario tenga el sistema listo al entrar.
    default_rules = [
        models.DistributionRule(
            club_id=new_club.id, 
            name="Caja (Gastos Fijos)", 
            rule_type=models.RuleType.MONTHLY_QUOTA, 
            value=400000,  # Meta mensual por defecto
            priority=1, 
            active=True
        ),
        models.DistributionRule(
            club_id=new_club.id, 
            name="Utilidad Socios", 
            rule_type=models.RuleType.PERCENTAGE, 
            value=1.00,    # 100% de lo que sobre va para socios
            priority=2, 
            active=True
        ),
    ]
    db.add_all(default_rules)
    await db.commit()

    return {"message": "Club creado exitosamente", "club_id": new_club.id, "email": new_club.email}


# ---------------------------------------------------------
# 2. LOGIN (OBTENER TOKEN)
# ---------------------------------------------------------
@router.post("/auth/login", response_model=schemas.Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    """
    Intercambia credenciales (Email/Pass) por un Token JWT de sesión.
    Nota: OAuth2 usa el campo 'username' para el email.
    """
    # 1. Buscar usuario/club por email
    result = await db.execute(select(models.Club).where(models.Club.email == form_data.username))
    club = result.scalars().first()

    # 2. Validar contraseña
    if not club or not auth_utils.verify_password(form_data.password, club.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas (Email o Contraseña)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Generar Token (La "Llave Maestra" de la sesión)
    access_token = auth_utils.create_access_token(
        data={"sub": club.email, "club_id": club.id}
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.delete("/me/delete-account")
async def delete_my_account(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """
    PELIGRO: Borra el club actual y TODOS sus datos (jugadores, sesiones, dinero).
    Útil para reiniciar el ejercicio de desarrollo.
    """
    cid = current_club.id

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

    # 6. FINALMENTE: Borrar el Club
    await db.execute(delete(models.Club).where(models.Club.id == cid))
    
    await db.commit()
    
    return {"message": "Cuenta eliminada. Ahora puedes registrarte de nuevo desde cero."}