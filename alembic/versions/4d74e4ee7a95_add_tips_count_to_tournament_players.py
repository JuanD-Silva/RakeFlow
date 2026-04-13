"""add tips_count to tournament_players

Revision ID: 4d74e4ee7a95
Revises: 2ac100c2b022
Create Date: 2026-04-13 18:55:15.216106

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d74e4ee7a95'
down_revision: Union[str, Sequence[str], None] = '2ac100c2b022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Usar IF NOT EXISTS porque en dev la columna se agregó manualmente
    op.execute("ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS tips_count INTEGER DEFAULT 0")


def downgrade() -> None:
    op.drop_column('tournament_players', 'tips_count')
