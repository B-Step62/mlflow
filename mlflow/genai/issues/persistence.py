"""Persist suggested categories as MLflow issues.

Bridges the suggestion step (clustering human feedback) with the
existing issue tracking store. Issues created here are real
:class:`~mlflow.entities.Issue` entities that the rest of the failure-
driven loop (fix prompt, verify, regression suite) operates on.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from mlflow.entities.issue import Issue, IssueStatus
from mlflow.tracing.client import TracingClient

if TYPE_CHECKING:
    from mlflow.genai.issues.categorization import SuggestedCategory

_logger = logging.getLogger(__name__)

# Tag key used to embed the cluster's source feedback / trace links inside
# the issue description. The marker makes it easy to round-trip the lineage
# without a schema change.
_LINEAGE_MARKER = "<!-- mlflow.issue.lineage -->"


def _format_description(category: SuggestedCategory) -> str:
    """Compose an issue description with embedded lineage to source feedback and traces.

    The lineage block is a fenced JSON object preceded by ``_LINEAGE_MARKER``.
    Keeping the format machine-readable lets the rest of the loop (fix prompt,
    verify) parse it back without needing a new schema field.
    """
    lineage = {
        "member_feedback_ids": category.member_feedback_ids,
        "representative_trace_ids": category.representative_trace_ids,
        "confidence": category.confidence,
    }
    trace_lines = "\n".join(f"- mlflow:/trace/{tid}" for tid in category.representative_trace_ids)
    feedback_count = len(category.member_feedback_ids)
    return (
        f"{category.description}\n\n"
        f"## Representative traces\n"
        f"{trace_lines or '(none)'}\n\n"
        f"## Source feedback\n"
        f"{feedback_count} feedback item(s) from this cluster.\n\n"
        f"{_LINEAGE_MARKER}\n"
        f"```json\n{json.dumps(lineage, indent=2)}\n```\n"
    )


def create_from_categories(
    experiment_id: str,
    categories: list[SuggestedCategory],
    source_run_id: str | None = None,
    created_by: str | None = None,
) -> list[Issue]:
    """Create one MLflow issue per suggested category.

    Lineage to source feedback IDs and representative traces is embedded
    in the issue description as a machine-readable JSON block (this
    keeps the prototype schema-free; a proper linkage table can replace
    it later without breaking callers).

    Args:
        experiment_id: Experiment the issues belong to.
        categories: Categories accepted by the user (typically after
            review/edit/merge of the output of
            :func:`suggest_categories`).
        source_run_id: Optional run that surfaced these issues.
        created_by: Optional identifier for the issue author.

    Returns:
        The created :class:`Issue` entities, in the same order as the
        input categories.
    """
    client = TracingClient()
    issues: list[Issue] = []
    for category in categories:
        issue = client._create_issue(
            experiment_id=experiment_id,
            name=category.name,
            description=_format_description(category),
            status=IssueStatus.TODO,
            categories=[category.name],
            source_run_id=source_run_id,
            created_by=created_by,
        )
        issues.append(issue)
        _logger.info("Created issue %s for category %r", issue.issue_id, category.name)
    return issues
