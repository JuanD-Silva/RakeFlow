"""reto rotativo mensual: tabla monthly_challenges (PR7 retención)

Revision ID: bb8w9x0y1z2a
Revises: aa7v8w9x0y1z
Create Date: 2026-07-05 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'bb8w9x0y1z2a'
down_revision: Union[str, Sequence[str], None] = 'aa7v8w9x0y1z'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente. Reto rotativo del mes por club.
    op.execute("""
        CREATE TABLE IF NOT EXISTS monthly_challenges (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            title VARCHAR NOT NULL,
            description VARCHAR,
            metric VARCHAR NOT NULL,
            target DOUBLE PRECISION NOT NULL,
            reward_text VARCHAR,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_monthly_challenges_club_id ON monthly_challenges (club_id)")
    # Un solo reto ACTIVO por (club, año, mes): re-crear pisa el anterior desde
    # el endpoint del staff (upsert), no por doble insert concurrente.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_challenge_active
        ON monthly_challenges (club_id, year, month)
        WHERE active = TRUE
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS monthly_challenges")
