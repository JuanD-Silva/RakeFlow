"""add email_verified subscription and password_reset to clubs

Revision ID: 2ac100c2b022
Revises: 4d22ddb27494
Create Date: 2026-04-05 03:20:57.068933

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2ac100c2b022'
down_revision: Union[str, Sequence[str], None] = '4d22ddb27494'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('clubs', sa.Column('email_verified', sa.Boolean(), server_default='false'))
    op.add_column('clubs', sa.Column('setup_completed', sa.Boolean(), server_default='false'))
    op.add_column('clubs', sa.Column('subscription_active', sa.Boolean(), server_default='false'))
    op.add_column('clubs', sa.Column('subscription_trial_end', sa.DateTime(), nullable=True))
    op.add_column('clubs', sa.Column('password_reset_token', sa.String(), nullable=True))
    op.add_column('clubs', sa.Column('password_reset_expires', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('clubs', 'password_reset_expires')
    op.drop_column('clubs', 'password_reset_token')
    op.drop_column('clubs', 'subscription_trial_end')
    op.drop_column('clubs', 'subscription_active')
    op.drop_column('clubs', 'setup_completed')
    op.drop_column('clubs', 'email_verified')
