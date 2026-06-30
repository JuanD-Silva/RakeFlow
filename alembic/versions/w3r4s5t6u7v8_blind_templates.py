"""biblioteca de estructuras de blinds: tabla blind_templates (PR3)

Revision ID: w3r4s5t6u7v8
Revises: v2q3r4s5t6u7
Create Date: 2026-06-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'w3r4s5t6u7v8'
down_revision: Union[str, Sequence[str], None] = 'v2q3r4s5t6u7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente: plantillas de blinds propias por club. Los presets
    # fijos son constantes en código (no filas), así que esta tabla solo guarda
    # las del club. No toca plata.
    op.execute("""
        CREATE TABLE IF NOT EXISTS blind_templates (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            name VARCHAR NOT NULL,
            blind_structure JSON DEFAULT '[]'::json,
            starting_stack INTEGER DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_blind_templates_club_id ON blind_templates (club_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS blind_templates")
