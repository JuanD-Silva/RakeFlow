"""torneo: scheduled_start (torneos programados)

Revision ID: u1p2q3r4s5t6
Revises: t0o1p2q3r4s5
Create Date: 2026-06-29 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'u1p2q3r4s5t6'
down_revision: Union[str, Sequence[str], None] = 't0o1p2q3r4s5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: fecha/hora de inicio programado. NULL = no programado. Los torneos
    # con scheduled_start se crean con status 'SCHEDULED' (no cuentan como activo).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS scheduled_start")
