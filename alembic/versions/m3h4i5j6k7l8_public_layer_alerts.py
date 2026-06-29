"""capa pública del club + tokens + alertas dealer→staff

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-06-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'm3h4i5j6k7l8'
down_revision: Union[str, Sequence[str], None] = 'l2g3h4i5j6k7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Club: token público + anuncio (aditivo). Backfill con UUID para los clubes
    # existentes (PG17 trae gen_random_uuid()).
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS public_token VARCHAR")
    op.execute("ALTER TABLE clubs ADD COLUMN IF NOT EXISTS public_announcement VARCHAR")
    op.execute("UPDATE clubs SET public_token = replace(gen_random_uuid()::text, '-', '') WHERE public_token IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_clubs_public_token ON clubs (public_token)")

    # Session: token del link dealer (solo sesiones; backfill todas para que las
    # mesas ya abiertas tengan link válido).
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS public_token VARCHAR")
    op.execute("UPDATE sessions SET public_token = replace(gen_random_uuid()::text, '-', '') WHERE public_token IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_sessions_public_token ON sessions (public_token)")

    # Alertas dealer→staff
    op.execute("""
        CREATE TABLE IF NOT EXISTS dealer_alerts (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            alert_type VARCHAR NOT NULL,
            message VARCHAR,
            dealer_name VARCHAR,
            status VARCHAR NOT NULL DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT now(),
            resolved_at TIMESTAMP,
            resolved_by_user_id INTEGER REFERENCES users(id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_alerts_club_id ON dealer_alerts (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_alerts_session_id ON dealer_alerts (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_alerts_status ON dealer_alerts (status)")
    # Una sola alerta PENDING por (mesa, tipo): backstop anti-flood/race del
    # endpoint público (el atacante con el token no puede inundar la tabla).
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_dealer_alerts_pending ON dealer_alerts (session_id, alert_type) WHERE status = 'PENDING'")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS dealer_alerts")
    op.execute("DROP INDEX IF EXISTS ix_sessions_public_token")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS public_token")
    op.execute("DROP INDEX IF EXISTS ix_clubs_public_token")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS public_announcement")
    op.execute("ALTER TABLE clubs DROP COLUMN IF EXISTS public_token")
