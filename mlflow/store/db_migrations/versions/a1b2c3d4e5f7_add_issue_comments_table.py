"""add issue_comments table

Linear-style activity thread on issues. Each row is one entry in the issue's
chronological feed (human comment, worker turn, system event).

Create Date: 2026-05-06 19:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f7"
down_revision = "9a8b7c6d5e4f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "issue_comments",
        sa.Column("comment_id", sa.String(length=36), nullable=False),
        sa.Column("issue_id", sa.String(length=36), nullable=False),
        sa.Column("author", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("created_timestamp", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["issue_id"],
            ["issues.issue_id"],
            name="fk_issue_comments_issue_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("comment_id", name="issue_comments_pk"),
    )
    with op.batch_alter_table("issue_comments", schema=None) as batch_op:
        batch_op.create_index(
            "index_issue_comments_issue_id",
            ["issue_id"],
            unique=False,
        )
        batch_op.create_index(
            "index_issue_comments_issue_created",
            ["issue_id", "created_timestamp"],
            unique=False,
        )


def downgrade():
    op.drop_table("issue_comments")
