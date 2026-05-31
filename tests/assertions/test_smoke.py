"""Smoke tests for @mlflow.assertions and the verify pytest fixture.

These exercise the plumbing end-to-end without needing a live LLM judge.
Custom @scorer-decorated functions stand in for real scorers.
"""

from __future__ import annotations

import time

import pytest

import mlflow
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


@mlflow.assertions(returns_true)
def test_passing_bool_scorer(verify):
    verify("anything")


@mlflow.assertions(returns_false)
def test_failing_bool_scorer_raises_assertion_error(verify):
    with pytest.raises(AssertionError, match="returns_false"):
        verify("anything")


@mlflow.assertions(yes_feedback)
def test_yes_feedback_passes(verify):
    verify("anything")


@mlflow.assertions(no_feedback)
def test_no_feedback_fails(verify):
    with pytest.raises(AssertionError, match="no_feedback"):
        verify("anything")


@mlflow.assertions(numeric_high)
def test_high_numeric_passes(verify):
    verify("anything")


@mlflow.assertions(numeric_low)
def test_low_numeric_fails(verify):
    with pytest.raises(AssertionError, match="numeric_low"):
        verify("anything")


@mlflow.assertions(returns_true, yes_feedback, numeric_high)
def test_multiple_passing_scorers(verify):
    verify("anything")


@mlflow.assertions(returns_true, no_feedback, numeric_high)
def test_one_failing_among_many_fails(verify):
    with pytest.raises(AssertionError, match="no_feedback"):
        verify("anything")


@mlflow.assertions(slow_a, slow_b, slow_c)
def test_scorers_run_concurrently(verify):
    start = time.perf_counter()
    verify("anything")
    elapsed = time.perf_counter() - start
    # 3 scorers x 0.4s sequential = 1.2s. Concurrent should be ~0.4s + overhead.
    assert elapsed < 0.9


@mlflow.assertions(returns_true)
def test_verify_with_inputs_and_expectations(verify):
    verify("response text", inputs="some input", expectations={"key": "value"})


@pytest.mark.parametrize("phrase", ["alpha", "beta"])
@mlflow.assertions(returns_true)
def test_parametrize_threads_param_value(verify, phrase):
    # Regression: @mlflow.assertions must compose with @pytest.mark.parametrize.
    # The bundle previously listed parametrize args as required fixtures and
    # raised "fixture 'phrase' not found"; now each item's callspec value is
    # injected into the body instead.
    assert phrase in ("alpha", "beta")
    verify(phrase)


@mlflow.assertions(returns_true)
def test_verify_attaches_feedback_when_trace_exists(verify):
    @mlflow.trace
    def fake_agent(query: str) -> str:
        return f"response to {query}"

    response = fake_agent("hello")
    verify(response)
    # S1: feedback should attach to the trace produced above. We confirm the
    # plumbing does not raise. Verifying the actual tag write is S2 territory.


def test_missing_decorator_fails_clearly():
    with pytest.raises(ValueError, match="at least one scorer"):

        @mlflow.assertions()
        def _bad():
            pass


def test_unsupported_arg_type_fails_clearly():
    with pytest.raises(TypeError, match="rubric string or a Scorer"):

        @mlflow.assertions(42)  # not a string or scorer
        def _bad():
            pass


def test_string_rubric_is_wrapped_as_guidelines():
    from mlflow.genai.scorers import Guidelines

    @mlflow.assertions("The response should be in English")
    def _dummy():
        pass

    attached = getattr(_dummy, "_mlflow_assertions")
    assert len(attached) == 1
    assert isinstance(attached[0], Guidelines)
    # Name was slugified from the rubric text.
    assert attached[0].name == "the_response_should_be_in_english"


def test_string_and_scorer_mixed():
    from mlflow.genai.scorers import Guidelines

    @mlflow.assertions("Refuses politely", returns_true)
    def _dummy():
        pass

    attached = getattr(_dummy, "_mlflow_assertions")
    assert len(attached) == 2
    assert isinstance(attached[0], Guidelines)
    assert attached[0].name == "refuses_politely"
    # Scorer instance preserved as-is.
    assert attached[1] is returns_true
