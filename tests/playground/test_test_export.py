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
