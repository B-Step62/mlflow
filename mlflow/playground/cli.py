"""CLI commands under the `mlflow agent` namespace."""

from pathlib import Path

import click

from mlflow.playground.issue_cli import issue_commands


@click.group("agent")
def agent_commands() -> None:
    """MLflow Agent Playground commands."""


agent_commands.add_command(issue_commands)


@agent_commands.command("setup")
@click.option(
    "--non-interactive",
    is_flag=True,
    help="Skip prompts and accept defaults (or existing config values).",
)
@click.option(
    "--config-path",
    type=click.Path(dir_okay=False, path_type=Path),
    default=None,
    help="Override the config file location (default: ~/.mlflow/playground/config.yaml).",
)
@click.option(
    "--repo-dir",
    type=click.Path(file_okay=False, dir_okay=True, path_type=Path),
    default=None,
    help=(
        "The agent repository to instrument with MLflow tracing "
        "(default: current working directory). Answer 'no' to the tracing prompt "
        "to skip instrumentation."
    ),
)
def setup(
    non_interactive: bool,
    config_path: Path | None,
    repo_dir: Path | None,
) -> None:
    """Interactive wizard for the MLflow Agent Playground.

    Detects installed coding agents (claude, codex, gemini, opencode) and lets
    you pick one as the playground's primary worker. Only Claude Code is fully
    supported today; other selections are saved but instrumentation is skipped.
    """
    from mlflow.claude_code.playground_setup import (
        DEFAULT_CONFIG_PATH,
        run_setup_wizard,
    )

    run_setup_wizard(
        config_path=config_path or DEFAULT_CONFIG_PATH,
        non_interactive=non_interactive,
        repo_dir=repo_dir if repo_dir is not None else Path.cwd(),
    )


@agent_commands.command("playground")
@click.option("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1).")
@click.option("--port", type=int, default=5000, help="Port to bind (default: 5000).")
@click.option("--no-browser", is_flag=True, help="Don't open the browser automatically.")
@click.option(
    "--reload",
    is_flag=True,
    help="Auto-reload the MLflow server on code changes (development only).",
)
@click.option(
    "--agent-url",
    default=None,
    help="Base URL for the agent server /invocations endpoint (default: http://127.0.0.1:8000).",
)
def playground(host: str, port: int, no_browser: bool, reload: bool, agent_url: str | None) -> None:
    """Start the local MLflow playground flow and open the browser."""
    from mlflow.playground.server import serve

    serve(host=host, port=port, open_browser=not no_browser, reload=reload, agent_url=agent_url)
