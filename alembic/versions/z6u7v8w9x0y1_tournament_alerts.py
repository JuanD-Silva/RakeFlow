"""alertas del dealer en mesas de torneo: dealer_alerts.tournament_table_id

Revision ID: z6u7v8w9x0y1
Revises: y5t6u7v8w9x0
Create Date: 2026-07-01 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'z6u7v8w9x0y1'
down_revision: Union[str, Sequence[str], None] = 'y5t6u7v8w9x0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: las alertas pueden venir de una mesa de torneo. session_id pasa a
    # nullable (una alerta es de cash O de torneo). Idempotente.
    op.execute("ALTER TABLE dealer_alerts ALTER COLUMN session_id DROP NOT NULL")
    op.execute("ALTER TABLE dealer_alerts ADD COLUMN IF NOT EXISTS tournament_table_id INTEGER REFERENCES tournament_tables(id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_alerts_tournament_table_id ON dealer_alerts (tournament_table_id)")
    # Anti-flood para torneo: una sola PENDING por (mesa de torneo, tipo).
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dealer_alerts_pending_ttable
        ON dealer_alerts (tournament_table_id, alert_type)
        WHERE status = 'PENDING' AND tournament_table_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dealer_alerts_pending_ttable")
    op.execute("DROP INDEX IF EXISTS ix_dealer_alerts_tournament_table_id")
    op.execute("ALTER TABLE dealer_alerts DROP COLUMN IF EXISTS tournament_table_id")
    # No restauramos NOT NULL en session_id (habría filas de torneo con NULL).
