"""multi-usuario: ampliar tabla users + auto-crear OWNER por cada Club

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Agregar valor CASHIER al enum userrole (idempotente, Postgres 12+)
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'CASHIER'")

    # 2. Ampliar columnas de users (todas aditivas)
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_token VARCHAR")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMP")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by_user_id INTEGER REFERENCES users(id)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    # hashed_password debe ser nullable (los invitados aun no tienen password)
    op.execute("ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL")

    # 3. Indices
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_unique ON users (email) WHERE email IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_invitation_token ON users (invitation_token)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_club_id ON users (club_id)")

    # 4. Auto-crear un User OWNER por cada Club existente que aun no tenga OWNER.
    #    Reusa el mismo email + hashed_password del Club para que el primer login
    #    siga funcionando con las credenciales actuales.
    op.execute("""
        INSERT INTO users (
            club_id, email, name, hashed_password, role, is_active, created_at
        )
        SELECT
            c.id,
            c.email,
            c.name,
            c.hashed_password,
            'OWNER'::userrole,
            TRUE,
            COALESCE(c.created_at, CURRENT_TIMESTAMP)
        FROM clubs c
        WHERE NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.club_id = c.id AND u.role = 'OWNER'::userrole
        )
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    # No revertir auto-creacion ni borrar columnas: aditivo.
    op.execute("DROP INDEX IF EXISTS ix_users_invitation_token")
    op.execute("DROP INDEX IF EXISTS ix_users_email_unique")
    # club_id index ya existia, no lo borramos
    # CASHIER value en enum no se puede quitar facilmente en Postgres
