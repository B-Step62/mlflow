"""Tests for ``mlflow agent issue {create,accept,reject}`` (YUK-16)."""

from __future__ import annotations

from pathlib import Path

import pytest
from click.testing import CliRunner
from sqlalchemy import create_engine

import mlflow
from mlflow.entities.issue import IssueStatus
from mlflow.playground.cli import agent_commands
from mlflow.store.db.utils import _initialize_tables
from mlflow.tracking._tracking_service.utils import _get_store


@pytest.fixture
def cli_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Local sqlite DB with a single ``agent-playground`` experiment, the
    tracking URI pointed at it via env, and a fresh ``MlflowClient``."""
    db_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    _initialize_tables(create_engine(db_uri))
    monkeypatch.setenv("MLFLOW_TRACKING_URI", db_uri)
    mlflow.set_tracking_uri(db_uri)
    exp_id = mlflow.create_experiment("agent-playground")
    return {"db_uri": db_uri, "experiment_id": exp_id}


def _issue_id_from_output(output: str) -> str:
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("id:"):
            return stripped.split(":", 1)[1].strip()
    raise AssertionError(f"No 'id:' line in output:\n{output}")


def test_create_persists_issue_with_trace_lineage(cli_env):
    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        [
            "issue",
            "create",
            "--rationale",
            "Greeting reply was overly formal for casual chat.",
            "--trace-id",
            "tr-abc",
        ],
    )
    assert result.exit_code == 0, result.output

    issue_id = _issue_id_from_output(result.output)
    issue = _get_store().get_issue(issue_id)
    assert issue.status == IssueStatus.TODO
    assert issue.source_trace_id == "tr-abc"
    # title auto-derived from rationale
    assert issue.name.startswith("Greeting reply")
    # Lands in the default experiment from the playground config.
    assert str(issue.experiment_id) == cli_env["experiment_id"]


def test_create_warns_when_yuk14_generator_missing(cli_env):
    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        ["issue", "create", "--rationale", "x", "--trace-id", "tr-1"],
    )
    assert result.exit_code == 0
    # Stub note: the test-case generator hook prints a YUK-14 reference.
    assert "YUK-14" in result.output


def test_create_with_explicit_experiment_name(cli_env):
    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        [
            "issue",
            "create",
            "--rationale",
            "x",
            "--trace-id",
            "tr-2",
            "--experiment",
            "agent-playground",
        ],
    )
    assert result.exit_code == 0, result.output


def test_create_unknown_experiment_fails_cleanly(cli_env):
    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        [
            "issue",
            "create",
            "--rationale",
            "x",
            "--trace-id",
            "tr-3",
            "--experiment",
            "no-such-experiment",
        ],
    )
    assert result.exit_code != 0
    assert "not found" in result.output.lower()


def test_reject_transitions_to_rejected(cli_env):
    runner = CliRunner()
    create = runner.invoke(
        agent_commands,
        ["issue", "create", "--rationale", "x", "--trace-id", "tr-r"],
    )
    issue_id = _issue_id_from_output(create.output)

    result = runner.invoke(agent_commands, ["issue", "reject", issue_id])
    assert result.exit_code == 0, result.output
    assert "rejected" in result.output

    assert _get_store().get_issue(issue_id).status == IssueStatus.REJECTED


def test_accept_walks_full_legal_path(cli_env):
    runner = CliRunner()
    create = runner.invoke(
        agent_commands,
        ["issue", "create", "--rationale", "x", "--trace-id", "tr-a"],
    )
    issue_id = _issue_id_from_output(create.output)

    # Manually move TODO -> IN_PROGRESS -> REVIEW (the worker's job in real
    # life). YUK-16's CLI itself only owns the create / accept / reject edges.
    store = _get_store()
    store.transition_issue(issue_id, IssueStatus.IN_PROGRESS, assignee="worker:1")
    store.transition_issue(issue_id, IssueStatus.REVIEW)

    result = runner.invoke(agent_commands, ["issue", "accept", issue_id])
    assert result.exit_code == 0, result.output
    assert "done" in result.output
    # Stub notice for YUK-15's regression-suite append.
    assert "YUK-15" in result.output

    after = store.get_issue(issue_id)
    assert after.status == IssueStatus.DONE
    # accept clears the assignee.
    assert after.assignee is None


def test_accept_after_reject_returns_clean_error(cli_env):
    runner = CliRunner()
    create = runner.invoke(
        agent_commands,
        ["issue", "create", "--rationale", "x", "--trace-id", "tr-x"],
    )
    issue_id = _issue_id_from_output(create.output)
    runner.invoke(agent_commands, ["issue", "reject", issue_id])

    result = runner.invoke(agent_commands, ["issue", "accept", issue_id])
    assert result.exit_code != 0
    assert "Illegal issue transition" in result.output
    # No traceback should leak — the wrapper translated it to a click error.
    assert "Traceback" not in result.output


def test_reject_missing_issue_returns_not_found(cli_env):
    runner = CliRunner()
    result = runner.invoke(agent_commands, ["issue", "reject", "iss-doesnotexist"])
    assert result.exit_code != 0
    assert "not found" in result.output.lower()
    assert "Traceback" not in result.output
