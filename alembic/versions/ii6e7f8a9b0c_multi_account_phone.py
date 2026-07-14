"""multi-cuenta: el teléfono deja de ser único global; ahora (teléfono, club, rol)

Revision ID: ii6e7f8a9b0c
Revises: hh5d6e7f8a9b
Create Date: 2026-07-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'ii6e7f8a9b0c'
down_revision: Union[str, Sequence[str], None] = 'hh5d6e7f8a9b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Una PERSONA (teléfono) puede tener varias cuentas: jugador y dealer del
    # mismo club, o jugador en dos clubes. Lo que no puede repetirse es la misma
    # membresía: (teléfono, club, rol). Idempotente.
    op.execute("DROP INDEX IF EXISTS uq_users_phone")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_club_role "
        "ON users (phone, club_id, role) WHERE phone IS NOT NULL"
    )


def downgrade() -> None:
    # Volver a "un teléfono = una cuenta" exige que no haya teléfonos repetidos;
    # si los hay (ya se crearon multi-cuentas), este CREATE falla por diseño.
    op.execute("DROP INDEX IF EXISTS uq_users_phone_club_role")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone "
        "ON users (phone) WHERE phone IS NOT NULL"
    )
