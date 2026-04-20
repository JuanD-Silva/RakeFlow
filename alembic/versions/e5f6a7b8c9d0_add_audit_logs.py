"""add audit_logs table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-20 00:02:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id),
            actor_type VARCHAR NOT NULL DEFAULT 'CLUB',
            actor_id INTEGER,
            actor_email VARCHAR,
            action VARCHAR NOT NULL,
            entity_type VARCHAR,
            entity_id INTEGER,
            meta JSONB,
            ip VARCHAR,
            user_agent VARCHAR,
            request_id VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_club_id ON audit_logs (club_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_request_id ON audit_logs (request_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_club_created ON audit_logs (club_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_logs")
