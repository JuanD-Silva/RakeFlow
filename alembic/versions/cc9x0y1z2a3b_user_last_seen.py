"""medición de retención: users.last_seen_at (PR8)

Revision ID: cc9x0y1z2a3b
Revises: bb8w9x0y1z2a
Create Date: 2026-07-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'cc9x0y1z2a3b'
down_revision: Union[str, Sequence[str], None] = 'bb8w9x0y1z2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente. Última apertura del panel (rol PLAYER): sirve de
    # throttle diario del evento PANEL_OPEN y de señal "último visto" para
    # segmentar inactivos (reutilizable en el re-engagement de PR9).
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at")
