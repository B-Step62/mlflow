"""Issue lifecycle helpers: fix prompt, comments, verification.

These wrap the existing :class:`~mlflow.tracing.client.TracingClient`
issue surface with conveniences that make the failure-driven loop
operable from a Python notebook or CLI without needing UI changes.
"""

from __future__ import annotations

import datetime as _dt
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import pydantic

import mlflow
from mlflow.entities.assessment_source import AssessmentSource, AssessmentSourceType
from mlflow.entities.issue import Issue, IssueStatus
from mlflow.exceptions import MlflowException
from mlflow.genai.discovery.constants import DEFAULT_MODEL
from mlflow.genai.scorers.llm_backend import ScorerLLMClient
from mlflow.tracing.client import TracingClient

_logger = logging.getLogger(__name__)

# Marker written by persistence._format_description. The JSON fence
# immediately following it carries the lineage payload.
_LINEAGE_MARKER = "<!-- mlflow.issue.lineage -->"

# Tag prefix used to record human-mediated comments on the issue. Comments
# are stored on the issue's source run as tags so we do not need a new
# schema for the prototype.
_COMMENT_TAG_PREFIX = "mlflow.issue.comment."


def _parse_lineage(description: str) -> dict[str, Any]:
    """Extract the JSON lineage block embedded in an issue description."""
    if _LINEAGE_MARKER not in description:
        return {}
    match = re.search(r"```json\s*(\{.*?\})\s*```", description, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        _logger.debug("Failed to parse lineage JSON from issue description", exc_info=True)
        return {}


_FIX_PROMPT_TEMPLATE = """\
You are improving an AI agent tracked by MLflow. The following issue was discovered \
through human feedback during a debugging or vibe-check session.

# Issue

**Title:** {name}

{description_body}

# Representative failing traces

{trace_block}

# Your task

1. Read the representative traces above (via MLflow's MCP `get_trace` tool or by \
   reading the trace IDs through `mlflow.get_trace(trace_id)`).
2. Identify the root cause of the failure pattern.
3. Make targeted changes to the agent code (system prompt, tool definitions, \
   retrieval logic, etc.). Prefer minimal changes.
4. Verify your fix:
   - Re-run the representative traces' inputs against the modified agent.
   - Confirm the existing regression test suite still passes.
5. Report back via MLflow's MCP `add_issue_comment` tool (or by printing the \
   JSON report block below for the human to paste).

# Acceptance criteria

- The representative traces produce correct behavior after your fix
- No regressions in the existing test suite
- The issue's comment clearly explains what changed and why

If you cannot resolve the issue or are unsure, post a comment explaining what \
you tried and where the ambiguity is. Flag any traces that need human review.

# Report back in this format

```json
{{
  "issue_id": "{issue_id}",
  "summary": "<one paragraph describing what you changed>",
  "files_changed": ["<relative paths>"],
  "verification": {{
    "representative_traces_pass": true,
    "regression_suite_pass": true,
    "notes": "<anything else worth noting>"
  }},
  "needs_human_review": ["<trace_ids if any>"]
}}
```
"""


def get_fix_prompt(issue_id: str) -> str:
    """Render a copy-pasteable prompt that hands the issue off to a coding agent.

    The prompt includes the issue's representative traces (parsed from
    the lineage block embedded in the description) and instructs the
    coding agent to post back via MCP or as a structured JSON block.

    Args:
        issue_id: Identifier of the issue to generate a prompt for.

    Returns:
        Prompt string ready for the user to copy into their coding
        agent (Claude Code, Cursor, etc.).
    """
    issue = TracingClient()._get_issue(issue_id)
    lineage = _parse_lineage(issue.description or "")
    trace_ids: list[str] = lineage.get("representative_trace_ids") or []

    if trace_ids:
        trace_block = "\n".join(f"- `{tid}`" for tid in trace_ids)
    else:
        trace_block = "(No representative traces linked. Inspect the issue manually.)"

    # Strip the embedded lineage block from the description so the coding
    # agent reads only the human-meaningful portion.
    description_body = issue.description or ""
    if _LINEAGE_MARKER in description_body:
        description_body = description_body.split(_LINEAGE_MARKER, 1)[0].rstrip()

    return _FIX_PROMPT_TEMPLATE.format(
        name=issue.name,
        description_body=description_body,
        trace_block=trace_block,
        issue_id=issue.issue_id,
    )


@dataclass
class IssueComment:
    """Lightweight comment record persisted as a run tag for the prototype."""

    comment_id: str
    issue_id: str
    body: str
    author: str
    created_at: str
    metadata: dict[str, Any] = field(default_factory=dict)


def _comment_storage_run_id(issue: Issue) -> str:
    """Resolve the run that owns the issue's comment tags.

    For the prototype we piggyback on the issue's ``source_run_id`` to
    avoid a schema change. If the issue has no source run we raise so
    the caller can attach one explicitly.
    """
    if not issue.source_run_id:
        raise MlflowException(
            f"Issue {issue.issue_id!r} has no source_run_id; cannot persist comments. "
            "Create the issue with a source_run_id or attach the issue to a run first."
        )
    return issue.source_run_id


def add_comment(
    issue_id: str,
    body: str,
    author: str = "coding-agent",
    metadata: dict[str, Any] | None = None,
) -> IssueComment:
    """Append a comment to an issue.

    Stored as a run tag for the prototype so no new schema is required.
    The tag key encodes a monotonic millisecond timestamp; the value is
    JSON-encoded with the comment body and metadata.

    Args:
        issue_id: Issue identifier.
        body: Free-text body of the comment.
        author: Who authored the comment (default ``"coding-agent"``).
        metadata: Optional structured payload (test results, files
            changed, etc.).

    Returns:
        The persisted :class:`IssueComment`.
    """
    client = TracingClient()
    issue = client._get_issue(issue_id)
    run_id = _comment_storage_run_id(issue)

    ts_ms = int(time.time() * 1000)
    comment_id = f"{issue_id}::{ts_ms}"
    payload = {
        "issue_id": issue_id,
        "body": body,
        "author": author,
        "created_at": _dt.datetime.fromtimestamp(ts_ms / 1000, tz=_dt.timezone.utc).isoformat(),
        "metadata": metadata or {},
    }
    tag_key = f"{_COMMENT_TAG_PREFIX}{issue_id}.{ts_ms}"
    mlflow.MlflowClient().set_tag(run_id, tag_key, json.dumps(payload))
    return IssueComment(
        comment_id=comment_id,
        issue_id=issue_id,
        body=body,
        author=author,
        created_at=payload["created_at"],
        metadata=payload["metadata"],
    )


def list_comments(issue_id: str) -> list[IssueComment]:
    """Return all comments for an issue, sorted by creation time."""
    client = TracingClient()
    issue = client._get_issue(issue_id)
    run_id = _comment_storage_run_id(issue)
    run = mlflow.MlflowClient().get_run(run_id)

    prefix = f"{_COMMENT_TAG_PREFIX}{issue_id}."
    comments: list[IssueComment] = []
    for tag_key, tag_value in run.data.tags.items():
        if not tag_key.startswith(prefix):
            continue
        try:
            payload = json.loads(tag_value)
        except json.JSONDecodeError:
            _logger.debug("Skipping malformed comment tag %s", tag_key)
            continue
        comments.append(
            IssueComment(
                comment_id=tag_key.removeprefix(_COMMENT_TAG_PREFIX),
                issue_id=payload["issue_id"],
                body=payload["body"],
                author=payload["author"],
                created_at=payload["created_at"],
                metadata=payload.get("metadata") or {},
            )
        )
    comments.sort(key=lambda c: c.created_at)
    return comments


@dataclass
class TraceVerification:
    trace_id: str
    passed: bool
    rationale: str


@dataclass
class VerificationResult:
    issue_id: str
    overall_pass: bool
    pass_rate: float
    per_trace: list[TraceVerification]
    error: str | None = None


class _JudgeVerdict(pydantic.BaseModel):
    passed: bool = pydantic.Field(
        description="True if the new agent output addresses the original failure."
    )
    rationale: str = pydantic.Field(
        description="One-sentence justification grounded in the new output."
    )


_VERIFICATION_SYSTEM_PROMPT = """\
You are verifying whether a fix for an AI agent's failure was successful.

You will see:
- The issue description (what was wrong)
- The original failing input and output
- The new output produced by the modified agent on the same input

Decide if the new output resolves the failure described. Be strict: only \
mark as passing if the specific failure no longer occurs. Do not pass on \
generic improvements unrelated to the issue.
"""


def _resolve_trace_input(trace_id: str) -> Any:
    """Return the input payload of the trace's root span, if available."""
    trace = mlflow.get_trace(trace_id)
    if trace is None or not trace.data.spans:
        return None
    root = trace.data.spans[0]
    return root.inputs


def _resolve_trace_output(trace_id: str) -> Any:
    trace = mlflow.get_trace(trace_id)
    if trace is None or not trace.data.spans:
        return None
    root = trace.data.spans[0]
    return root.outputs


def verify(
    issue_id: str,
    agent_callable: Callable[[Any], Any],
    *,
    model: str | None = None,
    resolve_if_passing: bool = True,
) -> VerificationResult:
    """Re-run the issue's representative traces against ``agent_callable`` and judge each.

    For each linked trace:
        1. Fetch the trace's root-span input.
        2. Call ``agent_callable`` with that input.
        3. Ask an LLM judge whether the new output addresses the failure
           described by the issue.

    If every trace passes and ``resolve_if_passing`` is true, the issue
    status is updated to :attr:`IssueStatus.DONE` and a verification
    comment is appended.

    Args:
        issue_id: Issue identifier.
        agent_callable: Callable that takes the same input shape as the
            original trace and returns the agent's output.
        model: Optional LLM model URI for the verdict judge.
        resolve_if_passing: When true (default), set the issue status to
            ``RESOLVED`` on full pass.

    Returns:
        :class:`VerificationResult` summarising the outcome.
    """
    client = TracingClient()
    issue = client._get_issue(issue_id)
    lineage = _parse_lineage(issue.description or "")
    trace_ids: list[str] = lineage.get("representative_trace_ids") or []
    if not trace_ids:
        return VerificationResult(
            issue_id=issue_id,
            overall_pass=False,
            pass_rate=0.0,
            per_trace=[],
            error="No representative trace IDs found on this issue.",
        )

    judge = ScorerLLMClient(model or DEFAULT_MODEL)
    per_trace: list[TraceVerification] = []
    for tid in trace_ids:
        original_input = _resolve_trace_input(tid)
        original_output = _resolve_trace_output(tid)
        if original_input is None:
            per_trace.append(
                TraceVerification(
                    trace_id=tid,
                    passed=False,
                    rationale="Could not read original trace input.",
                )
            )
            continue
        try:
            new_output = agent_callable(original_input)
        except Exception as exc:
            per_trace.append(
                TraceVerification(
                    trace_id=tid,
                    passed=False,
                    rationale=f"agent_callable raised: {exc!r}",
                )
            )
            continue

        verdict_json = judge.complete(
            [
                {"role": "system", "content": _VERIFICATION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Issue: {issue.name}\n"
                        f"Description: {issue.description}\n\n"
                        f"Original input: {original_input}\n"
                        f"Original output: {original_output}\n\n"
                        f"New output: {new_output}\n"
                    ),
                },
            ],
            response_format=_JudgeVerdict,
        )
        verdict = _JudgeVerdict.model_validate_json(verdict_json)
        per_trace.append(
            TraceVerification(
                trace_id=tid,
                passed=verdict.passed,
                rationale=verdict.rationale,
            )
        )

    pass_count = sum(1 for t in per_trace if t.passed)
    pass_rate = pass_count / len(per_trace)
    overall_pass = pass_count == len(per_trace)

    result = VerificationResult(
        issue_id=issue_id,
        overall_pass=overall_pass,
        pass_rate=pass_rate,
        per_trace=per_trace,
    )

    # Append a verification comment so the audit trail lives on the issue.
    try:
        add_comment(
            issue_id=issue_id,
            body=(
                f"Verification: {pass_count}/{len(per_trace)} representative traces pass."
            ),
            author="mlflow.verify",
            metadata={
                "overall_pass": overall_pass,
                "pass_rate": pass_rate,
                "per_trace": [
                    {"trace_id": t.trace_id, "passed": t.passed, "rationale": t.rationale}
                    for t in per_trace
                ],
            },
        )
    except MlflowException:
        _logger.debug("Skipping verification comment (no source_run_id on issue)", exc_info=True)

    if overall_pass and resolve_if_passing:
        client.store.update_issue(
            issue_id=issue_id,
            status=IssueStatus.DONE,
        )

    return result


# Re-export the AssessmentSource type for callers that want to flag traces
# for human review while operating inside the issue lifecycle.
__all__ = [
    "AssessmentSource",
    "AssessmentSourceType",
    "IssueComment",
    "TraceVerification",
    "VerificationResult",
    "add_comment",
    "get_fix_prompt",
    "list_comments",
    "verify",
]
