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
"""

from __future__ import annotations

import inspect
import logging
from concurrent.futures import ThreadPoolExecutor

import pytest

from mlflow._assertions.decorator import ASSERTIONS_ATTR
from mlflow._assertions.runner import make_verify
from mlflow.environment_variables import MLFLOW_GENAI_EVAL_MAX_WORKERS

_logger = logging.getLogger(__name__)

_THREAD_PREFIX = "MlflowAssertions"
_BUNDLE_FUNC_NAME = "_mlflow_assertions_bundle"


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
    return make_verify(scorers)


def _is_assertion_test(item: pytest.Item) -> bool:
    """True when the item carries an ``@mlflow.assertions`` decorator."""
    if not isinstance(item, pytest.Function):
        return False
    return hasattr(item.function, ASSERTIONS_ATTR)


def _resolve_workers() -> int:
    return max(1, MLFLOW_GENAI_EVAL_MAX_WORKERS.get())


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

    workers = _resolve_workers()

    def bundle_body(**fixtures):
        subtests = fixtures.pop("subtests")
        results: list[tuple[pytest.Function, BaseException | None]] = []

        if workers == 1:
            # Sequential mode: still bundled (one pytest item) but no thread
            # pool. Useful for debugging.
            for item in bundled_items:
                err = _execute_one(item, fixtures)
                results.append((item, err))
        else:
            pool_size = min(workers, len(bundled_items))
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
    bundle_body.__name__ = _BUNDLE_FUNC_NAME
    return bundle_body


def _execute_one(
    item: pytest.Function, fixtures: dict
) -> BaseException | None:
    """Run one bundled test's body with the appropriate fixture subset.

    Returns the raised exception (or None on success). Caller re-raises
    inside the per-test subtests context for proper per-test reporting.
    """
    scorers = getattr(item.function, ASSERTIONS_ATTR, [])
    per_test_verify = make_verify(scorers)

    # Use the function's signature, not item.fixturenames - the latter can
    # include plugin-injected extras (e.g. pytest-asyncio's
    # ``event_loop_policy``) the test body never declared.
    try:
        signature = inspect.signature(item.obj)
    except (TypeError, ValueError):
        signature = None
    accepted = set(signature.parameters) if signature else set(item.fixturenames)

    item_args: dict = {}
    for name in accepted:
        if name == "verify":
            item_args["verify"] = per_test_verify
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
            name=f"{_BUNDLE_FUNC_NAME}_{module.__name__.replace('.', '_')}",
            callobj=bundle_body,
        )

        # Insert the bundle at the position of the first original item so
        # that tests written after the bundled set still run in order.
        first_index = min(items.index(o) for o in group)
        for original in group:
            items.remove(original)
        items.insert(first_index, bundle_item)
