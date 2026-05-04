"""CLI commands under the `mlflow agent` namespace."""

import click


@click.group("agent")
def agent_commands() -> None:
    """MLflow Agent Playground commands."""


@agent_commands.command("playground")
@click.option("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1).")
@click.option("--port", type=int, default=0, help="Port to bind (default: pick a free one).")
@click.option("--no-browser", is_flag=True, help="Don't open the browser automatically.")
@click.option(
    "--reload",
    is_flag=True,
    help="Auto-reload the server on code changes (development only).",
)
def playground(host: str, port: int, no_browser: bool, reload: bool) -> None:
    """Start the Agent Playground cockpit and open the browser."""
    from mlflow.playground.server import serve

    serve(host=host, port=port, open_browser=not no_browser, reload=reload)
