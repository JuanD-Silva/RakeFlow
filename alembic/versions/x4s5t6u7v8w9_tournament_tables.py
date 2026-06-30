"""mesas de torneo: tabla tournament_tables + table_id/seat_number en players (Fase 1a)

Revision ID: x4s5t6u7v8w9
Revises: w3r4s5t6u7v8
Create Date: 2026-06-30 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'x4s5t6u7v8w9'
down_revision: Union[str, Sequence[str], None] = 'w3r4s5t6u7v8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente. Mesas físicas de un torneo + asiento del jugador.
    op.execute("""
        CREATE TABLE IF NOT EXISTS tournament_tables (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id),
            table_number INTEGER NOT NULL,
            max_seats INTEGER DEFAULT 9,
            status VARCHAR DEFAULT 'OPEN',
            public_token VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_tables_club_id ON tournament_tables (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_tables_tournament_id ON tournament_tables (tournament_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_tables_public_token ON tournament_tables (public_token) WHERE public_token IS NOT NULL")

    op.execute("ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES tournament_tables(id)")
    op.execute("ALTER TABLE tournament_players ADD COLUMN IF NOT EXISTS seat_number INTEGER")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_players_table_id ON tournament_players (table_id)")
    # Un solo jugador ACTIVE por (mesa, asiento): evita asientos duplicados bajo
    # concurrencia (la segunda escritura choca → 409, no corrompe el estado).
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_player_seat
        ON tournament_players (table_id, seat_number)
        WHERE status = 'ACTIVE' AND table_id IS NOT NULL AND seat_number IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_tournament_player_seat")
    op.execute("DROP INDEX IF EXISTS ix_tournament_players_table_id")
    op.execute("ALTER TABLE tournament_players DROP COLUMN IF EXISTS seat_number")
    op.execute("ALTER TABLE tournament_players DROP COLUMN IF EXISTS table_id")
    op.execute("DROP TABLE IF EXISTS tournament_tables")
