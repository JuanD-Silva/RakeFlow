"""Passkeys (huella/cara) para jugadores (aditiva)

Revision ID: c9x0y1z2a3b4
Revises: b8w9x0y1z2a3
Create Date: 2026-11-08
"""
from alembic import op

revision = "c9x0y1z2a3b4"
down_revision = "b8w9x0y1z2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Aditiva e idempotente: dos tablas nuevas, nada existente cambia.
    op.execute("""
        CREATE TABLE IF NOT EXISTS passkey_credentials (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id VARCHAR NOT NULL,
            public_key VARCHAR NOT NULL,
            sign_count BIGINT NOT NULL DEFAULT 0,
            transports VARCHAR,
            device_label VARCHAR,
            opens JSON NOT NULL DEFAULT '[]',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            last_used_at TIMESTAMP
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_passkey_credentials_id ON passkey_credentials (id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_passkey_credentials_user_id ON passkey_credentials (user_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_passkey_credentials_credential_id ON passkey_credentials (credential_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS passkey_challenges (
            id SERIAL PRIMARY KEY,
            challenge VARCHAR NOT NULL UNIQUE,
            purpose VARCHAR NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            opens JSON,
            expires_at TIMESTAMP NOT NULL
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_passkey_challenges_id ON passkey_challenges (id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_passkey_challenges_expires_at ON passkey_challenges (expires_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS passkey_challenges")
    op.execute("DROP TABLE IF EXISTS passkey_credentials")
