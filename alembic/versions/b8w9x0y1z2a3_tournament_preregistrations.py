"""Pre-inscripción pública a torneos + cupo (aditiva)

Revision ID: b8w9x0y1z2a3
Revises: a7v8w9x0y1z2
Create Date: 2026-11-06
"""
from alembic import op

revision = "b8w9x0y1z2a3"
down_revision = "a7v8w9x0y1z2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Aditiva e idempotente. Cupo NULL = sin límite (todos los torneos existentes).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_entries INTEGER")

    op.execute("""
        CREATE TABLE IF NOT EXISTS tournament_preregistrations (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            name VARCHAR NOT NULL,
            phone VARCHAR NOT NULL,
            status VARCHAR NOT NULL DEFAULT 'PENDING',
            player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
            confirmed_at TIMESTAMP,
            cancelled_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_preregistrations_id ON tournament_preregistrations (id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_preregistrations_club_id ON tournament_preregistrations (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_preregistrations_tournament_id ON tournament_preregistrations (tournament_id)")
    # Un teléfono, una pre-inscripción viva por torneo.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_prereg_phone "
        "ON tournament_preregistrations (tournament_id, phone) WHERE status != 'CANCELLED'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tournament_preregistrations")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS max_entries")
