"""rake neto + costo dealers + liquidaciones (dealer_payouts)

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-06-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'l2g3h4i5j6k7'
down_revision: Union[str, Sequence[str], None] = 'k1f2g3h4i5j6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Gastos del cierre + rake neto en sessions (aditivo, default 0 => regresión cero)
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS dealer_cost FLOAT DEFAULT 0")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS courtesy_cost FLOAT DEFAULT 0")
    op.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS net_rake FLOAT DEFAULT 0")

    # Ledger de liquidaciones a dealers
    op.execute("""
        CREATE TABLE IF NOT EXISTS dealer_payouts (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            dealer_id INTEGER NOT NULL REFERENCES dealers(id),
            amount FLOAT NOT NULL DEFAULT 0,
            method VARCHAR,
            note VARCHAR,
            period_start TIMESTAMP,
            period_end TIMESTAMP,
            paid_at TIMESTAMP NOT NULL DEFAULT now(),
            paid_by_user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_payouts_club_id ON dealer_payouts (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_payouts_dealer_id ON dealer_payouts (dealer_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS dealer_payouts")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS net_rake")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS courtesy_cost")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS dealer_cost")
