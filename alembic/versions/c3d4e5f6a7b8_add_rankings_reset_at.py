"""add rankings_reset_at to clubs

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-18 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS rankings_reset_at TIMESTAMP NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS rankings_reset_at")
