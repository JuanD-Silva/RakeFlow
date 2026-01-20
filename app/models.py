# app/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Enum as SqEnum
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
    name = Column(String, unique=True, index=True) 
    code = Column(String, unique=True, index=True) 
    
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    
    is_active = Column(Boolean, default=True) 
    plan_type = Column(String, default="BASIC")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relaciones
    users = relationship("User", back_populates="club")
    players = relationship("Player", back_populates="club")
    sessions = relationship("Session", back_populates="club")
    rules = relationship("DistributionRule", back_populates="club") # Agregado

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
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    # 👇 Se cambia a nullable=True para permitir propinas anónimas
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True) 

    type = Column(SqEnum(TransactionType))
    amount = Column(Float, nullable=False)
    method = Column(String, default="CASH")
    
    timestamp = Column(DateTime, default=datetime.utcnow)

    # Relaciones
    session = relationship("Session", back_populates="transactions")
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