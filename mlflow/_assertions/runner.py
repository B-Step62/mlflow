"""Scorer execution and feedback attachment for ``@mlflow.assertions``.

Scorers declared on a test run concurrently inside ``verify()``. Their results
attach as ``Feedback`` to the last active trace. The runner is intentionally
small: no caching, no retries, no concurrency knob beyond a sensible default
for v0.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

import mlflow
from mlflow.entities.assessment import Feedback

_logger = logging.getLogger(__name__)

_DEFAULT_JUDGE_CONCURRENCY = 16


@dataclass
class AssertionResult:
    scorer_name: str
    value: Any
    rationale: str | None
    passed: bool
    error: Exception | None = None

    def summary(self) -> str:
        """One-liner of the form ``<scorer>: <rationale or value>``.

        Used in the AssertionError message so pytest's short summary
        actually communicates *why* the assertion failed, not just *that*
        it failed.
        """
        if self.rationale:
            return f"{self.scorer_name}: {self.rationale}"
        return f"{self.scorer_name}: value={self.value!r}"


def make_verify(
    scorers: list[Any],
    *,
    trace_tags: dict[str, str] | None = None,
    on_results: Any = None,
):
    """Build a ``verify(outputs, ...)`` callable bound to a specific scorer list.

    Used by both the pytest fixture and the bundle dispatcher so failure
    formatting stays consistent.

    Args:
        scorers: Scorers to run on each ``verify(...)`` call.
        trace_tags: When set, applied to the trace before scorer feedbacks
            attach. Typical keys: ``mlflow.test.name``, ``mlflow.test.session_id``,
            ``mlflow.test.case_id``.
        on_results: Optional callable invoked with the ``list[AssertionResult]``
            after each ``verify`` call. The pytest plugin uses this to feed
            its end-of-session per-scorer summary.
    """

    def _verify(outputs, *, inputs=None, expectations=None):
        results = run_assertions(
            scorers,
            inputs=inputs,
            outputs=outputs,
            expectations=expectations,
            trace_tags=trace_tags,
        )
        if on_results is not None:
            on_results(results)

        failures = [r for r in results if not r.passed]
        if not failures:
            return

        # Pack the actionable signal onto the first line so pytest's short
        # summary tells the user *why* the assertion failed, not just that
        # ``verify()`` errored.
        if len(failures) == 1:
            raise AssertionError(failures[0].summary())

        names = ", ".join(r.scorer_name for r in failures)
        header = f"{len(failures)} assertions failed: {names}"
        detail = "\n".join(f"  - {r.summary()}" for r in failures)
        raise AssertionError(f"{header}\n{detail}")

    return _verify


def run_assertions(
    scorers: list[Any],
    *,
    outputs: Any,
    inputs: Any = None,
    expectations: dict[str, Any] | None = None,
    trace_id: str | None = None,
    trace_tags: dict[str, str] | None = None,
    max_workers: int = _DEFAULT_JUDGE_CONCURRENCY,
) -> list[AssertionResult]:
    """Run all scorers concurrently. Attach feedback to the trace. Return results.

    Failures do not interrupt other scorers. The caller decides whether to
    raise based on the collected results.
    """
    if trace_id is None:
        # thread_local=True returns the trace produced in *this* thread - the
        # agent call the test just made (and completed) before calling verify().
        # This keeps trace-introspecting scorers correctly associated with their
        # own test when the assertion bundle runs tests in parallel threads.
        # (Note: agents that run under their own asyncio loop may not propagate
        # the thread-local trace; such tests should assert on outputs directly.)
        trace_id = mlflow.get_last_active_trace_id(thread_local=True)

    # Materialize the trace so scorers that declare a ``trace`` parameter (e.g.
    # span-introspecting @scorer functions) receive it. flush=True forces any
    # pending async trace export to complete first.
    trace = mlflow.get_trace(trace_id, silent=True, flush=True) if trace_id else None

    # Tag the trace before attaching feedback so the per-test identifiers are
    # visible on the trace even if a scorer raises mid-run.
    if trace_id and trace_tags:
        for key, value in trace_tags.items():
            if value is not None:
                try:
                    mlflow.set_trace_tag(trace_id, key, str(value))
                except Exception as e:
                    _logger.warning("Failed to set trace tag %s=%r on %s: %s", key, value, trace_id, e)

    results: list[AssertionResult] = []
    workers = min(max_workers, len(scorers)) or 1

    with ThreadPoolExecutor(max_workers=workers) as ex:
        future_to_scorer = {
            ex.submit(
                _invoke_scorer,
                scorer,
                inputs=inputs,
                outputs=outputs,
                expectations=expectations,
                trace=trace,
            ): scorer
            for scorer in scorers
        }
        for future in as_completed(future_to_scorer):
            scorer = future_to_scorer[future]
            scorer_name = _scorer_name(scorer)
            try:
                raw = future.result()
            except Exception as e:
                _logger.warning("Scorer %s raised: %s", scorer_name, e)
                results.append(
                    AssertionResult(
                        scorer_name=scorer_name,
                        value=None,
                        rationale=str(e),
                        passed=False,
                        error=e,
                    )
                )
                _try_log_error(trace_id, scorer_name, e)
                continue

            value = _extract_value(raw)
            rationale = _extract_rationale(raw)
            passed = _is_passing(value)

            results.append(
                AssertionResult(
                    scorer_name=scorer_name,
                    value=value,
                    rationale=rationale,
                    passed=passed,
                )
            )
            _try_log_feedback(trace_id, scorer_name, value, rationale)

    return results


def _invoke_scorer(scorer, *, inputs, outputs, expectations, trace=None):
    # Scorer.run() inspects the scorer's signature and forwards only the
    # kwargs it accepts. A scorer declared as `def f(outputs)` won't be
    # passed `inputs=...`; one declared as `def f(trace)` receives the trace.
    return scorer.run(inputs=inputs, outputs=outputs, expectations=expectations, trace=trace)


def _scorer_name(scorer) -> str:
    return getattr(scorer, "name", None) or type(scorer).__name__


def _extract_value(raw) -> Any:
    if isinstance(raw, Feedback):
        return raw.value
    if isinstance(raw, list):
        return [_extract_value(f) for f in raw]
    return raw


def _extract_rationale(raw) -> str | None:
    if isinstance(raw, Feedback):
        return raw.rationale
    return None


def _is_passing(value: Any) -> bool:
    """Default pass/fail rule for v0.

    - bool True -> pass; bool False -> fail
    - "yes" / "pass" / "true" (case-insensitive) -> pass; anything else string -> fail
    - numeric >= 0.5 -> pass
    - list of values -> all must pass
    """
    match value:
        case bool():
            return value
        case str():
            return value.lower().strip() in {"yes", "pass", "true"}
        case int() | float():
            return value >= 0.5
        case list():
            return all(_is_passing(v) for v in value)
        case _:
            return False


def _try_log_feedback(trace_id: str | None, name: str, value: Any, rationale: str | None) -> None:
    if not trace_id:
        return
    try:
        mlflow.log_feedback(trace_id=trace_id, name=name, value=value, rationale=rationale)
    except Exception as e:
        _logger.warning("Failed to log feedback %s on %s: %s", name, trace_id, e)


def _try_log_error(trace_id: str | None, name: str, error: Exception) -> None:
    if not trace_id:
        return
    try:
        mlflow.log_feedback(
            trace_id=trace_id,
            name=name,
            error=error,
            rationale=f"Scorer execution failed: {error}",
        )
    except Exception as e:
        _logger.warning("Failed to log error feedback %s on %s: %s", name, trace_id, e)
