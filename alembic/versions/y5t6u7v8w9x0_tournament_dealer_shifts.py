"""dealer por mesa de torneo: tournament_dealer_shifts + tarifa de torneo (Fase 1b)

Revision ID: y5t6u7v8w9x0
Revises: x4s5t6u7v8w9
Create Date: 2026-06-30 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'y5t6u7v8w9x0'
down_revision: Union[str, Sequence[str], None] = 'x4s5t6u7v8w9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tarifa por hora de torneo del dealer (distinta a la de cash; sin %rake).
    op.execute("ALTER TABLE dealers ADD COLUMN IF NOT EXISTS tournament_hourly_rate_cop DOUBLE PRECISION NOT NULL DEFAULT 0.0")

    # Turno del dealer en una mesa de torneo.
    op.execute("""
        CREATE TABLE IF NOT EXISTS tournament_dealer_shifts (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
            table_id INTEGER NOT NULL REFERENCES tournament_tables(id),
            dealer_id INTEGER NOT NULL REFERENCES dealers(id),
            start_time TIMESTAMP NOT NULL DEFAULT now(),
            end_time TIMESTAMP,
            tournament_hourly_rate_cop DOUBLE PRECISION NOT NULL DEFAULT 0.0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_dealer_shifts_club_id ON tournament_dealer_shifts (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_dealer_shifts_tournament_id ON tournament_dealer_shifts (tournament_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_dealer_shifts_table_id ON tournament_dealer_shifts (table_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_dealer_shifts_dealer_id ON tournament_dealer_shifts (dealer_id)")
    # Un solo turno abierto por mesa de torneo.
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_dealer_shift_open ON tournament_dealer_shifts (table_id) WHERE end_time IS NULL")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tournament_dealer_shifts")
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS tournament_hourly_rate_cop")
