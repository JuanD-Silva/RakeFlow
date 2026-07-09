"""reto escalonado: columna tiers (JSON) en monthly_challenges

Revision ID: ee1z2a3b4c5d
Revises: dd0y1z2a3b4c
Create Date: 2026-07-09 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'ee1z2a3b4c5d'
down_revision: Union[str, Sequence[str], None] = 'dd0y1z2a3b4c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo e idempotente. Reto escalonado: una lista de tramos
    # [{"target": n, "reward": str|null, "reward_vip": str|null}, ...] ordenada
    # ascendente por target. NULL => reto de meta única (comportamiento previo,
    # sigue usando las columnas target/reward_text).
    op.execute(
        "ALTER TABLE monthly_challenges ADD COLUMN IF NOT EXISTS tiers JSON"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE monthly_challenges DROP COLUMN IF EXISTS tiers")
