"""Pytest plugin for ``@mlflow.assertions``.

Auto-registered via the ``pytest11`` entry point in ``pyproject.toml``. Users
do not need to add anything to their conftest.

Provides:
- ``verify`` fixture that runs declared scorers and asserts.
"""

from __future__ import annotations

import pytest

from mlflow._assertions.decorator import ASSERTIONS_ATTR
from mlflow._assertions.runner import run_assertions


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

    def _verify(outputs, *, inputs=None, expectations=None):
        results = run_assertions(
            scorers,
            inputs=inputs,
            outputs=outputs,
            expectations=expectations,
        )
        failures = [r for r in results if not r.passed]
        if failures:
            lines = ["verify() failed:"]
            for r in results:
                lines.append(r.format_line())
            raise AssertionError("\n".join(lines))

    return _verify
