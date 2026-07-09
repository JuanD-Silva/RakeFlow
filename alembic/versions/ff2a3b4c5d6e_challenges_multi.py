"""retos múltiples: quitar índice único de 1-reto-activo-por-mes

Revision ID: ff2a3b4c5d6e
Revises: ee1z2a3b4c5d
Create Date: 2026-07-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'ff2a3b4c5d6e'
down_revision: Union[str, Sequence[str], None] = 'ee1z2a3b4c5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Hasta 3 retos activos por (club, mes): quitamos el índice único parcial que
    # imponía uno solo. El tope de 3 lo aplica la capa de aplicación (schema +
    # reemplazo en bloque con advisory lock). Idempotente.
    op.execute("DROP INDEX IF EXISTS uq_monthly_challenge_active")


def downgrade() -> None:
    # Reponer el índice único parcial exige que no haya >1 activo por (club, mes);
    # si los hay, este create fallará (por diseño: el downgrade asume set válido).
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_challenge_active "
        "ON monthly_challenges (club_id, year, month) WHERE active = TRUE"
    )
