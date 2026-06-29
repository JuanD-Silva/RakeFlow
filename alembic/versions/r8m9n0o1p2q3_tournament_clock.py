"""reloj de torneo: estructura de blinds, nivel actual, estado del reloj + public_token

Revision ID: r8m9n0o1p2q3
Revises: q7l8m9n0o1p2
Create Date: 2026-06-29 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'r8m9n0o1p2q3'
down_revision: Union[str, Sequence[str], None] = 'q7l8m9n0o1p2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: reloj/niveles de torneo (T3). Todo nullable/default para no tocar
    # los torneos existentes (siguen sin reloj hasta que se les arranque).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS blind_structure JSON DEFAULT '[]'")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS current_level INTEGER DEFAULT 1")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS clock_status VARCHAR DEFAULT 'STOPPED'")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS level_started_at TIMESTAMP")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS clock_elapsed_seconds INTEGER DEFAULT 0")
    # Token del link público de la vista TV (rakeflow.site/torneo/{public_token}/tv).
    # Backfill para los torneos existentes (PG17 trae gen_random_uuid()).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS public_token VARCHAR")
    op.execute("UPDATE tournaments SET public_token = replace(gen_random_uuid()::text, '-', '') WHERE public_token IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_tournaments_public_token ON tournaments (public_token)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tournaments_public_token")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS public_token")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS clock_elapsed_seconds")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS level_started_at")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS clock_status")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS current_level")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS blind_structure")
