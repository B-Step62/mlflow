"""Tests for `mlflow.playground._llm` (shared Databricks-OpenAI helper)."""

from __future__ import annotations

import sys
from unittest import mock

import pydantic
import pytest

from mlflow.playground._llm import (
    call_databricks_endpoint,
    pydantic_to_response_format,
)


class _Sample(pydantic.BaseModel):
    passed: bool
    reasoning: str = ""


def _fake_openai_module(content: str = "{}"):
    """Build a fake `openai` module with a stub `OpenAI()` client whose
    `chat.completions.create` returns the given content."""
    fake_client = mock.Mock()
    fake_client.chat.completions.create.return_value = type(
        "R",
        (),
        {"choices": [type("C", (), {"message": type("M", (), {"content": content})()})()]},
    )()
    return type("M", (), {"OpenAI": mock.Mock(return_value=fake_client)}), fake_client


def test_pydantic_to_response_format_strips_leading_underscore():
    rf = pydantic_to_response_format(_Sample)
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["name"] == "Sample"
    assert "properties" in rf["json_schema"]["schema"]
    assert "passed" in rf["json_schema"]["schema"]["properties"]


def test_call_databricks_endpoint_uses_serving_endpoint_with_pat(monkeypatch):
    fake_module, fake_client = _fake_openai_module(content='{"passed": true}')
    monkeypatch.setitem(sys.modules, "openai", fake_module)
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com/")
    monkeypatch.setenv("DATABRICKS_TOKEN", "dapi-fake")
    monkeypatch.delenv("MLFLOW_PLAYGROUND_DATABRICKS_ENDPOINT", raising=False)

    out = call_databricks_endpoint("hi")

    fake_module.OpenAI.assert_called_once_with(
        api_key="dapi-fake",
        base_url="https://example.cloud.databricks.com/serving-endpoints",
    )
    create_kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert create_kwargs["model"] == "databricks-gpt-5-4"
    assert create_kwargs["messages"] == [{"role": "user", "content": "hi"}]
    assert "response_format" not in create_kwargs
    assert out == '{"passed": true}'


def test_call_databricks_endpoint_forwards_response_format(monkeypatch):
    fake_module, fake_client = _fake_openai_module()
    monkeypatch.setitem(sys.modules, "openai", fake_module)
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
    monkeypatch.setenv("DATABRICKS_TOKEN", "dapi-fake")

    rf = pydantic_to_response_format(_Sample)
    call_databricks_endpoint("hi", response_format=rf)

    create_kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert create_kwargs["response_format"] is rf


def test_call_databricks_endpoint_env_override(monkeypatch):
    fake_module, fake_client = _fake_openai_module()
    monkeypatch.setitem(sys.modules, "openai", fake_module)
    monkeypatch.setenv("DATABRICKS_HOST", "https://example.cloud.databricks.com")
    monkeypatch.setenv("DATABRICKS_TOKEN", "dapi-fake")
    monkeypatch.setenv("MLFLOW_PLAYGROUND_DATABRICKS_ENDPOINT", "databricks-meta-llama-3-3-70b-instruct")

    call_databricks_endpoint("hi")

    assert (
        fake_client.chat.completions.create.call_args.kwargs["model"]
        == "databricks-meta-llama-3-3-70b-instruct"
    )


def test_call_databricks_endpoint_requires_credentials(monkeypatch):
    monkeypatch.delenv("DATABRICKS_HOST", raising=False)
    monkeypatch.delenv("DATABRICKS_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="DATABRICKS_HOST"):
        call_databricks_endpoint("hi")
