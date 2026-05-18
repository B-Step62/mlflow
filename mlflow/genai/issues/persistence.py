"""Persist suggested categories as MLflow issues with test cases.

Bridges the suggestion step (clustering human feedback) with the
existing issue tracking store. Each created issue carries:

* A description with embedded lineage (member feedback IDs, representative
  trace IDs, confidence).
* A dedicated regression-test dataset whose rows are derived from the
  cluster's representative traces. The dataset_id is stored in the issue
  lineage block so the verify step can find and execute the test cases.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import TYPE_CHECKING, Any

import mlflow
from mlflow.entities.dataset_record_source import DatasetRecordSource, DatasetRecordSourceType
from mlflow.entities.issue import Issue, IssueStatus
from mlflow.exceptions import MlflowException
from mlflow.tracing.client import TracingClient

if TYPE_CHECKING:
    from mlflow.genai.datasets.evaluation_dataset import EvaluationDataset
    from mlflow.genai.issues.categorization import SuggestedCategory

_logger = logging.getLogger(__name__)

# Marker before the JSON lineage block in the issue description. Lets the
# rest of the loop (fix prompt, verify) parse the block back without a
# schema change.
_LINEAGE_MARKER = "<!-- mlflow.issue.lineage -->"


def _format_description(category: SuggestedCategory, test_dataset_id: str | None) -> str:
    """Compose an issue description with lineage to source feedback, traces, and test dataset."""
    lineage: dict[str, Any] = {
        "member_feedback_ids": category.member_feedback_ids,
        "representative_trace_ids": category.representative_trace_ids,
        "confidence": category.confidence,
    }
    if test_dataset_id:
        lineage["test_dataset_id"] = test_dataset_id
    trace_lines = "\n".join(f"- mlflow:/trace/{tid}" for tid in category.representative_trace_ids)
    feedback_count = len(category.member_feedback_ids)
    dataset_line = (
        f"## Regression test dataset\n`{test_dataset_id}`\n\n" if test_dataset_id else ""
    )
    return (
        f"{category.description}\n\n"
        f"## Representative traces\n"
        f"{trace_lines or '(none)'}\n\n"
        f"## Source feedback\n"
        f"{feedback_count} feedback item(s) from this cluster.\n\n"
        f"{dataset_line}"
        f"{_LINEAGE_MARKER}\n"
        f"```json\n{json.dumps(lineage, indent=2)}\n```\n"
    )


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, max_length: int = 40) -> str:
    return _SLUG_RE.sub("-", text.lower()).strip("-")[:max_length] or "issue"


def _build_record_from_trace(trace_id: str, category: SuggestedCategory) -> dict[str, Any] | None:
    """Render a regression-test dataset record from one representative trace."""
    trace = mlflow.get_trace(trace_id)
    if trace is None or not trace.data.spans:
        _logger.debug("Skipping trace %s: not found or has no spans", trace_id)
        return None
    root = trace.data.spans[0]
    return {
        "inputs": root.inputs if isinstance(root.inputs, dict) else {"input": root.inputs},
        "expectations": {
            "fail_pattern_name": category.name,
            "fail_pattern_description": category.description,
            "original_output": root.outputs,
        },
        "tags": {
            "cluster_name": category.name,
            "source_trace_id": trace_id,
            "purpose": "regression-test",
        },
        "source": DatasetRecordSource(
            source_type=DatasetRecordSourceType.TRACE,
            source_data={"trace_id": trace_id},
        ).to_dict(),
    }


def _create_test_dataset(
    experiment_id: str,
    category: SuggestedCategory,
) -> EvaluationDataset | None:
    """Create a regression-test dataset for one category and merge records.

    Returns ``None`` and logs at debug if the category has no representative
    traces or the underlying datasets API isn't available. Issue creation
    proceeds without a test dataset in that case.
    """
    if not category.representative_trace_ids:
        return None

    from mlflow.genai import datasets as ds

    name = f"issue-tests-{_slugify(category.name)}-{int(time.time())}"
    try:
        dataset = ds.create_dataset(
            name=name,
            experiment_id=experiment_id,
            tags={
                "purpose": "regression-test",
                "cluster_name": category.name,
                "confidence": str(category.confidence),
            },
        )
    except MlflowException as exc:
        _logger.warning(
            "Could not create test dataset for category %r: %s. "
            "Issue will be created without test cases.",
            category.name,
            exc,
        )
        return None

    records: list[dict[str, Any]] = []
    for tid in category.representative_trace_ids:
        record = _build_record_from_trace(tid, category)
        if record is not None:
            records.append(record)
    if records:
        try:
            dataset.merge_records(records)
        except MlflowException as exc:
            _logger.warning(
                "Created dataset %r but failed to merge records: %s.",
                dataset.dataset_id if hasattr(dataset, "dataset_id") else name,
                exc,
            )
    return dataset


def create_from_categories(
    experiment_id: str,
    categories: list[SuggestedCategory],
    source_run_id: str | None = None,
    created_by: str | None = None,
    create_test_cases: bool = True,
) -> list[Issue]:
    """Create one MLflow issue per suggested category, with regression test cases.

    For each category, this:

    1. Creates a dedicated evaluation dataset whose rows are built from the
       cluster's representative traces (one record per trace, carrying the
       original trace input, the cluster description, and a trace-typed
       :class:`DatasetRecordSource`).
    2. Creates the :class:`Issue` with the dataset_id embedded in the
       lineage block of the description.

    Args:
        experiment_id: Experiment the issues belong to.
        categories: Categories accepted by the user (typically after
            review/edit/merge of the output of :func:`suggest_categories`).
        source_run_id: Optional run that surfaced these issues. Required if
            comments are to be appended later (see :mod:`lifecycle`).
        created_by: Optional identifier for the issue author.
        create_test_cases: When true (default), create a regression-test
            dataset per issue. Disable for offline / dry-run paths.

    Returns:
        The created :class:`Issue` entities, in the same order as the input
        categories.
    """
    client = TracingClient()
    issues: list[Issue] = []
    for category in categories:
        dataset = _create_test_dataset(experiment_id, category) if create_test_cases else None
        dataset_id = getattr(dataset, "dataset_id", None)
        issue = client._create_issue(
            experiment_id=experiment_id,
            name=category.name,
            description=_format_description(category, test_dataset_id=dataset_id),
            status=IssueStatus.TODO,
            categories=[category.name],
            source_run_id=source_run_id,
            created_by=created_by,
        )
        issues.append(issue)
        _logger.info(
            "Created issue %s (test_dataset_id=%s) for category %r",
            issue.issue_id,
            dataset_id or "none",
            category.name,
        )
    return issues
