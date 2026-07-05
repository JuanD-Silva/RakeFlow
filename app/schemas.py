# app/schemas.py
from pydantic import BaseModel, Field, ConfigDict, field_validator, computed_field
from decimal import Decimal
from typing import Optional, List
from datetime import datetime
from .models import TransactionType, SessionStatus
from . import tournament_chips
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
    password: str = Field(..., min_length=8, max_length=128)
    accept_terms: bool = Field(False, description="Aceptacion de Terminos y Politica de Privacidad")

    @field_validator('accept_terms')
    @classmethod
    def must_accept_terms(cls, v):
        if not v:
            raise ValueError('Debes aceptar los Terminos y la Politica de Privacidad para continuar')
        return v

    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('La contrasena debe tener al menos una mayuscula')
        if not any(c.islower() for c in v):
            raise ValueError('La contrasena debe tener al menos una minuscula')
        if not any(c.isdigit() for c in v):
            raise ValueError('La contrasena debe tener al menos un numero')
        return v

class Token(BaseModel):
    access_token: str
    token_type: str


# --- USERS (multi-usuario por club) ---
class UserRoleEnum(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    CASHIER = "cashier"
    DEALER = "dealer"


class UserInvite(BaseModel):
    email: str = Field(..., min_length=5, max_length=150)
    name: Optional[str] = Field(None, max_length=100)
    role: UserRoleEnum = UserRoleEnum.CASHIER


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    role: Optional[UserRoleEnum] = None
    is_active: Optional[bool] = None


class UserResponse(BaseSchema):
    id: int
    # Optional: las cuentas por teléfono (dealer/player) no tienen email, y una
    # sola fila sin email no debe tumbar el listado entero con un 500.
    email: Optional[str] = None
    name: Optional[str] = None
    role: str
    is_active: bool
    invitation_pending: bool = False
    invitation_sent_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class AcceptInvitation(BaseModel):
    token: str
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError('La contrasena debe tener al menos una mayuscula')
        if not any(c.islower() for c in v):
            raise ValueError('La contrasena debe tener al menos una minuscula')
        if not any(c.isdigit() for c in v):
            raise ValueError('La contrasena debe tener al menos un numero')
        return v

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
    # Estado de la cuenta del panel del jugador (rol PLAYER)
    user_id: Optional[int] = None
    has_account: bool = False              # True si user_id != None
    invitation_pending: bool = False       # cuenta creada pero sin activar (sin password)
    history_unlocked: bool = True          # stats_since IS NULL = histórico completo


# --- DEALERS ---
class DealerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    hourly_rate_cop: float = Field(0, ge=0)
    rake_pct: float = Field(0, ge=0, le=100)
    tournament_hourly_rate_cop: float = Field(0, ge=0)  # tarifa/hora en torneo (sin rake)

    @field_validator('name')
    @classmethod
    def strip_name(cls, v):
        return v.strip()

class DealerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    hourly_rate_cop: Optional[float] = Field(None, ge=0)
    rake_pct: Optional[float] = Field(None, ge=0, le=100)
    tournament_hourly_rate_cop: Optional[float] = Field(None, ge=0)
    is_active: Optional[bool] = None

class DealerResponse(BaseSchema):
    id: int
    name: str
    phone: Optional[str] = None
    hourly_rate_cop: float
    rake_pct: float
    tournament_hourly_rate_cop: float = 0.0
    is_active: bool
    user_id: Optional[int] = None          # cuenta vinculada (rol DEALER), si tiene
    has_account: bool = False              # True si user_id != None
    invitation_pending: bool = False       # True si tiene cuenta pero aún no aceptó (sin password)
    created_at: Optional[datetime] = None

class DealerShiftStart(BaseModel):
    dealer_id: int
    force: bool = False

class DealerShiftChange(BaseModel):
    dealer_id: int
    declared_rake: float = Field(..., ge=0)
    force: bool = False

class DealerShiftEnd(BaseModel):
    declared_rake: float = Field(..., ge=0)

class DealerShiftResponse(BaseModel):
    # Construido a mano en el router (lleva joins y campos calculados)
    id: int
    dealer_id: int
    dealer_name: str
    start_time: datetime
    end_time: Optional[datetime] = None
    elapsed_minutes: int   # calculado server-side (evita líos de TZ en el front)
    hours: float
    declared_rake: Optional[float] = None
    hourly_rate_cop: float
    rake_pct: float
    payment: float


class ClubPublicUpdate(BaseModel):
    public_announcement: Optional[str] = Field(None, max_length=120)


class DealerPayoutCreate(BaseModel):
    amount: float = Field(..., gt=0)
    method: Optional[str] = Field(None, max_length=30)
    note: Optional[str] = Field(None, max_length=200)
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None

class DealerPayoutResponse(BaseSchema):
    id: int
    dealer_id: int
    dealer_name: Optional[str] = None
    amount: float
    method: Optional[str] = None
    note: Optional[str] = None
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


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
    name: Optional[str] = Field(None, max_length=100)
    max_players: int = Field(9, ge=2, le=12)

class SessionCloseRequest(BaseModel):
    declared_rake_cash: Decimal = Field(..., ge=0)
    declared_jackpot_cash: Decimal = Field(default=Decimal(0), ge=0)
    force_close: bool = False

class SessionResponse(BaseSchema):
    id: int
    name: Optional[str] = None
    public_token: Optional[str] = None
    max_players: Optional[int] = 9
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
    session_id: Optional[int] = None  # opcional para compat; si no viene, fallback a primera OPEN
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    method: str = "CASH"
    dealer_id: Optional[int] = None  # solo lo usa /tip: dealer destinatario

class TransactionResponse(BaseSchema):
    id: int
    session_id: int
    type: TransactionType
    amount: Decimal
    timestamp: datetime
    player_id: Optional[int] = None
    dealer_id: Optional[int] = None

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
class BlindLevel(BaseModel):
    """Un nivel de la estructura de blinds. Los breaks son niveles is_break=True."""
    level: int = Field(..., ge=1)
    small_blind: int = Field(default=0, ge=0)
    big_blind: int = Field(default=0, ge=0)
    ante: int = Field(default=0, ge=0)
    duration_min: int = Field(default=20, ge=1, le=600)  # ge=1: un nivel de 0 min trabaría el auto-avance
    is_break: bool = False

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

    @field_validator('payout_structure')
    @classmethod
    def payouts_must_sum_100(cls, v):
        # El wizard ya lo valida en el cliente; este es el guard de verdad — una
        # estructura que no suma 100% reparte un pozo distinto al pozo neto.
        if v:
            if any(pct <= 0 for pct in v):
                raise ValueError("Cada puesto debe llevar un porcentaje mayor a 0")
            if sum(v) != 100:
                raise ValueError(f"Los premios deben sumar 100% (suman {sum(v)}%)")
        return v

    # Estructura de blinds (T3). Si no viene (None), el backend usa la plantilla
    # default; si viene, debe tener al menos 1 nivel (una vacía rompería el reloj).
    blind_structure: Optional[List[BlindLevel]] = Field(default=None, min_length=1)
    starting_stack: Optional[int] = Field(default=0, ge=0)  # fichas iniciales (T4)
    # Fichas que suma cada jugada al stack (para el stack promedio).
    rebuy_chips: Optional[int] = Field(default=0, ge=0)
    double_rebuy_chips: Optional[int] = Field(default=0, ge=0)
    addon_chips: Optional[int] = Field(default=0, ge=0)
    double_addon_chips: Optional[int] = Field(default=0, ge=0)
    tip_chips: Optional[int] = Field(default=0, ge=0)
    # Ventanas de rebuy/addon (T4): nivel hasta el cual están disponibles. None = sin límite.
    rebuy_until_level: Optional[int] = Field(default=None, ge=1)
    addon_until_level: Optional[int] = Field(default=None, ge=1)
    # Programación (T4): si viene, el torneo se crea como SCHEDULED (no cuenta como activo).
    scheduled_start: Optional[datetime] = None

class BlindStructureUpdate(BaseModel):
    """Editar la estructura de blinds (y opcionalmente el stack inicial) de un torneo."""
    blind_structure: List[BlindLevel] = Field(..., min_length=1)  # al menos 1 nivel
    starting_stack: Optional[int] = Field(default=None, ge=0)

# --- BIBLIOTECA DE ESTRUCTURAS DE BLINDS (PR3) ---
class BlindTemplateCreate(BaseModel):
    """Guardar una plantilla de blinds propia del club."""
    name: str = Field(..., min_length=1, max_length=60)
    blind_structure: List[BlindLevel] = Field(..., min_length=1)
    starting_stack: int = Field(default=0, ge=0)

class BlindTemplateResponse(BaseModel):
    # id es int para las guardadas y str ("preset:slug") para los presets fijos.
    id: int | str
    name: str
    blind_structure: List[BlindLevel] = []
    starting_stack: int = 0
    is_preset: bool = False

    class Config:
        from_attributes = True

class BlindTemplateList(BaseModel):
    """Presets fijos (para todos) + plantillas guardadas del club."""
    presets: List[BlindTemplateResponse] = []
    saved: List[BlindTemplateResponse] = []

class TournamentPlayerSchema(BaseModel):
    id: int
    player_id: int
    status: str
    is_tip_paid: bool
    tips_count: int = 0
    is_buyin_paid: bool = False
    rebuys_count: int
    addons_count: int
    double_rebuys_count: int = 0
    double_addons_count: int = 0
    rank: Optional[int] = None
    prize_collected: int
    table_id: Optional[int] = None
    seat_number: Optional[int] = None

    class Config:
        from_attributes = True

# --- MESAS DE TORNEO (Fase 1a) ---
class TournamentTableCreate(BaseModel):
    """Crear una mesa (o varias) para un torneo."""
    max_seats: int = Field(default=9, ge=2, le=12)
    count: int = Field(default=1, ge=1, le=20)  # cuántas mesas crear de una

class TournamentTableUpdate(BaseModel):
    max_seats: Optional[int] = Field(default=None, ge=2, le=12)
    status: Optional[str] = None  # OPEN | CLOSED

class TableSeatPlayer(BaseModel):
    """Un jugador sentado en una mesa (vista de la mesa)."""
    player_id: int
    name: str
    seat_number: Optional[int] = None
    status: str

class TournamentTableResponse(BaseModel):
    id: int
    table_number: int
    max_seats: int
    status: str
    seated_count: int = 0       # jugadores ACTIVE sentados
    seats_available: int = 0    # max_seats − seated_count (clamp ≥0)
    players: List[TableSeatPlayer] = []
    dealer_id: Optional[int] = None      # dealer con turno abierto en la mesa
    dealer_name: Optional[str] = None

class AssignDealerRequest(BaseModel):
    dealer_id: int
    force: bool = False  # mover al dealer aunque tenga otra mesa de torneo abierta

class UnseatedPlayer(BaseModel):
    player_id: int
    name: str

class TournamentTablesView(BaseModel):
    """Vista completa de mesas de un torneo: mesas + jugadores sin mesa + totales."""
    tables: List[TournamentTableResponse] = []
    unseated: List[UnseatedPlayer] = []
    total_seats: int = 0       # Σ max_seats de mesas OPEN
    total_seated: int = 0      # Σ jugadores ACTIVE sentados
    total_available: int = 0   # cupos libres totales (OPEN)

class MovePlayerRequest(BaseModel):
    """Mover un jugador a otra mesa (reasiento manual). table_id None = sacar de mesa."""
    table_id: Optional[int] = None
    seat_number: Optional[int] = Field(default=None, ge=1, le=12)

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
    scheduled_start: Optional[datetime] = None
    total_players: int = 0
    total_prize_pool: int = 0
    players: List[TournamentPlayerSchema] = []
    payout_structure: List[int] = []
    # Reloj / niveles (T3). El estado vivo (elapsed/remaining) va en GET /clock.
    blind_structure: List[BlindLevel] = []
    starting_stack: int = 0
    rebuy_chips: int = 0
    double_rebuy_chips: int = 0
    addon_chips: int = 0
    double_addon_chips: int = 0
    tip_chips: int = 0
    rebuy_until_level: Optional[int] = None
    addon_until_level: Optional[int] = None
    current_level: int = 1
    clock_status: str = "STOPPED"
    public_token: Optional[str] = None

    @computed_field
    @property
    def average_stack(self) -> int:
        # total_chips no lo consume ningún cliente; sólo exponemos el promedio
        # (una sola pasada de chip_stats por serialización).
        return tournament_chips.chip_stats(self)["average_stack"]

    class Config:
        from_attributes = True

class WinnerAssignment(BaseModel):
    rank: int = Field(..., ge=1)
    player_id: int

class TournamentFinalize(BaseModel):
    winners: List[WinnerAssignment]
