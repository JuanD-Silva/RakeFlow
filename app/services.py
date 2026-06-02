from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from . import models


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
