"""sessions.max_players: capacidad de asientos (cupos en link público)

Revision ID: n4i5j6k7l8m9
Revises: m3h4i5j6k7l8
Create Date: 2026-06-28 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'n4i5j6k7l8m9'
down_revision: Union[str, Sequence[str], None] = 'm3h4i5j6k7l8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: capacidad de asientos por mesa. Backfill a 9 (mesa de poker estándar)
    # para las sesiones ya existentes.
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_players INTEGER DEFAULT 9")
    op.execute("UPDATE sessions SET max_players = 9 WHERE max_players IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS max_players")
