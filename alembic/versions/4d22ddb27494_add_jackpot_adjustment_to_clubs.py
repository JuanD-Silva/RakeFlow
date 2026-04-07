"""add jackpot_adjustment to clubs

Revision ID: 4d22ddb27494
Revises: b7250a45cab8
Create Date: 2026-04-05 02:48:01.667593

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4d22ddb27494'
down_revision: Union[str, Sequence[str], None] = 'b7250a45cab8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('clubs', sa.Column('jackpot_adjustment', sa.Float(), server_default='0.0', nullable=True))


def downgrade() -> None:
    op.drop_column('clubs', 'jackpot_adjustment')
