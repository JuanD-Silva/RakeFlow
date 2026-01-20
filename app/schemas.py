# app/schemas.py
from pydantic import BaseModel, Field, ConfigDict
from decimal import Decimal
from typing import Optional, List
from datetime import datetime
from .models import TransactionType, SessionStatus
from enum import Enum


# Asegúrate de tener este Enum para validación
class RuleTypeEnum(str, Enum):
    FIXED = "FIXED"
    MONTHLY_QUOTA = "QUOTA"
    PERCENTAGE = "PERCENTAGE"

# Base Config to handle Decimal serialization nicely
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class ClubCreate(BaseModel):
    name: str
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# --- SCHEMAS DE JUGADORES (NUEVO) ---
class PlayerBase(BaseSchema):
    name: str
    phone: str 

class PlayerCreate(PlayerBase):
    pass

class PlayerResponse(PlayerBase):
    id: int
    created_at: datetime

class PlayerSessionStats(BaseModel):
    player_id: int
    name: str
    total_buyin: float
    total_cashout: float
    total_spend: float  # Bebidas/Comida
    total_jackpot: float = 0.0
    current_balance: float # (Cashout - Buyin - Spend) -> Ganancia o Pérdida neta
    last_method: str = "CASH"

# --- SCHEMAS DE SESIÓN ---
class SessionCreate(BaseSchema):
    blind_level: str = "500/1000"
    default_rake_per_hour: Decimal = Decimal(0)

class SessionCloseRequest(BaseModel):
    declared_rake_cash: Decimal = Field(..., ge=0)
    declared_jackpot_cash: Decimal = Field(default=Decimal(0), ge=0)
    force_close: bool = False

class SessionResponse(BaseSchema):
    id: int
    status: SessionStatus
    start_time: datetime
    end_time: Optional[datetime]
    rake_per_hour: Optional[Decimal]
    declared_rake_cash: Optional[Decimal] = Decimal(0)
    declared_jackpot_cash: Optional[Decimal] = Decimal(0)
    rake_per_hour: float = 0.0
    audited_with_error: bool = False
    debt_payment: float

# --- SCHEMAS DE TRANSACCIONES ---
class TransactionCreate(BaseSchema):
    player_id: Optional[int] = None
    amount: Decimal = Field(..., gt=0, decimal_places=2) 
    # Validamos que sea positivo y tenga max 2 decimales
    method: str = "CASH"

class TransactionResponse(BaseSchema):
    id: int
    session_id: int
    type: TransactionType
    amount: Decimal
    timestamp: datetime
    player_id: Optional[int] = None


class AuditResponse(BaseModel):
    total_buyins: float
    total_cashouts: float
    total_expenses: float
    total_tips: float
    total_jackpot_payouts: float
    expected_cash_in_box: float 
    transactions_count: int

# Esquema para crear/editar una regla
class DistributionRuleCreate(BaseModel):
    name: str
    percent: float = Field(..., gt=0, le=1.0, description="Debe ser entre 0 y 1")

class DistributionRuleResponse(DistributionRuleCreate):
    id: int
    active: bool

    class Config:
        from_attributes = True

# --- DISTRIBUTION RULES ---

class DistributionRuleBase(BaseModel):
    name: str
    rule_type: RuleTypeEnum # Nuevo: FIXED, QUOTA, PERCENTAGE
    value: float            # Nuevo: Puede ser dinero (400000) o decimal (0.25)
    priority: int = 10      # Nuevo: Orden de cobro

class DistributionRuleCreate(DistributionRuleBase):
    pass

class DistributionRuleResponse(DistributionRuleBase):
    id: int
    club_id: int
    active: bool

    class Config:
        from_attributes = True

class PartnerSetup(BaseModel):
    name: str
    percentage: float # Ej: 45.0

class InitialSetupRequest(BaseModel):
    monthly_goal: float = 0

class InitialSetupRequest(BaseModel):
    monthly_goal: float = 0
    partners: List[PartnerSetup] # Lista de socios