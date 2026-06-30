"""torneo: fichas por jugada (rebuy/addon/tip) para el stack promedio

Revision ID: v2q3r4s5t6u7
Revises: u1p2q3r4s5t6
Create Date: 2026-06-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'v2q3r4s5t6u7'
down_revision: Union[str, Sequence[str], None] = 'u1p2q3r4s5t6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: fichas (no plata) que suma cada jugada al stack del jugador. Sirven
    # para el stack promedio. Default 0 = no suma fichas (comportamiento previo).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rebuy_chips INTEGER DEFAULT 0")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS double_rebuy_chips INTEGER DEFAULT 0")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS addon_chips INTEGER DEFAULT 0")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS double_addon_chips INTEGER DEFAULT 0")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tip_chips INTEGER DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS tip_chips")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS double_addon_chips")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS addon_chips")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS double_rebuy_chips")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS rebuy_chips")
