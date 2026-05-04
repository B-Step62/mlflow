"""Tests for ``mlflow agent test run --issue X`` (YUK-27 CLI)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from click.testing import CliRunner
from sqlalchemy import create_engine

import mlflow
from mlflow.entities.issue import IssueStatus
from mlflow.playground.cli import agent_commands
from mlflow.playground.regression_suite import append_test_case
from mlflow.playground.test_case_generator import (
    AssertionSpec,
    GeneratedTestCase,
    JudgeSpec,
    TestStrategy,
)
from mlflow.store.db.utils import _initialize_tables
from mlflow.tracking._tracking_service.utils import _get_store


@pytest.fixture
def cli_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    _initialize_tables(create_engine(db_uri))
    monkeypatch.setenv("MLFLOW_TRACKING_URI", db_uri)
    mlflow.set_tracking_uri(db_uri)
    exp_id = mlflow.create_experiment("agent-playground")
    return {"db_uri": db_uri, "experiment_id": exp_id}


def _make_fake_response(payload: dict, status: int = 200):
    class _R:
        is_success = 200 <= status < 300
        status_code = status
        text = ""

        def json(self):
            return payload

    return _R()


def _seed_issue_with_assertion_test(experiment_id: str, *, must_contain: list[str]) -> str:
    store = _get_store()
    issue = store.create_issue(
        experiment_id=experiment_id,
        name="Tone bug",
        description="rationale text",
        status=IssueStatus.IN_PROGRESS,
        source_trace_id="tr-abc",
    )
    test_case = GeneratedTestCase(
        test_case_id=f"tc-{issue.issue_id}",
        strategy=TestStrategy.ASSERTION,
        inputs=[{"role": "user", "content": "Help me dispute a charge."}],
        rationale_summary="Must mention dispute",
        assertion=AssertionSpec(must_contain=must_contain),
    )
    append_test_case(
        experiment_id=experiment_id,
        test_case=test_case,
        issue_id=issue.issue_id,
        source_trace_id="tr-abc",
    )
    return issue.issue_id


def test_run_passes_when_assertion_holds(cli_env):
    issue_id = _seed_issue_with_assertion_test(
        cli_env["experiment_id"], must_contain=["dispute"]
    )
    runner = CliRunner()

    fake = _make_fake_response({
        "role": "assistant",
        "content": [{"type": "text", "text": "I'll help you dispute that charge."}],
    })
    with patch("mlflow.playground.test_run_cli.httpx.post", return_value=fake):
        result = runner.invoke(agent_commands, ["test", "run", "--issue", issue_id])

    assert result.exit_code == 0, result.output
    assert "PASS (assertion)" in result.output
    assert "contains required substring" in result.output


def test_run_fails_when_assertion_misses(cli_env):
    issue_id = _seed_issue_with_assertion_test(
        cli_env["experiment_id"], must_contain=["dispute"]
    )
    runner = CliRunner()
    fake = _make_fake_response({
        "role": "assistant",
        "content": [{"type": "text", "text": "lol idk"}],
    })
    with patch("mlflow.playground.test_run_cli.httpx.post", return_value=fake):
        result = runner.invoke(agent_commands, ["test", "run", "--issue", issue_id])

    assert result.exit_code == 1, result.output
    assert "FAIL (assertion)" in result.output
    assert "missing required substring" in result.output


def test_run_verbose_prints_response_and_tools(cli_env):
    issue_id = _seed_issue_with_assertion_test(
        cli_env["experiment_id"], must_contain=["dispute"]
    )
    runner = CliRunner()
    fake = _make_fake_response({
        "role": "assistant",
        "content": [
            {"type": "text", "text": "Sure, let's dispute it."},
            {"type": "tool_use", "name": "lookup_charge"},
        ],
    })
    with patch("mlflow.playground.test_run_cli.httpx.post", return_value=fake):
        result = runner.invoke(
            agent_commands, ["test", "run", "--issue", issue_id, "--verbose"]
        )
    assert result.exit_code == 0, result.output
    assert "agent response" in result.output
    assert "Sure, let's dispute it." in result.output
    assert "lookup_charge" in result.output
    assert "POST http://127.0.0.1:8000/invocations" in result.output


def test_run_missing_issue_returns_clean_error(cli_env):
    runner = CliRunner()
    result = runner.invoke(
        agent_commands, ["test", "run", "--issue", "iss-doesnotexist"]
    )
    assert result.exit_code == 1
    assert "not found" in result.output.lower()
    assert "Traceback" not in result.output


def test_run_issue_without_test_row(cli_env):
    """An Issue exists but no regression-suite row was generated for it."""
    store = _get_store()
    issue = store.create_issue(
        experiment_id=cli_env["experiment_id"],
        name="orphan",
        description="no test yet",
        status=IssueStatus.TODO,
    )
    runner = CliRunner()
    result = runner.invoke(agent_commands, ["test", "run", "--issue", issue.issue_id])
    assert result.exit_code == 1
    assert "No regression-suite row" in result.output
    assert "Traceback" not in result.output


def test_run_legacy_detection_issue_is_rejected(cli_env):
    store = _get_store()
    issue = store.create_issue(
        experiment_id=cli_env["experiment_id"],
        name="legacy",
        description="...",
        status=IssueStatus.PENDING,
    )
    runner = CliRunner()
    result = runner.invoke(agent_commands, ["test", "run", "--issue", issue.issue_id])
    assert result.exit_code == 1
    assert "legacy detection path" in result.output


def test_run_agent_unreachable_surfaces_clean_error(cli_env):
    issue_id = _seed_issue_with_assertion_test(
        cli_env["experiment_id"], must_contain=["dispute"]
    )
    runner = CliRunner()
    with patch(
        "mlflow.playground.test_run_cli.httpx.post",
        side_effect=httpx.ConnectError("connection refused"),
    ):
        result = runner.invoke(agent_commands, ["test", "run", "--issue", issue_id])
    assert result.exit_code == 1
    assert "Could not reach agent" in result.output
    assert "Traceback" not in result.output


def test_run_agent_url_override_used_in_invocation(cli_env, monkeypatch):
    issue_id = _seed_issue_with_assertion_test(
        cli_env["experiment_id"], must_contain=["x"]
    )
    runner = CliRunner()
    fake = _make_fake_response({
        "role": "assistant",
        "content": [{"type": "text", "text": "x"}],
    })
    with patch(
        "mlflow.playground.test_run_cli.httpx.post", return_value=fake
    ) as mock_post:
        result = runner.invoke(
            agent_commands,
            ["test", "run", "--issue", issue_id, "--agent-url", "http://custom:9001"],
        )
    assert result.exit_code == 0, result.output
    mock_post.assert_called_once()
    posted_url = mock_post.call_args[0][0]
    assert posted_url == "http://custom:9001/invocations"


def test_run_judge_strategy_uses_default_llm_unless_overridden(cli_env, monkeypatch):
    """Judge tests with the real LLM are out of scope here; we only confirm
    the CLI hands the spec down correctly. The runner module's unit tests
    cover the LLM hand-off via a stub."""
    store = _get_store()
    issue = store.create_issue(
        experiment_id=cli_env["experiment_id"],
        name="Judge",
        description="...",
        status=IssueStatus.IN_PROGRESS,
    )
    test_case = GeneratedTestCase(
        test_case_id="tc-judge",
        strategy=TestStrategy.JUDGE,
        inputs=[{"role": "user", "content": "say hi"}],
        rationale_summary="Must be polite",
        judge=JudgeSpec(criteria="Be polite."),
    )
    append_test_case(
        experiment_id=cli_env["experiment_id"],
        test_case=test_case,
        issue_id=issue.issue_id,
    )
    fake = _make_fake_response({
        "role": "assistant",
        "content": [{"type": "text", "text": "Hello, how can I help?"}],
    })

    runner = CliRunner()
    with (
        patch("mlflow.playground.test_run_cli.httpx.post", return_value=fake),
        patch(
            "mlflow.playground.test_runner._default_judge_llm",
            return_value='{"passed": true, "reasoning": "polite enough"}',
        ),
    ):
        result = runner.invoke(agent_commands, ["test", "run", "--issue", issue.issue_id])

    assert result.exit_code == 0, result.output
    assert "PASS (judge)" in result.output
