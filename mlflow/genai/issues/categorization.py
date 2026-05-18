"""Suggest failure categories from human feedback on traces.

The failure-driven improvement loop captures human observations as
inline feedback on traces (typically during vibe-checking). This module
clusters those raw feedback items into coherent failure patterns so the
developer can turn them into trackable issues.

Output is intentionally a *suggestion*: the caller reviews, edits,
merges, or splits the categories before persisting any of them as
issues. See :func:`mlflow.genai.issues.create_from_categories` for the
persistence step.
"""

from __future__ import annotations

import logging
from typing import Any

import pydantic

import mlflow
from mlflow.entities.trace import Trace
from mlflow.exceptions import MlflowException
from mlflow.genai.discovery.constants import DEFAULT_MODEL
from mlflow.genai.scorers.llm_backend import ScorerLLMClient
from mlflow.tracking.fluent import _get_experiment_id

_logger = logging.getLogger(__name__)


class SuggestedCategory(pydantic.BaseModel):
    """A candidate failure category derived from human feedback."""

    name: str = pydantic.Field(
        description="Short descriptive name for the failure pattern (5-10 words)."
    )
    description: str = pydantic.Field(
        description="One-sentence description of the underlying failure pattern."
    )
    member_feedback_ids: list[str] = pydantic.Field(
        description="IDs of feedback items that belong to this cluster."
    )
    representative_trace_ids: list[str] = pydantic.Field(
        description="2-3 trace IDs that exemplify this cluster."
    )
    confidence: float = pydantic.Field(
        description="Cluster coherence confidence between 0.0 and 1.0.",
        ge=0.0,
        le=1.0,
    )


class _CategorizationResult(pydantic.BaseModel):
    categories: list[SuggestedCategory]


_SYSTEM_PROMPT = """\
You are analyzing developer feedback left on AI agent traces during a debugging \
or vibe-checking session.

Cluster the feedback into coherent failure patterns. For each cluster:
- Give it a short, descriptive name (5-10 words) using the developer's vocabulary
- Write a one-sentence description of the underlying pattern
- List the feedback IDs that belong to this cluster
- Pick 2-3 representative trace IDs from the cluster members
- Estimate cluster coherence as a confidence score between 0.0 and 1.0

Guidelines:
- Prefer fewer, coherent clusters over many noisy ones
- Discard feedback that doesn't fit any pattern (do not force-fit)
- Use the developer's own words; do not generalize to vendor jargon
- Single-item clusters are acceptable when the failure is genuinely unique
"""


def _extract_feedback_items(
    traces: list[Trace],
    feedback_ids: list[str] | None,
) -> list[dict[str, Any]]:
    """Extract human feedback assessments from traces.

    Returns a list of dicts with keys: feedback_id, trace_id, name,
    rationale, value. Only assessments authored by a human source are
    included.
    """
    items: list[dict[str, Any]] = []
    feedback_filter = set(feedback_ids) if feedback_ids else None
    for trace in traces:
        assessments = trace.info.assessments or []
        for a in assessments:
            source = getattr(a, "source", None)
            source_type = getattr(source, "source_type", None) if source else None
            if source_type != "HUMAN":
                continue
            assessment_id = getattr(a, "assessment_id", None)
            if not assessment_id:
                continue
            if feedback_filter is not None and assessment_id not in feedback_filter:
                continue
            rationale = getattr(a, "rationale", "") or ""
            value = getattr(a, "value", "")
            items.append({
                "feedback_id": assessment_id,
                "trace_id": trace.info.trace_id,
                "name": getattr(a, "name", "") or "",
                "rationale": rationale,
                "value": str(value) if value is not None else "",
            })
    return items


def _format_feedback_for_prompt(items: list[dict[str, Any]]) -> str:
    lines = []
    for item in items:
        body = item["rationale"] or item["value"] or "(no comment text)"
        name_part = f" [{item['name']}]" if item["name"] else ""
        lines.append(
            f"feedback_id={item['feedback_id']} trace_id={item['trace_id']}{name_part}: {body}"
        )
    return "\n".join(lines)


def _fetch_traces(
    experiment_id: str,
    trace_ids: list[str] | None,
) -> list[Trace]:
    if trace_ids:
        fetched = [mlflow.get_trace(tid) for tid in trace_ids]
        return [t for t in fetched if t is not None]
    return mlflow.search_traces(locations=[experiment_id], return_type="list")


def suggest_categories(
    experiment_id: str | None = None,
    trace_ids: list[str] | None = None,
    feedback_ids: list[str] | None = None,
    model: str | None = None,
    max_categories: int = 7,
) -> list[SuggestedCategory]:
    """Cluster human feedback on traces into candidate failure categories.

    The output is a *suggestion* meant for human review. Nothing is
    persisted by this call. Pass accepted categories to
    :func:`mlflow.genai.issues.create_from_categories` to turn them into
    tracked issues.

    Args:
        experiment_id: Experiment to read traces from. Defaults to the
            active experiment.
        trace_ids: Specific traces to consider. If ``None``, all traces
            in the experiment are scanned.
        feedback_ids: Specific human feedback items to categorize. If
            ``None``, all human feedback on the selected traces is used.
        model: LLM model URI. Defaults to the discovery pipeline default
            (``"openai:/gpt-5-mini"`` at the time of writing).
        max_categories: Upper bound on the number of suggested clusters.

    Returns:
        List of :class:`SuggestedCategory` objects, possibly empty when
        no human feedback is found.
    """
    exp_id = experiment_id or _get_experiment_id()
    if exp_id is None:
        raise MlflowException(
            "No experiment specified. Pass experiment_id or call mlflow.set_experiment()."
        )

    traces = _fetch_traces(exp_id, trace_ids)
    items = _extract_feedback_items(traces, feedback_ids=feedback_ids)
    if not items:
        _logger.info("No human feedback found for the given inputs.")
        return []

    client = ScorerLLMClient(model or DEFAULT_MODEL)
    user_prompt = (
        f"Cluster these {len(items)} feedback items into at most {max_categories} categories:\n\n"
        f"{_format_feedback_for_prompt(items)}"
    )
    response_json = client.complete(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format=_CategorizationResult,
    )
    parsed = _CategorizationResult.model_validate_json(response_json)
    return parsed.categories
