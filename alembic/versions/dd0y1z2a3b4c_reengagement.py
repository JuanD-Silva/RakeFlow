"""experimento de reactivación: players.reengagement_group + qualified_at (PR9)

Revision ID: dd0y1z2a3b4c
Revises: cc9x0y1z2a3b
Create Date: 2026-07-06 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'dd0y1z2a3b4c'
down_revision: Union[str, Sequence[str], None] = 'cc9x0y1z2a3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente. Experimento de reactivación con grupo de control:
    # - reengagement_group: 'treatment' | 'control' (NULL = todavía no calificó).
    #   Estable una vez asignado → no re-balancear (invalidaría el experimento).
    # - reengagement_qualified_at: primera vez que el jugador entró al pool de
    #   inactivos (baseline para medir el retorno post-mensaje vs control).
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS reengagement_group VARCHAR")
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS reengagement_qualified_at TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE players DROP COLUMN IF EXISTS reengagement_qualified_at")
    op.execute("ALTER TABLE players DROP COLUMN IF EXISTS reengagement_group")
