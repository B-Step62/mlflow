"""FastAPI server for the MLflow Agent Playground cockpit.

Epic 1 ships a placeholder page so `mlflow agent playground` is end-to-end runnable.
Epic 2 (YUK-9 through YUK-11) replaces the placeholder with the chat shell.
"""

import socket
import threading
import time
import webbrowser

import click
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

PLACEHOLDER_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MLflow Agent Playground</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
           max-width: 640px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
    code { background: #f4f4f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .placeholder { color: #71717a; font-style: italic; }
    h1 { margin-bottom: 0.5rem; }
    .subtitle { color: #52525b; margin-top: 0; }
  </style>
</head>
<body>
  <h1>MLflow Agent Playground</h1>
  <p class="subtitle">Cockpit for parallel agent development.</p>
  <p>The setup wizard and the <code>mlflow agent playground</code> entrypoint are wired
     (Epic 1 — YUK-6, YUK-7, YUK-8).</p>
  <p class="placeholder">Epic 2 (YUK-9 → YUK-11) will replace this page with a
     streaming chat UI, tool-call display, and an inline trace panel.</p>
</body>
</html>
"""


def create_app() -> FastAPI:
    app = FastAPI(title="MLflow Agent Playground")

    @app.get("/playground", response_class=HTMLResponse)
    def playground() -> str:
        return PLACEHOLDER_HTML

    @app.get("/", response_class=HTMLResponse)
    def root() -> str:
        return PLACEHOLDER_HTML

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "stage": "epic-1-placeholder"}

    return app


def pick_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def build_url(host: str, port: int) -> str:
    return f"http://{host}:{port}/playground"


def _open_browser_after_delay(url: str, delay: float = 0.5) -> None:
    time.sleep(delay)
    webbrowser.open(url)


def serve(
    host: str = "127.0.0.1",
    port: int = 0,
    open_browser: bool = True,
    reload: bool = False,
) -> None:
    """Start the playground server. Blocks until interrupted."""
    import uvicorn

    if port == 0:
        port = pick_free_port(host)

    url = build_url(host, port)
    if open_browser:
        threading.Thread(target=_open_browser_after_delay, args=(url,), daemon=True).start()

    click.echo(f"MLflow Agent Playground starting at {url}")
    click.echo("Press Ctrl+C to stop.")

    if reload:
        uvicorn.run(
            "mlflow.playground.server:create_app",
            host=host,
            port=port,
            factory=True,
            reload=True,
        )
    else:
        uvicorn.run(create_app(), host=host, port=port)
