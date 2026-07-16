"""dealer_payouts.session_id: pago de dealer ligado a la mesa donde se le pagó

Revision ID: ll9b0c1d2e3f
Revises: kk8a9b0c1d2e
Create Date: 2026-07-15 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'll9b0c1d2e3f'
# Re-encadenada a kk (self_registered_at, del PR #89 ya en main) para que la
# cadena quede lineal jj → kk → ll y Alembic tenga un solo head.
down_revision: Union[str, Sequence[str], None] = 'kk8a9b0c1d2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente: un pago (DealerPayout) puede quedar ligado a la mesa
    # (sesión) donde se le pagó al dealer, para el control por-mesa en la mesa
    # activa. NULL = pago general por rango (liquidación de Reportes, como hoy).
    op.execute("ALTER TABLE dealer_payouts ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES sessions(id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_dealer_payouts_session_id ON dealer_payouts (session_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_dealer_payouts_session_id")
    op.execute("ALTER TABLE dealer_payouts DROP COLUMN IF EXISTS session_id")
