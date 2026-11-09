"""Libro de pagos de suscripción (idempotencia de la plata) — aditiva

Revision ID: d0y1z2a3b4c5
Revises: b8w9x0y1z2a3
Create Date: 2026-11-09
"""
from alembic import op

revision = "d0y1z2a3b4c5"
down_revision = "b8w9x0y1z2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS subscription_payments (
            id SERIAL PRIMARY KEY,
            club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
            reference VARCHAR NOT NULL,
            provider_tx_id VARCHAR,
            kind VARCHAR NOT NULL,
            status VARCHAR NOT NULL,
            amount_cop INTEGER,
            period_key VARCHAR,
            period_end_applied TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_reference ON subscription_payments (reference)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_provider_tx ON subscription_payments (provider_tx_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_subscription_payments_club_id ON subscription_payments (club_id)")
    # Un intento vivo (PENDING o APPROVED) por club y vencimiento: dos corridas
    # del cron no pueden reservar el mismo periodo.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_payments_renew_period "
        "ON subscription_payments (club_id, period_key) "
        "WHERE kind = 'renew' AND status IN ('PENDING', 'APPROVED')"
    )

    # Backfill: los pagos ya aplicados (audit_logs) quedan registrados, para que
    # una transacción vieja no pueda volver a sumar días vía /wompi/confirm.
    op.execute("""
        INSERT INTO subscription_payments (club_id, reference, provider_tx_id, kind, status, amount_cop, created_at, updated_at)
        SELECT DISTINCT ON (a.meta->>'transaction_id')
            a.club_id,
            COALESCE(NULLIF(a.meta->>'reference', ''), 'legacy-' || (a.meta->>'transaction_id')),
            a.meta->>'transaction_id',
            'legacy',
            'APPROVED',
            NULLIF(a.meta->>'amount_cop', '')::numeric::integer,
            a.created_at,
            a.created_at
        FROM audit_logs a
        WHERE a.action IN ('SUBSCRIPTION_PAID', 'SUBSCRIPTION_RENEWED')
          AND COALESCE(a.meta->>'transaction_id', '') <> ''
          AND EXISTS (SELECT 1 FROM clubs c WHERE c.id = a.club_id)
        ORDER BY a.meta->>'transaction_id', a.created_at
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS subscription_payments")
