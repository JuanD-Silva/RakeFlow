"""add performance indexes on FK columns

Revision ID: a1b2c3d4e5f6
Revises: 8af0365c6e93
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '8af0365c6e93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_transactions_session_id ON transactions (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_transactions_player_id ON transactions (player_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_transactions_tournament_id ON transactions (tournament_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_transactions_session_type ON transactions (session_id, type)")

    op.execute("CREATE INDEX IF NOT EXISTS ix_players_club_id ON players (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sessions_club_id ON sessions (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournaments_club_id ON tournaments (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_distribution_rules_club_id ON distribution_rules (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_club_id ON users (club_id)")

    op.execute("CREATE INDEX IF NOT EXISTS ix_financial_distributions_session_id ON financial_distributions (session_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_players_tournament_id ON tournament_players (tournament_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tournament_players_player_id ON tournament_players (player_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tournament_players_player_id")
    op.execute("DROP INDEX IF EXISTS ix_tournament_players_tournament_id")
    op.execute("DROP INDEX IF EXISTS ix_financial_distributions_session_id")
    op.execute("DROP INDEX IF EXISTS ix_users_club_id")
    op.execute("DROP INDEX IF EXISTS ix_distribution_rules_club_id")
    op.execute("DROP INDEX IF EXISTS ix_tournaments_club_id")
    op.execute("DROP INDEX IF EXISTS ix_sessions_club_id")
    op.execute("DROP INDEX IF EXISTS ix_players_club_id")
    op.execute("DROP INDEX IF EXISTS ix_transactions_session_type")
    op.execute("DROP INDEX IF EXISTS ix_transactions_tournament_id")
    op.execute("DROP INDEX IF EXISTS ix_transactions_player_id")
    op.execute("DROP INDEX IF EXISTS ix_transactions_session_id")
