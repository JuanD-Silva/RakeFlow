"""torneo: stack inicial de fichas (starting_stack)

Revision ID: s9n0o1p2q3r4
Revises: r8m9n0o1p2q3
Create Date: 2026-06-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 's9n0o1p2q3r4'
down_revision: Union[str, Sequence[str], None] = 'r8m9n0o1p2q3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: fichas iniciales del torneo (informativo, se muestra en la TV).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS starting_stack INTEGER DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS starting_stack")
