from pathlib import Path
from unittest.mock import patch

import pytest
import yaml
from click.testing import CliRunner

from mlflow.claude_code.cli import claude_top_commands
from mlflow.claude_code.playground_setup import (
    DEFAULT_EXPERIMENT_NAME,
    SCHEMA_VERSION,
    load_user_config,
    run_setup_wizard,
)


@pytest.fixture(autouse=True)
def _no_real_skill_install():
    """Prevent tests from writing to ~/.claude/skills.

    Returns a non-empty list by default so the "submodule auto-init" fallback
    branch is not exercised. Tests that care about that branch should override
    `return_value` (or assert against `mlflow.claude_code.playground_setup
    ._init_skills_submodule_if_dev`).
    """
    with patch(
        "mlflow.assistant.skill_installer.install_skills",
        return_value=["mock-skill"],
    ) as m:
        yield m


@pytest.fixture(autouse=True)
def _no_real_instrument():
    """Prevent tests from spawning a real `claude` subprocess.

    Defaults to a successful no-op (rc=0). Tests that care about the call
    can grab the mock and override `return_value` or assert call args.
    """
    with patch(
        "mlflow.claude_code.playground_setup.instrument_with_claude",
        return_value=0,
    ) as m:
        yield m


def test_run_setup_wizard_writes_config_non_interactive(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    config = run_setup_wizard(config_path=config_path, non_interactive=True, repo_dir=repo_dir)

    assert config_path.exists()
    raw = yaml.safe_load(config_path.read_text())
    assert raw["schema_version"] == SCHEMA_VERSION
    assert raw["mlflow"]["experiment"] == DEFAULT_EXPERIMENT_NAME
    # tracking_uri is no longer persisted — it's derived from cwd at launch.
    assert raw["mlflow"]["tracking_uri"] == ""
    assert raw["worker"]["kind"] == "claude-code"
    assert config.playground.enable_tracing is True
    assert raw["playground"]["repo_dir"] == str(repo_dir.resolve())


def test_run_setup_wizard_idempotent_preserves_user_edits(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    run_setup_wizard(config_path=config_path, non_interactive=True)

    raw = yaml.safe_load(config_path.read_text())
    raw["mlflow"]["experiment"] = "my-custom-experiment"
    config_path.write_text(yaml.safe_dump(raw, sort_keys=False))

    second = run_setup_wizard(config_path=config_path, non_interactive=True)
    assert second.mlflow.experiment == "my-custom-experiment"


def test_cli_setup_non_interactive_writes_to_custom_path(tmp_path: Path):
    config_path = tmp_path / "playground" / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    runner = CliRunner()
    result = runner.invoke(
        claude_top_commands,
        [
            "setup",
            "--non-interactive",
            "--config-path",
            str(config_path),
            "--repo-dir",
            str(repo_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    assert config_path.exists()


def test_cli_setup_interactive_accept_all_defaults(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    runner = CliRunner()
    # 3 prompts in order: experiment, enable_tracing,
    # then (after summary) start_now.
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--config-path", str(config_path), "--repo-dir", str(repo_dir)],
        input="\n" * 3,
    )
    assert result.exit_code == 0, result.output
    config = load_user_config(config_path)
    assert config is not None
    assert config.mlflow.experiment == DEFAULT_EXPERIMENT_NAME


def test_cli_setup_start_playground_prompt_appears_after_summary(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    runner = CliRunner()
    # 3 prompts: experiment, enable_tracing, start_now.
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--config-path", str(config_path), "--repo-dir", str(repo_dir)],
        input="\n" * 3,
    )
    assert result.exit_code == 0, result.output
    output = result.output
    summary_idx = output.find(str(config_path))
    start_idx = output.find("Start the local MLflow playground now?")
    assert summary_idx != -1
    assert start_idx != -1
    assert summary_idx < start_idx, (
        "The 'Start the playground server now?' prompt must come AFTER the "
        f"summary, but got summary at {summary_idx}, start prompt at {start_idx}.\n"
        f"Output:\n{output}"
    )


def test_cli_setup_invokes_claude_instrumentation(tmp_path: Path, _no_real_instrument):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    runner = CliRunner()
    result = runner.invoke(
        claude_top_commands,
        [
            "setup",
            "--non-interactive",
            "--config-path",
            str(config_path),
            "--repo-dir",
            str(repo_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    _no_real_instrument.assert_called_once_with(repo_dir)


def test_cli_setup_user_says_no_to_tracing_skips_instrumentation(
    tmp_path: Path, _no_real_instrument
):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "agent-repo"
    repo_dir.mkdir()
    runner = CliRunner()
    # 3 prompts: experiment, enable_tracing (answer NO), start_now
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--config-path", str(config_path), "--repo-dir", str(repo_dir)],
        input="\nn\n\n",
    )
    assert result.exit_code == 0, result.output
    _no_real_instrument.assert_not_called()


def test_load_user_config_ignores_stale_keys(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        yaml.safe_dump({
            "schema_version": SCHEMA_VERSION,
            "mlflow": {"tracking_uri": "sqlite:///x.db", "experiment": "exp"},
            "playground": {
                "enable_tracing": True,
                "repo_dir": str(tmp_path),
                "install_claude_skills": True,  # removed field
            },
            "worker": {"kind": "claude-code"},
            "git": {"use_existing_credentials": True},
        })
    )
    config = load_user_config(config_path)
    assert config is not None
    assert config.playground.enable_tracing is True
    assert config.playground.repo_dir == str(tmp_path)
    assert not hasattr(config.playground, "install_claude_skills")


def test_install_skills_always_runs(tmp_path: Path, _no_real_skill_install):
    _no_real_skill_install.return_value = ["instrumenting-with-mlflow-tracing"]
    config_path = tmp_path / "config.yaml"
    runner = CliRunner()
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--non-interactive", "--config-path", str(config_path), "--repo-dir", str(tmp_path / "agent-repo")],
    )
    assert result.exit_code == 0, result.output
    _no_real_skill_install.assert_called_once()
    (called_path,) = _no_real_skill_install.call_args.args
    assert called_path == Path.home() / ".claude" / "skills"
    assert "instrumenting-with-mlflow-tracing" in result.output


def test_install_skills_retries_after_dev_submodule_init(tmp_path: Path, _no_real_skill_install):
    """Empty first call (uninitialized submodule) → init helper → retry succeeds."""
    _no_real_skill_install.side_effect = [
        [],  # first call: empty (submodule not checked out)
        ["instrumenting-with-mlflow-tracing"],  # after init: skills appear
    ]
    config_path = tmp_path / "config.yaml"
    runner = CliRunner()
    with patch(
        "mlflow.claude_code.playground_setup._init_skills_submodule_if_dev",
        return_value=True,
    ) as mock_init:
        result = runner.invoke(
            claude_top_commands,
            [
                "setup",
                "--non-interactive",
                "--config-path",
                str(config_path),
                "--repo-dir",
                str(tmp_path / "agent-repo"),
            ],
        )
    assert result.exit_code == 0, result.output
    mock_init.assert_called_once()
    assert _no_real_skill_install.call_count == 2
    assert "instrumenting-with-mlflow-tracing" in result.output


def test_install_skills_pypi_path_no_init_attempt(tmp_path: Path, _no_real_skill_install):
    """When install succeeds on the first call, the dev-init helper is never called."""
    _no_real_skill_install.return_value = ["instrumenting-with-mlflow-tracing"]
    config_path = tmp_path / "config.yaml"
    runner = CliRunner()
    with patch(
        "mlflow.claude_code.playground_setup._init_skills_submodule_if_dev",
    ) as mock_init:
        result = runner.invoke(
            claude_top_commands,
            [
                "setup",
                "--non-interactive",
                "--config-path",
                str(config_path),
                "--repo-dir",
                str(tmp_path / "agent-repo"),
            ],
        )
    assert result.exit_code == 0, result.output
    mock_init.assert_not_called()
