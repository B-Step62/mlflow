"""Pytest plugin for ``@mlflow.test`` + ``mlflow.genai.assert_behavior``.

Auto-registered via the ``pytest11`` entry point in ``pyproject.toml``. Users do
not need to add anything to their conftest.

What it does:
- A collection-time hook **bundles** all ``@mlflow.test``-marked tests in a module
  into a single synthetic pytest item. Inside the bundle, the original test bodies
  run concurrently in a thread pool sized by ``MLFLOW_GENAI_EVAL_MAX_WORKERS``
  (default 10), and each test's result is reported individually via pytest 9's
  native subtests. ``@mlflow.test`` is a no-op marker; the assertions are made in
  the body with ``mlflow.genai.assert_behavior("auto", assertions=[...])``.

Why bundle? Pytest's ``SetupState`` enforces strict LIFO push/pop of items, which
makes it structurally impossible to set up two sibling tests concurrently.
Collapsing N tests into one item sidesteps that: pytest sees one item, one setup,
one teardown; the thread pool lives inside the item body. Set
``MLFLOW_GENAI_EVAL_MAX_WORKERS=1`` to run a bundle sequentially (still one item).

- Opens one **regression-test run** for the session (lazily, on the first
  ``assert_behavior()`` / bundle start) and ends it at session finish, logging per-scorer
  pass rates + counts. Test traces auto-link to it.
- Prints a per-scorer pass/fail summary at the end of every run that used
  ``mlflow.genai.assert_behavior``. Set ``MLFLOW_TEST_SESSION_ID`` to override the
  auto-generated session id (useful in CI).
"""

from __future__ import annotations

import inspect
import logging
from concurrent.futures import ThreadPoolExecutor

import pytest

from mlflow._assertions import session as _session
from mlflow._assertions.decorator import MLFLOW_TEST_ATTR
from mlflow.environment_variables import MLFLOW_GENAI_EVAL_MAX_WORKERS

_logger = logging.getLogger(__name__)

_THREAD_PREFIX = "MlflowAssertions"
# Name that shows up in pytest's nodeid after `::`. Short and human-readable.
# Each file gets its own bundle; the file path in the nodeid disambiguates them.
_BUNDLE_ITEM_NAME = "mlflow_assertions"
_BUNDLE_COUNT_ATTR = "_mlflow_bundled_count"


def _case_id_from_item_name(item_name: str) -> str | None:
    """Pull the parametrize id out of ``test_x[case1-case2]``. None when absent."""
    if "[" not in item_name or not item_name.endswith("]"):
        return None
    return item_name[item_name.index("[") + 1 : -1]


def pytest_sessionstart(session: pytest.Session) -> None:
    _session.reset()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    # exitstatus catches both assert_behavior() failures and any test errors that never
    # reached assert_behavior(), keeping the run status honest.
    _session.finalize(exitstatus)


def pytest_report_collectionfinish(
    config: pytest.Config, start_path, startdir, items
) -> list[str] | None:
    """Report the real underlying test count (bundles collapse many into one)."""
    bundles = [i for i in items if getattr(i, _BUNDLE_COUNT_ATTR, 0) > 0]
    if not bundles:
        return None
    total = sum(getattr(b, _BUNDLE_COUNT_ATTR, 0) for b in bundles)
    n_bundles = len(bundles)
    bundle_word = "bundle" if n_bundles == 1 else "bundles"
    return [f"  ({total} @mlflow.test cases in {n_bundles} parallel {bundle_word})"]


@pytest.hookimpl(tryfirst=True)
def pytest_report_teststatus(report, config: pytest.Config):
    """Display subtests as if they were regular tests (`.` / `F`, not SUBPASSED)."""
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
    """Print per-scorer pass/fail rollup across the whole _session."""
    snapshot = _session.snapshot()
    if not snapshot:
        return

    by_scorer = _session.aggregate_by_scorer(snapshot)
    terminalreporter.write_sep("=", "mlflow.genai.assert_behavior summary")
    for scorer_name in sorted(by_scorer):
        s = by_scorer[scorer_name]
        total = s["pass"] + s["fail"]
        status = "PASS" if s["fail"] == 0 else "FAIL"
        terminalreporter.write_line(f"  {status}  {scorer_name}  {s['pass']}/{total}")
        if s["fails"]:
            unique = sorted(set(s["fails"]))
            terminalreporter.write_line(f"        failed: {', '.join(unique)}")
    terminalreporter.write_line(f"  session_id: {_session.session_id()}")
    if _session.run_id() is not None:
        terminalreporter.write_line(f"  run_id:     {_session.run_id()}")


def _is_mlflow_test(item: pytest.Item) -> bool:
    """True when the item carries the ``@mlflow.test`` marker."""
    if not isinstance(item, pytest.Function):
        return False
    return getattr(item.function, MLFLOW_TEST_ATTR, False) is True


def _resolve_workers() -> int:
    return max(1, MLFLOW_GENAI_EVAL_MAX_WORKERS.get())


def _make_bundle_callable(bundled_items: list[pytest.Function]):
    """Build a function whose signature lists the union of the bundled tests'
    fixtures. pytest reads the signature to inject fixtures; the body dispatches
    each original test body in a thread pool and reports each via ``subtests``.
    """
    union: set[str] = {"subtests"}
    for item in bundled_items:
        union.update(item.fixturenames)
    # Parametrize values arrive via each item's ``callspec``, not as fixtures.
    # Leaving them in the bundle signature makes pytest fail to resolve them as
    # fixtures, so drop them here and re-inject from callspec in ``_execute_one``.
    for item in bundled_items:
        callspec = getattr(item, "callspec", None)
        if callspec is not None:
            union -= set(callspec.params)

    workers = _resolve_workers()

    def bundle_body(**fixtures):
        subtests = fixtures.pop("subtests")
        results: list[tuple[pytest.Function, BaseException | None]] = []

        # Enable tracing-only autologging for installed flavors while tests run,
        # mirroring mlflow.genai.evaluate(), so an instrumented agent produces a
        # trace automatically and trace-introspecting scorers work. Restored on
        # exit. Open the regression-test run here -- the tracking store is now
        # configured and no test body has traced yet, so traces auto-link.
        from mlflow.models.evaluation.utils.trace import (
            configure_autologging_for_evaluation,
        )

        with configure_autologging_for_evaluation(enable_tracing=True):
            _session.ensure_run()
            if workers == 1:
                for item in bundled_items:
                    results.append((item, _execute_one(item, fixtures)))
            else:
                pool_size = min(workers, len(bundled_items))
                with ThreadPoolExecutor(
                    max_workers=pool_size, thread_name_prefix=_THREAD_PREFIX
                ) as executor:
                    future_to_item = {
                        executor.submit(_execute_one, item, fixtures): item
                        for item in bundled_items
                    }
                    future_lookup = {future_to_item[f]: f for f in future_to_item}
                    try:
                        for item in bundled_items:
                            results.append((item, future_lookup[item].result()))
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


def _execute_one(item: pytest.Function, fixtures: dict) -> BaseException | None:
    """Run one bundled test's body with the appropriate fixture subset.

    Returns the raised exception (or None). The caller re-raises inside the
    per-test subtests context for proper per-test reporting. Sets the thread-local
    current-test so ``assert_behavior()`` tags traces with the *real* test name (not the
    bundle item).
    """
    test_name = item.function.__name__
    case_id = _case_id_from_item_name(item.name)
    _session.set_current_test(test_name, case_id)

    # Use the function's signature, not item.fixturenames - the latter can include
    # plugin-injected extras (e.g. pytest-asyncio's event_loop_policy).
    try:
        signature = inspect.signature(item.obj)
    except (TypeError, ValueError):
        signature = None
    accepted = set(signature.parameters) if signature else set(item.fixturenames)

    callspec = getattr(item, "callspec", None)
    param_values = dict(callspec.params) if callspec is not None else {}

    item_args: dict = {}
    for name in accepted:
        if name in param_values:
            item_args[name] = param_values[name]
        elif name in fixtures:
            item_args[name] = fixtures[name]

    try:
        item.obj(**item_args)
    except BaseException as e:  # noqa: BLE001 - propagate to caller
        return e
    finally:
        _session.set_current_test(None, None)
    return None


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(
    session: pytest.Session, items: list[pytest.Item]
) -> None:
    """Collapse ``@mlflow.test`` tests in the same module into one bundle.

    Runs LAST so pytest's ``-k`` / ``-m`` / nodeid filters have already pruned
    ``items`` to what the user selected -- we only bundle what's left. Tests from
    different modules each get their own bundle; a module with a single marked
    test isn't bundled (no benefit). Non-marked tests are left alone.
    """
    by_module: dict = {}
    for item in items:
        if _is_mlflow_test(item):
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
        setattr(bundle_item, _BUNDLE_COUNT_ATTR, len(group))

        first_index = min(items.index(o) for o in group)
        for original in group:
            items.remove(original)
        items.insert(first_index, bundle_item)
