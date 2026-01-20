from decimal import Decimal, ROUND_HALF_UP

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