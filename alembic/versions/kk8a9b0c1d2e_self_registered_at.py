"""players.self_registered_at: el jugador reclamó su panel solo (QR self-service)

Revision ID: kk8a9b0c1d2e
Revises: jj7f8a9b0c1d
Create Date: 2026-07-15 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'kk8a9b0c1d2e'
down_revision: Union[str, Sequence[str], None] = 'jj7f8a9b0c1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente: marca la ficha cuya cuenta de panel nació de un
    # auto-registro por QR (no de una invitación del staff). NULL = vino por el
    # flujo normal (invitación o ficha creada en mesa). Sirve al staff para ver
    # el canal de adquisición en el CRM.
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS self_registered_at TIMESTAMP WITHOUT TIME ZONE")


def downgrade() -> None:
    op.execute("ALTER TABLE players DROP COLUMN IF EXISTS self_registered_at")
