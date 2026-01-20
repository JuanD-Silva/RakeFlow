# app/routers/sessions.py
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, case, text
from typing import List
from datetime import datetime, date

# Importamos modelos y esquemas
from .. import models, schemas
# Importamos las dependencias SaaS
from ..dependencies import get_db, get_current_club

router = APIRouter(
    prefix="/sessions",
    tags=["Sessions"]
)

# ---------------------------------------------------------
# 1. ABRIR SESIÓN (Start Session)
# ---------------------------------------------------------
@router.post("/", response_model=schemas.SessionResponse)
async def create_session(session_in: schemas.SessionCreate, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club) ):
    # Validar si ya hay mesa abierta en este club
    result = await db.execute(
        select(models.Session).where(
            models.Session.status == models.SessionStatus.OPEN,
            models.Session.club_id == current_club.id
        )
    )
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Ya hay una sesión abierta en este club.")

    # Crear sesión asignada al Club
    new_session = models.Session(
        status=models.SessionStatus.OPEN,
        start_time=datetime.utcnow(),
        club_id=current_club.id 
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    return new_session


# ---------------------------------------------------------
# 2. LISTAR SESIONES (History)
# ---------------------------------------------------------
@router.get("/", response_model=List[schemas.SessionResponse])
async def read_sessions(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    result = await db.execute(
        select(models.Session)
        .where(models.Session.club_id == current_club.id)
        .order_by(models.Session.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


# ---------------------------------------------------------
# 3. ESTADÍSTICAS / AUDITORÍA EN TIEMPO REAL
# ---------------------------------------------------------
@router.get("/current/players-stats")
async def get_current_session_stats(db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    # 1. Buscar sesión activa
    stmt = select(models.Session).where(
        models.Session.club_id == current_club.id, 
        models.Session.status == models.SessionStatus.OPEN
    )
    session = (await db.execute(stmt)).scalars().first()
    
    if not session:
        raise HTTPException(status_code=404, detail="No hay sesión activa")

    # 2. SQL Directo mejorado con detección de pagos digitales 📱
    sql = text("""
        SELECT 
            p.id as player_id,
            p.name,
            p.phone,
            COALESCE(SUM(CASE WHEN t.type = 'BUYIN' THEN t.amount ELSE 0 END), 0) as total_buyin,
            COALESCE(SUM(CASE WHEN t.type = 'CASHOUT' THEN t.amount ELSE 0 END), 0) as total_cashout,
            COALESCE(SUM(CASE WHEN t.type IN ('SPEND', 'TIP') THEN t.amount ELSE 0 END), 0) as total_spend,
            COALESCE(SUM(CASE WHEN t.type = 'JACKPOT_PAYOUT' THEN t.amount ELSE 0 END), 0) as total_jackpot,
            -- 👇 NUEVA LÍNEA: Devuelve 1 si encuentra al menos un Buyin Digital, 0 si no.
            MAX(CASE WHEN (t.type = 'BUYIN' OR t.type = 'REBUY') AND t.method = 'DIGITAL' THEN 1 ELSE 0 END) as has_digital
        FROM players p
        JOIN transactions t ON p.id = t.player_id
        WHERE t.session_id = :sid
        GROUP BY p.id, p.name
    """)
    
    result = await db.execute(sql, {"sid": session.id})
    rows = result.fetchall()
    
    stats = []
    for r in rows:
        # Tu fórmula de balance original
        balance = (r.total_cashout + r.total_jackpot) - r.total_buyin - r.total_spend
        
        stats.append({
            "player_id": r.player_id,
            "name": r.name,
            "phone": r.phone,
            "total_buyin": r.total_buyin,
            "total_cashout": r.total_cashout,
            "total_spend": r.total_spend,
            "total_jackpot": r.total_jackpot,
            "current_balance": balance,
            # Convertimos el 1/0 de SQL a True/False de Python
            "has_digital_payments": bool(r.has_digital) 
        })
        
    return stats
# ---------------------------------------------------------
# 4. AUDITORÍA FINANCIERA (Para el botón de auditar)
# ---------------------------------------------------------
@router.get("/audit/current-session") 
async def audit_current_session(db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    result = await db.execute(
        select(models.Session).where(
            models.Session.status == models.SessionStatus.OPEN,
            models.Session.club_id == current_club.id
        )
    )
    session = result.scalars().first()
    
    if not session:
        return {"expected_cash_in_box": 0}

    query = select(models.Transaction).where(models.Transaction.session_id == session.id)
    result_trans = await db.execute(query)
    transactions = result_trans.scalars().all()

    total_buyins = sum(t.amount for t in transactions if t.type in [models.TransactionType.BUYIN, models.TransactionType.REBUY])
    total_cashouts = sum(t.amount for t in transactions if t.type == models.TransactionType.CASHOUT)
    total_expenses = sum(t.amount for t in transactions if t.type == models.TransactionType.SPEND)
    total_jackpot_payouts = sum(t.amount for t in transactions if t.type == models.TransactionType.JACKPOT_PAYOUT)
    total_tips = sum(t.amount for t in transactions if t.type == models.TransactionType.TIP)

    expected_cash = total_buyins - total_cashouts - total_expenses - total_jackpot_payouts - total_tips

    return {
        "total_buyins": total_buyins,
        "total_cashouts": total_cashouts,
        "total_expenses": total_expenses,
        "total_jackpot_payouts": total_jackpot_payouts,
        "total_tips": total_tips,
        "expected_cash_in_box": expected_cash
    }

# ---------------------------------------------------------
# 5. CERRAR SESIÓN (Motor de Reglas SaaS + Fallback)
# ---------------------------------------------------------
@router.post("/{session_id}/close")
async def close_session(session_id: int, input_data: schemas.SessionCloseRequest, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    """
    Cierra caja, audita y DISTRIBUYE EL DINERO.
    MODO TOTAL: Suma todo (Físico + Digital) al esperado.
    CORRECCIÓN: Calcula el % efectivo de la utilidad para que no salga 0%.
    """
    # 1. Validar Sesión
    result = await db.execute(
        select(models.Session).where(
            models.Session.id == session_id,
            models.Session.club_id == current_club.id
        )
    )
    session = result.scalars().first()
    
    if not session or session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Sesión inválida o cerrada")

    # -----------------------------------------------------------------------
    # 2. CALCULAR AUDITORÍA (TOTAL GLOBAL 🌎)
    # -----------------------------------------------------------------------
    async def get_global_sum(tx_type_list):
        stmt = select(func.sum(models.Transaction.amount)).where(
            models.Transaction.session_id == session_id,
            models.Transaction.type.in_(tx_type_list)
        )
        return (await db.execute(stmt)).scalar() or 0.0

    total_buyins = await get_global_sum([models.TransactionType.BUYIN, models.TransactionType.REBUY])
    total_cashouts = await get_global_sum([models.TransactionType.CASHOUT])
    total_spends = await get_global_sum([models.TransactionType.SPEND, models.TransactionType.TIP])
    total_jackpot_payouts = await get_global_sum([models.TransactionType.JACKPOT_PAYOUT])

    expected_total = total_buyins - total_cashouts - total_spends - total_jackpot_payouts

    # -----------------------------------------------------------------------
    # 3. VERIFICAR DESCUADRE
    # -----------------------------------------------------------------------
    declared_rake = float(input_data.declared_rake_cash)
    declared_jackpot = float(input_data.declared_jackpot_cash)
    
    total_declared = declared_rake + declared_jackpot
    
    difference = total_declared - float(expected_total) 
    is_valid = abs(difference) <= 2000 

    if not is_valid and not input_data.force_close:
        return JSONResponse(
            status_code=409, 
            content={
                "detail": "Descuadre detectado",
                "expected": float(expected_total),
                "declared": float(total_declared),
                "difference": float(difference)
            }
        )

    # ---------------------------------------------------
    # 4. ALGORITMO DE DISTRIBUCIÓN
    # ---------------------------------------------------
    final_debt_payment = 0.0
    final_partner_profit = 0.0
    
    cash_remaining = float(declared_rake)
    calculation_base = float(declared_rake) 

    stmt_rules = (
        select(models.DistributionRule)
        .where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True
        )
        .order_by(models.DistributionRule.priority.asc())
    )
    rules = (await db.execute(stmt_rules)).scalars().all()

    if rules:
        for rule in rules:
            if cash_remaining <= 0: break
            
            amount_to_pay = 0.0
            
            # --- LÓGICA DE REGLA FIJA (META/DEUDA) ---
            if rule.rule_type == models.RuleType.FIXED:
                # 1. Calcular cuánto se ha pagado de ESTA meta en el mes actual
                start_of_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                
                # Sumamos todas las distribuciones con el mismo nombre en este club y mes
                paid_stmt = select(func.sum(models.FinancialDistribution.amount)).join(models.Session).where(
                    models.Session.club_id == current_club.id,
                    models.FinancialDistribution.name == rule.name,
                    models.Session.end_time >= start_of_month,
                    models.Session.status == models.SessionStatus.CLOSED
                )
                total_paid_already = (await db.execute(paid_stmt)).scalar() or 0.0
                
                # 2. Determinar el saldo pendiente de la meta
                remaining_gap = max(0.0, float(rule.value) - float(total_paid_already))
                
                # 3. Solo tomamos lo que falte para completar la meta, sin exceder el rake actual
                amount_to_pay = min(remaining_gap, cash_remaining)
                
                # Restamos de la base para que los socios no cobren sobre la deuda pagada
                calculation_base -= amount_to_pay 
                final_debt_payment += amount_to_pay

            # --- LÓGICA DE REGLA PORCENTUAL (SOCIOS) ---
            elif rule.rule_type == models.RuleType.PERCENTAGE:
                # Ajuste de porcentaje (maneja 45 o 0.45)
                percentage = rule.value / 100.0 if rule.value > 1 else rule.value
                amount_to_pay = min(calculation_base * percentage, cash_remaining)
                final_partner_profit += amount_to_pay

            # Registrar la distribución si hubo monto
            if amount_to_pay > 0:
                db.add(models.FinancialDistribution(
                    session_id=session.id,
                    name=rule.name,
                    amount=amount_to_pay,
                    percentage_applied=rule.value if rule.rule_type == models.RuleType.PERCENTAGE else 0.0
                ))
                cash_remaining -= amount_to_pay

        # 4. REMANENTE FINAL: Si sobra algo, va a utilidad de socios
        if cash_remaining > 0:
            final_partner_profit += cash_remaining
            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Utilidad Socios (Sobrante)",
                amount=cash_remaining,
                percentage_applied=0.0
            ))
            final_partner_profit += cash_remaining

    else:
        # C. FALLBACK (Sin reglas)
        MONTHLY_TARGET = 400000.0 
        
        current_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        stmt_paid = select(func.sum(models.Session.debt_payment)).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED,
            models.Session.end_time >= current_month
        )
        paid_so_far = (await db.execute(stmt_paid)).scalar() or 0.0
        remaining_debt = max(0.0, MONTHLY_TARGET - paid_so_far)
        
        if declared_rake >= remaining_debt:
            final_debt_payment = remaining_debt
            final_partner_profit = declared_rake - remaining_debt
        else:
            final_debt_payment = declared_rake
            final_partner_profit = 0.0
            
        # REGISTROS EXPLÍCITOS CON % CALCULADO
        if final_debt_payment > 0:
            # Calculamos qué % del rake total se fue a deuda
            effective_pct_debt = (final_debt_payment / declared_rake) if declared_rake > 0 else 0.0
            
            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Caja (Gastos Fijos)",
                amount=final_debt_payment,
                percentage_applied=effective_pct_debt
            ))
            
        if final_partner_profit > 0:
            # 👇 CÁLCULO DEL PORCENTAJE REAL
            effective_pct_profit = (final_partner_profit / declared_rake) if declared_rake > 0 else 0.0

            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Utilidad Socios",
                amount=final_partner_profit,
                percentage_applied=effective_pct_profit # Guardamos el % calculado
            ))

    # ---------------------------------------------------
    # 5. GUARDAR Y RESPONDER
    # ---------------------------------------------------
    session.end_time = datetime.utcnow()
    session.status = models.SessionStatus.CLOSED
    session.declared_rake_cash = declared_rake
    session.declared_jackpot_cash = declared_jackpot
    
    session.debt_payment = final_debt_payment
    session.partner_profit = final_partner_profit
    
    await db.commit()

    dist_result = await db.execute(
        select(models.FinancialDistribution).where(models.FinancialDistribution.session_id == session.id)
    )

    distributions = dist_result.scalars().all()

    return {
        "status": "CLOSED",
        "declared_rake_cash": declared_rake,
        "declared_jackpot_cash": declared_jackpot,
        "debt_payment": final_debt_payment,       
        "partner_profit": final_partner_profit,
        # 2. Enviamos la lista detallada
        "distributions": [
            {
                "name": d.name, 
                "amount": d.amount, 
                "percentage_applied": d.percentage_applied
            } for d in distributions
        ]
    }
# ---------------------------------------------------------
# 6. DETALLES DE SESIÓN (HISTORIAL)
# ---------------------------------------------------------
@router.get("/{session_id}/details")
async def get_session_details(session_id: int, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    """
    Reporte final de una sesión específica (Jugadores + Distribución).
    Usado por el historial para ver qué pasó ese día.
    """
    # 1. Validar sesión y propiedad del club
    result = await db.execute(
        select(models.Session).where(
            models.Session.id == session_id,
            models.Session.club_id == current_club.id
        )
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    # 2. Resumen de Jugadores (Aggregation Query)
    # Recuperamos cuánto compró, sacó y gastó cada jugador en ESA sesión
    stmt = (
        select(
            models.Player.name,
            func.sum(case((models.Transaction.type.in_([models.TransactionType.BUYIN, models.TransactionType.REBUY]), models.Transaction.amount), else_=0)).label("total_buyin"),
            func.sum(case((models.Transaction.type == models.TransactionType.CASHOUT, models.Transaction.amount), else_=0)).label("total_cashout"),
            func.sum(case((models.Transaction.type.in_([models.TransactionType.SPEND, models.TransactionType.TIP]), models.Transaction.amount), else_=0)).label("total_spend"),
            func.sum(case((models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT, models.Transaction.amount), else_=0)).label("total_jackpot"),
        )
        .join(models.Transaction, models.Transaction.player_id == models.Player.id)
        .where(models.Transaction.session_id == session_id)
        .group_by(models.Player.id, models.Player.name)
    )
    players_data = (await db.execute(stmt)).all()
    
    players_list = []
    for row in players_data:
        # Calcular balance final del jugador
        balance = (row.total_cashout + row.total_jackpot) - row.total_buyin - row.total_spend
        
        players_list.append({
            "name": row.name,
            "buyin": row.total_buyin,
            "cashout": row.total_cashout,
            "spend": row.total_spend,
            "jackpot": row.total_jackpot,
            "balance": balance
        })

    # 3. Distribución (¿A dónde se fue el dinero?)
    dist_query = select(models.FinancialDistribution).where(models.FinancialDistribution.session_id == session_id)
    dist_results = (await db.execute(dist_query)).scalars().all()
    
    distribution_list = [
        {"name": d.name, "amount": d.amount, "percent": d.percentage_applied} 
        for d in dist_results
    ]

    return {
        "players": players_list,
        "distribution": distribution_list
    }


    # ---------------------------------------------------------
    # 6. DISTRIBUCIÓN DINÁMICA (MOTOR DE REGLAS SAAS) ⚙️
    # ---------------------------------------------------------
    
    total_rake = float(input_data.declared_rake_cash)
    cash_remaining = total_rake
    calculation_base = total_rake 
    
    # Variables acumuladoras para el reporte final
    final_debt_payment = 0.0
    final_partner_profit = 0.0

    # A. Buscar reglas en Base de Datos
    stmt_rules = (
        select(models.DistributionRule)
        .where(
            models.DistributionRule.club_id == current_club.id,
            models.DistributionRule.active == True
        )
        .order_by(models.DistributionRule.priority.asc())
    )
    rules = (await db.execute(stmt_rules)).scalars().all()

    # B. Ejecutar Motor de Reglas
    if rules:
        for rule in rules:
            amount_to_pay = 0.0
            
            # --- Reglas Fijas ---
            if rule.rule_type == models.RuleType.FIXED:
                amount_to_pay = min(rule.value, cash_remaining)
                calculation_base -= amount_to_pay # Reduce base para % siguientes

            # --- Reglas Cuota Mensual ---
            elif rule.rule_type == models.RuleType.MONTHLY_QUOTA:
                today = datetime.utcnow().date()
                start_of_month = datetime(today.year, today.month, 1)
                
                stmt_paid = (
                    select(func.sum(models.FinancialDistribution.amount))
                    .join(models.Session)
                    .where(
                        models.FinancialDistribution.name == rule.name,
                        models.Session.start_time >= start_of_month,
                        models.Session.club_id == current_club.id
                    )
                )
                paid_so_far = (await db.execute(stmt_paid)).scalar() or 0.0
                remaining_quota = max(0.0, rule.value - paid_so_far)
                amount_to_pay = min(remaining_quota, cash_remaining)
                calculation_base -= amount_to_pay # Reduce base para % siguientes

            # --- Reglas Porcentuales ---
            elif rule.rule_type == models.RuleType.PERCENTAGE:
                calculated_share = calculation_base * rule.value
                amount_to_pay = min(calculated_share, cash_remaining)
                # NO reduce la base (socios comparten el riesgo)

            # C. Registrar pago y acumular para reporte
            if amount_to_pay > 0:
                # Guardar el registro detallado
                db.add(models.FinancialDistribution(
                    session_id=session.id,
                    name=rule.name,
                    amount=amount_to_pay,
                    percentage_applied=rule.value if rule.rule_type == models.RuleType.PERCENTAGE else 0.0
                ))
                
                cash_remaining -= amount_to_pay
                if cash_remaining < 0: cash_remaining = 0
                
                # ACUMULAMOS PARA EL FRONTEND (Heurística simple)
                # Si la regla se llama "DEUDA" o es de tipo Cuota, sumamos a Deuda.
                # Si no, asumimos que es ganancia de socios.
                if rule.rule_type == models.RuleType.MONTHLY_QUOTA or "DEUDA" in rule.name.upper():
                    final_debt_payment += amount_to_pay
                else:
                    final_partner_profit += amount_to_pay

        # Si sobró dinero y no hay reglas que lo tomen, va a utilidades generales (opcional)
        if cash_remaining > 0:
             final_partner_profit += cash_remaining

    else:
        # ⚠️ FALLBACK SAAS: Si NO hay reglas configuradas (instalación nueva),
        # usamos la lógica por defecto para que el usuario no vea $0.
        
        # 1. Calcular Deuda Default (400k)
        today = datetime.utcnow().date()
        start_of_month = datetime(today.year, today.month, 1)
        MONTHLY_TARGET = 400000.0
        
        stmt_paid = select(func.sum(models.Session.debt_payment)).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED,
            models.Session.end_time >= start_of_month
        )
        paid_so_far = (await db.execute(stmt_paid)).scalar() or 0.0
        remaining_debt = max(0.0, MONTHLY_TARGET - paid_so_far)
        
        # 2. Distribuir
        if total_rake >= remaining_debt:
            final_debt_payment = remaining_debt
            final_partner_profit = total_rake - remaining_debt
        else:
            final_debt_payment = total_rake
            final_partner_profit = 0.0

    # 7. Finalizar y Guardar
    session.end_time = datetime.utcnow()
    session.status = models.SessionStatus.CLOSED
    session.declared_rake_cash = declared_rake
    session.declared_jackpot_cash = declared_jackpot
    
    # Guardamos los acumulados en la sesión para historial rápido
    session.debt_payment = final_debt_payment
    session.partner_profit = final_partner_profit
    
    await db.commit()

    # 8. Retorno al Frontend
    return {
        "status": "CLOSED",
        "declared_rake_cash": declared_rake,
        "declared_jackpot_cash": declared_jackpot,
        "debt_payment": final_debt_payment,
        "partner_profit": final_partner_profit
    }