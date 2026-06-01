"""Smoke tests for @mlflow.test and mlflow.genai.assert_behavior.

These exercise the plumbing end-to-end without needing a live LLM judge.
Custom @scorer-decorated functions stand in for real scorers.
"""

from __future__ import annotations

import time

import pytest

import mlflow
from mlflow._assertions.decorator import _to_scorer
from mlflow.entities import Trace
from mlflow.entities.assessment import Feedback
from mlflow.genai.scorers import scorer


@scorer
def returns_true(outputs) -> bool:
    return True


@scorer
def returns_false(outputs) -> bool:
    return False


@scorer
def slow_a(outputs) -> bool:
    time.sleep(0.4)
    return True


@scorer
def slow_b(outputs) -> bool:
    time.sleep(0.4)
    return True


@scorer
def slow_c(outputs) -> bool:
    time.sleep(0.4)
    return True


@scorer
def yes_feedback(outputs):
    return Feedback(name="yes_feedback", value="yes", rationale="all good")


@scorer
def no_feedback(outputs):
    return Feedback(name="no_feedback", value="no", rationale="not good")


@scorer
def numeric_high(outputs) -> float:
    return 0.9


@scorer
def numeric_low(outputs) -> float:
    return 0.1


@scorer
def saw_agent_span(trace) -> bool:
    # A trace-introspecting scorer. assert_behavior must resolve the trace the
    # agent produced (or the one passed explicitly) and hand it here, with the
    # agent's span available - without the test wiring the trace itself.
    return len(trace.search_spans(name="fake_agent")) > 0


@mlflow.trace
def fake_agent(query: str) -> str:
    return f"response to {query}"


@mlflow.test
def test_passing_bool_scorer():
    mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[returns_true])


@mlflow.test
def test_failing_bool_scorer_raises_assertion_error():
    with pytest.raises(AssertionError, match="returns_false"):
        mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[returns_false])


@mlflow.test
def test_yes_feedback_passes():
    mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[yes_feedback])


@mlflow.test
def test_no_feedback_fails():
    with pytest.raises(AssertionError, match="no_feedback"):
        mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[no_feedback])


@mlflow.test
def test_high_numeric_passes():
    mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[numeric_high])


@mlflow.test
def test_low_numeric_fails():
    with pytest.raises(AssertionError, match="numeric_low"):
        mlflow.genai.assert_behavior("auto", outputs="anything", assertions=[numeric_low])


@mlflow.test
def test_multiple_passing_scorers():
    mlflow.genai.assert_behavior(
        "auto", outputs="anything", assertions=[returns_true, yes_feedback, numeric_high]
    )


@mlflow.test
def test_one_failing_among_many_fails():
    with pytest.raises(AssertionError, match="no_feedback"):
        mlflow.genai.assert_behavior(
            "auto", outputs="anything", assertions=[returns_true, no_feedback, numeric_high]
        )


@mlflow.test
def test_scorers_run_concurrently():
    start = time.perf_counter()
    mlflow.genai.assert_behavior(
        "auto", outputs="anything", assertions=[slow_a, slow_b, slow_c]
    )
    elapsed = time.perf_counter() - start
    # 3 scorers x 0.4s sequential = 1.2s. Concurrent should be ~0.4s + overhead.
    assert elapsed < 0.9


@pytest.mark.parametrize("phrase", ["alpha", "beta"])
@mlflow.test
def test_parametrize_threads_param_value(phrase):
    # Regression: @mlflow.test must compose with @pytest.mark.parametrize. The
    # bundle previously listed parametrize args as required fixtures and raised
    # "fixture 'phrase' not found"; now each item's callspec value is injected.
    assert phrase in ("alpha", "beta")
    mlflow.genai.assert_behavior("auto", outputs=phrase, assertions=[returns_true])


@mlflow.test
def test_auto_resolves_the_agents_trace():
    # "auto" resolves the trace fake_agent just produced, so a span-introspecting
    # scorer sees the agent span - end to end, no trace wiring in the test.
    fake_agent("hello")
    mlflow.genai.assert_behavior("auto", assertions=[saw_agent_span])


@mlflow.test
def test_explicit_trace_argument():
    fake_agent("hello")
    trace = mlflow.get_trace(mlflow.get_last_active_trace_id(thread_local=True))
    assert isinstance(trace, Trace)
    mlflow.genai.assert_behavior(trace, assertions=[saw_agent_span])


@mlflow.test
def test_outputs_override_without_a_trace():
    # Non-traced path: "auto" resolves no trace, so the explicit outputs is what
    # gets scored. The assertion still runs and passes.
    mlflow.genai.assert_behavior("auto", outputs="some response", assertions=[returns_true])


def test_missing_assertions_fails_clearly():
    with pytest.raises(ValueError, match="at least one assertion"):
        mlflow.genai.assert_behavior("auto", outputs="x", assertions=[])


def test_unsupported_assertion_type_fails_clearly():
    with pytest.raises(TypeError, match="rubric string or a Scorer"):
        mlflow.genai.assert_behavior("auto", outputs="x", assertions=[42])


def test_invalid_trace_arg_type_fails_clearly():
    with pytest.raises(TypeError, match='Trace or the literal "auto"'):
        mlflow.genai.assert_behavior(42, outputs="x", assertions=[returns_true])


def test_string_rubric_is_wrapped_as_guidelines():
    from mlflow.genai.scorers import Guidelines

    s = _to_scorer("The response should be in English", index=0)
    assert isinstance(s, Guidelines)
    # Name was slugified from the rubric text.
    assert s.name == "the_response_should_be_in_english"


def test_string_and_scorer_mixed():
    from mlflow.genai.scorers import Guidelines

    rubric = _to_scorer("Refuses politely", index=0)
    passthrough = _to_scorer(returns_true, index=1)
    assert isinstance(rubric, Guidelines)
    assert rubric.name == "refuses_politely"
    # Scorer instance preserved as-is.
    assert passthrough is returns_true
