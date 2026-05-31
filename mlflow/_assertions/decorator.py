"""``@mlflow.assertions(...)`` decorator.

Attaches a list of scorers to a test function as metadata. The pytest plugin
reads this metadata at test time via the ``verify`` fixture and runs each
scorer as an assertion.
"""

from __future__ import annotations

import re
from typing import Any, Callable, ParamSpec, TypeVar

_P = ParamSpec("_P")
_R = TypeVar("_R")

ASSERTIONS_ATTR = "_mlflow_assertions"

# Cap on the slug name length used for Guidelines auto-wrapping. Long enough
# to stay human-readable, short enough to render in a terminal table.
_SLUG_MAX_LEN = 40


def assertions(*scorers: Any) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Declare which scorers ``verify`` should run on this test's output.

    Each listed scorer becomes a required assertion. The pytest plugin reads
    this metadata at test time, runs scorers concurrently in ``verify()``,
    attaches feedback to the trace produced by the agent call, and fails the
    test if any scorer reports a failing value.

    Plain strings are auto-wrapped in ``Guidelines(name=<slug>, guidelines=text)``
    so common LLM-judge assertions stay terse::

        @mlflow.assertions(
            "Refuses with explanation",          # auto-wrapped Guidelines
            "Cites at least one source",         # auto-wrapped Guidelines
            Safety(),                            # passed through
        )
        def test_refuses_pii(agent, verify):
            response = agent.invoke("What's John Doe's SSN?")
            verify(response)

    For scorers that need ``inputs`` or ``expectations`` (e.g. ``Correctness``,
    ``RetrievalGroundedness``), pass them as keyword arguments to ``verify``::

        @mlflow.assertions(Correctness())
        def test_x(agent, verify):
            response = agent.invoke(prompt)
            verify(response, inputs=prompt, expectations={"answer": expected})

    Args:
        *scorers: Each argument is either:
          - A ``str`` rubric. Auto-wrapped in a ``Guidelines`` scorer whose
            name is a slug derived from the text.
          - A ``Scorer`` instance (``Safety()``, ``Guidelines("...")``, or any
            ``@scorer``-decorated function).
          At least one argument is required.
    """
    if not scorers:
        raise ValueError(
            "@mlflow.assertions(...) requires at least one scorer or rubric "
            "string. Pass a plain string rubric like 'Refuses politely', a "
            "scorer instance like Safety(), or a @scorer-decorated function."
        )

    resolved = [_to_scorer(arg, index=i) for i, arg in enumerate(scorers)]

    def decorator(fn: Callable[_P, _R]) -> Callable[_P, _R]:
        # Marker decorator: returns the original function unmodified except
        # for the attribute. No wrapping, so functools.wraps is unnecessary.
        setattr(fn, ASSERTIONS_ATTR, resolved)
        return fn

    return decorator


def _to_scorer(arg: Any, *, index: int) -> Any:
    """Normalize an argument to a Scorer instance.

    A plain string becomes a ``Guidelines`` scorer with a slug name derived
    from the rubric text. A Scorer instance is passed through. Anything else
    raises ``TypeError`` so users get a clear error at definition time.
    """
    if isinstance(arg, str):
        # Lazy import: `mlflow.genai.scorers` has its own lazy-loading
        # machinery for builtin scorers; importing at module top would risk a
        # circular dep via `mlflow.__init__`.
        from mlflow.genai.scorers import Guidelines

        slug = _slugify(arg) or f"rubric_{index}"
        return Guidelines(name=slug, guidelines=arg)

    # Heuristic: a Scorer instance has a callable `.run(...)`. We don't import
    # `Scorer` directly here to avoid the cost of pulling in `mlflow.genai`
    # at decoration time for users who only ever pass strings.
    if callable(getattr(arg, "run", None)):
        return arg

    raise TypeError(
        f"@mlflow.assertions arguments must be a rubric string or a Scorer "
        f"instance. Got {type(arg).__name__} at position {index}: {arg!r}"
    )


def _slugify(text: str) -> str:
    """Turn an arbitrary rubric string into a readable, filesystem-safe slug.

    Used as the ``name`` of an auto-wrapped ``Guidelines`` scorer so feedback
    entries on the trace are distinguishable from each other.
    """
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return slug[:_SLUG_MAX_LEN]

