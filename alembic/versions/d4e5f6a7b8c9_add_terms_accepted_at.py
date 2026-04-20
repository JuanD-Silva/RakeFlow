"""add terms_accepted_at to clubs

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS terms_accepted_at")
