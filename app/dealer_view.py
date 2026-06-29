"""Helpers compartidos por la vista del dealer: el link público anónimo
(app/routers/public.py) y la vista autenticada (app/routers/dealer_self.py).

Tener una sola fuente evita que ambas superficies se desincronicen (mismo
formato de jugador, mismo fix de timezone)."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text

from . import models

# Tipos de alerta dealer→staff (compartido por link público y vista autenticada).
ALERT_TYPES = {"CHIPS", "WAITER", "MANAGER", "URGENT"}


def shift_hours(start, end=None) -> float:
    """Horas de un turno con la MISMA granularidad que el cierre/liquidación:
    se trunca a minutos enteros y luego se redondea a 2 decimales. Fuente única
    para que el pago del portal del dealer cuadre exacto con lo que liquida el
    cajero (ver _shift_to_dict en routers/dealers.py)."""
    end = end or datetime.utcnow()
    elapsed_minutes = max(0, int((end - start).total_seconds() // 60))
    return round(elapsed_minutes / 60.0, 2)


def utc_iso(dt) -> Optional[str]:
    """ISO con offset UTC (+00:00). Los timestamps se guardan como UTC naïve
    (datetime.utcnow); sin el offset, el front los parsea como hora local y el
    cálculo de tiempo en mesa sale mal (negativo => 0m para activos)."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat()


async def current_dealer_name(db: AsyncSession, session_id: int) -> Optional[str]:
    """Nombre del dealer con turno abierto (end_time NULL) en la sesión."""
    row = (await db.execute(
        select(models.Dealer.name)
        .join(models.DealerShift, models.DealerShift.dealer_id == models.Dealer.id)
        .where(
            models.DealerShift.session_id == session_id,
            models.DealerShift.end_time.is_(None),
        )
    )).first()
    return row[0] if row else None


async def session_players(db: AsyncSession, session_id: int) -> list[dict]:
    """Jugadores sentados en la mesa.
    seated_at = primer buy-in (arranca su reloj de tiempo en mesa);
    busted_at = BUST (congela el reloj, baja el conteo y libera el cupo)."""
    rows = (await db.execute(text("""
        SELECT p.id, p.name,
            MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) AS seated_at,
            MAX(CASE WHEN CAST(t.type AS TEXT) = 'BUST' THEN t.timestamp END) AS busted_at
        FROM players p
        JOIN transactions t ON p.id = t.player_id
        WHERE t.session_id = :sid
        GROUP BY p.id, p.name
        HAVING MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END) IS NOT NULL
        ORDER BY MIN(CASE WHEN CAST(t.type AS TEXT) IN ('BUYIN','REBUY') THEN t.timestamp END)
    """), {"sid": session_id})).fetchall()
    return [{
        "player_id": r.id,
        "name": r.name,
        "seated_at": utc_iso(r.seated_at),
        "busted_at": utc_iso(r.busted_at),
        "is_busted": r.busted_at is not None,
    } for r in rows]
