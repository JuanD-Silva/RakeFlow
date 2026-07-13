"""push_subscriptions: suscripciones Web Push del panel del jugador

Revision ID: gg4c5d6e7f8a
Revises: ff2a3b4c5d6e
Create Date: 2026-07-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'gg4c5d6e7f8a'
down_revision: Union[str, Sequence[str], None] = 'ff2a3b4c5d6e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotente: create_all del startup puede haberla creado ya (y viceversa:
    # en Railway alembic corre ANTES de uvicorn, así que normalmente la crea acá).
    # Timestamps naive-UTC como el resto del schema; el default de created_at lo
    # pone el ORM (datetime.utcnow) — el DEFAULT en DDL es solo red de seguridad
    # para inserts manuales.
    op.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            endpoint VARCHAR NOT NULL,
            p256dh VARCHAR NOT NULL,
            auth VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_push_subscriptions_endpoint "
        "ON push_subscriptions (endpoint)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_club_id "
        "ON push_subscriptions (club_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id "
        "ON push_subscriptions (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_subscriptions")
