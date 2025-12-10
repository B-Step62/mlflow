"""add job name column

Create Date: 2025-12-09 00:00:00

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b1b3fd7822f4"
down_revision = "bf29a5ff90ea"
branch_labels = None
depends_on = None


def upgrade():
    # Add column nullable first
    op.add_column("jobs", sa.Column("name", sa.String(length=255), nullable=True))

    # Backfill existing rows with function_fullname
    op.execute("UPDATE jobs SET name = function_fullname WHERE name IS NULL")

    # Set NOT NULL
    op.alter_column("jobs", "name", existing_type=sa.String(length=255), nullable=False)

    # Add unique constraint and index
    with op.batch_alter_table("jobs", schema=None) as batch_op:
        batch_op.create_unique_constraint("uq_jobs_name", ["name"])
        batch_op.create_index(
            "index_jobs_name_status_creation_time",
            ["name", "status", "creation_time"],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table("jobs", schema=None) as batch_op:
        batch_op.drop_index("index_jobs_name_status_creation_time")
        batch_op.drop_constraint("uq_jobs_name", type_="unique")

    op.drop_column("jobs", "name")
