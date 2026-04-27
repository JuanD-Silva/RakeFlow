# app/routers/sessions.py
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, case, text, delete
from typing import List
from decimal import Decimal
from datetime import datetime, date
import traceback
import logging

logger = logging.getLogger(__name__)

# Importamos modelos y esquemas
from .. import models, schemas
# Importamos las dependencias SaaS
from ..dependencies import get_db, get_current_club, require_role
from ..audit import log_action, AuditAction

router = APIRouter(
    prefix="/sessions",
    tags=["Sessions"]
)
logger = logging.getLogger("uvicorn.error")
# ---------------------------------------------------------
# 1. ABRIR SESIÓN (Start Session)
# ---------------------------------------------------------
@router.post("/", response_model=schemas.SessionResponse)
async def create_session(
    session_in: schemas.SessionCreate,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Crear una nueva sesion. Multi-mesa: pueden coexistir varias sesiones OPEN en el mismo club."""
    new_session = models.Session(
        status=models.SessionStatus.OPEN,
        start_time=datetime.utcnow(),
        club_id=current_club.id,
        name=(session_in.name or None) if session_in else None,
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
async def _build_players_stats(db: AsyncSession, session: models.Session) -> list:
    """Calcula los stats de jugadores y detalle de transacciones para una sesion dada."""
    # 1. SQL para TOTALES (Incluye la lógica de BONOS)
    sql = text("""
        SELECT 
            p.id as player_id,
            p.name,
            p.phone,
            COALESCE(SUM(CASE WHEN t.type IN ('BUYIN', 'REBUY') THEN t.amount ELSE 0 END), 0) as total_buyin,
            COALESCE(SUM(CASE WHEN t.type = 'CASHOUT' THEN t.amount ELSE 0 END), 0) as total_cashout,
            COALESCE(SUM(CASE WHEN t.type IN ('SPEND', 'TIP') THEN t.amount ELSE 0 END), 0) as total_spend,
            COALESCE(SUM(CASE WHEN t.type = 'JACKPOT_PAYOUT' THEN t.amount ELSE 0 END), 0) as total_jackpot,
            -- 👇 Lógica de Bonos
            COALESCE(SUM(CASE WHEN t.type = 'BONUS' THEN t.amount ELSE 0 END), 0) as total_bonus,
            MAX(CASE WHEN (t.type = 'BUYIN' OR t.type = 'REBUY') AND t.method = 'DIGITAL' THEN 1 ELSE 0 END) as has_digital,
            MAX(CASE WHEN t.type IN ('BUYIN', 'REBUY') AND COALESCE(t.is_paid, TRUE) = FALSE THEN 1 ELSE 0 END) as has_pending_payment,
            SUM(CASE WHEN t.type IN ('BUYIN', 'REBUY') THEN 1 ELSE 0 END) as buyins_count,
            SUM(CASE WHEN t.type IN ('BUYIN', 'REBUY') AND COALESCE(t.is_paid, FALSE) = TRUE THEN 1 ELSE 0 END) as paid_buyins_count,
            MAX(CASE WHEN t.type = 'BUST' THEN 1 ELSE 0 END) as is_busted,
            MAX(CASE WHEN t.type = 'BUST' THEN t.timestamp END) as busted_at
        FROM players p
        JOIN transactions t ON p.id = t.player_id
        WHERE t.session_id = :sid
        GROUP BY p.id, p.name, p.phone
    """)
    
    result = await db.execute(sql, {"sid": session.id})
    rows = result.fetchall()

    # 3. INICIALIZAR EL DICCIONARIO
    players_map = {}
    
    for r in rows:
        # 👇 Fórmula Contable Actualizada: El bono suma al balance del jugador
        balance = (r.total_cashout + r.total_jackpot + r.total_bonus) - r.total_buyin - r.total_spend
        
        players_map[r.player_id] = {
            "player_id": r.player_id,
            "name": r.name,
            "phone": r.phone,
            "total_buyin": r.total_buyin,
            "total_cashout": r.total_cashout,
            "total_spend": r.total_spend,
            "total_jackpot": r.total_jackpot,
            "total_bonus": r.total_bonus,  # Guardamos el bono
            "current_balance": balance,
            "has_digital_payments": bool(r.has_digital),
            "has_pending_payment": bool(r.has_pending_payment),
            "buyins_count": int(r.buyins_count or 0),
            "paid_buyins_count": int(r.paid_buyins_count or 0),
            "is_busted": bool(r.is_busted),
            "busted_at": r.busted_at.isoformat() if r.busted_at else None,
            "transactions": []
        }

    # 4. SQL BLINDADO PARA DETALLES 🛡️
    #    Fusiona: Corrección 'timestamp' + Corrección 'Hora Colombia' + Conversión Texto
    sql_details = text("""
        SELECT
            id,
            player_id,
            CAST(type AS TEXT) as type_str,
            amount,
            CAST(method AS TEXT) as method_str,
            COALESCE(is_paid, FALSE) as is_paid,
            -- 👇 AQUÍ ESTÁ LA FUSIÓN CLAVE: 'timestamp' + 'Time Zone'
            (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') as created_at
        FROM transactions
        WHERE session_id = :sid
        ORDER BY timestamp DESC
    """)
    
    details_result = await db.execute(sql_details, {"sid": session.id})
    raw_transactions = details_result.fetchall()

    # 5. LLENAR EL DICCIONARIO CON SEGURIDAD
    for tx in raw_transactions:
        try:
            if tx.player_id in players_map:
                # Limpieza de string por si acaso (ej: "TransactionType.BUYIN")
                raw_type = str(tx.type_str)
                clean_type = raw_type.split('.')[-1] if '.' in raw_type else raw_type

                players_map[tx.player_id]["transactions"].append({
                    "id": tx.id,
                    "type": clean_type,
                    "amount": tx.amount,
                    "created_at": tx.created_at,
                    "method": tx.method_str or "CASH",
                    "is_paid": bool(tx.is_paid),
                })
        except Exception as e:
            logger.warning("Error procesando transacción: %s", e)
            continue

    # 6. Retornar lista
    return list(players_map.values())


@router.get("/current/players-stats")
async def get_current_session_stats(
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """[DEPRECADO en multi-mesa] Devuelve stats de la primera sesion OPEN del club.
    Mantener para compat. Usar GET /sessions/{id}/players-stats."""
    stmt = select(models.Session).where(
        models.Session.club_id == current_club.id,
        models.Session.status == models.SessionStatus.OPEN,
    ).order_by(models.Session.id.asc())
    session = (await db.execute(stmt)).scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="No hay sesión activa")
    return await _build_players_stats(db, session)


@router.get("/{session_id}/players-stats")
async def get_session_players_stats(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
):
    """Stats de jugadores y detalle de transacciones para una mesa especifica."""
    stmt = select(models.Session).where(
        models.Session.id == session_id,
        models.Session.club_id == current_club.id,
    )
    session = (await db.execute(stmt)).scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="Mesa no encontrada")
    return await _build_players_stats(db, session)


# ---------------------------------------------------------
# 4. AUDITORÍA FINANCIERA (Para el botón de auditar)
# ---------------------------------------------------------
@router.get("/{session_id}/audit")
async def audit_session_by_id(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club)
):
    """Auditoría de una sesión específica por ID."""
    stmt = select(models.Session).where(
        models.Session.id == session_id,
        models.Session.club_id == current_club.id
    )
    session = (await db.execute(stmt)).scalars().first()

    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    sql = text("""
        SELECT
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) IN ('BUYIN', 'REBUY') THEN amount ELSE 0 END), 0) as total_buyins,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'CASHOUT' THEN amount ELSE 0 END), 0) as total_cashouts,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'SPEND' THEN amount ELSE 0 END), 0) as total_expenses,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'JACKPOT_PAYOUT' THEN amount ELSE 0 END), 0) as total_jackpot_payouts,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'TIP' THEN amount ELSE 0 END), 0) as total_tips,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) LIKE '%BONUS%' THEN amount ELSE 0 END), 0) as total_bonuses
        FROM transactions
        WHERE session_id = :sid
    """)

    result = await db.execute(sql, {"sid": session.id})
    data = result.fetchone()
    expected_cash = data.total_buyins - data.total_cashouts - data.total_expenses - data.total_jackpot_payouts - data.total_tips

    return {
        "total_buyins": data.total_buyins,
        "total_cashouts": data.total_cashouts,
        "total_expenses": data.total_expenses,
        "total_jackpot_payouts": data.total_jackpot_payouts,
        "total_tips": data.total_tips,
        "total_bonuses": data.total_bonuses,
        "expected_cash_in_box": expected_cash,
        "transactions_count": 0
    }

@router.get("/audit/current-session")
async def audit_current_session(
    db: AsyncSession = Depends(get_db), 
    current_club: models.Club = Depends(get_current_club)
):
    # 1. Buscar sesión activa
    stmt = select(models.Session).where(
        models.Session.status == models.SessionStatus.OPEN,
        models.Session.club_id == current_club.id
    )
    session = (await db.execute(stmt)).scalars().first()
    
    if not session:
        return {"expected_cash_in_box": 0}

    # 2. CONSULTA SQL ROBUSTA (Busca 'BONUS' aunque esté en mayúscula/minúscula)
    sql = text("""
        SELECT 
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) IN ('BUYIN', 'REBUY') THEN amount ELSE 0 END), 0) as total_buyins,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'CASHOUT' THEN amount ELSE 0 END), 0) as total_cashouts,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'SPEND' THEN amount ELSE 0 END), 0) as total_expenses,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'JACKPOT_PAYOUT' THEN amount ELSE 0 END), 0) as total_jackpot_payouts,
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) = 'TIP' THEN amount ELSE 0 END), 0) as total_tips,
            
            -- 👇 EL FIX DEL BONO: Usamos LIKE para atrapar cualquier variante
            COALESCE(SUM(CASE WHEN CAST(type AS TEXT) LIKE '%BONUS%' THEN amount ELSE 0 END), 0) as total_bonuses
            
        FROM transactions
        WHERE session_id = :sid
    """)
    
    result = await db.execute(sql, {"sid": session.id})
    data = result.fetchone()

    # 3. 🕵️‍♂️ DEBUG EN TERMINAL (Ahora sí lo verás)
    logger.info("Auditoría sesión %d: buyins=%.0f, bonos=%.0f", session.id, data.total_buyins, data.total_bonuses)

    # 4. CÁLCULO DE CAJA
    expected_cash = (data.total_buyins) - data.total_cashouts - data.total_expenses - data.total_jackpot_payouts - data.total_tips

    return {
        "total_buyins": data.total_buyins,
        "total_cashouts": data.total_cashouts,
        "total_expenses": data.total_expenses,
        "total_jackpot_payouts": data.total_jackpot_payouts,
        "total_tips": data.total_tips,
        "total_bonuses": data.total_bonuses,
        "expected_cash_in_box": expected_cash
    }
# ---------------------------------------------------------
# 5. CERRAR SESIÓN (Motor de Reglas SaaS + Fallback)
# ---------------------------------------------------------
@router.post("/{session_id}/close")
async def close_session(session_id: int, input_data: schemas.SessionCloseRequest, request: Request, db: AsyncSession = Depends(get_db), current_club: models.Club = Depends(get_current_club)):
    """
    Cierra caja, audita y DISTRIBUYE EL DINERO.
    MODO TOTAL: Suma todo (Físico + Digital) al esperado.
    CORRECCIÓN: Calcula el % efectivo de la utilidad para que no salga 0%.
    """
    # 1. Validar Sesión (con lock para evitar cierre simultáneo)
    result = await db.execute(
        select(models.Session)
        .where(
            models.Session.id == session_id,
            models.Session.club_id == current_club.id
        )
        .with_for_update()
    )
    session = result.scalars().first()

    if not session or session.status == models.SessionStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Sesión inválida o cerrada")

    # -----------------------------------------------------------------------
    # 2. CALCULAR AUDITORÍA (TOTAL GLOBAL)
    # -----------------------------------------------------------------------
    async def get_global_sum(tx_type_list):
        stmt = select(func.sum(models.Transaction.amount)).where(
            models.Transaction.session_id == session_id,
            models.Transaction.type.in_(tx_type_list)
        )
        return Decimal(str((await db.execute(stmt)).scalar() or 0))

    total_buyins = await get_global_sum([models.TransactionType.BUYIN, models.TransactionType.REBUY])
    total_cashouts = await get_global_sum([models.TransactionType.CASHOUT])
    total_spends = await get_global_sum([models.TransactionType.SPEND, models.TransactionType.TIP])
    total_jackpot_payouts = await get_global_sum([models.TransactionType.JACKPOT_PAYOUT])

    expected_total = total_buyins - total_cashouts - total_spends - total_jackpot_payouts

    # -----------------------------------------------------------------------
    # 3. VERIFICAR DESCUADRE
    # -----------------------------------------------------------------------
    declared_rake = input_data.declared_rake_cash
    declared_jackpot = input_data.declared_jackpot_cash

    total_declared = declared_rake + declared_jackpot

    difference = total_declared - expected_total
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
    final_debt_payment = Decimal(0)
    final_partner_profit = Decimal(0)

    cash_remaining = declared_rake
    calculation_base = declared_rake

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

            amount_to_pay = Decimal(0)

            # --- LÓGICA DE REGLA FIJA (META/DEUDA) ---
            if rule.rule_type == models.RuleType.FIXED:
                start_of_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

                paid_stmt = select(func.sum(models.FinancialDistribution.amount)).join(models.Session).where(
                    models.Session.club_id == current_club.id,
                    models.FinancialDistribution.name == rule.name,
                    models.Session.end_time >= start_of_month,
                    models.Session.status == models.SessionStatus.CLOSED
                )
                total_paid_already = Decimal(str((await db.execute(paid_stmt)).scalar() or 0))

                remaining_gap = max(Decimal(0), Decimal(str(rule.value)) - total_paid_already)
                amount_to_pay = min(remaining_gap, cash_remaining)

                calculation_base -= amount_to_pay
                final_debt_payment += amount_to_pay

            # --- LÓGICA DE REGLA PORCENTUAL (SOCIOS) ---
            elif rule.rule_type == models.RuleType.PERCENTAGE:
                percentage = Decimal(str(rule.value)) / Decimal(100) if rule.value > 1 else Decimal(str(rule.value))
                amount_to_pay = min(calculation_base * percentage, cash_remaining)
                final_partner_profit += amount_to_pay

            # Registrar la distribución si hubo monto
            if amount_to_pay > 0:
                db.add(models.FinancialDistribution(
                    session_id=session.id,
                    name=rule.name,
                    amount=float(amount_to_pay),
                    percentage_applied=rule.value if rule.rule_type == models.RuleType.PERCENTAGE else 0.0
                ))
                cash_remaining -= amount_to_pay

        # 4. REMANENTE FINAL: Si sobra algo, va a utilidad de socios
        if cash_remaining > 0:
            final_partner_profit += cash_remaining
            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Utilidad Socios (Sobrante)",
                amount=float(cash_remaining),
                percentage_applied=0.0
            ))

    else:
        # C. FALLBACK (Sin reglas)
        MONTHLY_TARGET = Decimal(400000)

        current_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        stmt_paid = select(func.sum(models.Session.debt_payment)).where(
            models.Session.club_id == current_club.id,
            models.Session.status == models.SessionStatus.CLOSED,
            models.Session.end_time >= current_month
        )
        paid_so_far = Decimal(str((await db.execute(stmt_paid)).scalar() or 0))
        remaining_debt = max(Decimal(0), MONTHLY_TARGET - paid_so_far)

        if declared_rake >= remaining_debt:
            final_debt_payment = remaining_debt
            final_partner_profit = declared_rake - remaining_debt
        else:
            final_debt_payment = declared_rake
            final_partner_profit = Decimal(0)

        # REGISTROS EXPLÍCITOS CON % CALCULADO
        if final_debt_payment > 0:
            effective_pct_debt = (final_debt_payment / declared_rake) if declared_rake > 0 else Decimal(0)

            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Caja (Gastos Fijos)",
                amount=float(final_debt_payment),
                percentage_applied=float(effective_pct_debt)
            ))

        if final_partner_profit > 0:
            effective_pct_profit = (final_partner_profit / declared_rake) if declared_rake > 0 else Decimal(0)

            db.add(models.FinancialDistribution(
                session_id=session.id,
                name="Utilidad Socios",
                amount=float(final_partner_profit),
                percentage_applied=float(effective_pct_profit)
            ))

    # ---------------------------------------------------
    # 5. GUARDAR Y RESPONDER
    # ---------------------------------------------------
    session.end_time = datetime.utcnow()
    session.status = models.SessionStatus.CLOSED
    session.declared_rake_cash = float(declared_rake)
    session.declared_jackpot_cash = float(declared_jackpot)

    session.debt_payment = float(final_debt_payment)
    session.partner_profit = float(final_partner_profit)

    await log_action(
        db, request=request, club=current_club,
        action=AuditAction.SESSION_CLOSE,
        entity_type="Session", entity_id=session.id,
        meta={
            "declared_rake_cash": float(declared_rake),
            "declared_jackpot_cash": float(declared_jackpot),
            "debt_payment": float(final_debt_payment),
            "partner_profit": float(final_partner_profit),
        },
    )
    await db.commit()

    dist_result = await db.execute(
        select(models.FinancialDistribution).where(models.FinancialDistribution.session_id == session.id)
    )

    distributions = dist_result.scalars().all()

    return {
        "status": "CLOSED",
        "declared_rake_cash": float(declared_rake),
        "declared_jackpot_cash": float(declared_jackpot),
        "debt_payment": float(final_debt_payment),
        "partner_profit": float(final_partner_profit),
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


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_club: models.Club = Depends(get_current_club),
    _: models.User = Depends(require_role([models.UserRole.OWNER])),
):
    # A. Buscar la sesión
    result = await db.execute(select(models.Session).where(models.Session.id == session_id))
    session = result.scalars().first()

    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    # B. Verificar seguridad (que sea del club correcto)
    if session.club_id != current_club.id:
        raise HTTPException(status_code=403, detail="No tienes permiso para eliminar esta sesión")

    try:
        # Contar transacciones para snapshot de auditoria
        tx_count = (await db.execute(
            select(func.count(models.Transaction.id)).where(models.Transaction.session_id == session_id)
        )).scalar() or 0

        # C. Eliminar primero las transacciones asociadas
        await db.execute(delete(models.Transaction).where(models.Transaction.session_id == session_id))

        # D. Eliminar la sesión
        await db.execute(delete(models.Session).where(models.Session.id == session_id))
        await log_action(
            db, request=request, club=current_club,
            action=AuditAction.SESSION_DELETE,
            entity_type="Session", entity_id=session_id,
            meta={"status": str(session.status), "transactions_deleted": tx_count},
        )
        await db.commit()

        return {"message": "Sesión eliminada correctamente"}

    except Exception as e:
        await db.rollback()
        logger.error("Error borrando sesión %d: %s", session_id, e)
        raise HTTPException(status_code=500, detail="Error interno al eliminar la sesión")

