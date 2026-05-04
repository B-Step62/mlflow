"""extend issues table with playground lineage fields

Adds fields needed by the agent playground (design.md §5.1): priority,
source_feedback_id, source_trace_id, source_conversation_id, test_case_id,
agent_version_id, base_prompt_id, assignee, labels. Also adds a composite
``(experiment_id, status)`` index for orchestrator polling.

All new columns are nullable so existing issue-detection rows are preserved
unchanged. The legacy ``status`` column is reused (with new playground state
values added at the entity layer); no rename.

Create Date: 2026-05-04 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9a8b7c6d5e4f"
down_revision = "da6fb0208061"
branch_labels = None
depends_on = None


_NEW_COLUMNS = [
    sa.Column("priority", sa.Integer(), nullable=True),
    sa.Column("source_feedback_id", sa.String(length=50), nullable=True),
    sa.Column("source_trace_id", sa.String(length=50), nullable=True),
    sa.Column("source_conversation_id", sa.String(length=64), nullable=True),
    sa.Column("test_case_id", sa.String(length=36), nullable=True),
    sa.Column("agent_version_id", sa.String(length=36), nullable=True),
    sa.Column("base_prompt_id", sa.String(length=36), nullable=True),
    sa.Column("assignee", sa.String(length=255), nullable=True),
    sa.Column("labels", sa.Text(), nullable=True),
]

_COMPOSITE_INDEX = "index_issues_experiment_id_status"
_LINEAGE_INDEXES = [
    ("index_issues_source_feedback_id", "source_feedback_id"),
    ("index_issues_source_trace_id", "source_trace_id"),
    ("index_issues_assignee", "assignee"),
]


def upgrade():
    with op.batch_alter_table("issues", schema=None) as batch_op:
        for col in _NEW_COLUMNS:
            batch_op.add_column(col)
        batch_op.create_index(
            _COMPOSITE_INDEX,
            ["experiment_id", "status"],
            unique=False,
        )
        for idx_name, col_name in _LINEAGE_INDEXES:
            batch_op.create_index(idx_name, [col_name], unique=False)


def downgrade():
    with op.batch_alter_table("issues", schema=None) as batch_op:
        for idx_name, _ in _LINEAGE_INDEXES:
            batch_op.drop_index(idx_name)
        batch_op.drop_index(_COMPOSITE_INDEX)
        for col in reversed(_NEW_COLUMNS):
            batch_op.drop_column(col.name)
