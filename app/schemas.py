# app/schemas.py
from pydantic import BaseModel, Field, ConfigDict, field_validator
from decimal import Decimal
from typing import Optional, List
from datetime import datetime
from .models import TransactionType, SessionStatus
from enum import Enum


class RuleTypeEnum(str, Enum):
    FIXED = "FIXED"
    MONTHLY_QUOTA = "QUOTA"
    PERCENTAGE = "PERCENTAGE"

# Base Config to handle Decimal serialization
class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

# --- AUTH ---
class ClubCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=5, max_length=150)
    password: str = Field(..., min_length=6, max_length=128)

class Token(BaseModel):
    access_token: str
    token_type: str

# --- JUGADORES ---
class PlayerBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)

    @field_validator('name')
    @classmethod
    def strip_name(cls, v):
        return v.strip()

class PlayerCreate(PlayerBase):
    pass

class PlayerResponse(PlayerBase):
    id: int
    created_at: datetime

class PlayerSessionStats(BaseModel):
    player_id: int
    name: str
    total_buyin: float
    phone: Optional[str] = None
    total_cashout: float
    total_spend: float
    total_jackpot: float = 0.0
    total_bonus: float = 0.0
    current_balance: float
    last_method: str = "CASH"

# --- SESIONES ---
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
    end_time: Optional[datetime] = None
    declared_rake_cash: Optional[Decimal] = Decimal(0)
    declared_jackpot_cash: Optional[Decimal] = Decimal(0)
    rake_per_hour: float = 0.0
    debt_payment: float = 0.0

# --- TRANSACCIONES ---
class TransactionCreate(BaseSchema):
    player_id: Optional[int] = None
    session_id: int
    amount: Decimal = Field(..., gt=0, decimal_places=2)
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
    total_bonuses: float = 0.0
    transactions_count: int

# --- DISTRIBUTION RULES ---
class DistributionRuleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    rule_type: RuleTypeEnum
    value: float = Field(..., ge=0, le=100000000)
    priority: int = Field(default=10, ge=1, le=100)

class DistributionRuleCreate(DistributionRuleBase):
    pass

class DistributionRuleResponse(DistributionRuleBase):
    id: int
    club_id: int
    active: bool

    class Config:
        from_attributes = True

# --- SETUP ---
class PartnerSetup(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    percentage: float = Field(..., ge=0, le=100)

class InitialSetupRequest(BaseModel):
    monthly_goal: float = Field(default=0, ge=0)
    partners: List[PartnerSetup] = []

# --- TORNEOS ---
class TournamentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    buyin_amount: int = Field(..., ge=0)
    rake_percentage: int = Field(..., ge=0, le=100)
    dealer_tip_amount: Optional[int] = 0
    bounty_amount: Optional[int] = 0
    addon_price: Optional[int] = 0
    rebuy_price: int = 0
    double_rebuy_price: int = 0
    double_addon_price: int = 0
    payout_structure: List[int] = []

class TournamentPlayerSchema(BaseModel):
    id: int
    player_id: int
    status: str
    is_tip_paid: bool
    rebuys_count: int
    addons_count: int
    double_rebuys_count: int = 0
    double_addons_count: int = 0
    rank: Optional[int] = None
    prize_collected: int

    class Config:
        from_attributes = True

class TournamentResponse(BaseModel):
    id: int
    name: str
    status: str
    buyin_amount: int
    rake_percentage: int
    dealer_tip_amount: int
    bounty_amount: int = 0
    rebuy_price: int
    double_rebuy_price: int
    addon_price: int
    double_addon_price: int
    start_time: datetime
    end_time: Optional[datetime] = None
    total_players: int = 0
    total_prize_pool: int = 0
    players: List[TournamentPlayerSchema] = []
    payout_structure: List[int] = []

    class Config:
        from_attributes = True

class WinnerAssignment(BaseModel):
    rank: int = Field(..., ge=1)
    player_id: int

class TournamentFinalize(BaseModel):
    winners: List[WinnerAssignment]
