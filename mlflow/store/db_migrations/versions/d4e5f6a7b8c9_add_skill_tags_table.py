"""add skill_tags table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-18 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "skill_tags",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.String(5000), nullable=True),
        sa.PrimaryKeyConstraint("name", "key", name="skill_tags_pk"),
        sa.ForeignKeyConstraint(
            ["name"],
            ["registered_skills.name"],
            name="fk_skill_tags_name",
            ondelete="CASCADE",
        ),
    )


def downgrade():
    op.drop_table("skill_tags")
