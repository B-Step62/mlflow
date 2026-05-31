"""Pytest plugin for ``@mlflow.assertions``.

Auto-registered via the ``pytest11`` entry point in ``pyproject.toml``. Users
do not need to add anything to their conftest.

Provides:
- ``verify`` fixture used inside ``@mlflow.assertions``-decorated tests.
- A collection-time hook that **bundles** all ``@mlflow.assertions`` tests in
  a module into a single synthetic pytest item. Inside the bundle, the
  original test bodies run concurrently in a thread pool sized by
  ``MLFLOW_GENAI_EVAL_MAX_WORKERS`` (default 10), and each test's result is
  reported individually via pytest 9's native subtests.

Why bundle? Pytest's ``SetupState`` enforces strict LIFO push/pop of items.
That makes it structurally impossible to set up two sibling tests
concurrently without violating the invariant. Collapsing N tests into one
pytest item sidesteps the constraint entirely: pytest sees one item, one
setup, one teardown. The thread pool lives inside the item's body, where
pytest's internals do not reach. Session-scoped fixtures are built once and
shared across all parallel test bodies because we stay in a single process.

Set ``MLFLOW_GENAI_EVAL_MAX_WORKERS=1`` to disable bundling-based
parallelism (tests still bundle but execute sequentially).

This plugin also:

- Tags every trace produced inside a ``verify(...)`` call with
  ``mlflow.test.name``, ``mlflow.test.session_id`` and (for parametrized
  cases) ``mlflow.test.case_id`` so test traces are findable in MLflow UI.
- Prints a per-scorer pass/fail summary at the end of every pytest run
  that used ``@mlflow.assertions``. Set ``MLFLOW_TEST_SESSION_ID`` to
  override the auto-generated session id (useful in CI).
"""

from __future__ import annotations

import datetime
import inspect
import logging
import os
import threading
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import pytest

from mlflow._assertions.decorator import ASSERTIONS_ATTR
from mlflow._assertions.runner import AssertionResult, make_verify
from mlflow.environment_variables import MLFLOW_GENAI_EVAL_MAX_WORKERS

_logger = logging.getLogger(__name__)

_THREAD_PREFIX = "MlflowAssertions"
# Name that shows up in pytest's nodeid after `::`. Short and human-readable
# so the progress line is not full of internal jargon. Each file gets its
# own bundle; the file path in the nodeid disambiguates between bundles.
_BUNDLE_ITEM_NAME = "mlflow_assertions"
_BUNDLE_COUNT_ATTR = "_mlflow_bundled_count"

TAG_TEST_NAME = "mlflow.test.name"
TAG_SESSION_ID = "mlflow.test.session_id"
TAG_CASE_ID = "mlflow.test.case_id"

# Module-level session state. Reset at sessionstart; collected from across
# threads under a lock; flushed by the terminal-summary hook.
_session_id: str | None = None
_results_lock = threading.Lock()
_results: list[tuple[str, AssertionResult]] = []


def _record_results(test_name: str, results: list[AssertionResult]) -> None:
    with _results_lock:
        for r in results:
            _results.append((test_name, r))


def _case_id_from_item_name(item_name: str) -> str | None:
    """Pull the parametrize id out of ``test_x[case1-case2]``. None when absent."""
    if "[" not in item_name or not item_name.endswith("]"):
        return None
    return item_name[item_name.index("[") + 1 : -1]


def _build_trace_tags(test_name: str, case_id: str | None) -> dict[str, str]:
    tags: dict[str, str] = {TAG_TEST_NAME: test_name}
    if _session_id is not None:
        tags[TAG_SESSION_ID] = _session_id
    if case_id is not None:
        tags[TAG_CASE_ID] = case_id
    return tags


def pytest_sessionstart(session: pytest.Session) -> None:
    global _session_id
    override = os.environ.get("MLFLOW_TEST_SESSION_ID")
    if override:
        _session_id = override
    else:
        stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
        _session_id = f"{stamp}-{uuid.uuid4().hex[:6]}"
    with _results_lock:
        _results.clear()


def pytest_report_collectionfinish(
    config: pytest.Config, start_path, startdir, items
) -> list[str] | None:
    """Add a line after pytest's "collected N items" that reports the real
    underlying test count (since bundles collapse many tests into one item).
    """
    bundles = [i for i in items if getattr(i, _BUNDLE_COUNT_ATTR, 0) > 0]
    if not bundles:
        return None
    total = sum(getattr(b, _BUNDLE_COUNT_ATTR, 0) for b in bundles)
    n_bundles = len(bundles)
    bundle_word = "bundle" if n_bundles == 1 else "bundles"
    return [
        f"  ({total} @mlflow.assertions tests in {n_bundles} parallel {bundle_word})"
    ]


@pytest.hookimpl(tryfirst=True)
def pytest_report_teststatus(report, config: pytest.Config):
    """Display subtests as if they were regular tests.

    Without this, pytest-subtests renders every subtest as ``SUBPASSED[name]``
    which (a) is verbose, (b) leaves a stale progress percentage on every
    line because the bundle counts as one item. Returning the same shape as
    a regular TestReport (".", "PASSED [name]") makes subtests blend into
    the normal progress display.

    The first character is what shows in non-verbose (``.`` / ``F``); the
    verbose word still includes the subtest's ``msg`` so the user can read
    which original test was the one that failed.
    """
    if report.when != "call":
        return None
    try:
        from _pytest.subtests import SubtestReport
    except ImportError:
        return None
    if not isinstance(report, SubtestReport):
        return None

    msg = getattr(report.context, "msg", None) or "?"
    if report.passed:
        return ("passed", ".", f"PASSED [{msg}]")
    if report.failed:
        return ("failed", "F", f"FAILED [{msg}]")
    if report.skipped:
        return ("skipped", "s", f"SKIPPED [{msg}]")
    return None


def pytest_terminal_summary(
    terminalreporter, exitstatus: int, config: pytest.Config
) -> None:
    """Print per-scorer pass/fail rollup across the whole session."""
    with _results_lock:
        snapshot = list(_results)
    if not snapshot:
        return

    by_scorer: dict[str, dict] = defaultdict(
        lambda: {"pass": 0, "fail": 0, "fails": []}
    )
    for test_name, result in snapshot:
        bucket = by_scorer[result.scorer_name]
        if result.passed:
            bucket["pass"] += 1
        else:
            bucket["fail"] += 1
            bucket["fails"].append(test_name)

    terminalreporter.write_sep("=", "mlflow.assertions summary")
    for scorer_name in sorted(by_scorer):
        s = by_scorer[scorer_name]
        total = s["pass"] + s["fail"]
        status = "PASS" if s["fail"] == 0 else "FAIL"
        terminalreporter.write_line(f"  {status}  {scorer_name}  {s['pass']}/{total}")
        if s["fails"]:
            # Dedupe in case the same test produced the same scorer failure
            # via multiple verify() calls in one test body.
            unique = sorted(set(s["fails"]))
            terminalreporter.write_line(f"        failed: {', '.join(unique)}")
    terminalreporter.write_line(f"  session_id: {_session_id}")


@pytest.fixture
def verify(request: pytest.FixtureRequest):
    """Run declared assertions against the agent's output.

    Reads the scorer list from the ``@mlflow.assertions(...)`` decorator on
    the test function. Runs each scorer concurrently, attaches feedback to
    the last active trace, and raises ``AssertionError`` if any scorer
    reports a failing value.

    Usage::

        @mlflow.assertions(Safety(), Guidelines("..."))
        def test_x(agent, verify):
            response = agent.invoke("...")
            verify(response)
            verify(response, inputs="...", expectations={"...": ...})
    """
    test_func = request.function
    scorers = getattr(test_func, ASSERTIONS_ATTR, None)
    if not scorers:
        pytest.fail(
            f"verify() fixture used in {test_func.__name__} but no "
            f"@mlflow.assertions(...) decorator declared. Add "
            f"@mlflow.assertions(scorer1, scorer2, ...) to the test function."
        )

    test_name = test_func.__name__
    case_id = _case_id_from_item_name(request.node.name)
    trace_tags = _build_trace_tags(test_name, case_id)

    def on_results(results: list[AssertionResult]) -> None:
        _record_results(test_name, results)

    return make_verify(scorers, trace_tags=trace_tags, on_results=on_results)


def _is_assertion_test(item: pytest.Item) -> bool:
    """True when the item carries an ``@mlflow.assertions`` decorator."""
    if not isinstance(item, pytest.Function):
        return False
    return hasattr(item.function, ASSERTIONS_ATTR)


def _resolve_workers() -> int:
    return max(1, MLFLOW_GENAI_EVAL_MAX_WORKERS.get())


def _bundle_needs_trace(bundled_items: list[pytest.Function]) -> bool:
    """True if any bundled test declares a scorer that consumes the ``trace``.

    Such scorers resolve the (thread-local) last-active trace, which is only
    unambiguous when tests run serially - so a bundle containing one is executed
    sequentially rather than in the thread pool.
    """
    for item in bundled_items:
        for scorer in getattr(item.function, ASSERTIONS_ATTR, []) or []:
            target = getattr(scorer, "__call__", scorer)
            try:
                if "trace" in inspect.signature(target).parameters:
                    return True
            except (TypeError, ValueError):
                continue
    return False


def _make_bundle_callable(bundled_items: list[pytest.Function]):
    """Build a function whose signature lists the union of all bundled tests'
    fixtures (excluding ``verify``).

    pytest reads the signature to know which fixtures to inject. The function
    body dispatches each original test body in a thread pool, then reports
    each via the ``subtests`` fixture (parallel execution, serial reporting).
    """
    # Union of fixtures used by the bundled tests, plus ``subtests`` for
    # per-result reporting. Exclude ``verify`` - we synthesize a per-test
    # verifier inside instead, because the real ``verify`` fixture reads the
    # currently-running test's decorator, and the bundle has none.
    union: set[str] = {"subtests"}
    for item in bundled_items:
        union.update(item.fixturenames)
    union.discard("verify")
    # Values supplied by ``@pytest.mark.parametrize`` arrive through each item's
    # ``callspec``, not through fixtures. They still show up in ``fixturenames``,
    # so leaving them in the bundle signature makes pytest try (and fail) to
    # resolve them as fixtures ("fixture '<param>' not found"). Drop them here
    # and re-inject each item's own values from its callspec in ``_execute_one``.
    for item in bundled_items:
        callspec = getattr(item, "callspec", None)
        if callspec is not None:
            union -= set(callspec.params)

    workers = _resolve_workers()

    def bundle_body(**fixtures):
        subtests = fixtures.pop("subtests")
        results: list[tuple[pytest.Function, BaseException | None]] = []

        # Enable tracing-only autologging for all installed flavors while the
        # tests run, mirroring mlflow.genai.evaluate(). This way a test that
        # exercises an instrumented agent produces a trace automatically, so
        # span-introspecting @scorer(trace=...) assertions work without the
        # user wiring up mlflow.<flavor>.autolog() themselves. Config is
        # restored on exit.
        from mlflow.models.evaluation.utils.trace import (
            configure_autologging_for_evaluation,
        )

        # Scorers that introspect the trace resolve the last-active trace, which
        # MLflow tracks in OS-thread-local storage. The thread pool reuses worker
        # threads across tests, so a trace-introspecting scorer could observe
        # another (or a stale) test's trace. Run such bundles sequentially, where
        # each test's trace is unambiguously the last-active one. Output-only
        # scorer bundles keep the parallel fast path.
        effective_workers = 1 if _bundle_needs_trace(bundled_items) else workers

        with configure_autologging_for_evaluation(enable_tracing=True):
            if effective_workers == 1:
                # Sequential mode: still bundled (one pytest item) but no thread
                # pool. Useful for debugging.
                for item in bundled_items:
                    err = _execute_one(item, fixtures)
                    results.append((item, err))
            else:
                pool_size = min(effective_workers, len(bundled_items))
                with ThreadPoolExecutor(
                    max_workers=pool_size, thread_name_prefix=_THREAD_PREFIX
                ) as executor:
                    future_to_item = {
                        executor.submit(_execute_one, item, fixtures): item
                        for item in bundled_items
                    }
                    # Maintain original collection order in reporting.
                    future_lookup = {future_to_item[f]: f for f in future_to_item}
                    try:
                        for item in bundled_items:
                            future = future_lookup[item]
                            err = future.result()
                            results.append((item, err))
                    except KeyboardInterrupt:
                        executor.shutdown(cancel_futures=True)
                        raise

        for item, err in results:
            with subtests.test(msg=item.name):
                if err is not None:
                    raise err

    sig_params = [
        inspect.Parameter(name, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        for name in sorted(union)
    ]
    bundle_body.__signature__ = inspect.Signature(parameters=sig_params)
    bundle_body.__name__ = _BUNDLE_ITEM_NAME
    return bundle_body


def _execute_one(
    item: pytest.Function, fixtures: dict
) -> BaseException | None:
    """Run one bundled test's body with the appropriate fixture subset.

    Returns the raised exception (or None on success). Caller re-raises
    inside the per-test subtests context for proper per-test reporting.
    """
    scorers = getattr(item.function, ASSERTIONS_ATTR, [])
    test_name = item.function.__name__
    case_id = _case_id_from_item_name(item.name)
    trace_tags = _build_trace_tags(test_name, case_id)

    def on_results(results: list[AssertionResult]) -> None:
        _record_results(test_name, results)

    per_test_verify = make_verify(scorers, trace_tags=trace_tags, on_results=on_results)

    # Use the function's signature, not item.fixturenames - the latter can
    # include plugin-injected extras (e.g. pytest-asyncio's
    # ``event_loop_policy``) the test body never declared.
    try:
        signature = inspect.signature(item.obj)
    except (TypeError, ValueError):
        signature = None
    accepted = set(signature.parameters) if signature else set(item.fixturenames)

    # Parametrize values come from this item's callspec, not the bundle fixtures.
    callspec = getattr(item, "callspec", None)
    param_values = dict(callspec.params) if callspec is not None else {}

    item_args: dict = {}
    for name in accepted:
        if name == "verify":
            item_args["verify"] = per_test_verify
        elif name in param_values:
            item_args[name] = param_values[name]
        elif name in fixtures:
            item_args[name] = fixtures[name]

    try:
        item.obj(**item_args)
    except BaseException as e:  # noqa: BLE001 - propagate to caller
        return e
    return None


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(
    session: pytest.Session, items: list[pytest.Item]
) -> None:
    """Collapse ``@mlflow.assertions`` tests in the same module into one bundle.

    Runs LAST so that pytest's built-in ``-k`` / ``-m`` / nodeid filters have
    already pruned ``items`` to what the user actually selected. We only
    bundle what's left, so ``pytest -k some_specific_test`` runs that one
    test as a normal item (no bundle), and ``pytest`` (no filter) bundles
    everything for max parallelism.

    Tests collected from different modules each get their own bundle. If a
    module has only one assertion test, no bundling happens (no benefit).
    Non-assertion tests are left alone.
    """
    by_module: dict = {}
    for item in items:
        if _is_assertion_test(item):
            by_module.setdefault(item.module, []).append(item)

    for module, group in by_module.items():
        if len(group) < 2:
            continue

        bundle_body = _make_bundle_callable(group)
        parent = group[0].parent
        bundle_item = pytest.Function.from_parent(
            parent=parent,
            name=_BUNDLE_ITEM_NAME,
            callobj=bundle_body,
        )
        # Stash the bundled count so pytest_report_collectionfinish can give
        # an honest "N tests in M parallel bundles" message.
        setattr(bundle_item, _BUNDLE_COUNT_ATTR, len(group))

        # Insert the bundle at the position of the first original item so
        # that tests written after the bundled set still run in order.
        first_index = min(items.index(o) for o in group)
        for original in group:
            items.remove(original)
        items.insert(first_index, bundle_item)
