from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from . import models


def shift_payment_breakdown(hours: float, hourly_rate: float, rake_pct: float, declared_rake) -> dict:
    """Pago de un turno de dealer, fuente ÚNICA de verdad (cierre Y reportes).

    pago = horas x tarifa + % del rake. El componente de rake nunca resta:
    un rake auto-calculado negativo paga $0 de ese componente.

    Devuelve el total redondeado UNA sola vez (club_payment) más los
    componentes redondeados para mostrar. club_payment es el canónico: así el
    mismo dealer muestra el mismo total en la factura de cierre y en el reporte.
    """
    hour_pay = hours * hourly_rate
    rake_comm = max(0.0, declared_rake or 0.0) * rake_pct / 100.0
    return {
        "hour_payment": round(hour_pay),
        "rake_commission": round(rake_comm),
        "club_payment": round(hour_pay + rake_comm),
    }


def shift_payment(hours: float, hourly_rate: float, rake_pct: float, declared_rake) -> float:
    """Total del pago de un turno (atajo de shift_payment_breakdown)."""
    return shift_payment_breakdown(hours, hourly_rate, rake_pct, declared_rake)["club_payment"]


def calculate_distribution(total_rake: Decimal):
    """
    Distribuye el Rake:
    15% Caja Menor
    85% Socios
    """
    # Usamos quantize para redondear a 2 decimales bancarios
    caja_menor = (total_rake * Decimal("0.15")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    socios_total = total_rake - caja_menor

    # Suponiendo que se guarda el monto total para socios,
    # si se necesita por socio individual, se divide aquí.
    return {
        "caja_menor": caja_menor,
        "partners": socios_total
    }

def verify_integrity(
    total_buyins: Decimal,
    total_cashouts: Decimal,
    total_spends: Decimal,
    total_tips: Decimal,
    total_jackpot_payouts: Decimal,
    declared_rake: Decimal,
    declared_jackpot: Decimal
) -> bool:
    """
    Integridad Completa (v3):
    Considera todo lo que entra y sale de la mesa.

    Fórmula:
    (Entradas + Premios Pagados) - (Salidas + Gastos + Propinas) == (Rake + Jackpot Recaudado)
    """
    # 1. Total de Fichas que entraron al juego (Buyins + Premios que la casa pagó)
    total_chips_in = total_buyins + total_jackpot_payouts

    # 2. Total de Fichas que salieron del juego (Cashouts + Bebidas + Propinas)
    total_chips_out = total_cashouts + total_spends + total_tips

    # 3. Lo que debería sobrar teóricamente en la mesa
    theoretical_remainder = total_chips_in - total_chips_out

    # 4. Lo que el cajero cuenta físicamente (Rake + Jackpot guardado)
    physical_count = declared_rake + declared_jackpot

    # Comparamos
    return theoretical_remainder == physical_count


async def tournament_rake_in_range(
    db: AsyncSession, club_id: int, start, end
) -> float:
    """Rake recaudado por torneos COMPLETED cuyo end_time cae en [start, end].

    FUENTE UNICA de verdad del rake de torneos: la usan tanto el dashboard
    (stats) como el cierre de caja (sessions), para que "cuanto aportaron los
    torneos a la meta" sea exactamente el mismo numero en ambos lados y no
    vuelvan a divergir.

    rebuys_count/addons_count son TOTALES (singles + dobles):
    singles = total - dobles; los dobles se valuan a su precio doble.
    """
    stmt = (
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(
            models.Tournament.club_id == club_id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= start,
            models.Tournament.end_time <= end,
        )
    )
    tournaments = (await db.execute(stmt)).scalars().all()

    total_rake = 0.0
    for t in tournaments:
        gross_pot = 0
        for p in t.players:
            single_rebuys = max(0, (p.rebuys_count or 0) - (p.double_rebuys_count or 0))
            single_addons = max(0, (p.addons_count or 0) - (p.double_addons_count or 0))
            gross_pot += (
                t.buyin_amount
                + single_rebuys * t.rebuy_price
                + (p.double_rebuys_count or 0) * t.double_rebuy_price
                + single_addons * t.addon_price
                + (p.double_addons_count or 0) * t.double_addon_price
            )
        total_rake += gross_pot * (t.rake_percentage / 100)
    return total_rake


async def tournament_gross_pot_in_range(
    db: AsyncSession, club_id: int, start, end
) -> float:
    """Pozo BRUTO total recaudado por torneos COMPLETED en el rango (antes de rake).

    Usado para el KPI "Total Movido" (cuanta plata entro al club).
    Misma logica de singles/dobles que tournament_rake_in_range pero sin
    multiplicar por rake_percentage al final.
    """
    stmt = (
        select(models.Tournament)
        .options(selectinload(models.Tournament.players))
        .where(
            models.Tournament.club_id == club_id,
            models.Tournament.status == "COMPLETED",
            models.Tournament.end_time >= start,
            models.Tournament.end_time <= end,
        )
    )
    tournaments = (await db.execute(stmt)).scalars().all()

    total_gross = 0.0
    for t in tournaments:
        for p in t.players:
            single_rebuys = max(0, (p.rebuys_count or 0) - (p.double_rebuys_count or 0))
            single_addons = max(0, (p.addons_count or 0) - (p.double_addons_count or 0))
            total_gross += (
                t.buyin_amount
                + single_rebuys * t.rebuy_price
                + (p.double_rebuys_count or 0) * t.double_rebuy_price
                + single_addons * t.addon_price
                + (p.double_addons_count or 0) * t.double_addon_price
            )
    return total_gross


async def club_jackpot(db: AsyncSession, club: models.Club) -> int:
    """Saldo del jackpot del club: FUENTE ÚNICA DE VERDAD.

    entradas (jackpot declarado en los cierres de caja) − pagos de jackpot
    + ajuste manual del dueño. Es EXACTAMENTE el número que el staff ve en el
    widget de la mesa cash (StatsPanel), y ahora también el que ven jugadores
    en el link público y en su panel: no puede haber dos jackpots distintos.

    Solo suma sesiones CLOSED: el jackpot se declara al cerrar la caja, así que
    la mesa abierta de esta noche todavía no mueve el número.

    TENANT: `club` DEBE venir del server —get_current_club, user.club_id o
    _get_club_by_token—, JAMÁS de un payload: uno de los callers es público
    (sin auth) y esta función confía por completo en el club que recibe.

    Devuelve el saldo REAL (puede ser negativo si el dueño ajustó de más): el
    staff necesita verlo para corregir la caja. Las superficies de jugador
    (link público y panel) publican el número SOLO si es > 0 — jamás un
    "-$500.000" ni un "$0" en la cara del jugador.
    """
    total_income = (await db.execute(
        select(func.sum(models.Session.declared_jackpot_cash))
        .where(models.Session.status == "CLOSED", models.Session.club_id == club.id)
    )).scalar() or 0.0
    total_payouts = (await db.execute(
        select(func.sum(models.Transaction.amount))
        # onclause explícito (consistente con transactions.py): la FK es única
        # hoy, pero no dependemos de que siga siéndolo.
        .join(models.Session, models.Transaction.session_id == models.Session.id)
        .where(models.Transaction.type == models.TransactionType.JACKPOT_PAYOUT,
               models.Session.club_id == club.id)
    )).scalar() or 0.0
    # round, no int(): int() trunca hacia cero y los montos son Float.
    return round(total_income - total_payouts + (club.jackpot_adjustment or 0.0))


async def club_jackpot_public(db: AsyncSession, club: models.Club) -> int | None:
    """El jackpot TAL COMO SE LE MUESTRA AL JUGADOR (link público y panel).

    None = no mostrar la card. Se oculta si el club apagó el flag, si el saldo
    es 0 (un club que no maneja jackpot no debe publicar "🎰 $0") o si quedó
    negativo por un ajuste (jamás publicarle un saldo negativo al jugador; el
    staff sí lo ve en su widget para corregirlo).
    """
    if not club.show_jackpot:
        return None
    total = await club_jackpot(db, club)
    return total if total > 0 else None
