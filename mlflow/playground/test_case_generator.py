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
You are turning a human's feedback about an AI assistant's response into a \
robust, runnable test case. The test will be re-run against the agent later \
to confirm regressions don't return — so it must catch the *general failure \
mode* the human was pointing at, not just the specific surface symptom they \
happened to notice this time.

# Conversation prefix (messages leading up to the failing turn)
{conversation_prefix}

# The assistant turn that received the feedback
{failing_assistant_message}

# Human feedback
Rationale: {rationale}{expected_response_section}{aspect_section}

# How to think about this (do this BEFORE filling the JSON)

1. **Identify the underlying principle.** Read the rationale and ask: what \
general rule is the human asking the assistant to follow? The specific \
strings or values in *this* failing response are evidence, not the rule itself.

2. **Articulate the expected state.** Restate the rule as a positive standard \
the assistant must meet, in general terms — not "must not contain X" where \
X is the literal symbol from this turn, but "the response must satisfy \
PROPERTY_OF_X".

3. **Pick the strategy that captures the principle.** A test that only \
catches the exact literal failure is *brittle*: it'll go green for \
near-identical violations that share the same root cause. Bias toward the \
strategy that captures the underlying rule.

# The two strategies

## "assertion" — string- or tool-call match
Use this ONLY when the principle reduces to a literal substring presence/absence \
or a literal tool name. Good fits:
  - "must mention §4.2 of the refund policy"   → must_contain: ["§4.2"]
  - "must not call delete_account"              → must_not_call_tool: ["delete_account"]
  - "must include a link to docs.example.com"   → must_contain: ["docs.example.com"]

Bad fits (use "judge" instead):
  - "must not link to non-latest docs" — "2.20.3" today, "2.21.0" tomorrow.
  - "tone is too casual" — no fixed string captures formality.
  - "the answer should be a polite refusal" — phrasing varies.

## "judge" — qualitative principle
Use this when the rule needs *understanding* the response, not just \
string-grepping it. Fill `judge_criteria` with a short, *general* standard \
a separate LLM judge will evaluate — phrased so it would still apply when \
the same failure recurs with different surface details. Leave assertion lists empty.

# Concrete brittle-vs-robust examples (study these — they map directly to common mistakes)

Rationale: "do not use non-latest doc" (assistant linked to /docs/2.20.3/x)
  ✗ Brittle:  must_not_contain: ["2.20.3"]
              # Won't catch /docs/2.21.0/, /docs/v2/, /archive/...
  ✓ Robust:   strategy = "judge"
              judge_criteria = "Any documentation links must point to the
                  latest published version. Reject responses that include
                  versioned, archived, or otherwise non-latest doc URLs."

Rationale: "answer is too long, should be one paragraph"
  ✗ Brittle:  must_not_contain: ["\\n\\n"]   # collapses on one false positive
  ✓ Robust:   strategy = "judge"
              judge_criteria = "The answer is at most one short paragraph
                  (~3 sentences); no headings, lists, or multi-paragraph
                  structure."

Rationale: "must mention the §4.2 clause specifically"
  ✓ Robust:   strategy = "assertion"
              must_contain: ["§4.2"]
              # The literal "§4.2" IS the principle here — no generalization needed.

# Output

Fill `rationale_summary` with a short (<=80 char) summary of the original rationale.
Pick `strategy` and fill the matching fields. Return JSON matching the schema.
"""


def _default_llm_call(prompt: str) -> str:
    """Invoke the auto-selected playground LLM provider.

    See :mod:`mlflow.playground._llm` for provider selection (Claude Code
    CLI by default, Databricks endpoint as fallback). The ``_LLMTestCase``
    schema is enforced natively by whichever provider is chosen.
    """
    from mlflow.playground._llm import call_default_llm

    return call_default_llm(prompt, response_schema=_LLMTestCase)


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
