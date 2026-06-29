"""torneo: ventanas de rebuy/addon (disponibles hasta nivel N)

Revision ID: t0o1p2q3r4s5
Revises: s9n0o1p2q3r4
Create Date: 2026-06-29 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 't0o1p2q3r4s5'
down_revision: Union[str, Sequence[str], None] = 's9n0o1p2q3r4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Aditivo: nivel hasta el cual están disponibles rebuys/addons. NULL = sin
    # límite (comportamiento actual). Nullable, sin default -> no toca torneos
    # existentes (siguen sin ventana).
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rebuy_until_level INTEGER")
    op.execute("ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS addon_until_level INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS addon_until_level")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS rebuy_until_level")
