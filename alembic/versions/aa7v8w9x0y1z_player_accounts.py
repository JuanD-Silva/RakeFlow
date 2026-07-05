"""cuentas de jugador: rol PLAYER + players.user_id + players.stats_since

Panel del Jugador (PR1). El jugador entra por teléfono con OTP (patrón dealer).
stats_since es el corte del histórico: al activar la cuenta se setea a now()
(el jugador arranca de 0); el staff lo pone en NULL cuando el jugador compra
su histórico en caja. En clubes nuevos es un no-op (no hay data previa).

Revision ID: aa7v8w9x0y1z
Revises: z6u7v8w9x0y1
Create Date: 2026-07-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'aa7v8w9x0y1z'
down_revision: Union[str, Sequence[str], None] = 'z6u7v8w9x0y1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Vínculo 1:1 cuenta de usuario <-> ficha de jugador. Nullable: la mayoría
    # de los jugadores no tendrá cuenta. Único parcial = mismo patrón que
    # uq_dealers_user_id (o5j6k7l8m9n0).
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_players_user_id ON players (user_id) WHERE user_id IS NOT NULL")

    # Corte del histórico del panel: NULL = histórico completo desbloqueado
    # (pagó en caja, o club nuevo sin data previa); con fecha = las stats del
    # panel corren desde ahí. Se setea al activar la cuenta.
    op.execute("ALTER TABLE players ADD COLUMN IF NOT EXISTS stats_since TIMESTAMP")

    # Nuevo rol PLAYER. SQLAlchemy guarda el .name del enum => 'PLAYER' en
    # mayúscula, igual que 'DEALER' (o5j6k7l8m9n0). ADD VALUE corre dentro de
    # la transacción en PG12+ mientras no se use el valor en la misma tx.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'PLAYER'")


def downgrade() -> None:
    # El valor del enum no se puede quitar fácilmente en Postgres; solo
    # revertimos columnas/índice (aditivo).
    op.execute("DROP INDEX IF EXISTS uq_players_user_id")
    op.execute("ALTER TABLE players DROP COLUMN IF EXISTS user_id")
    op.execute("ALTER TABLE players DROP COLUMN IF EXISTS stats_since")
