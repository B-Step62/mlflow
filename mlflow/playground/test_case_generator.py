"""Generates a runnable test case from a piece of feedback.

Implements design.md §9.1 (assertion vs LLM-judge variants). Produces a
``GeneratedTestCase`` value object; persistence into the regression
``EvaluationDataset`` is the dispatch flow's job (see YUK-15).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol

import pydantic


class TestStrategy(str, Enum):
    ASSERTION = "assertion"
    JUDGE = "judge"


@dataclass(frozen=True)
class FeedbackInput:
    """The slice of a Feedback / Expectation pair the generator consumes."""

    rationale: str
    failing_assistant_message: str
    conversation_prefix: list[dict[str, Any]]
    expected_response: str | None = None
    aspect: str | None = None


@dataclass
class AssertionSpec:
    """Substring + tool-name checks. Narrow on purpose for MVP — richer
    assertion forms (regex, semantic, structural) are out of scope for YUK-14.
    """

    must_contain: list[str] = field(default_factory=list)
    must_not_contain: list[str] = field(default_factory=list)
    must_call_tool: list[str] = field(default_factory=list)
    must_not_call_tool: list[str] = field(default_factory=list)


@dataclass
class JudgeSpec:
    criteria: str
    expected_response: str | None = None


@dataclass
class GeneratedTestCase:
    test_case_id: str
    strategy: TestStrategy
    inputs: list[dict[str, Any]]
    rationale_summary: str
    assertion: AssertionSpec | None = None
    judge: JudgeSpec | None = None


class _LLMTestCase(pydantic.BaseModel):
    """Structured-output schema the LLM fills in."""

    strategy: str
    rationale_summary: str = ""
    must_contain: list[str] = pydantic.Field(default_factory=list)
    must_not_contain: list[str] = pydantic.Field(default_factory=list)
    must_call_tool: list[str] = pydantic.Field(default_factory=list)
    must_not_call_tool: list[str] = pydantic.Field(default_factory=list)
    judge_criteria: str | None = None


class LLMCallable(Protocol):
    def __call__(self, prompt: str) -> str: ...


_PROMPT_TEMPLATE = """\
You are turning human feedback about an AI assistant's response into a runnable \
test case.

# Conversation prefix (messages leading up to the failing turn)
{conversation_prefix}

# The assistant turn that received the feedback
{failing_assistant_message}

# Human feedback
Rationale: {rationale}{expected_response_section}{aspect_section}

# Your task
Pick ONE of two strategies:

1. "assertion" — the rationale is concrete and decidable by string match on the \
assistant message or by checking which tools it called / didn't call. Examples:
     - "must mention §4.2 of the refund policy"
     - "must not call delete_account"
   Fill `must_contain` / `must_not_contain` / `must_call_tool` / `must_not_call_tool`. \
Leave `judge_criteria` null.

2. "judge" — the rationale is qualitative and can't be decided by string or tool match. \
Examples:
     - "tone is too casual"
     - "the answer doesn't actually address what the user asked"
   Fill `judge_criteria` with a short natural-language standard the judge will evaluate. \
Leave the assertion lists empty.

Also fill `rationale_summary` — a short summary of the original rationale (<= 80 chars).

Return JSON matching the schema.
"""


_DEFAULT_DATABRICKS_ENDPOINT = "databricks-claude-sonnet-4-5"


def _default_llm_call(prompt: str) -> str:
    """Invoke a Databricks model-serving endpoint via its OpenAI-compatible API.

    Databricks model serving exposes every endpoint at
    ``<DATABRICKS_HOST>/serving-endpoints`` with an OpenAI-shaped
    chat-completions surface, so we just point the OpenAI client at it
    and pass the workspace PAT as the API key. No special MLflow judge
    adapter, no `databricks-agents` dependency.

    Configuration (all from env):
      * ``DATABRICKS_HOST`` — workspace URL.
      * ``DATABRICKS_TOKEN`` — personal access token.
      * ``MLFLOW_PLAYGROUND_TEST_GEN_ENDPOINT`` — endpoint name (optional;
        defaults to ``databricks-claude-sonnet-4-5``).

    The prompt asks the model to return JSON matching the schema; we
    parse it via ``_LLMTestCase.model_validate_json(...)`` downstream.
    """
    import os

    host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")
    token = os.environ.get("DATABRICKS_TOKEN", "")
    if not host or not token:
        raise RuntimeError(
            "Test-case generation needs Databricks workspace credentials. "
            "Set DATABRICKS_HOST (workspace URL) and DATABRICKS_TOKEN (PAT) "
            "in the environment running `mlflow agent playground`, then retry."
        )
    endpoint = os.environ.get("MLFLOW_PLAYGROUND_TEST_GEN_ENDPOINT", _DEFAULT_DATABRICKS_ENDPOINT)

    from openai import OpenAI

    client = OpenAI(api_key=token, base_url=f"{host}/serving-endpoints")
    response = client.chat.completions.create(
        model=endpoint,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content or ""


class TestCaseGenerator:
    """Produces a ``GeneratedTestCase`` for a single piece of feedback."""

    def __init__(self, llm: LLMCallable | None = None):
        self._llm = llm or _default_llm_call

    def generate(self, feedback: FeedbackInput) -> GeneratedTestCase:
        raw = self._llm(self._build_prompt(feedback))
        parsed = (
            _LLMTestCase.model_validate_json(raw)
            if isinstance(raw, str)
            else _LLMTestCase.model_validate(raw)
        )
        return self._to_test_case(parsed, feedback)

    @staticmethod
    def _build_prompt(feedback: FeedbackInput) -> str:
        prefix = json.dumps(feedback.conversation_prefix, indent=2)
        expected = (
            f"\nUser-provided expected response: {feedback.expected_response!r}"
            if feedback.expected_response
            else ""
        )
        aspect = f"\nAspect tag: {feedback.aspect}" if feedback.aspect else ""
        return _PROMPT_TEMPLATE.format(
            conversation_prefix=prefix,
            failing_assistant_message=feedback.failing_assistant_message,
            rationale=feedback.rationale,
            expected_response_section=expected,
            aspect_section=aspect,
        )

    @staticmethod
    def _to_test_case(parsed: _LLMTestCase, feedback: FeedbackInput) -> GeneratedTestCase:
        try:
            strategy = TestStrategy(parsed.strategy)
        except ValueError as e:
            raise ValueError(
                f"Generator returned unknown strategy {parsed.strategy!r}; "
                f"expected one of {[s.value for s in TestStrategy]}."
            ) from e

        assertion: AssertionSpec | None = None
        judge: JudgeSpec | None = None
        if strategy is TestStrategy.ASSERTION:
            assertion = AssertionSpec(
                must_contain=list(parsed.must_contain),
                must_not_contain=list(parsed.must_not_contain),
                must_call_tool=list(parsed.must_call_tool),
                must_not_call_tool=list(parsed.must_not_call_tool),
            )
        else:
            judge = JudgeSpec(
                criteria=parsed.judge_criteria or feedback.rationale,
                expected_response=feedback.expected_response,
            )

        summary = parsed.rationale_summary.strip() or feedback.rationale[:80]
        return GeneratedTestCase(
            test_case_id=f"tc-{uuid.uuid4().hex}",
            strategy=strategy,
            inputs=list(feedback.conversation_prefix),
            rationale_summary=summary,
            assertion=assertion,
            judge=judge,
        )

    @staticmethod
    def to_dataset_record(
        test_case: GeneratedTestCase,
        issue_id: str | None = None,
        source_trace_id: str | None = None,
    ) -> dict[str, Any]:
        """Shape a ``GeneratedTestCase`` into a row for ``EvaluationDataset.merge_records``."""
        spec: dict[str, Any] = {"strategy": test_case.strategy.value}
        if test_case.assertion is not None:
            spec["assertion"] = {
                "must_contain": test_case.assertion.must_contain,
                "must_not_contain": test_case.assertion.must_not_contain,
                "must_call_tool": test_case.assertion.must_call_tool,
                "must_not_call_tool": test_case.assertion.must_not_call_tool,
            }
        if test_case.judge is not None:
            spec["judge"] = {
                "criteria": test_case.judge.criteria,
                "expected_response": test_case.judge.expected_response,
            }
        tags: dict[str, str] = {}
        if issue_id is not None:
            tags["issue_id"] = issue_id
        if source_trace_id is not None:
            tags["source_trace_id"] = source_trace_id
        return {
            "inputs": {"messages": test_case.inputs},
            "expectations": {
                "test_case_id": test_case.test_case_id,
                "test_spec": spec,
                "rationale_summary": test_case.rationale_summary,
            },
            "tags": tags,
        }


__all__ = [
    "AssertionSpec",
    "FeedbackInput",
    "GeneratedTestCase",
    "JudgeSpec",
    "LLMCallable",
    "TestCaseGenerator",
    "TestStrategy",
]


# pytest treats any class named `Test*` as a test container. Opt out so pytest
# skips collection on these public API symbols.
TestCaseGenerator.__test__ = False
TestStrategy.__test__ = False
