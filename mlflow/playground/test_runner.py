"""Executor for regression test rows.

YUK-14 produces a spec dict via :func:`TestCaseGenerator.to_dataset_record`,
YUK-15 stores it on the experiment's regression dataset, and this module is
the read-side counterpart: given a spec + the agent's response, decide
pass/fail with a human-readable verdict.

The interesting shape lives in ``test_spec``:

    {
      "strategy": "assertion" | "judge",
      "assertion": {
          "must_contain":      [str, ...],
          "must_not_contain":  [str, ...],
          "must_call_tool":    [str, ...],
          "must_not_call_tool":[str, ...],
      },
      # OR
      "judge": {
          "criteria": str,
          "expected_response": str | None,
      },
    }

Pure: no MLflow / HTTP / dataset access. The CLI in ``test_run_cli`` is the
caller that fetches the row, hits the agent, and feeds us this dict.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import pydantic


class JudgeLLM(Protocol):
    def __call__(self, prompt: str) -> str: ...


@dataclass
class AgentResponse:
    """Best-effort normalised view of an agent's ``/invocations`` response."""

    text: str
    tool_calls: list[str] = field(default_factory=list)
    raw: Any = None


@dataclass(frozen=True)
class TestVerdict:
    passed: bool
    reasons: list[str]
    strategy: str
    judge_reasoning: str | None = None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def evaluate(
    test_spec: dict[str, Any],
    response: AgentResponse,
    *,
    judge_llm: JudgeLLM | None = None,
) -> TestVerdict:
    """Run ``test_spec`` against ``response`` and return a :class:`TestVerdict`.

    ``test_spec`` is the ``expectations.test_spec`` cell from a row produced
    by :func:`mlflow.playground.test_case_generator.TestCaseGenerator.to_dataset_record`.
    ``judge_llm`` is only consulted when ``strategy == "judge"``; it defaults
    to the same model the test-case generator uses, so unit tests can pass
    a deterministic stub instead.
    """
    strategy = test_spec.get("strategy")
    if strategy == "assertion":
        return _eval_assertion(test_spec.get("assertion") or {}, response)
    if strategy == "judge":
        llm = judge_llm or _default_judge_llm
        return _eval_judge(test_spec.get("judge") or {}, response, llm=llm)
    return TestVerdict(
        passed=False,
        reasons=[f"Unknown test strategy: {strategy!r}"],
        strategy=str(strategy),
    )


# ---------------------------------------------------------------------------
# Assertion strategy
# ---------------------------------------------------------------------------


def _eval_assertion(assertion: dict[str, Any], response: AgentResponse) -> TestVerdict:
    failures: list[str] = []
    successes: list[str] = []

    for s in assertion.get("must_contain", []) or []:
        if s in response.text:
            successes.append(f"contains required substring {s!r}")
        else:
            failures.append(f"missing required substring {s!r}")

    for s in assertion.get("must_not_contain", []) or []:
        if s in response.text:
            failures.append(f"forbidden substring present {s!r}")
        else:
            successes.append(f"forbidden substring absent {s!r}")

    called = set(response.tool_calls)
    for t in assertion.get("must_call_tool", []) or []:
        if t in called:
            successes.append(f"called required tool {t!r}")
        else:
            failures.append(f"missing required tool call {t!r}")

    for t in assertion.get("must_not_call_tool", []) or []:
        if t in called:
            failures.append(f"forbidden tool call invoked {t!r}")
        else:
            successes.append(f"forbidden tool absent {t!r}")

    if failures:
        return TestVerdict(passed=False, reasons=failures, strategy="assertion")
    if not successes:
        # Empty assertion spec — treat as pass but flag in the reason so the
        # user doesn't think the test actually checked anything.
        return TestVerdict(
            passed=True,
            reasons=["assertion spec was empty — vacuously passed"],
            strategy="assertion",
        )
    return TestVerdict(passed=True, reasons=successes, strategy="assertion")


# ---------------------------------------------------------------------------
# Judge strategy
# ---------------------------------------------------------------------------


class _JudgeVerdict(pydantic.BaseModel):
    """Structured-output schema the judge LLM fills in."""

    passed: bool
    reasoning: str = ""


_JUDGE_PROMPT = """\
You are evaluating whether an AI assistant's response meets a quality standard.

# Standard
{criteria}{expected_section}

# Assistant response
{response_text}

# Your task
Return JSON matching the schema.

* `passed`: true if the response meets the standard, false otherwise.
* `reasoning`: one or two sentences explaining your verdict, citing concrete \
parts of the response. Be terse.
"""


def _eval_judge(
    judge: dict[str, Any],
    response: AgentResponse,
    *,
    llm: Callable[[str], str],
) -> TestVerdict:
    criteria = (judge.get("criteria") or "").strip()
    if not criteria:
        return TestVerdict(
            passed=False,
            reasons=["judge spec is missing 'criteria'"],
            strategy="judge",
        )

    expected = judge.get("expected_response")
    expected_section = (
        f"\nFor reference, an example response that would clearly pass: {expected!r}"
        if expected
        else ""
    )
    prompt = _JUDGE_PROMPT.format(
        criteria=criteria,
        expected_section=expected_section,
        response_text=response.text,
    )
    raw = llm(prompt)
    try:
        parsed = (
            _JudgeVerdict.model_validate_json(raw)
            if isinstance(raw, str)
            else _JudgeVerdict.model_validate(raw)
        )
    except pydantic.ValidationError as e:
        return TestVerdict(
            passed=False,
            reasons=[f"judge LLM returned malformed JSON: {e}"],
            strategy="judge",
        )

    return TestVerdict(
        passed=parsed.passed,
        reasons=[parsed.reasoning or ("met criteria" if parsed.passed else "failed criteria")],
        strategy="judge",
        judge_reasoning=parsed.reasoning or None,
    )


def _default_judge_llm(prompt: str) -> str:
    """Default judge: same model the generator uses."""
    from mlflow.genai.simulators.utils import (
        get_default_simulation_model,
        invoke_model_without_tracing,
    )
    from mlflow.types.llm import ChatMessage

    return invoke_model_without_tracing(
        model_uri=get_default_simulation_model(),
        messages=[ChatMessage(role="user", content=prompt)],
        response_format=_JudgeVerdict,
    )


# ---------------------------------------------------------------------------
# Best-effort response normalisation
# ---------------------------------------------------------------------------


def normalize_agent_response(payload: Any) -> AgentResponse:
    """Coerce a raw ``/invocations`` JSON body into an :class:`AgentResponse`.

    Handles the three shapes the playground server already deals with
    (Anthropic-like ``content`` blocks, OpenAI Responses ``output`` items,
    OpenAI ChatCompletion ``messages``). Tool-call extraction is best-effort
    and keyed off the same shapes; unknown shapes return an empty
    ``tool_calls`` list rather than raising.
    """
    text = _extract_text(payload)
    tool_calls = _extract_tool_calls(payload)
    return AgentResponse(text=text, tool_calls=tool_calls, raw=payload)


def _extract_text(payload: Any) -> str:
    # Mirrors mlflow.playground.server._extract_assistant_text; reproduced
    # locally so this module has no dependency on the FastAPI server.
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        return _coerce(payload)

    if payload.get("role") == "assistant":
        content = payload.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type", "text") == "text"
            )

    if isinstance(payload.get("output"), list):
        parts = []
        for item in payload["output"]:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            for c in item.get("content", []) or []:
                if isinstance(c, dict) and c.get("type") == "output_text":
                    parts.append(str(c.get("text", "")))
        if parts:
            return "".join(parts)

    if isinstance(payload.get("choices"), list):
        for choice in payload["choices"]:
            msg = (choice or {}).get("message") if isinstance(choice, dict) else None
            if isinstance(msg, dict) and msg.get("content"):
                return str(msg["content"])

    if isinstance(payload.get("messages"), list):
        for item in reversed(payload["messages"]):
            if isinstance(item, dict) and item.get("role") == "assistant":
                return _extract_text(item)

    if "content" in payload:
        return _coerce(payload["content"])
    return _coerce(payload)


def _extract_tool_calls(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    seen: list[str] = []

    def _add(name: Any) -> None:
        if isinstance(name, str) and name and name not in seen:
            seen.append(name)

    # Anthropic-like content blocks
    content = payload.get("content")
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "tool_use":
                _add(item.get("name"))

    # OpenAI Responses API
    out = payload.get("output")
    if isinstance(out, list):
        for item in out:
            if isinstance(item, dict) and item.get("type") == "function_call":
                _add(item.get("name"))

    # OpenAI ChatCompletion: choices[].message.tool_calls[].function.name
    for choice in payload.get("choices", []) or []:
        if not isinstance(choice, dict):
            continue
        msg = choice.get("message")
        if not isinstance(msg, dict):
            continue
        for tc in msg.get("tool_calls", []) or []:
            if isinstance(tc, dict):
                fn = tc.get("function")
                if isinstance(fn, dict):
                    _add(fn.get("name"))

    # Multi-message protocol: tool messages indicate prior tool calls
    for msg in payload.get("messages", []) or []:
        if isinstance(msg, dict):
            if msg.get("role") == "tool":
                _add(msg.get("name"))
            elif msg.get("role") == "assistant":
                for tc in msg.get("tool_calls", []) or []:
                    if isinstance(tc, dict):
                        fn = tc.get("function")
                        if isinstance(fn, dict):
                            _add(fn.get("name"))

    return seen


def _coerce(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


__all__ = [
    "AgentResponse",
    "JudgeLLM",
    "TestVerdict",
    "evaluate",
    "normalize_agent_response",
]


# pytest treats Test* classes as test containers; opt out the public names.
TestVerdict.__test__ = False
