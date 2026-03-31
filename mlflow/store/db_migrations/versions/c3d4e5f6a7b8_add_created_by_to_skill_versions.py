"""add created_by to skill_versions

Revision ID: c3d4e5f6a7b8
Revises: f2a3b4c5d6e7
Create Date: 2026-03-31 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("skill_versions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by", sa.String(255), nullable=True))


def downgrade():
    with op.batch_alter_table("skill_versions", schema=None) as batch_op:
        batch_op.drop_column("created_by")
