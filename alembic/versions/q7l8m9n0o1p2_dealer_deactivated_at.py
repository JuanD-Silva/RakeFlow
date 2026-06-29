"""dealers.deactivated_at: marca cuándo se desactivó (purga a 60 días)

Revision ID: q7l8m9n0o1p2
Revises: p6k7l8m9n0o1
Create Date: 2026-06-29 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'q7l8m9n0o1p2'
down_revision: Union[str, Sequence[str], None] = 'p6k7l8m9n0o1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Momento de desactivación: se setea al desactivar, se limpia al reactivar.
    # La purga automática borra dealers sin historial desactivados hace +60 días.
    op.execute("ALTER TABLE dealers ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS deactivated_at")
