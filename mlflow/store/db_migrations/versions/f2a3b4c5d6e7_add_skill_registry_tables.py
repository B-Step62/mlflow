"""add skill registry tables

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-03-31 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f2a3b4c5d6e7"
down_revision = "76601a5f987d"
branch_labels = None
depends_on = None


def upgrade():
    # Create registered_skills table
    op.create_table(
        "registered_skills",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("creation_timestamp", sa.BigInteger(), nullable=True),
        sa.Column("last_updated_timestamp", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("name", name="registered_skills_pk"),
    )

    # Create skill_versions table
    op.create_table(
        "skill_versions",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("manifest_content", sa.Text(), nullable=True),
        sa.Column("artifact_location", sa.Text(), nullable=True),
        sa.Column("creation_timestamp", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("name", "version", name="skill_versions_pk"),
        sa.ForeignKeyConstraint(
            ["name"],
            ["registered_skills.name"],
            name="fk_skill_versions_name",
            ondelete="CASCADE",
        ),
    )

    with op.batch_alter_table("skill_versions", schema=None) as batch_op:
        batch_op.create_index("index_skill_versions_name", ["name"], unique=False)

    # Create skill_version_tags table
    op.create_table(
        "skill_version_tags",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("value", sa.String(5000), nullable=True),
        sa.PrimaryKeyConstraint("name", "version", "key", name="skill_version_tags_pk"),
        sa.ForeignKeyConstraint(
            ["name", "version"],
            ["skill_versions.name", "skill_versions.version"],
            name="fk_skill_version_tags",
            ondelete="CASCADE",
        ),
    )

    # Create skill_aliases table
    op.create_table(
        "skill_aliases",
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("alias", sa.String(255), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("name", "alias", name="skill_aliases_pk"),
        sa.ForeignKeyConstraint(
            ["name"],
            ["registered_skills.name"],
            name="fk_skill_aliases_name",
            ondelete="CASCADE",
        ),
    )


def downgrade():
    op.drop_table("skill_aliases")
    op.drop_table("skill_version_tags")
    op.drop_table("skill_versions")
    op.drop_table("registered_skills")
