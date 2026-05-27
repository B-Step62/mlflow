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

    def format_line(self) -> str:
        icon = "PASS" if self.passed else "FAIL"
        rationale = f'  "{self.rationale}"' if self.rationale else ""
        return f"  {icon}  {self.scorer_name}  {self.value!r}{rationale}"


def run_assertions(
    scorers: list[Any],
    *,
    outputs: Any,
    inputs: Any = None,
    expectations: dict[str, Any] | None = None,
    trace_id: str | None = None,
    max_workers: int = _DEFAULT_JUDGE_CONCURRENCY,
) -> list[AssertionResult]:
    """Run all scorers concurrently. Attach feedback to the trace. Return results.

    Failures do not interrupt other scorers. The caller decides whether to
    raise based on the collected results.
    """
    if trace_id is None:
        trace_id = mlflow.get_last_active_trace_id()

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


def _invoke_scorer(scorer, *, inputs, outputs, expectations):
    # Scorer.run() inspects the scorer's signature and forwards only the
    # kwargs it accepts. A scorer declared as `def f(outputs)` won't be
    # passed `inputs=...`.
    return scorer.run(inputs=inputs, outputs=outputs, expectations=expectations)


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
