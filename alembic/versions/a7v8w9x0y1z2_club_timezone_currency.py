"""Zona horaria y moneda por club (aditiva, defaults = Colombia)

Revision ID: a7v8w9x0y1z2
Revises: nn1d2e3f4g5h
Create Date: 2026-08-24
"""
from alembic import op

revision = "a7v8w9x0y1z2"
down_revision = "nn1d2e3f4g5h"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Aditiva e idempotente: todo club existente queda como Colombia.
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS timezone VARCHAR NOT NULL DEFAULT 'America/Bogota'")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS currency VARCHAR NOT NULL DEFAULT 'COP'")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS locale VARCHAR NOT NULL DEFAULT 'es-CO'")


def downgrade() -> None:
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS timezone")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS currency")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS locale")
