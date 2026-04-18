"""add BUST value to transactiontype enum

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres 12+ permite ADD VALUE dentro de transaccion con IF NOT EXISTS.
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'BUST'")


def downgrade() -> None:
    # Postgres no soporta DROP VALUE de un enum de forma directa.
    # Downgrade intencionalmente vacio.
    pass
