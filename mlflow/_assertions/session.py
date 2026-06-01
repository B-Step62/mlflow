"""Session state for MLflow assertion tests.

Holds the per-pytest-invocation state shared by the public
``mlflow.genai.assert_behavior`` function and the pytest plugin: the session id,
the regression-test run, and the collected per-scorer results. Lives in its own
module (no ``pytest`` import) so ``assert_behavior`` works in notebooks and
scripts too, not just under pytest.
"""

from __future__ import annotations

import datetime
import logging
import os
import threading
import uuid
from collections import defaultdict

from mlflow._assertions.runner import AssertionResult

_logger = logging.getLogger(__name__)

TAG_TEST_NAME = "mlflow.test.name"
TAG_SESSION_ID = "mlflow.test.session_id"
TAG_CASE_ID = "mlflow.test.case_id"

_lock = threading.Lock()
_session_id: str | None = None
_run_id: str | None = None
_run_owned: bool = False
_results: list[tuple[str, AssertionResult]] = []

# Per-thread "which test am I in", set by the bundle runner before each test
# body. Inside a bundle, ``PYTEST_CURRENT_TEST`` names the synthetic bundle item,
# not the real test -- so verify() reads this thread-local first for correct
# per-test trace tagging in the parallel path.
_current = threading.local()


def set_current_test(test_name: str | None, case_id: str | None = None) -> None:
    _current.value = (test_name, case_id)


def current_test() -> tuple[str | None, str | None]:
    return getattr(_current, "value", (None, None))


def reset(session_id: str | None = None) -> None:
    """Start a fresh session (called by the plugin at ``pytest_sessionstart``)."""
    global _session_id, _run_id, _run_owned
    if session_id is None:
        session_id = os.environ.get("MLFLOW_TEST_SESSION_ID")
    if not session_id:
        stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
        session_id = f"{stamp}-{uuid.uuid4().hex[:6]}"
    _session_id = session_id
    _run_id = None
    _run_owned = False
    with _lock:
        _results.clear()


def session_id() -> str:
    if _session_id is None:
        reset()
    return _session_id


def run_id() -> str | None:
    return _run_id


def record(test_name: str, results: list[AssertionResult]) -> None:
    with _lock:
        for r in results:
            _results.append((test_name, r))


def snapshot() -> list[tuple[str, AssertionResult]]:
    with _lock:
        return list(_results)


def aggregate_by_scorer(snap: list[tuple[str, AssertionResult]]) -> dict[str, dict]:
    by_scorer: dict[str, dict] = defaultdict(lambda: {"pass": 0, "fail": 0, "fails": []})
    for test_name, result in snap:
        bucket = by_scorer[result.scorer_name]
        if result.passed:
            bucket["pass"] += 1
        else:
            bucket["fail"] += 1
            bucket["fails"].append(test_name)
    return by_scorer


def build_trace_tags(test_name: str | None, case_id: str | None = None) -> dict[str, str]:
    tags: dict[str, str] = {}
    if test_name:
        tags[TAG_TEST_NAME] = test_name
    sid = session_id()
    if sid:
        tags[TAG_SESSION_ID] = sid
    if case_id:
        tags[TAG_CASE_ID] = case_id
    return tags


def ensure_run() -> str | None:
    """Open (or adopt) the regression-test run, once per session. Idempotent.

    Opened in the *current* tracking store (callers invoke this once the store
    is configured and before test bodies trace), so traces created afterward
    auto-link to it via the trace processor's global active-run lookup. If the
    user already has an active run, adopt and tag it (they own its lifecycle).
    Any failure is non-fatal -- assertions still run, just ungrouped.
    """
    global _run_id, _run_owned
    if _run_id is not None:
        return _run_id

    import mlflow
    from mlflow.tracking import MlflowClient
    from mlflow.utils.mlflow_tags import MLFLOW_RUN_TYPE, MLFLOW_RUN_TYPE_REGRESSION_TEST

    tags = {MLFLOW_RUN_TYPE: MLFLOW_RUN_TYPE_REGRESSION_TEST, TAG_SESSION_ID: session_id()}

    try:
        active = mlflow.active_run()
    except Exception as e:
        _logger.warning("mlflow.assertions: could not check active run: %s", e)
        return None

    if active is not None:
        try:
            client = MlflowClient()
            for k, v in tags.items():
                client.set_tag(active.info.run_id, k, v)
        except Exception as e:
            _logger.warning("mlflow.assertions: could not tag active run: %s", e)
            return None
        _run_id = active.info.run_id
        _run_owned = False
        return _run_id

    try:
        run = mlflow.start_run(tags=tags)
    except Exception as e:
        _logger.warning("mlflow.assertions: could not start regression-test run: %s", e)
        return None
    _run_id = run.info.run_id
    _run_owned = True
    return _run_id


def finalize(exitstatus: int) -> None:
    """Log roll-up metrics to the run and end it (if we opened it).

    Per-scorer pass rates land as ``pass_rate.<scorer>``; per-case feedback
    already lives on the linked traces, so it isn't re-logged at run level.
    """
    global _run_id, _run_owned
    if _run_id is None:
        return

    import mlflow
    from mlflow.tracking import MlflowClient

    snap = snapshot()
    try:
        client = MlflowClient()
        total_pass = total_fail = 0
        for scorer_name, bucket in aggregate_by_scorer(snap).items():
            n = bucket["pass"] + bucket["fail"]
            if n:
                try:
                    client.log_metric(_run_id, f"pass_rate.{scorer_name}", bucket["pass"] / n)
                except Exception as e:
                    _logger.warning("Failed to log pass_rate.%s: %s", scorer_name, e)
            total_pass += bucket["pass"]
            total_fail += bucket["fail"]
        for key, value in (
            ("pass_count", total_pass),
            ("fail_count", total_fail),
            ("total_count", total_pass + total_fail),
        ):
            try:
                client.log_metric(_run_id, key, value)
            except Exception as e:
                _logger.warning("Failed to log %s: %s", key, e)
    finally:
        if _run_owned:
            status = "FINISHED" if exitstatus == 0 else "FAILED"
            try:
                mlflow.end_run(status=status)
            except Exception as e:
                _logger.warning("Failed to end run %s: %s", _run_id, e)
