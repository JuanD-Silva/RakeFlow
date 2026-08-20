from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, desc, or_, and_
from typing import List
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
import logging

from .. import models, schemas, services, player_stats
from ..dependencies import get_db, get_current_club, require_role

# Mambo y demas clubes operan en Colombia. Railway corre en UTC, asi que
# usar datetime.utcnow().replace(day=1) deja el "mes en curso" desfasado
# para el cliente entre 19:00 (Colombia) y 00:00 (UTC) del primer dia del mes
# siguiente: el server pasa al mes nuevo pero el cliente todavia ve el anterior.
_COL_TZ = ZoneInfo("America/Bogota")
_UTC = ZoneInfo("UTC")


def _start_of_month_col_as_utc() -> datetime:
    """Inicio del mes en hora Colombia, expresado como UTC naive para
    comparar con Session.end_time / Tournament.end_time (que se guardan
    con datetime.utcnow() — naive UTC)."""
    col_now = datetime.now(_COL_TZ)
    col_start = col_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return col_start.astimezone(_UTC).replace(tzinfo=None)

# Reportes financieros: solo dueno y encargado, no cashier
_REPORT_ROLES = [models.UserRole.OWNER, models.UserRole.MANAGER]

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/stats",
    tags=["Stats"] 
)

# --- FUNCIÓN AUXILIAR: Calcular Rake Neto (Cash + Torneos - Gastos) en un rango ---
async def _get_net_profit_in_range(db: AsyncSession, club_id: int, start: datetime, end: datetime) -> float:
    # 1. CASH
    stmt_cash = select(func.sum(models.Session.declared_rake_cash)).where(
        models.Session.club_id == club_id,
        models.Session.status == models.SessionStatus.CLOSED,
        models.Session.end_time >= start,
        models.Session.end_time <= end
    )
    cash = (await db.execute(stmt_cash)).scalar() or 0.0

    # 2. TORNEOS (misma funcion que usa el cierre de caja: una sola fuente de verdad)
    tourney = await services.tournament_rake_in_range(db, club_id, start, end)

    return (cash + int(tourney))

# ---------------------------------------------------------
# 1. DASHBOARD GENERAL (KPIs) 📊
# ---------------------------------------------------------
@router.get("/dashboard")
async def get_dashboard_stats(
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    try:
        now = datetime.utcnow()
        # Si el frontend pasa rango (sincronizado con WeeklyReport navegando),
        # usamos eso. Si no, default = mes en curso hora Colombia. Esto evita
        # el desfase entre el rango que el user esta viendo y los KPIs.
        if start_date and end_date:
            # Rango EXPLÍCITO (el dashboard financiero navegando periodos): sin
            # clamp de rankings_reset_at — weekly-distribution tampoco clampa y
            # el desfase hacía que el neto pudiera superar al bruto en pantalla.
            range_start = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
            range_end = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)
        else:
            range_start = _start_of_month_col_as_utc()
            range_end = now
            if current_club.rankings_reset_at and current_club.rankings_reset_at > range_start:
                range_start = current_club.rankings_reset_at

        # A. TOTAL SESIONES Y HORAS DEL RANGO (Cash + Torneos)
        stmt_cash = select(models.Session).where(
            models.Session.club_id == current_club.id,
            models.Session.status == "CLOSED",
            models.Session.end_time >= range_start,
            models.Session.end_time <= range_end,
        )
        cash_sessions = (await db.execute(stmt_cash)).scalars().all()
        cash_hours = sum(
            (s.end_time - s.start_time).total_seconds() / 3600
            for s in cash_sessions if s.end_time and s.start_time
        )

        stmt_tourney = select(models.Tournament).where(
            models.Tournament.club_id == current_club.id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= range_start,
            models.Tournament.end_time <= range_end,
        )
        tournaments = (await db.execute(stmt_tourney)).scalars().all()
        tourney_hours = sum(
            (t.end_time - t.start_time).total_seconds() / 3600
            for t in tournaments if t.start_time and t.end_time
        )

        total_sessions = len(cash_sessions) + len(tournaments)
        total_hours = cash_hours + tourney_hours

        # B. PROFIT DEL RANGO (cash + torneos)
        range_profit = await _get_net_profit_in_range(db, current_club.id, range_start, range_end)

        # C. META (la meta es mensual por definicion, asi que efficiency siempre
        # se calcula contra el MES del range_start, no contra el rango).
        stmt_meta = select(func.sum(models.DistributionRule.value)).where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True,
            or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED)
        )
        # Sin reglas FIXED/QUOTA activas no hay meta: devolvemos 0 para que el
        # frontend oculte la barra.
        monthly_goal = (await db.execute(stmt_meta)).scalar() or 0.0
        efficiency = (range_profit / monthly_goal * 100) if monthly_goal > 0 else 0

        # D. JACKPOT — saldo acumulado (no filtra fecha). Fuente única:
        # services.club_jackpot. Este KPI ignoraba el ajuste manual del dueño y
        # daba un número distinto al del widget de la mesa (bug: en Mambo, $1,6M
        # vs $200k reales). Hoy no se renderiza, pero queda correcto.
        jackpot_total = await services.club_jackpot(db, current_club)

        # E. BUY-IN PROMEDIO DEL RANGO = monto total / numero de entradas.
        stmt_avg_ticket = (
            select(
                func.coalesce(func.sum(models.Transaction.amount), 0).label("total_buyin"),
                func.count(models.Transaction.id).label("entries"),
            )
            .join(models.Session, models.Transaction.session_id == models.Session.id)
            .where(
                models.Session.club_id == current_club.id,
                models.Session.status == models.SessionStatus.CLOSED,
                models.Session.end_time >= range_start,
                models.Session.end_time <= range_end,
                models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]),
            )
        )
        row = (await db.execute(stmt_avg_ticket)).first()
        cash_buyin_total = float(row.total_buyin) if row else 0.0
        avg_ticket = int(cash_buyin_total / row.entries) if (row and row.entries) else 0

        # F. TOTAL MOVIDO del rango = buyins cash + pozo bruto de torneos.
        # Mide cuanta plata entro al club (no rake, dinero total movido).
        tourney_gross = await services.tournament_gross_pot_in_range(
            db, current_club.id, range_start, range_end
        )
        total_in = int(cash_buyin_total + tourney_gross)

        return {
            # Rake del rango (bruto): lo usa el KPI "vs periodo anterior".
            "rake_range": int(range_profit),
            "avg_rake_hour": int(range_profit / total_hours) if total_hours > 0 else 0,
            "total_hours": round(total_hours, 1),
            "total_sessions": total_sessions,
            "avg_ticket": avg_ticket,
            "total_in": total_in,
            "efficiency": round(efficiency, 1),
            "jackpot": jackpot_total,
            "weekly_profit": 0
        }

    except HTTPException:
        raise
    except Exception as e:
        # NUNCA devolver {} con 200: el frontend lo pintaba como "$0 · 0h · 0
        # sesiones" y el dueno se iba creyendo que no hubo actividad.
        logger.exception("Error dashboard: %s", e)
        raise HTTPException(status_code=500, detail="No se pudieron calcular los indicadores. Intenta de nuevo.")

# ---------------------------------------------------------
# 2. DISTRIBUCIÓN SEMANAL (CASCADA: META -> SOCIOS) 🌊
# ---------------------------------------------------------
@router.get("/weekly-distribution")
async def get_weekly_distribution(
    start_date: str = None,
    end_date: str = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    try:
        # 1. Definir rango de fechas
        if not start_date or not end_date:
            today = datetime.now().date()
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
            start_dt = datetime.combine(start, time.min)
            end_dt = datetime.combine(end, time.max)
        else:
            start_dt = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
            end_dt = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)

        # 2. Profit de ESTA SEMANA (rake BRUTO: cash declarado + torneos)
        net_profit_week = await _get_net_profit_in_range(db, current_club.id, start_dt, end_dt)

        # 2b. Gastos del cierre (salario dealers + cortesías) de las mesas cash
        #     del rango → rake NETO = bruto - gastos.
        exp_stmt = select(
            func.coalesce(func.sum(models.Session.dealer_cost + models.Session.courtesy_cost), 0)
        ).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED,
            models.Session.end_time >= start_dt,
            models.Session.end_time <= end_dt,
        )
        expenses_cash = float((await db.execute(exp_stmt)).scalar() or 0)
        # 2c. Dealers de TORNEO: el rake de torneos ya suma al bruto (2), asi que
        #     su costo de dealers tiene que restar aqui — si no, el neto que se
        #     reparte a socios "olvida" esos turnos y solo cuadra en clubes sin
        #     torneos. Misma funcion que usa /dealer-payments.
        expenses_tourney = await services.tournament_dealer_cost_in_range(db, current_club.id, start_dt, end_dt)
        expenses_week = expenses_cash + expenses_tourney
        net_rake_week = net_profit_week - expenses_week

        # 3. Lógica de Cascada — se reparte sobre el rake NETO (igual que el cierre:
        #    los gastos salen antes de meta y socios).
        distribution = []
        remaining_pool = max(0, net_rake_week)

        # Línea de gasto (display): bruto = gastos + meta + socios.
        if expenses_week > 0:
            distribution.append({
                "name": "Gastos (dealers + cortesías)",
                "total": int(expenses_week),
                "percent": 0,
                # type EXPLÍCITO: la UI clasificaba por substring del nombre y
                # una regla llamada "...fijo..." se pintaba como meta.
                "type": "EXPENSES",
            })

        #
        # PASO A: META MENSUAL (Prioridad 1)
        stmt_quota = select(models.DistributionRule).where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True,
            or_(
                models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA,
                models.DistributionRule.rule_type == models.RuleType.FIXED
            )
        ).order_by(models.DistributionRule.priority)
        
        quota_rule = (await db.execute(stmt_quota)).scalars().first()

        if quota_rule and remaining_pool > 0:
            target = quota_rule.value
            
            # Inicio del Mes
            month_start = start_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            # Calcular cuánto se generó ANTES de empezar esta semana
            if start_dt > month_start:
                prior_end = start_dt - timedelta(seconds=1)
                profit_prior = await _get_net_profit_in_range(db, current_club.id, month_start, prior_end)
            else:
                profit_prior = 0.0

            # ¿Cuánto de la meta ya estaba lleno?
            covered_before = min(max(0, profit_prior), target)
            
            # ¿Cuánto falta?
            gap = target - covered_before
            
            if gap > 0:
                payment = min(remaining_pool, gap)
                distribution.append({
                    "name": quota_rule.name or "Meta Mensual",
                    "total": int(payment),
                    "percent": 0,  # Indicador visual
                    "type": "META",
                })
                remaining_pool -= payment

        # PASO B: SOCIOS (Prioridad 2 - Si sobra dinero)
        if remaining_pool > 0:
            percent_rules = (await db.execute(select(models.DistributionRule).where(
                models.DistributionRule.club_id == current_club.id,
                models.DistributionRule.active == True,
                models.DistributionRule.rule_type == models.RuleType.PERCENTAGE
            ).order_by(models.DistributionRule.priority))).scalars().all()

            if percent_rules:
                for r in percent_rules:
                    amount = remaining_pool * (r.value / 100)
                    distribution.append({
                        "name": r.name,
                        "total": int(amount),
                        "percent": r.value,
                        "type": "PARTNER",
                        "rule_id": r.id,
                    })
            else:
                distribution.append({"name": "Fondo Club", "total": int(remaining_pool), "percent": 100, "type": "FUND"})

        return {
            "range": { "start": start_dt.strftime("%d %b"), "end": end_dt.strftime("%d %b") },
            "total_week": int(net_profit_week), # Total Generado / rake BRUTO (Card 1)
            "gross_week": int(net_profit_week),
            "expenses_week": int(expenses_week),
            "net_week": int(net_rake_week),     # rake NETO (después de gastos)
            "distribution": distribution
        }

    except Exception as e:
        logger.error("Error weekly distribution: %s", e)
        return {"error": str(e)}

# ---------------------------------------------------------
# 4. META MENSUAL (BARRA DE PROGRESO)
# ---------------------------------------------------------
@router.get("/monthly-debt-quota")
async def get_monthly_debt_quota(
    start_date: str | None = None,
    end_date: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    # Meta. Sin reglas configuradas el target queda en 0 y el frontend oculta la barra.
    stmt_rules = select(func.sum(models.DistributionRule.value)).where(models.DistributionRule.club_id == current_club.id, models.DistributionRule.active == True, or_(models.DistributionRule.rule_type == models.RuleType.MONTHLY_QUOTA, models.DistributionRule.rule_type == models.RuleType.FIXED))
    target = (await db.execute(stmt_rules)).scalar() or 0.0

    # Pagado: por defecto mes en curso (hora Colombia). Si el frontend pasa rango
    # (sincronizado con WeeklyReport), usamos ese rango — asi la card "Rake del Mes"
    # se sincroniza con el periodo que el user esta viendo.
    now = datetime.utcnow()
    if start_date and end_date:
        range_start = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
        range_end = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)
    else:
        range_start = _start_of_month_col_as_utc()
        range_end = now

    current = await _get_net_profit_in_range(db, current_club.id, range_start, range_end)
    
    remaining = max(0.0, target - current)

    return {
        "target": target,
        "paid_so_far": int(current),
        "remaining": int(remaining),
        "is_completed": remaining == 0
    }

# ---------------------------------------------------------
# 5. RANKINGS (HALL OF FAME) 🏆
# ---------------------------------------------------------
@router.get("/rankings")
async def get_rankings(
    year: int | None = None,
    month: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """
    Rankings mensuales. Por default mes en curso.
    Si se pasan year y month, devuelve los rankings de ese mes especifico.

    El cálculo vive en player_stats.compute_monthly_rankings (fuente única,
    compartida con el panel del jugador); acá solo se toma el top 3.
    """
    try:
        winners_map, spenders_map, active_map, names_map, period = \
            await player_stats.compute_monthly_rankings(db, current_club, year, month)

        def get_top_3(data_map):
            lista = [{"name": names_map.get(k, "Unknown"), "value": v} for k, v in data_map.items()]
            return sorted(lista, key=lambda x: x["value"], reverse=True)[:3]

        return {
            "winners": get_top_3(winners_map),
            "spenders": get_top_3(spenders_map),
            "active": get_top_3(active_map),
            "period": period,
        }

    except Exception as e:
        logger.error("Error rankings: %s", e)
        # En caso de error devolvemos listas vacías para que el front no explote
        return {"winners": [], "spenders": [], "active": [], "period": None}

@router.get("/jackpot-global")
async def get_global_jackpot(db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    """Saldo del jackpot (widget de la mesa cash). Misma función que alimenta el
    link público y el panel del jugador: un solo jackpot para todos."""
    return {"total_jackpot": await services.club_jackpot(db, current_club)}

@router.post("/jackpot-adjust")
async def adjust_jackpot(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    """Ajusta el jackpot manualmente (positivo = agrega, negativo = retira)."""
    amount = data.get("amount", 0)
    reason = data.get("reason", "")
    if amount == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser 0")
    current_club.jackpot_adjustment = (current_club.jackpot_adjustment or 0.0) + float(amount)
    await db.commit()
    return {"message": "Jackpot ajustado", "adjustment_applied": amount, "reason": reason}


@router.get("/history-mixed")
async def get_mixed_history(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """
    Retorna una lista combinada de Sesiones de Cash y Torneos,
    ordenada cronológicamente (más reciente primero).
    """
    
    # 1. Traer Sesiones de Cash (Cerradas o Abiertas, según prefieras)
    stmt_sessions = select(models.Session).where(
        models.Session.club_id == current_club.id
    ).order_by(models.Session.start_time.desc()).limit(limit)
    
    sessions_result = await db.execute(stmt_sessions)
    sessions = sessions_result.scalars().all()

    # 2. Traer Torneos
    stmt_tournaments = select(models.Tournament).where(
        models.Tournament.club_id == current_club.id
    ).order_by(models.Tournament.start_time.desc()).limit(limit)
    
    tournaments_result = await db.execute(stmt_tournaments)
    tournaments = tournaments_result.scalars().all()

    # 3. Formatear y Etiquetar ("type")
    history_list = []

    # Procesar Sesiones
    for s in sessions:
        history_list.append({
            "id": s.id,
            "type": "SESSION",  # 👈 ESTA ES LA CLAVE PARA TU FRONTEND
            "name": f"Mesa Cash #{s.id}", # O el nombre que uses
            "start_time": s.start_time,
            "end_time": s.end_time,
            "status": s.status,
            "total_cash": s.declared_rake_cash, # Ejemplo de dato a mostrar
            # Agrega los campos que necesites en la tarjeta visual
        })

    # Procesar Torneos
    for t in tournaments:
        history_list.append({
            "id": t.id,
            "type": "TOURNAMENT", # 👈 ESTA ES LA CLAVE PARA TU FRONTEND
            "name": t.name,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "status": t.status,
            "total_cash": t.buyin_amount, # O el pozo acumulado
            "buyin_amount": t.buyin_amount # Campo único de torneos
        })

    # 4. Ordenar la lista combinada por fecha (lo más nuevo arriba)
    # Python sort: x['start_time'] puede ser None si apenas se creó, manejar con cuidado
    def get_sort_key(item):
        return item['start_time'] or datetime.min

    history_list.sort(key=get_sort_key, reverse=True)

    # Aplicar paginación manual a la lista combinada (opcional)
    return history_list[skip : skip + limit]




# ---------------------------------------------------------
# PAGOS A DEALERS EN UN RANGO (diario / semanal / mensual)
# ---------------------------------------------------------
@router.get("/dealer-payments")
async def get_dealer_payments(
    start_date: str = None,
    end_date: str = None,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """
    Reporte de cuánto se le debe pagar a cada dealer en un rango.
    Agrega los turnos CERRADOS (end_time dentro del rango) y las propinas
    asignadas. Pago del club = horas x tarifa + % del rake (snapshot por turno).
    Las propinas se reportan aparte (son del dealer, no las paga el club).
    """
    # 1. Rango (default: mes en curso, hora Colombia)
    if not start_date or not end_date:
        start_dt = _start_of_month_col_as_utc()
        end_dt = datetime.utcnow()
    else:
        start_dt = datetime.combine(datetime.strptime(start_date, "%Y-%m-%d").date(), time.min)
        end_dt = datetime.combine(datetime.strptime(end_date, "%Y-%m-%d").date(), time.max)

    # 2. Turnos cerrados del club en el rango (por end_time)
    shifts_stmt = (
        select(models.DealerShift, models.Dealer.name, models.Dealer.is_active)
        .join(models.Dealer, models.Dealer.id == models.DealerShift.dealer_id)
        .where(
            models.DealerShift.club_id == current_club.id,
            models.DealerShift.end_time.isnot(None),
            models.DealerShift.end_time >= start_dt,
            models.DealerShift.end_time <= end_dt,
        )
        .order_by(models.DealerShift.start_time)
    )
    shift_rows = (await db.execute(shifts_stmt)).all()

    # 2.b Turnos de TORNEO cerrados en el rango (Fase 2): pago = horas × tarifa torneo.
    t_shift_rows = (await db.execute(
        select(models.TournamentDealerShift, models.Dealer.name, models.Dealer.is_active)
        .join(models.Dealer, models.Dealer.id == models.TournamentDealerShift.dealer_id)
        .where(
            models.TournamentDealerShift.club_id == current_club.id,
            models.TournamentDealerShift.end_time.isnot(None),
            models.TournamentDealerShift.end_time >= start_dt,
            models.TournamentDealerShift.end_time <= end_dt,
        )
    )).all()

    # 3. Propinas asignadas a dealers en el rango (por timestamp).
    #    Join a Dealer para acotar al club (defensa tenant en la propia query).
    tips_stmt = (
        select(models.Transaction.dealer_id, func.sum(models.Transaction.amount))
        .join(models.Dealer, models.Dealer.id == models.Transaction.dealer_id)
        .where(
            models.Transaction.type == models.TransactionType.TIP,
            models.Transaction.dealer_id.isnot(None),
            models.Dealer.club_id == current_club.id,
            models.Transaction.timestamp >= start_dt,
            models.Transaction.timestamp <= end_dt,
        )
        .group_by(models.Transaction.dealer_id)
    )
    tips_by_dealer = {d_id: float(total or 0) for d_id, total in (await db.execute(tips_stmt)).all()}

    # 3b. Liquidaciones (pagos ya hechos) por dealer. Misma semantica que el
    #     ledger de socios:
    #     - Pago CON periodo (Liquidar desde Reportes): cuenta solo si su periodo
    #       esta CONTENIDO en el rango visto. Asi, pagar el lunes la semana
    #       pasada deja esa semana en "Pagado" (antes, por paid_at, quedaba
    #       "Pendiente" para siempre y el pago aparecia en una semana sin
    #       devengo). Un pago que desborda el rango (registrado a nivel mes y
    #       miramos la semana) no suma pero AVISA, para no re-registrarlo.
    #     - Pago SIN periodo (pago en la mesa, session_id): por paid_at.
    payouts_rows = (await db.execute(
        select(models.DealerPayout).where(
            models.DealerPayout.club_id == current_club.id,
            or_(
                and_(
                    models.DealerPayout.period_start.isnot(None),
                    models.DealerPayout.period_end.isnot(None),
                    models.DealerPayout.period_end >= start_dt,
                    models.DealerPayout.period_start <= end_dt,
                ),
                and_(
                    models.DealerPayout.period_start.is_(None),
                    models.DealerPayout.paid_at >= start_dt,
                    models.DealerPayout.paid_at <= end_dt,
                ),
            ),
        )
    )).scalars().all()
    paid_by_dealer: dict = {}
    external_by_dealer: set = set()
    for p in payouts_rows:
        if p.period_start is None:
            paid_by_dealer[p.dealer_id] = paid_by_dealer.get(p.dealer_id, 0.0) + float(p.amount or 0)
        elif p.period_start >= start_dt and p.period_end <= end_dt:
            paid_by_dealer[p.dealer_id] = paid_by_dealer.get(p.dealer_id, 0.0) + float(p.amount or 0)
        else:
            external_by_dealer.add(p.dealer_id)

    # 4. Agregar por dealer. Usamos la MISMA función de pago que el cierre
    #    (services.shift_payment_breakdown, redondeo por turno) para que el mismo
    #    dealer muestre el mismo total acá y en la factura de cierre.
    dealers = {}
    for shift, name, is_active in shift_rows:
        elapsed_min = max(0, int((shift.end_time - shift.start_time).total_seconds() // 60))
        hours = round(elapsed_min / 60.0, 2)
        bd = services.shift_payment_breakdown(hours, shift.hourly_rate_cop or 0, shift.rake_pct or 0, shift.declared_rake)

        d = dealers.setdefault(shift.dealer_id, {
            "dealer_id": shift.dealer_id,
            "name": name,
            "is_active": is_active,
            "shifts_count": 0,
            "sessions": set(),
            "tournaments": set(),
            "total_minutes": 0,
            "hour_payment": 0,
            "rake_commission": 0,
            "club_payment": 0,
        })
        d["shifts_count"] += 1
        d["sessions"].add(shift.session_id)
        d["total_minutes"] += elapsed_min
        d["hour_payment"] += bd["hour_payment"]
        d["rake_commission"] += bd["rake_commission"]
        d["club_payment"] += bd["club_payment"]

    # Turnos de TORNEO: suman horas + pago por horas (sin %rake) al mismo dealer.
    for shift, name, is_active in t_shift_rows:
        elapsed_min = max(0, int((shift.end_time - shift.start_time).total_seconds() // 60))
        hours = round(elapsed_min / 60.0, 2)
        bd = services.shift_payment_breakdown(hours, shift.tournament_hourly_rate_cop or 0, 0, None)
        d = dealers.setdefault(shift.dealer_id, {
            "dealer_id": shift.dealer_id,
            "name": name,
            "is_active": is_active,
            "shifts_count": 0,
            "sessions": set(),
            "tournaments": set(),
            "total_minutes": 0,
            "hour_payment": 0,
            "rake_commission": 0,
            "club_payment": 0,
        })
        d["shifts_count"] += 1
        d["tournaments"].add(shift.tournament_id)
        d["total_minutes"] += elapsed_min
        d["hour_payment"] += bd["hour_payment"]
        d["club_payment"] += bd["club_payment"]

    # Asegurar que dealers con propina o liquidación pero sin turno cerrado
    # aparezcan igual en el reporte.
    for d_id in set(tips_by_dealer) | set(paid_by_dealer) | external_by_dealer:
        if d_id not in dealers:
            dr = (await db.execute(
                select(models.Dealer.name, models.Dealer.is_active).where(
                    models.Dealer.id == d_id,
                    models.Dealer.club_id == current_club.id,
                )
            )).first()
            if not dr:
                continue
            dealers[d_id] = {
                "dealer_id": d_id, "name": dr[0], "is_active": dr[1],
                "shifts_count": 0, "sessions": set(), "tournaments": set(), "total_minutes": 0,
                "hour_payment": 0, "rake_commission": 0, "club_payment": 0,
            }

    result = []
    summary = {"total_hours": 0.0, "club_payment": 0, "tips": 0, "grand_total": 0,
               "paid": 0, "pending": 0, "dealers_count": 0}
    for d in dealers.values():
        club_payment = round(d["club_payment"])
        tips = round(tips_by_dealer.get(d["dealer_id"], 0))
        paid = round(paid_by_dealer.get(d["dealer_id"], 0))
        # Pendiente = lo que el club le debe (pago por turnos) - lo ya liquidado.
        # SIN clamp: si se liquido de mas, se dice (igual que el ledger de
        # socios); esconderlo era un sobrepago silencioso.
        pending = club_payment - paid
        hours = round(d["total_minutes"] / 60.0, 1)
        result.append({
            "dealer_id": d["dealer_id"],
            "name": d["name"],
            "is_active": d["is_active"],
            "shifts_count": d["shifts_count"],
            "sessions_count": len(d["sessions"]),
            "tournaments_count": len(d["tournaments"]),
            "hours": hours,
            "hour_payment": round(d["hour_payment"]),
            "rake_commission": round(d["rake_commission"]),
            "club_payment": club_payment,
            "tips": tips,
            "grand_total": club_payment + tips,
            "paid": paid,
            "pending": pending,
            # Tiene un pago registrado en un periodo que desborda este rango
            # (ej. liquidado a nivel mes y miramos la semana): no suma, avisa.
            "paid_external": d["dealer_id"] in external_by_dealer,
        })
        summary["total_hours"] += hours
        summary["club_payment"] += club_payment
        summary["tips"] += tips
        summary["grand_total"] += club_payment + tips
        summary["paid"] += paid
        # El resumen suma solo lo que de verdad se debe; el sobrepago de uno
        # no "paga" la deuda de otro.
        summary["pending"] += max(0, pending)
    summary["dealers_count"] = len(result)
    summary["total_hours"] = round(summary["total_hours"], 1)

    # Mayor pago primero
    result.sort(key=lambda x: x["grand_total"], reverse=True)

    return {"summary": summary, "dealers": result}


# ---------------------------------------------------------------------------
# LEDGER DEL REPARTO A SOCIOS (espejo de la liquidación de dealers): registrar
# que la plata de la distribución YA se entregó. No mueve la caja — la utilidad
# se reconoció en el cierre; esto es "quién recibió qué y cuándo".
# ---------------------------------------------------------------------------
from pydantic import BaseModel as _BaseModel
from fastapi import Request as _Request
from ..audit import log_action as _log_action, AuditAction as _AuditAction


def _parse_fecha(v: str):
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Fechas inválidas: usa YYYY-MM-DD.")


class PartnerPayoutCreate(_BaseModel):
    beneficiary_name: str
    rule_id: int | None = None
    period_start: str  # YYYY-MM-DD (el rango que el dueño está viendo)
    period_end: str
    amount: int
    method: str = "cash"  # cash | transfer
    note: str | None = None


@router.get("/partner-payouts")
async def list_partner_payouts(
    start_date: str,
    end_date: str,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """Pagos a socios que SOLAPAN el rango visto. El front suma los CONTENIDOS
    en el rango y usa los que lo desbordan (ej. un pago a nivel mes visto desde
    la semana) como AVISO para no re-registrar."""
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d").date()
        e = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Fechas inválidas: usa YYYY-MM-DD.")
    rows = (await db.execute(
        select(models.PartnerPayout)
        .where(models.PartnerPayout.club_id == current_club.id)
        .where(models.PartnerPayout.period_end >= s)
        .where(models.PartnerPayout.period_start <= e)
        .order_by(models.PartnerPayout.created_at.desc())
    )).scalars().all()
    return [{
        "id": p.id, "beneficiary_name": p.beneficiary_name, "amount": p.amount,
        "method": p.method, "note": p.note,
        "period_start": p.period_start.isoformat(), "period_end": p.period_end.isoformat(),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    } for p in rows]


@router.post("/partner-payouts", status_code=201)
async def create_partner_payout(
    data: PartnerPayoutCreate,
    request: _Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role(_REPORT_ROLES)),
):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0.")
    if data.method not in ("cash", "transfer"):
        raise HTTPException(status_code=400, detail="Método inválido: usa cash o transfer.")
    if data.rule_id is not None:
        regla = (await db.execute(
            select(models.DistributionRule)
            .where(models.DistributionRule.id == data.rule_id)
            .where(models.DistributionRule.club_id == current_club.id)
        )).scalars().first()
        if not regla:
            raise HTTPException(status_code=404, detail="Regla de distribución no encontrada.")
    payout = models.PartnerPayout(
        club_id=current_club.id,
        beneficiary_name=data.beneficiary_name.strip(),
        rule_id=data.rule_id,
        period_start=_parse_fecha(data.period_start),
        period_end=_parse_fecha(data.period_end),
        amount=data.amount,
        method=data.method,
        note=(data.note or None),
        created_by_user_id=current_user.id,
    )
    db.add(payout)
    await db.flush()
    await _log_action(
        db, request=request, club=current_club, action=_AuditAction.PARTNER_PAYOUT_CREATE,
        entity_type="PartnerPayout", entity_id=payout.id,
        meta={"beneficiary": payout.beneficiary_name, "amount": payout.amount,
              "period": f"{data.period_start}..{data.period_end}", "by": current_user.email},
    )
    await db.commit()
    await db.refresh(payout)
    return {"id": payout.id, "beneficiary_name": payout.beneficiary_name, "amount": payout.amount}


@router.delete("/partner-payouts/{payout_id}")
async def delete_partner_payout(
    payout_id: int,
    request: _Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    current_user: models.User = Depends(require_role(_REPORT_ROLES)),
):
    """Deshacer un registro erróneo (es ledger: borrar el registro, no plata)."""
    payout = (await db.execute(
        select(models.PartnerPayout)
        .where(models.PartnerPayout.id == payout_id)
        .where(models.PartnerPayout.club_id == current_club.id)
    )).scalars().first()
    if not payout:
        raise HTTPException(status_code=404, detail="Registro no encontrado.")
    await _log_action(
        db, request=request, club=current_club, action=_AuditAction.PARTNER_PAYOUT_DELETE,
        entity_type="PartnerPayout", entity_id=payout.id,
        meta={"beneficiary": payout.beneficiary_name, "amount": payout.amount, "by": current_user.email},
    )
    await db.delete(payout)
    await db.commit()
    return {"message": "Registro eliminado"}
