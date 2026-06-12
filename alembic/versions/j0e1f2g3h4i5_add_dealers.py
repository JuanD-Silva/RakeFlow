"""add dealers and dealer_shifts (modulo de dealers en mesa cash)

Revision ID: j0e1f2g3h4i5
Revises: i9d0e1f2g3h4
Create Date: 2026-06-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'j0e1f2g3h4i5'
down_revision: Union[str, Sequence[str], None] = 'i9d0e1f2g3h4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS dealers (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            name VARCHAR NOT NULL,
            phone VARCHAR,
            hourly_rate_cop FLOAT NOT NULL DEFAULT 0,
            rake_pct FLOAT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealers_club_id ON dealers (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealers_name ON dealers (name)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS dealer_shifts (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            dealer_id INTEGER NOT NULL REFERENCES dealers(id),
            start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            end_time TIMESTAMP,
            declared_rake FLOAT,
            hourly_rate_cop FLOAT NOT NULL DEFAULT 0,
            rake_pct FLOAT NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_shifts_club_id ON dealer_shifts (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_shifts_session_id ON dealer_shifts (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_shifts_dealer_id ON dealer_shifts (dealer_id)")
    # Garantiza un solo turno abierto por mesa (red de seguridad contra races)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dealer_shifts_open_per_session
        ON dealer_shifts (session_id) WHERE end_time IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS dealer_shifts")
    op.execute("DROP TABLE IF EXISTS dealers")
