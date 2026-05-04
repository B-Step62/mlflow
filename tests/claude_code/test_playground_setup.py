from pathlib import Path

import yaml
from click.testing import CliRunner

from mlflow.claude_code.cli import claude_top_commands
from mlflow.claude_code.playground_setup import (
    DEFAULT_EXPERIMENT_NAME,
    SCHEMA_VERSION,
    load_user_config,
    run_setup_wizard,
)


def test_run_setup_wizard_writes_config_non_interactive(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    config = run_setup_wizard(config_path=config_path, non_interactive=True)

    assert config_path.exists()
    raw = yaml.safe_load(config_path.read_text())
    assert raw["schema_version"] == SCHEMA_VERSION
    assert raw["mlflow"]["experiment"] == DEFAULT_EXPERIMENT_NAME
    assert raw["mlflow"]["tracking_uri"].startswith("file://")
    assert raw["worker"]["kind"] == "claude-code"
    assert config.playground.enable_tracing is True


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
    runner = CliRunner()
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--non-interactive", "--config-path", str(config_path)],
    )
    assert result.exit_code == 0, result.output
    assert config_path.exists()


def test_cli_setup_interactive_accept_all_defaults(tmp_path: Path):
    config_path = tmp_path / "config.yaml"
    runner = CliRunner()
    # 5 prompts: tracking_uri, experiment, enable_tracing, install_claude_skills, start_now
    result = runner.invoke(
        claude_top_commands,
        ["setup", "--config-path", str(config_path)],
        input="\n" * 5,
    )
    assert result.exit_code == 0, result.output
    config = load_user_config(config_path)
    assert config is not None
    assert config.mlflow.experiment == DEFAULT_EXPERIMENT_NAME
