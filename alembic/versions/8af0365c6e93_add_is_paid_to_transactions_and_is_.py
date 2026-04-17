"""add is_paid to transactions and is_buyin_paid to tournament_players

Revision ID: 8af0365c6e93
Revises: 4d74e4ee7a95
Create Date: 2026-04-15 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8af0365c6e93'
down_revision: Union[str, Sequence[str], None] = '4d74e4ee7a95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE transactions ALTER COLUMN is_paid SET DEFAULT FALSE")
    op.execute("ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS is_buyin_paid BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE tournament_players ALTER COLUMN is_buyin_paid SET DEFAULT FALSE")


def downgrade() -> None:
    op.drop_column('tournament_players', 'is_buyin_paid')
    op.drop_column('transactions', 'is_paid')
