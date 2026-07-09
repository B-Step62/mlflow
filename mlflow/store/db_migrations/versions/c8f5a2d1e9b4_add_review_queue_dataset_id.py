"""add dataset_id to review_queues

Revision ID: c8f5a2d1e9b4
Revises: b7e4c1a90f23

Create Date: 2026-07-09 10:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c8f5a2d1e9b4"
down_revision = "b7e4c1a90f23"
branch_labels = None
depends_on = None


def upgrade():
    # Binds a queue to an evaluation dataset for dataset-record review; NULL for
    # a trace-review queue.
    op.add_column(
        "review_queues",
        sa.Column("dataset_id", sa.String(length=36), nullable=True),
    )


def downgrade():
    op.drop_column("review_queues", "dataset_id")
