"""Emit a runnable test script for the regression suite.

Reads every row from the experiment's regression dataset and asks the
default playground LLM to produce a single test file the user can drop
into their agent repo. The emitted script POSTs to a running agent
(``MLFLOW_AGENT_URL`` env var, defaulting to ``http://127.0.0.1:8000``)
and dispatches each case through
:func:`mlflow.playground.test_runner.evaluate`, so assertion + judge
strategies are handled the same way the playground runs them today.

Two-language design is planned (pytest for Python, vitest/jest for
TypeScript); v1 ships pytest only. The TS surface raises a clear
``ValueError`` so the API layer can return a 400 without us guessing
at code shape we haven't validated.
"""

from __future__ import annotations

import hashlib
import json
import threading
from typing import Any, Literal

import pydantic

ExportLanguage = Literal["python", "typescript"]
SUPPORTED_LANGUAGES: tuple[ExportLanguage, ...] = ("python",)

# In-memory cache: (experiment_id, language) -> (cases_fingerprint, script).
# A change in the regression dataset rotates the fingerprint, so the cache
# self-invalidates without us having to wire eviction hooks into every
# `append_test_case` / `update_test_case` / `delete_test_case` call site.
# Process-local: a playground restart drops the cache, which is the correct
# behavior (the LLM might have improved and we'd want to re-emit).
_export_cache: dict[tuple[str, ExportLanguage], tuple[str, "ExportedTestScript"]] = {}
_export_cache_lock = threading.Lock()


class ExportedTestScript(pydantic.BaseModel):
    """Structured-output schema the LLM fills in.

    ``code`` is the full file contents; ``filename`` is a suggested name
    (``test_<experiment>.py``). Both are sent through to the UI's modal
    so the user can copy or download without further LLM round-trips.
    """

    code: str = pydantic.Field(..., description="Full file contents of the runnable test script.")
    filename: str = pydantic.Field(
        default="test_regression.py",
        description="Suggested filename (e.g. test_regression.py).",
    )


_PYTEST_TEMPLATE_HINT = """\
The emitted file MUST follow this structure (adapt only the TEST_CASES list and any
docstrings — keep the imports + parametrize wiring exactly as shown so the script
runs against a vanilla `pytest`):

```python
\"\"\"Auto-generated regression suite for MLflow Agent Playground.

Run against a live agent:

    MLFLOW_AGENT_URL=http://127.0.0.1:8000 pytest <thisfile.py>
\"\"\"

from __future__ import annotations

import os
from typing import Any

import httpx
import pytest
from mlflow.playground.test_runner import evaluate, normalize_agent_response

AGENT_URL = os.environ.get("MLFLOW_AGENT_URL", "http://127.0.0.1:8000")
TIMEOUT_SECONDS = 30.0

TEST_CASES: list[dict[str, Any]] = [
    # one dict per test case — see below
]


@pytest.fixture(scope="module")
def agent_client():
    headers = {"x-mlflow-return-trace-id": "true"}
    with httpx.Client(timeout=TIMEOUT_SECONDS, headers=headers) as client:
        yield client


@pytest.mark.parametrize(
    "case",
    TEST_CASES,
    ids=[c["id"] for c in TEST_CASES],
)
def test_regression(agent_client: httpx.Client, case: dict[str, Any]) -> None:
    response = agent_client.post(
        f"{AGENT_URL.rstrip('/')}/invocations",
        json={"messages": case["messages"]},
    )
    response.raise_for_status()
    agent_response = normalize_agent_response(response.json())
    verdict = evaluate(case["test_spec"], agent_response)
    assert verdict.passed, "\\n".join(verdict.reasons)
```

Each TEST_CASES entry MUST be a dict with this exact shape:

    {
        "id": "<test_case_id>",                       # for pytest parametrize id
        "rationale": "<short summary>",               # human comment
        "messages": [{"role": ..., "content": ...}],  # conversation prefix
        "test_spec": { ... },                         # passed verbatim to evaluate()
    }
"""


def build_export_prompt(test_cases: list[dict[str, Any]], language: ExportLanguage) -> str:
    """Compose the LLM prompt that emits a runnable test script.

    The prompt embeds every test case in JSON so the LLM doesn't have to
    reconstruct shape from a summary. Strict template hint above pins the
    file structure so the LLM only varies the test data and docstrings —
    keeps emission reliable enough to skip a "re-prompt on broken code"
    loop for v1.
    """
    if language != "python":
        raise ValueError(
            f"Unsupported export language: {language!r}. v1 ships pytest only; "
            "TypeScript support is tracked as a follow-up."
        )

    serialized_cases = json.dumps(test_cases, indent=2, ensure_ascii=False)
    return f"""\
You are emitting a runnable pytest file for an MLflow Agent Playground
regression suite. {len(test_cases)} test case(s) are provided below; the
emitted file must run all of them as one parametrized pytest function.

{_PYTEST_TEMPLATE_HINT}

# Test cases (JSON — embed them verbatim in TEST_CASES)

{serialized_cases}

# Output

Return JSON matching the schema. ``code`` is the full file contents;
``filename`` is a suggested filename (default ``test_regression.py``).
Do NOT wrap the code in markdown fences — emit raw Python.
"""


def _collect_test_cases(experiment_id: str) -> list[dict[str, Any]]:
    """Read every regression row from the experiment's dataset and shape
    it into the minimal dict the prompt embeds.
    """
    from mlflow.playground.regression_suite import (
        get_or_create_regression_dataset,
    )

    dataset = get_or_create_regression_dataset(experiment_id)
    df = dataset.to_df()
    if df.empty:
        return []

    rows = df.to_dict(orient="records")
    cases: list[dict[str, Any]] = []
    for row in rows:
        inputs = row.get("inputs") or {}
        messages = inputs.get("messages") or []
        expectations = row.get("expectations") or {}
        test_case_id = expectations.get("test_case_id")
        test_spec = expectations.get("test_spec") or {}
        if not test_case_id or not isinstance(test_spec, dict):
            # Skip malformed rows rather than fail the whole export.
            continue
        cases.append(
            {
                "id": test_case_id,
                "rationale": expectations.get("rationale_summary") or "",
                "messages": messages,
                "test_spec": test_spec,
            }
        )
    return cases


def _fingerprint_cases(cases: list[dict[str, Any]]) -> str:
    """Stable hash of the test-case list, used as the cache invalidation key.

    Sorted by ``id`` so the cache survives reorderings that don't actually
    change the content. Hash covers the message bodies, the test spec, and
    the rationale, so any edit to any case rotates the fingerprint.
    """
    sorted_cases = sorted(cases, key=lambda c: c.get("id", ""))
    blob = json.dumps(sorted_cases, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha1(blob).hexdigest()


def export_test_script(
    experiment_id: str,
    language: ExportLanguage = "python",
) -> ExportedTestScript:
    """Read regression cases, prompt the default LLM, return the script.

    Cached: if the dataset rows haven't changed since the last successful
    export for the same ``(experiment_id, language)``, the cached script is
    returned without re-calling the LLM. Cache lives in process memory; a
    playground restart drops it.

    Raises:
        ValueError: when ``language`` is not supported by v1 (anything
            other than ``"python"``).
        LookupError: when the experiment's regression dataset is empty —
            the API layer translates this to 404 so the UI can render a
            "nothing to export" hint rather than an opaque error.
    """
    from mlflow.playground._llm import call_default_llm

    cases = _collect_test_cases(experiment_id)
    if not cases:
        raise LookupError(
            f"Regression dataset for experiment {experiment_id!r} is empty; "
            "dispatch feedback first to seed test cases."
        )

    fingerprint = _fingerprint_cases(cases)
    cache_key = (experiment_id, language)
    with _export_cache_lock:
        cached = _export_cache.get(cache_key)
        if cached is not None and cached[0] == fingerprint:
            return cached[1]

    # Cache miss or stale — regenerate.
    prompt = build_export_prompt(cases, language)
    raw = call_default_llm(prompt, response_schema=ExportedTestScript)
    script = (
        ExportedTestScript.model_validate_json(raw)
        if isinstance(raw, str)
        else ExportedTestScript.model_validate(raw)
    )
    # Only cache successful results — failed calls raise before we get here.
    with _export_cache_lock:
        _export_cache[cache_key] = (fingerprint, script)
    return script


__all__ = [
    "ExportLanguage",
    "ExportedTestScript",
    "SUPPORTED_LANGUAGES",
    "build_export_prompt",
    "export_test_script",
]
