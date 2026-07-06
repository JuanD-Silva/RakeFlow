# app/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Enum as SqEnum, JSON, Index, text
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
    BUST = "BUST"
    TOURNAMENT_ENTRY = "TOURNAMENT_ENTRY"
    TOURNAMENT_TIP = "TOURNAMENT_TIP"
    TOURNAMENT_REBUY = "TOURNAMENT_REBUY"
    TOURNAMENT_ADDON = "TOURNAMENT_ADDON"

class SessionStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"

class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"  # Yo (Dueno del SaaS, no se asigna desde UI)
    OWNER = "owner"            # Dueno del Club: gestiona usuarios, suscripcion, todo
    MANAGER = "manager"        # Encargado: operacion + finanzas, no gestiona usuarios
    CASHIER = "cashier"        # Cajero: solo operacion de mesa, no ve reportes globales
    DEALER = "dealer"          # Dealer: solo su mesa (turno abierto) + su portal (pago/historial)
    PLAYER = "player"          # Jugador (cliente del club): solo su panel de stats (/player)

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
    rankings_reset_at = Column(DateTime, nullable=True)
    terms_accepted_at = Column(DateTime, nullable=True)
    # Wompi: tarjeta tokenizada del cliente para cobro recurrente
    wompi_payment_source_id = Column(Integer, nullable=True)
    wompi_customer_email = Column(String, nullable=True)
    wompi_card_brand = Column(String, nullable=True)   # VISA, MC, AMEX
    wompi_card_last4 = Column(String, nullable=True)
    subscription_period_end = Column(DateTime, nullable=True)  # cuando expira el periodo actual
    # Precio personalizado para grandfathered customers; si null usa el default global
    subscription_price_cop = Column(Integer, nullable=True)
    # Capa pública: token imposible de adivinar para el link público del club
    # (rakeflow.site/c/{public_token}) y mensaje "Hoy se rompe".
    public_token = Column(String, unique=True, index=True, nullable=True)
    public_announcement = Column(String, nullable=True)
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
    Cada User pertenece a un Club. El Club es el cliente SaaS;
    el User es la persona fisica que opera (dueno, encargado, cajero).
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    # email opcional: los dealers entran por teléfono (sin email). El índice único
    # permite múltiples NULL en Postgres.
    email = Column(String, unique=True, index=True, nullable=True)
    # Teléfono = identidad/login del dealer (verificado por WhatsApp). La unicidad
    # la da el índice ÚNICO PARCIAL de la migración (uq_users_phone WHERE NOT NULL);
    # acá NO ponemos unique=True para que create_all no cree un índice total que
    # contradiga al parcial.
    phone = Column(String, index=True, nullable=True)
    phone_verified = Column(Boolean, default=False)
    # Intentos de activación fallidos: lockout anti-fuerza-bruta del OTP por teléfono.
    invitation_attempts = Column(Integer, default=0)
    name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True)  # null hasta aceptar invitacion
    role = Column(SqEnum(UserRole), default=UserRole.CASHIER, nullable=False)
    is_active = Column(Boolean, default=True)

    # Invitacion
    invitation_token = Column(String, nullable=True, index=True)
    invitation_expires_at = Column(DateTime, nullable=True)
    invitation_sent_at = Column(DateTime, nullable=True)
    invited_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Username legacy (se mantiene por compat con datos viejos, no se usa)
    username = Column(String, unique=True, index=True, nullable=True)

    club = relationship("Club", back_populates="users")


class Player(Base):
    """
    Jugadores vinculados a un Club específico.
    """
    __tablename__ = "players"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    name = Column(String, index=True)
    phone = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Vínculo 1:1 con una cuenta de usuario (rol PLAYER). NULL = jugador sin
    # cuenta (la mayoría). Único parcial garantizado por la migración. Si algún
    # día se fusionan jugadores, mover user_id al sobreviviente.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True, index=True)
    # Corte del histórico del panel del jugador: NULL = histórico completo
    # desbloqueado (pagó en caja / club nuevo); con fecha = sus stats corren
    # desde ahí. Se setea a now() al activar la cuenta.
    stats_since = Column(DateTime, nullable=True)

    # Relaciones
    club = relationship("Club", back_populates="players")
    transactions = relationship("Transaction", back_populates="player")
    user = relationship("User")


class Dealer(Base):
    """
    Dealers del club. Cobran por hora dealeada + % del rake de su turno.
    Soft delete via is_active (los turnos históricos los referencian).
    """
    __tablename__ = "dealers"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    name = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)
    hourly_rate_cop = Column(Float, default=0.0, nullable=False)  # tarifa por hora dealeada (cash)
    rake_pct = Column(Float, default=0.0, nullable=False)         # % del rake del turno (0-100, cash)
    # Tarifa por hora en TORNEO (distinta a la de cash; sin %rake). Fase 1b.
    tournament_hourly_rate_cop = Column(Float, default=0.0, nullable=False)
    is_active = Column(Boolean, default=True)
    # Cuándo se desactivó (para la purga automática a 60 días). NULL si está activo.
    deactivated_at = Column(DateTime, nullable=True)
    # Vínculo 1:1 con una cuenta de usuario (rol DEALER). NULL = dealer sin cuenta
    # (usa el link público anónimo). Único parcial garantizado por la migración.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    club = relationship("Club")
    user = relationship("User")
    shifts = relationship("DealerShift", back_populates="dealer")


class DealerShift(Base):
    """
    Turno de un dealer en una mesa cash. end_time NULL => turno abierto.
    declared_rake: rake contado por el cajero al terminar el turno (el último
    turno de la sesión se auto-calcula al cierre como total - suma de previos).
    Las tarifas se copian del Dealer al INICIAR (snapshot): editar al dealer
    no cambia el valor de turnos históricos.
    """
    __tablename__ = "dealer_shifts"

    id = Column(Integer, primary_key=True, index=True)
    # club_id redundante a propósito: tenant isolation sin join
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=False, index=True)

    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    declared_rake = Column(Float, nullable=True)

    # Snapshot de tarifas al momento de iniciar el turno
    hourly_rate_cop = Column(Float, nullable=False, default=0.0)
    rake_pct = Column(Float, nullable=False, default=0.0)

    dealer = relationship("Dealer", back_populates="shifts")
    session = relationship("Session")


class DealerPayout(Base):
    """
    Liquidación: registro de un pago físico a un dealer (ledger de caja).
    NO genera gasto financiero (el costo del dealer ya se reconoce en el cierre
    de la sesión vía net_rake). Sirve para llevar pendiente vs pagado.
    pendiente = devengado (turnos cerrados) - Σ payouts.
    """
    __tablename__ = "dealer_payouts"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=False, index=True)

    amount = Column(Float, nullable=False, default=0.0)
    method = Column(String, nullable=True)   # 'cash' | 'transfer' | ...
    note = Column(String, nullable=True)
    period_start = Column(DateTime, nullable=True)  # rango que cubre el pago (informativo)
    period_end = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    paid_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    dealer = relationship("Dealer")


class Session(Base):
    """
    Una mesa o sesión de juego.
    """
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    name = Column(String, nullable=True)  # "Mesa VIP", "Mesa 1"... null => "Mesa #ID"
    # Token del link público del dealer (rakeflow.site/mesa/{public_token}/dealer)
    public_token = Column(String, unique=True, index=True, nullable=True)
    # Capacidad de asientos de la mesa (para mostrar cupos disponibles en el link público)
    max_players = Column(Integer, default=9)

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
    partner_profit = Column(Float, default=0.0)  # Cuánto ganaron los socios (ya neto de gastos)

    # Gastos del cierre y rake neto (monitoreo bruto vs neto)
    dealer_cost = Column(Float, default=0.0)     # Salario de dealers (horas + % rake)
    courtesy_cost = Column(Float, default=0.0)   # Cortesías = Σ BONUS de la sesión
    net_rake = Column(Float, default=0.0)        # declared_rake_cash - dealer_cost - courtesy_cost

    notes = Column(String, nullable=True)

    # Relaciones
    club = relationship("Club", back_populates="sessions")
    transactions = relationship("Transaction", back_populates="session")
    distributions = relationship("FinancialDistribution", back_populates="session") # Agregado


class DealerAlert(Base):
    """
    Alerta que el dealer envía al staff desde el link público de la mesa
    (necesito fichas / mesero / director / urgencia). El staff la recibe por
    polling y la marca resuelta. No es realtime: polling REST.
    """
    __tablename__ = "dealer_alerts"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    # Origen de la alerta: mesa CASH (session_id) o mesa de TORNEO
    # (tournament_table_id). Exactamente uno de los dos está seteado.
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True, index=True)
    tournament_table_id = Column(Integer, ForeignKey("tournament_tables.id"), nullable=True, index=True)

    alert_type = Column(String, nullable=False)   # CHIPS | WAITER | MANAGER | URGENT
    message = Column(String, nullable=True)
    dealer_name = Column(String, nullable=True)    # nombre del turno abierto al alertar
    status = Column(String, nullable=False, default="PENDING", index=True)  # PENDING | RESOLVED
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Una sola alerta PENDING por (mesa, tipo): backstop anti-flood (cash y
    # torneo por separado; los NULL no colisionan en índices únicos de PG).
    # Declarado también acá para que metadata.create_all lo replique en DBs nuevas.
    __table_args__ = (
        Index(
            "uq_dealer_alerts_pending", "session_id", "alert_type",
            unique=True, postgresql_where=text("status = 'PENDING'"),
        ),
        Index(
            "uq_dealer_alerts_pending_ttable", "tournament_table_id", "alert_type",
            unique=True, postgresql_where=text("status = 'PENDING' AND tournament_table_id IS NOT NULL"),
        ),
    )

    session = relationship("Session")
    tournament_table = relationship("TournamentTable")


class Transaction(Base):
    """
    Movimientos de dinero.
    """
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True, index=True)

    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=True, index=True)
    # 👇 Se cambia a nullable=True para permitir propinas anónimas
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True, index=True)
    # Dealer destinatario (solo TIPs por ahora): a quién le dieron la propina
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=True, index=True)

    type = Column(SqEnum(TransactionType))
    amount = Column(Float, nullable=False)
    method = Column(String, default="CASH")
    is_paid = Column(Boolean, default=False)  # false = jugador debe (estado inicial)

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
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

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
    session_id = Column(Integer, ForeignKey("sessions.id"), index=True)

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
    club_id = Column(Integer, ForeignKey("clubs.id"), index=True)

    name = Column(String, nullable=False)
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    scheduled_start = Column(DateTime, nullable=True)  # programado para esta fecha (status SCHEDULED)
    
    # --- ESTRUCTURA DE COSTOS ---
    buyin_amount = Column(Integer, default=0)    # Costo base de entrada (Va al Pozo Bruto)
    rake_percentage = Column(Integer, default=10) # % que la casa quita del Pozo Bruto al final
    rebuy_price = Column(Integer, default=0)          # Rebuy Sencillo
    double_rebuy_price = Column(Integer, default=0)
    addon_price = Column(Integer, default=0)          # Add-on Sencillo
    double_addon_price = Column(Integer, default=0)
    # EXTRAS (Pagos Adicionales Fijos)
    dealer_tip_amount = Column(Integer, default=0) # Ej: 10.000 (Va a Dealers, no al pozo)
    bounty_amount = Column(Integer, default=0)     # Ej: 20.000 (Va directo al jugador que elimina)
    
    # Estado
    status = Column(String, default="REGISTERING")

    # --- RELOJ / NIVELES (T3) ---
    # blind_structure: lista de niveles [{level, small_blind, big_blind, ante,
    #   duration_min, is_break}]. El reloj es server-authoritative (igual que el
    #   elapsed del dealer): el cliente solo tickea local y resincroniza al pollear.
    blind_structure = Column(JSON, default=list)        # niveles de blinds
    starting_stack = Column(Integer, default=0)         # fichas iniciales (informativo, se muestra en TV)
    rebuy_until_level = Column(Integer, nullable=True)  # rebuys disponibles hasta este nivel (NULL = sin límite)
    addon_until_level = Column(Integer, nullable=True)  # add-ons disponibles hasta este nivel (NULL = sin límite)
    # Fichas (no plata) que suma cada jugada al stack, para el stack promedio.
    rebuy_chips = Column(Integer, default=0)
    double_rebuy_chips = Column(Integer, default=0)
    addon_chips = Column(Integer, default=0)
    double_addon_chips = Column(Integer, default=0)
    tip_chips = Column(Integer, default=0)
    current_level = Column(Integer, default=1)          # nivel activo (1-based en la estructura)
    clock_status = Column(String, default="STOPPED")    # STOPPED | RUNNING | PAUSED
    level_started_at = Column(DateTime, nullable=True)  # cuándo arrancó el reloj del nivel actual
    clock_elapsed_seconds = Column(Integer, default=0)  # segundos acumulados antes de la última pausa
    # Token del link público de la vista TV (rakeflow.site/torneo/{public_token}/tv)
    public_token = Column(String, unique=True, index=True, nullable=True)

    # Relaciones
    club = relationship("Club", back_populates="tournaments")
    players = relationship("TournamentPlayer", back_populates="tournament", cascade="all, delete-orphan", lazy="selectin")

    payout_structure = Column(JSON, default=[])


class BlindTemplate(Base):
    """Plantilla de estructura de blinds reutilizable, guardada por club (PR3).
    Los presets fijos (Estándar/Turbo/Deep/Hyper) NO viven acá: son constantes en
    app/blind_presets.py. Esta tabla guarda solo las plantillas propias del club.
    No toca plata: blind_structure son fichas/ciegas, starting_stack son fichas."""
    __tablename__ = "blind_templates"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    blind_structure = Column(JSON, default=list)   # [{level, small_blind, big_blind, ante, duration_min, is_break}]
    starting_stack = Column(Integer, default=0)    # fichas iniciales sugeridas por la plantilla

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AuditLog(Base):
    """
    Registro de acciones relevantes por club para trazabilidad legal y operativa.
    Immutable: no se edita ni se borra (solo se puede purgar por retención).
    """
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)

    # Actor (quien hizo la accion). Hoy es siempre el club; en el futuro podria ser user_id.
    actor_type = Column(String, default="CLUB", nullable=False)   # CLUB / USER / SYSTEM
    actor_id = Column(Integer, nullable=True)                       # id del actor
    actor_email = Column(String, nullable=True)                     # denormalizado

    action = Column(String, nullable=False, index=True)             # TRANSACTION_CREATE, SESSION_CLOSE, etc.
    entity_type = Column(String, nullable=True)                     # Transaction, Session, Tournament, ...
    entity_id = Column(Integer, nullable=True)

    meta = Column(JSON, nullable=True)                              # detalles especificos de la accion
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    request_id = Column(String, nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class TournamentPlayer(Base):
    __tablename__ = "tournament_players"
    # Un solo jugador ACTIVE por (mesa, asiento): red de seguridad contra carreras
    # al sentar/mover (mismo patrón que el turno único por mesa cash). Parcial:
    # sólo aplica a sentados activos (los eliminados/sin mesa tienen NULLs).
    __table_args__ = (
        Index(
            "uq_tournament_player_seat", "table_id", "seat_number", unique=True,
            postgresql_where=text("status = 'ACTIVE' AND table_id IS NOT NULL AND seat_number IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), index=True)
    player_id = Column(Integer, ForeignKey("players.id"), index=True)
    
    # Estado
    status = Column(String, default="ACTIVE") # ACTIVE, ELIMINATED

    # Mesa/asiento (Fase 1 mesas de torneo). NULL = sin sentar. La ocupación de una
    # mesa cuenta solo jugadores ACTIVE con ese table_id (eliminar libera el cupo).
    table_id = Column(Integer, ForeignKey("tournament_tables.id"), nullable=True, index=True)
    seat_number = Column(Integer, nullable=True)

    is_tip_paid = Column(Boolean, default=False)
    tips_count = Column(Integer, default=0)
    is_buyin_paid = Column(Boolean, default=False)  # false = jugador debe la entrada
    
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
    table = relationship("TournamentTable", back_populates="players")


class TournamentTable(Base):
    """Mesa física de un torneo (Fase 1). Los jugadores se reparten entre mesas
    (auto-balanceado al registrar). La ocupación = jugadores ACTIVE con este
    table_id; cupos = max_seats − ocupación. No toca plata."""
    __tablename__ = "tournament_tables"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)  # redundante: tenant isolation
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)

    table_number = Column(Integer, nullable=False)        # número visible de la mesa (1-based)
    max_seats = Column(Integer, default=9)                # cupos de la mesa
    status = Column(String, default="OPEN")               # OPEN | CLOSED (CLOSED = rota/consolidada, Fase 3)
    public_token = Column(String, unique=True, index=True, nullable=True)  # link del dealer (anónimo, respaldo)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tournament = relationship("Tournament")
    players = relationship("TournamentPlayer", back_populates="table")


class TournamentDealerShift(Base):
    """Turno de un dealer en una MESA de torneo (Fase 1b). Análogo a DealerShift
    pero para torneos: paga sólo horas × tarifa de torneo (sin %rake). end_time
    NULL => turno abierto. La tarifa se snapshotea al iniciar."""
    __tablename__ = "tournament_dealer_shifts"
    # Un solo turno abierto por mesa Y un solo turno abierto por dealer (red de
    # seguridad anti carrera: el dealer no puede quedar en dos mesas a la vez).
    __table_args__ = (
        Index(
            "uq_tournament_dealer_shift_open", "table_id", unique=True,
            postgresql_where=text("end_time IS NULL"),
        ),
        Index(
            "uq_tournament_dealer_shift_dealer_open", "dealer_id", unique=True,
            postgresql_where=text("end_time IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)  # redundante: tenant
    tournament_id = Column(Integer, ForeignKey("tournaments.id"), nullable=False, index=True)
    table_id = Column(Integer, ForeignKey("tournament_tables.id"), nullable=False, index=True)
    dealer_id = Column(Integer, ForeignKey("dealers.id"), nullable=False, index=True)

    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    # Snapshot de la tarifa/hora de torneo al iniciar el turno.
    tournament_hourly_rate_cop = Column(Float, nullable=False, default=0.0)

    dealer = relationship("Dealer")
    table = relationship("TournamentTable")


class MonthlyChallenge(Base):
    """Reto rotativo del mes por club (combate el novelty effect de los badges
    fijos). El staff define un objetivo mensual (métrica + meta + recompensa que
    entrega en caja) y el panel del jugador muestra su progreso. Un reto activo
    por (club, año, mes) — índice único parcial en la migración."""
    __tablename__ = "monthly_challenges"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1-12

    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    # Métrica contable en el mes: 'visitas' | 'horas' | 'torneos'.
    metric = Column(String, nullable=False)
    target = Column(Float, nullable=False)          # meta a alcanzar
    reward_text = Column(String, nullable=True)      # qué gana (lo entrega el staff en caja)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    club = relationship("Club")
