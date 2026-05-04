"""Unit tests for ``mlflow.playground.test_runner.evaluate``.

Pure-function tests; no DB / HTTP / MLflow runtime touched.
"""

from __future__ import annotations

import json

import pytest

from mlflow.playground.test_runner import (
    AgentResponse,
    evaluate,
    normalize_agent_response,
)


# --- Assertion strategy ------------------------------------------------------


def test_assertion_pass_all_clauses():
    spec = {
        "strategy": "assertion",
        "assertion": {
            "must_contain": ["§4.2"],
            "must_not_contain": ["scam"],
            "must_call_tool": ["lookup_policy"],
            "must_not_call_tool": ["delete_account"],
        },
    }
    response = AgentResponse(
        text="See §4.2 of the refund policy.",
        tool_calls=["lookup_policy"],
    )
    verdict = evaluate(spec, response)
    assert verdict.passed
    assert verdict.strategy == "assertion"
    # All four clauses produced positive reasons.
    assert any("contains required substring" in r for r in verdict.reasons)
    assert any("forbidden substring absent" in r for r in verdict.reasons)
    assert any("called required tool" in r for r in verdict.reasons)
    assert any("forbidden tool absent" in r for r in verdict.reasons)


@pytest.mark.parametrize(
    ("spec_overrides", "response_kwargs", "expected_failure_fragment"),
    [
        (
            {"must_contain": ["§4.2"]},
            {"text": "See the refund policy."},
            "missing required substring",
        ),
        (
            {"must_not_contain": ["scam"]},
            {"text": "this might be a scam"},
            "forbidden substring present",
        ),
        (
            {"must_call_tool": ["lookup_policy"]},
            {"text": "yes", "tool_calls": []},
            "missing required tool call",
        ),
        (
            {"must_not_call_tool": ["delete_account"]},
            {"text": "ok", "tool_calls": ["delete_account"]},
            "forbidden tool call invoked",
        ),
    ],
)
def test_assertion_fail_paths(
    spec_overrides: dict, response_kwargs: dict, expected_failure_fragment: str
):
    spec = {"strategy": "assertion", "assertion": spec_overrides}
    verdict = evaluate(spec, AgentResponse(**response_kwargs))
    assert not verdict.passed
    assert any(expected_failure_fragment in r for r in verdict.reasons)


def test_assertion_empty_spec_is_vacuously_passing():
    verdict = evaluate(
        {"strategy": "assertion", "assertion": {}},
        AgentResponse(text="anything"),
    )
    assert verdict.passed
    assert "vacuously" in verdict.reasons[0]


# --- Judge strategy ----------------------------------------------------------


def _stub_judge_llm(passed: bool, reasoning: str = "stub reasoning"):
    """Return a judge-LLM callable that always answers with this verdict."""

    def _llm(prompt: str) -> str:
        return json.dumps({"passed": passed, "reasoning": reasoning})

    return _llm


def test_judge_pass():
    spec = {"strategy": "judge", "judge": {"criteria": "Be professional."}}
    verdict = evaluate(
        spec,
        AgentResponse(text="Hello, I'd be happy to help."),
        judge_llm=_stub_judge_llm(True, "tone is professional"),
    )
    assert verdict.passed
    assert verdict.judge_reasoning == "tone is professional"
    assert verdict.strategy == "judge"


def test_judge_fail_includes_reasoning_in_reasons():
    spec = {"strategy": "judge", "judge": {"criteria": "Be professional."}}
    verdict = evaluate(
        spec,
        AgentResponse(text="hey lol sup"),
        judge_llm=_stub_judge_llm(False, "tone is too casual"),
    )
    assert not verdict.passed
    assert "tone is too casual" in verdict.reasons[0]


def test_judge_missing_criteria_fails():
    spec = {"strategy": "judge", "judge": {"criteria": ""}}
    # The LLM must NOT be invoked when criteria is empty.
    called = []

    def _should_not_be_called(prompt):
        called.append(prompt)
        return ""

    verdict = evaluate(spec, AgentResponse(text="x"), judge_llm=_should_not_be_called)
    assert not verdict.passed
    assert "missing 'criteria'" in verdict.reasons[0]
    assert called == []


def test_judge_malformed_llm_response_surfaces_clean_error():
    spec = {"strategy": "judge", "judge": {"criteria": "be helpful"}}
    verdict = evaluate(
        spec,
        AgentResponse(text="x"),
        judge_llm=lambda _: "not json at all",
    )
    assert not verdict.passed
    assert "malformed JSON" in verdict.reasons[0]


def test_judge_prompt_includes_expected_response_when_present():
    spec = {
        "strategy": "judge",
        "judge": {"criteria": "be helpful", "expected_response": "42"},
    }
    seen = []

    def _capture(prompt):
        seen.append(prompt)
        return json.dumps({"passed": True, "reasoning": "ok"})

    evaluate(spec, AgentResponse(text="42"), judge_llm=_capture)
    assert seen and "'42'" in seen[0]


# --- Strategy fallthrough ----------------------------------------------------


def test_unknown_strategy_fails_clean():
    verdict = evaluate({"strategy": "horoscope"}, AgentResponse(text="x"))
    assert not verdict.passed
    assert "Unknown test strategy" in verdict.reasons[0]


# --- normalize_agent_response ------------------------------------------------


def test_normalize_anthropic_content_blocks():
    payload = {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "Hi!"},
            {"type": "tool_use", "name": "search"},
            {"type": "tool_use", "name": "calc"},
        ],
    }
    n = normalize_agent_response(payload)
    assert n.text == "Hi!"
    assert n.tool_calls == ["search", "calc"]


def test_normalize_chatcompletion():
    payload = {
        "choices": [
            {
                "message": {
                    "content": "Hello",
                    "tool_calls": [{"function": {"name": "weather"}}],
                }
            }
        ]
    }
    n = normalize_agent_response(payload)
    assert n.text == "Hello"
    assert n.tool_calls == ["weather"]


def test_normalize_openai_responses_api():
    payload = {
        "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "Yes."}]},
            {"type": "function_call", "name": "calc"},
        ]
    }
    n = normalize_agent_response(payload)
    assert n.text == "Yes."
    assert n.tool_calls == ["calc"]


def test_normalize_unknown_shape_returns_no_tools():
    n = normalize_agent_response({"foo": "bar"})
    assert n.tool_calls == []
