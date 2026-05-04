"""CLI commands under the `mlflow agent` namespace."""

import click


@click.group("agent")
def agent_commands() -> None:
    """MLflow Agent Playground commands."""


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
