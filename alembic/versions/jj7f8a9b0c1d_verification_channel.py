"""users.verification_channel: canal de la invitación (twilio | manual)

Revision ID: jj7f8a9b0c1d
Revises: ii6e7f8a9b0c
Create Date: 2026-07-15 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'jj7f8a9b0c1d'
down_revision: Union[str, Sequence[str], None] = 'ii6e7f8a9b0c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL = manual (código local + wa.me), que es todo lo existente y el plan B.
    # Idempotente. Sin server_default: lo pone la capa de app al invitar.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_channel VARCHAR")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS verification_channel")
