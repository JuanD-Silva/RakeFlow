"""show_jackpot: el club decide si expone el jackpot a los jugadores

Revision ID: hh5d6e7f8a9b
Revises: gg4c5d6e7f8a
Create Date: 2026-07-13 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'hh5d6e7f8a9b'
down_revision: Union[str, Sequence[str], None] = 'gg4c5d6e7f8a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotente. DEFAULT TRUE: el jackpot es el gancho del club y los
    # jugadores lo piden; el que no quiera exponerlo lo apaga desde Config.
    op.execute(
        "ALTER TABLE clubs ADD COLUMN IF NOT EXISTS show_jackpot "
        "BOOLEAN NOT NULL DEFAULT TRUE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS show_jackpot")
