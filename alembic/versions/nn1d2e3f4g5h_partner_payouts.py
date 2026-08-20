"""ledger del reparto a socios: tabla partner_payouts

Revision ID: nn1d2e3f4g5h
Revises: mm0c1d2e3f4g
Create Date: 2026-08-20 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'nn1d2e3f4g5h'
down_revision: Union[str, Sequence[str], None] = 'mm0c1d2e3f4g'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditiva e idempotente: ledger de "ya le entregué la plata al socio"
    # (espejo de dealer_payouts). No mueve caja: solo registro.
    op.execute("""
        CREATE TABLE IF NOT EXISTS partner_payouts (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            beneficiary_name VARCHAR NOT NULL,
            rule_id INTEGER REFERENCES distribution_rules(id),
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            amount INTEGER NOT NULL,
            method VARCHAR DEFAULT 'cash',
            note VARCHAR,
            created_by_user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_partner_payouts_club_id ON partner_payouts (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_partner_payouts_period_start ON partner_payouts (period_start)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS partner_payouts")
