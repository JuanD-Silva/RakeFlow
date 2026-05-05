"""add subscription_price_cop for grandfather pricing

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-04-29 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'i9d0e1f2g3h4'
down_revision: Union[str, Sequence[str], None] = 'h8c9d0e1f2g3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS subscription_price_cop INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS subscription_price_cop")
