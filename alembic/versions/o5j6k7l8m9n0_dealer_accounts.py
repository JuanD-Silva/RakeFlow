"""cuentas de dealer: dealers.user_id (vínculo 1:1 con users) + rol DEALER

Revision ID: o5j6k7l8m9n0
Revises: n4i5j6k7l8m9
Create Date: 2026-06-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'o5j6k7l8m9n0'
down_revision: Union[str, Sequence[str], None] = 'n4i5j6k7l8m9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Vínculo 1:1 cuenta de usuario <-> dealer de nómina. Nullable: los dealers
    # sin cuenta quedan con user_id NULL. El único parcial fuerza el 1:1 sin
    # chocar con los muchos dealers sin cuenta (mismo patrón que
    # uq_dealer_alerts_pending).
    op.execute("ALTER TABLE dealers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_dealers_user_id ON dealers (user_id) WHERE user_id IS NOT NULL")

    # Nuevo rol DEALER. SQLAlchemy guarda el .name del enum => valor en MAYÚSCULA
    # ('DEALER'), igual que 'CASHIER' (ver f6a7b8c9d0e1). ADD VALUE corre dentro
    # de la transacción en PG12+ mientras no se USE el valor en la misma tx
    # (acá no se usa). Idempotente.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'DEALER'")


def downgrade() -> None:
    # El valor del enum no se puede quitar fácilmente en Postgres; solo revertimos
    # la columna/índice (aditivo).
    op.execute("DROP INDEX IF EXISTS uq_dealers_user_id")
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS user_id")
