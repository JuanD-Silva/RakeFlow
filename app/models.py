# app/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Enum as SqEnum, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .database import Base

# --- ENUMS (Opciones fijas) ---
class TransactionType(str, enum.Enum):
    BUYIN = "buyin"
    CASHOUT = "cashout"
    SPEND = "spend"
    REBUY = "rebuy"
    TIP = "tip"
    JACKPOT_PAYOUT = "jackpot-payout"
    BONUS = "BONUS"
    TOURNAMENT_ENTRY = "TOURNAMENT_ENTRY"
    TOURNAMENT_TIP = "TOURNAMENT_TIP"
    TOURNAMENT_REBUY = "TOURNAMENT_REBUY" 
    TOURNAMENT_ADDON = "TOURNAMENT_ADDON"

class SessionStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"

class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin" # Tú (Dueño del SaaS)
    OWNER = "owner"           # Tu Cliente (Dueño del Club)
    MANAGER = "manager"       # Cajero/Empleado

class RuleType(str, enum.Enum):
    FIXED = "FIXED"           # Ej: Alquiler diario
    MONTHLY_QUOTA = "QUOTA"   # Ej: Deuda mensual
    PERCENTAGE = "PERCENTAGE" # Ej: Socio %

# --- MODELOS SAAS (Tablas) ---

class Club(Base):
    """
    Representa a tu CLIENTE (El Club de Poker).
    """
    __tablename__ = "clubs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    code = Column(String, unique=True, index=True) 
    
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    
    is_active = Column(Boolean, default=True)
    plan_type = Column(String, default="BASIC")
    jackpot_adjustment = Column(Float, default=0.0)
    email_verified = Column(Boolean, default=False)
    setup_completed = Column(Boolean, default=False)
    subscription_active = Column(Boolean, default=False)
    subscription_trial_end = Column(DateTime, nullable=True)
    email_verification_token = Column(String, nullable=True)
    password_reset_token = Column(String, nullable=True)
    password_reset_expires = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relaciones
    users = relationship("User", back_populates="club")
    players = relationship("Player", back_populates="club")
    sessions = relationship("Session", back_populates="club")
    rules = relationship("DistributionRule", back_populates="club") # Agregado
    tournaments = relationship("Tournament", back_populates="club")

class User(Base):
    """
    Usuarios que pueden entrar al sistema (Login).
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=True)
    
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(SqEnum(UserRole), default=UserRole.MANAGER)
    
    is_active = Column(Boolean, default=True)

    club = relationship("Club", back_populates="users")


class Player(Base):
    """
    Jugadores vinculados a un Club específico.
    """
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)

    name = Column(String, index=True)
    phone = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relaciones
    club = relationship("Club", back_populates="players")
    transactions = relationship("Transaction", back_populates="player")


class Session(Base):
    """
    Una mesa o sesión de juego.
    """
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)

    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    status = Column(SqEnum(SessionStatus), default=SessionStatus.OPEN)
    
    # Contadores financieros
    rake_total = Column(Float, default=0.0)
    
    # Cierre de Caja (Inputs)
    declared_rake_cash = Column(Float, default=0.0)    
    declared_jackpot_cash = Column(Float, default=0.0) 
    
    # Resultados del Cierre (Calculados por el Backend) 👇 CRÍTICO
    debt_payment = Column(Float, default=0.0)    # Cuánto se pagó a deuda
    partner_profit = Column(Float, default=0.0)  # Cuánto ganaron los socios
    
    notes = Column(String, nullable=True)

    # Relaciones
    club = relationship("Club", back_populates="sessions")
    transactions = relationship("Transaction", back_populates="session")
    distributions = relationship("FinancialDistribution", back_populates="session") # Agregado


class Transaction(Base):
    """
    Movimientos de dinero.
    """
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True)

    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=True)
    # 👇 Se cambia a nullable=True para permitir propinas anónimas
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True) 

    type = Column(SqEnum(TransactionType))
    amount = Column(Float, nullable=False)
    method = Column(String, default="CASH")
    
    timestamp = Column(DateTime, default=datetime.utcnow)
    description = Column(String, nullable=True)

    # Relaciones
    session = relationship("Session", back_populates="transactions")
    tournament = relationship("Tournament", foreign_keys=[tournament_id])
    player = relationship("Player", back_populates="transactions")


class DistributionRule(Base):
    """
    Reglas de negocio SaaS (Cómo se reparte el dinero).
    """
    __tablename__ = "distribution_rules"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False)
    
    name = Column(String) 
    rule_type = Column(SqEnum(RuleType), default=RuleType.PERCENTAGE)
    value = Column(Float, nullable=False) 
    priority = Column(Integer, default=10) 
    active = Column(Boolean, default=True)

    club = relationship("Club", back_populates="rules")

# ---------------------------------------------------------
# RESULTADOS FINANCIEROS
# ---------------------------------------------------------
class FinancialDistribution(Base):
    __tablename__ = "financial_distributions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))
    
    name = Column(String) 
    amount = Column(Float) 
    percentage_applied = Column(Float, default=0.0) 
    
    session = relationship("Session", back_populates="distributions")

# ---------------------------------------------------------
# TORNEOS
# ---------------------------------------------------------
class Tournament(Base):
    __tablename__ = "tournaments"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"))
    
    name = Column(String, nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow)  
    end_time = Column(DateTime, nullable=True)
    
    # --- ESTRUCTURA DE COSTOS ---
    buyin_amount = Column(Integer, default=0)    # Costo base de entrada (Va al Pozo Bruto)
    rake_percentage = Column(Integer, default=10) # % que la casa quita del Pozo Bruto al final
    rebuy_price = Column(Integer, default=0)          # Rebuy Sencillo
    double_rebuy_price = Column(Integer, default=0)
    addon_price = Column(Integer, default=0)          # Add-on Sencillo
    double_addon_price = Column(Integer, default=0)
    # EXTRAS (Pagos Adicionales Fijos)
    dealer_tip_amount = Column(Integer, default=0) # Ej: 10.000 (Va a Dealers, no al pozo)
    addon_price = Column(Integer, default=0)       # Ej: 50.000 (Va al Pozo Bruto)
    bounty_amount = Column(Integer, default=0)     # Ej: 20.000 (Va directo al jugador que elimina)
    
    # Estado
    status = Column(String, default="REGISTERING") 
    
    # Relaciones
    club = relationship("Club", back_populates="tournaments")
    players = relationship("TournamentPlayer", back_populates="tournament", cascade="all, delete-orphan", lazy="selectin")

    payout_structure = Column(JSON, default=[]) 

class TournamentPlayer(Base):
    __tablename__ = "tournament_players"

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"))
    player_id = Column(Integer, ForeignKey("players.id"))
    
    # Estado
    status = Column(String, default="ACTIVE") # ACTIVE, ELIMINATED

    is_tip_paid = Column(Boolean, default=False)
    
    # Contadores de Dinero
    rebuys_count = Column(Integer, default=0) # Cantidad de recompras hechas
    addons_count = Column(Integer, default=0) # Cantidad de add-ons hechos

    double_rebuys_count = Column(Integer, default=0) 
    double_addons_count = Column(Integer, default=0)
    
    # Resultados
    rank = Column(Integer, nullable=True) 
    prize_collected = Column(Integer, default=0)

    tournament = relationship("Tournament", back_populates="players")
    player = relationship("Player")
