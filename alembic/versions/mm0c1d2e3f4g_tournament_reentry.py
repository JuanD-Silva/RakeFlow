"""re-entrada de torneo: tournament_players.entries_count

Revision ID: mm0c1d2e3f4g
Revises: ll9b0c1d2e3f
Create Date: 2026-08-18 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'mm0c1d2e3f4g'
down_revision: Union[str, Sequence[str], None] = 'll9b0c1d2e3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente: entradas pagadas al pozo (1 normal, +1 por cada
    # re-entrada de un eliminado). Backfill implícito: DEFAULT 1 = lo que ya
    # asumía el cálculo del pozo (una entrada por inscrito).
    op.execute("ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS entries_count INTEGER NOT NULL DEFAULT 1")


def downgrade() -> None:
    op.execute("ALTER TABLE tournament_players DROP COLUMN IF EXISTS entries_count")
