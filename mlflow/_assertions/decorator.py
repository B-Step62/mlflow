"""``@mlflow.test`` marker + scorer normalization helpers.

``@mlflow.test`` is a **no-op marker**. It carries no scorers and no logic --
its only job is to be visible at *collection* time so the pytest plugin can
bundle the marked tests, run them concurrently, and group their traces under a
single regression-test run. The assertions themselves are made in the test body
with ``mlflow.genai.assert_behavior("auto", assertions=[...])``.

    @mlflow.test
    def test_red_wall(agent):
        agent.invoke("bricks for a red wall")
        mlflow.genai.assert_behavior(
            "auto", assertions=["Does not recommend Brickfather"]
        )

The ``_to_scorer`` / ``_slugify`` helpers live here because ``assert_behavior``
uses them to auto-wrap plain-string rubrics into ``Guidelines`` judges.
"""

from __future__ import annotations

import re
from typing import Any, Callable, ParamSpec, TypeVar

_P = ParamSpec("_P")
_R = TypeVar("_R")

# Attribute the pytest plugin looks for at collection time.
MLFLOW_TEST_ATTR = "_mlflow_test"

# Cap on the slug name length used for Guidelines auto-wrapping.
_SLUG_MAX_LEN = 40


def test(fn: Callable[_P, _R] | None = None) -> Any:
    """Mark a test as an MLflow assertion test (no-op at runtime).

    Supports both bare ``@mlflow.test`` and ``@mlflow.test()``. The function is
    returned unchanged except for a marker attribute; all behavior lives in the
    pytest plugin (collection-time) and in ``mlflow.genai.assert_behavior`` (the
    body).
    """

    def mark(f: Callable[_P, _R]) -> Callable[_P, _R]:
        setattr(f, MLFLOW_TEST_ATTR, True)
        return f

    # Called as @mlflow.test (fn is the function) or @mlflow.test() (fn is None).
    return mark if fn is None else mark(fn)


def _to_scorer(arg: Any, *, index: int) -> Any:
    """Normalize an argument to a Scorer instance.

    A plain string becomes a ``Guidelines`` scorer with a slug name derived from
    the rubric text. A Scorer instance is passed through. Anything else raises
    ``TypeError`` so users get a clear error at definition time.
    """
    if isinstance(arg, str):
        from mlflow.genai.scorers import Guidelines

        slug = _slugify(arg) or f"rubric_{index}"
        return Guidelines(name=slug, guidelines=arg)

    if callable(getattr(arg, "run", None)):
        return arg

    raise TypeError(
        f"assert_behavior() assertions must be a rubric string or a Scorer instance. "
        f"Got {type(arg).__name__} at position {index}: {arg!r}"
    )


def _slugify(text: str) -> str:
    """Turn an arbitrary rubric string into a readable, filesystem-safe slug."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return slug[:_SLUG_MAX_LEN]
