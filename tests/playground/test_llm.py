"""Tests for `mlflow.playground._llm` (shared LLM provider dispatcher) and
its ``claude_code`` provider in `mlflow.playground._claude_llm`.
"""

from __future__ import annotations

import json
import subprocess
import sys
from unittest import mock

import pydantic
import pytest

from mlflow.playground._claude_llm import ClaudeCLIError, call_claude
from mlflow.playground._llm import (
    call_databricks_endpoint,
    call_default_llm,
    pydantic_to_response_format,
)


class _Sample(pydantic.BaseModel):
    passed: bool
    reasoning: str = ""


def _fake_openai_module(content: str = "{}"):
    """Build a fake `openai` module with a stub `OpenAI()` client whose
    `chat.completions.create` returns the given content.
    """
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


# ---------------------------------------------------------------------------
# claude_code provider
# ---------------------------------------------------------------------------


def _fake_claude_proc(*, returncode: int = 0, stdout: str = "{}", stderr: str = ""):
    return subprocess.CompletedProcess(
        args=[], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_call_claude_returns_structured_output(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    fake_run = mock.Mock(
        return_value=_fake_claude_proc(
            stdout=json.dumps({"structured_output": {"passed": True}})
        )
    )
    monkeypatch.setattr("mlflow.playground._claude_llm.subprocess.run", fake_run)

    out = call_claude("hi", response_schema=_Sample)

    assert json.loads(out) == {"passed": True}
    cmd = fake_run.call_args.args[0]
    assert cmd[:2] == ["claude", "-p"]
    assert cmd[2] == "hi"
    assert cmd[cmd.index("--max-turns") + 1] == "5"
    assert cmd[cmd.index("--tools") + 1] == ""
    assert cmd[cmd.index("--output-format") + 1] == "json"
    schema_idx = cmd.index("--json-schema")
    assert json.loads(cmd[schema_idx + 1])["properties"]["passed"]["type"] == "boolean"


def test_call_claude_runs_in_neutral_cwd(monkeypatch):
    """The judge call must NOT inherit the calling process's cwd — the worker
    dispatcher installs MLflow tracing hooks into worktree-local
    `.claude/settings.json`, and if the judge picks those up it fires hook
    subcommands per turn and blows past --max-turns. Pass a tempdir cwd to
    isolate.
    """
    import tempfile

    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    fake_run = mock.Mock(
        return_value=_fake_claude_proc(
            stdout=json.dumps({"structured_output": {"passed": True}})
        )
    )
    monkeypatch.setattr("mlflow.playground._claude_llm.subprocess.run", fake_run)

    call_claude("hi", response_schema=_Sample)

    assert fake_run.call_args.kwargs["cwd"] == tempfile.gettempdir()


def test_call_claude_omits_schema_when_unspecified(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    fake_run = mock.Mock(
        return_value=_fake_claude_proc(stdout=json.dumps({"result": "hi there"}))
    )
    monkeypatch.setattr("mlflow.playground._claude_llm.subprocess.run", fake_run)

    out = call_claude("ping")

    assert out == "hi there"
    cmd = fake_run.call_args.args[0]
    assert "--json-schema" not in cmd


def test_call_claude_raises_when_cli_missing(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: None)

    with pytest.raises(ClaudeCLIError, match="not available on PATH"):
        call_claude("hi", response_schema=_Sample)


def test_call_claude_raises_on_nonzero_exit(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    monkeypatch.setattr(
        "mlflow.playground._claude_llm.subprocess.run",
        mock.Mock(return_value=_fake_claude_proc(returncode=2, stdout="not json", stderr="boom")),
    )

    with pytest.raises(ClaudeCLIError, match="boom"):
        call_claude("hi", response_schema=_Sample)


def test_call_claude_surfaces_envelope_error_on_nonzero_exit(monkeypatch):
    """Exit-1 with empty stderr but a populated JSON envelope should surface
    the envelope's subtype/errors instead of the unhelpful 'exit code N'."""
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    monkeypatch.setattr(
        "mlflow.playground._claude_llm.subprocess.run",
        mock.Mock(
            return_value=_fake_claude_proc(
                returncode=1,
                stdout=json.dumps(
                    {
                        "subtype": "error_max_turns",
                        "errors": ["Reached maximum number of turns (1)"],
                    }
                ),
                stderr="",
            )
        ),
    )

    with pytest.raises(ClaudeCLIError, match="error_max_turns"):
        call_claude("hi", response_schema=_Sample)


def test_call_claude_raises_on_timeout(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    monkeypatch.setattr(
        "mlflow.playground._claude_llm.subprocess.run",
        mock.Mock(side_effect=subprocess.TimeoutExpired(cmd="claude", timeout=1.0)),
    )

    with pytest.raises(ClaudeCLIError, match="timed out"):
        call_claude("hi", response_schema=_Sample, timeout=1.0)


def test_call_claude_raises_when_envelope_lacks_structured_output(monkeypatch):
    monkeypatch.setattr("mlflow.playground._claude_llm.shutil.which", lambda _: "/bin/claude")
    monkeypatch.setattr(
        "mlflow.playground._claude_llm.subprocess.run",
        mock.Mock(return_value=_fake_claude_proc(stdout=json.dumps({"session_id": "x"}))),
    )

    with pytest.raises(ClaudeCLIError, match="structured_output"):
        call_claude("hi", response_schema=_Sample)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


def test_call_default_llm_routes_to_claude(monkeypatch):
    """The dispatcher unconditionally routes to the Claude Code CLI; the
    Databricks fallback below is dead code (preserved for future re-enablement).
    """
    fake = mock.Mock(return_value='{"passed": true}')
    monkeypatch.setattr("mlflow.playground._claude_llm.call_claude", fake)

    out = call_default_llm("hi", response_schema=_Sample)

    assert out == '{"passed": true}'
    fake.assert_called_once_with("hi", response_schema=_Sample)


def test_call_default_llm_does_not_call_databricks(monkeypatch):
    """Sanity-check: even with both providers reachable, the Databricks helper
    is never invoked through the dispatcher.
    """
    monkeypatch.setattr(
        "mlflow.playground._claude_llm.call_claude",
        mock.Mock(return_value="{}"),
    )
    databricks_call = mock.Mock(return_value="{}")
    monkeypatch.setattr(
        "mlflow.playground._llm.call_databricks_endpoint", databricks_call
    )

    call_default_llm("hi", response_schema=_Sample)

    databricks_call.assert_not_called()
