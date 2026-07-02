"""
Start MLflow server backed by TempoTrackingStore.

Uses `mlflow server` (not app.run) so Huey job runner, proper WSGI server,
and all server infrastructure work correctly.

The TempoTrackingStore is registered via the mlflow.tracking_store entry point
(scheme: tempo-sql) installed from this directory's pyproject.toml.

Usage (from repo root):
    # First time: uv pip install -e .agent/poc/
    uv run .agent/poc/serve_ui.py [--port 5004] [--trace-store-url http://localhost:3200]
"""

import argparse
import os
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5004)
    parser.add_argument("--trace-store-url", default="http://localhost:3200")
    args = parser.parse_args()

    poc_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(poc_dir, "sidecar.db")
    db_uri = f"sqlite:///{db_path}"

    print(f"MLflow server on port {args.port}")
    print(f"  Store URI: {db_uri}")
    print(f"  Trace store: {args.trace_store_url}")
    print(
        f"Run: cd mlflow/server/js && PORT=3002 MLFLOW_PROXY=http://localhost:{args.port}"
        f" MLFLOW_DEV_PROXY_MODE=1 BROWSER=none yarn start"
    )

    env = {
        **os.environ,
        "MLFLOW_TRACE_STORE_URL": args.trace_store_url,
    }

    cmd = [
        sys.executable,
        "-m",
        "mlflow",
        "server",
        "--backend-store-uri",
        db_uri,
        "--host",
        "0.0.0.0",
        "--port",
        str(args.port),
    ]

    subprocess.run(cmd, env=env)


if __name__ == "__main__":
    main()
