"""Tests for `mlflow.playground.test_export` and the export HTTP endpoint."""

from __future__ import annotations

import json
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mlflow.playground.test_export import (
    ExportedTestScript,
    build_export_prompt,
    export_test_script,
)
from mlflow.server.playground_api import create_playground_api_router


def _sample_cases() -> list[dict[str, object]]:
    return [
        {
            "id": "tc-assert",
            "rationale": "must cite §4.2",
            "messages": [{"role": "user", "content": "How long do refunds take?"}],
            "test_spec": {
                "strategy": "assertion",
                "assertion": {"must_contain": ["§4.2"]},
            },
        },
        {
            "id": "tc-judge",
            "rationale": "tone too casual",
            "messages": [{"role": "user", "content": "say hi"}],
            "test_spec": {
                "strategy": "judge",
                "judge": {
                    "criteria": "Tone is professional.",
                    "expected_response": None,
                },
            },
        },
    ]


def test_build_export_prompt_embeds_every_case_and_pytest_template():
    cases = _sample_cases()
    prompt = build_export_prompt(cases, "python")

    # Every test case id must appear in the embedded JSON block.
    for case in cases:
        assert case["id"] in prompt, f"missing case {case['id']!r} in prompt"
    # The template hint pins the pytest structure — make sure the LLM sees it.
    assert "@pytest.mark.parametrize" in prompt
    assert "normalize_agent_response" in prompt
    assert "evaluate(" in prompt
    assert "MLFLOW_AGENT_URL" in prompt


def test_build_export_prompt_rejects_unsupported_language():
    with pytest.raises(ValueError, match="Unsupported export language"):
        build_export_prompt(_sample_cases(), "typescript")  # type: ignore[arg-type]


def test_export_test_script_returns_llm_output(monkeypatch):
    cases = _sample_cases()

    def fake_collect(_experiment_id):
        return cases

    monkeypatch.setattr(
        "mlflow.playground.test_export._collect_test_cases", fake_collect
    )

    captured = {}

    def fake_llm(prompt, *, response_schema):
        captured["prompt"] = prompt
        captured["schema"] = response_schema
        return json.dumps({"code": "print('hi')", "filename": "test_x.py"})

    monkeypatch.setattr("mlflow.playground._llm.call_default_llm", fake_llm)

    script = export_test_script("exp-1", "python")

    assert isinstance(script, ExportedTestScript)
    assert script.code == "print('hi')"
    assert script.filename == "test_x.py"
    # Every case id ends up in the embedded prompt — sanity check the
    # call actually went through `build_export_prompt`.
    for case in cases:
        assert case["id"] in captured["prompt"]
    assert captured["schema"] is ExportedTestScript


def test_export_test_script_raises_lookup_error_when_dataset_empty(monkeypatch):
    monkeypatch.setattr(
        "mlflow.playground.test_export._collect_test_cases", lambda _: []
    )

    with pytest.raises(LookupError, match="empty"):
        export_test_script("exp-empty", "python")


@pytest.fixture
def _clear_export_cache():
    """Reset the in-memory export cache before/after each cache-related test
    so cross-test pollution doesn't hide a real cache miss."""
    from mlflow.playground import test_export as _te

    _te._export_cache.clear()
    yield
    _te._export_cache.clear()


def test_export_caches_until_cases_change(monkeypatch, _clear_export_cache):
    """Repeated calls with the same dataset rows must reuse the cached
    script and skip the LLM. A change in the rows must bust the cache."""
    cases_v1 = _sample_cases()
    cases_v2 = _sample_cases() + [
        {
            "id": "tc-new",
            "rationale": "added later",
            "messages": [{"role": "user", "content": "fresh"}],
            "test_spec": {"strategy": "assertion", "assertion": {"must_contain": ["x"]}},
        }
    ]
    cases_ref = {"current": cases_v1}

    monkeypatch.setattr(
        "mlflow.playground.test_export._collect_test_cases",
        lambda _: cases_ref["current"],
    )

    llm_call_count = {"n": 0}

    def fake_llm(prompt, *, response_schema):
        llm_call_count["n"] += 1
        return json.dumps({"code": f"# v{llm_call_count['n']}\nprint('hi')", "filename": "test_x.py"})

    monkeypatch.setattr("mlflow.playground._llm.call_default_llm", fake_llm)

    # First call — cache miss, hits the LLM.
    s1 = export_test_script("exp-cache", "python")
    assert llm_call_count["n"] == 1
    assert s1.code == "# v1\nprint('hi')"

    # Second call, same dataset — cache hit, no LLM.
    s2 = export_test_script("exp-cache", "python")
    assert llm_call_count["n"] == 1
    assert s2.code == s1.code

    # Dataset mutated — fingerprint differs, cache busts, LLM called again.
    cases_ref["current"] = cases_v2
    s3 = export_test_script("exp-cache", "python")
    assert llm_call_count["n"] == 2
    assert s3.code == "# v2\nprint('hi')"

    # Mutated dataset, repeat call — cache hit on the new fingerprint.
    s4 = export_test_script("exp-cache", "python")
    assert llm_call_count["n"] == 2
    assert s4.code == s3.code


def test_export_does_not_cache_failures(monkeypatch, _clear_export_cache):
    """LLM exceptions must not be cached — the next call should retry."""
    monkeypatch.setattr(
        "mlflow.playground.test_export._collect_test_cases", lambda _: _sample_cases()
    )

    attempts = {"n": 0}

    def flaky_llm(prompt, *, response_schema):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("LLM unavailable")
        return json.dumps({"code": "ok", "filename": "test.py"})

    monkeypatch.setattr("mlflow.playground._llm.call_default_llm", flaky_llm)

    with pytest.raises(RuntimeError, match="LLM unavailable"):
        export_test_script("exp-flaky", "python")

    # Same dataset, retry — must call the LLM again (failure wasn't cached).
    script = export_test_script("exp-flaky", "python")
    assert attempts["n"] == 2
    assert script.code == "ok"


# --- HTTP endpoint shape ----------------------------------------------------


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(create_playground_api_router())
    return TestClient(app)


def test_export_endpoint_returns_code_for_populated_dataset(monkeypatch):
    expected = ExportedTestScript(code="print('hi')", filename="test_x.py")

    with mock.patch(
        "mlflow.playground.test_export.export_test_script",
        return_value=expected,
    ) as m:
        response = _client().get(
            "/ajax-api/3.0/mlflow/playground/regression-suite/export?experiment_id=exp-1"
        )

    assert response.status_code == 200
    body = response.json()
    assert body == {"language": "python", "filename": "test_x.py", "code": "print('hi')"}
    m.assert_called_once_with("exp-1", "python")


def test_export_endpoint_returns_404_when_dataset_empty():
    with mock.patch(
        "mlflow.playground.test_export.export_test_script",
        side_effect=LookupError("dataset is empty"),
    ):
        response = _client().get(
            "/ajax-api/3.0/mlflow/playground/regression-suite/export?experiment_id=exp-2"
        )

    assert response.status_code == 404
    assert "empty" in response.json()["detail"]


def test_export_endpoint_rejects_unsupported_language():
    response = _client().get(
        "/ajax-api/3.0/mlflow/playground/regression-suite/export"
        "?experiment_id=exp-3&language=typescript"
    )

    assert response.status_code == 400
    assert "Unsupported export language" in response.json()["detail"]
