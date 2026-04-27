"""wompi: campos de suscripcion en clubs

Revision ID: h8c9d0e1f2g3
Revises: g7b8c9d0e1f2
Create Date: 2026-04-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'h8c9d0e1f2g3'
down_revision: Union[str, Sequence[str], None] = 'g7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS wompi_payment_source_id INTEGER")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS wompi_customer_email VARCHAR")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS wompi_card_brand VARCHAR")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS wompi_card_last4 VARCHAR")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS subscription_period_end")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS wompi_card_last4")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS wompi_card_brand")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS wompi_customer_email")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS wompi_payment_source_id")
