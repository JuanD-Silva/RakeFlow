"""propinas asignables a un dealer: transactions.dealer_id

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-06-12 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'k1f2g3h4i5j6'
down_revision: Union[str, Sequence[str], None] = 'j0e1f2g3h4i5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS dealer_id INTEGER REFERENCES dealers(id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_transactions_dealer_id ON transactions (dealer_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_transactions_dealer_id")
    op.execute("ALTER TABLE transactions DROP COLUMN IF EXISTS dealer_id")
