"""CLI commands under the `mlflow agent` namespace."""

from pathlib import Path

import click

from mlflow.playground.issue_cli import issue_commands
from mlflow.playground.test_run_cli import test_commands


@click.group("agent")
def agent_commands() -> None:
    """MLflow Agent Playground commands."""


agent_commands.add_command(issue_commands)
agent_commands.add_command(test_commands)


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
@click.option(
    "--no-start",
    is_flag=True,
    help="Stop after the wizard; don't launch the playground server.",
)
def setup(
    non_interactive: bool,
    config_path: Path | None,
    repo_dir: Path | None,
    no_start: bool,
) -> None:
    """Interactive wizard for the MLflow Agent Playground.

    Detects installed coding agents (claude, codex, gemini, opencode) and lets
    you pick one as the playground's primary worker. Only Claude Code is fully
    supported today; other selections are saved but instrumentation is skipped.

    By default the wizard hands off to ``mlflow agent playground`` once setup
    finishes — that's the natural next step and saves a context switch. Pass
    ``--no-start`` (or run with ``--non-interactive``, which is typically a
    CI/scripted path) to skip the auto-start.
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

    if no_start or non_interactive:
        return

    click.echo("")
    click.echo("Setup complete — starting playground at http://127.0.0.1:5000 …")
    click.echo("(re-run `mlflow agent setup --no-start` to skip this auto-start)")
    click.echo("")
    from mlflow.playground.server import serve

    serve(
        host="127.0.0.1",
        port=5000,
        open_browser=True,
        reload=False,
        agent_url=None,
        rebuild_ui=False,
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
@click.option(
    "--rebuild-ui",
    is_flag=True,
    help=(
        "Force a fresh `yarn build` of the React bundle before starting. Use this "
        "after editing source files in mlflow/server/js/src — otherwise the cached "
        "bundle from the previous run is served and your changes won't appear."
    ),
)
def playground(
    host: str,
    port: int,
    no_browser: bool,
    reload: bool,
    agent_url: str | None,
    rebuild_ui: bool,
) -> None:
    """Start the local MLflow playground flow and open the browser."""
    from mlflow.playground.server import serve

    serve(
        host=host,
        port=port,
        open_browser=not no_browser,
        reload=reload,
        agent_url=agent_url,
        rebuild_ui=rebuild_ui,
    )
