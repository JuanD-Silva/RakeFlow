"""dealers por teléfono: users.phone + phone_verified, email nullable

Revision ID: p6k7l8m9n0o1
Revises: o5j6k7l8m9n0
Create Date: 2026-06-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'p6k7l8m9n0o1'
down_revision: Union[str, Sequence[str], None] = 'o5j6k7l8m9n0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Login del dealer por teléfono (sin email). Los dealers se invitan/verifican
    # por WhatsApp con un código; su número es la identidad.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE")
    # Lockout anti-fuerza-bruta del código OTP, por teléfono (no por IP).
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_attempts INTEGER DEFAULT 0")
    # Único parcial: un teléfono por cuenta, sin chocar con los muchos users sin
    # teléfono (email-based). NULL no colisiona.
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users (phone) WHERE phone IS NOT NULL")
    # El email deja de ser obligatorio (los dealers no tienen). El índice único de
    # email permite múltiples NULL en Postgres, así que no hay colisión.
    op.execute("ALTER TABLE users ALTER COLUMN email DROP NOT NULL")


def downgrade() -> None:
    # No re-imponemos email NOT NULL (podría haber dealers sin email). Aditivo.
    op.execute("DROP INDEX IF EXISTS uq_users_phone")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS invitation_attempts")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS phone_verified")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS phone")
