# POC: MLflow Trace UI backed by Grafana Tempo

Proves that MLflow's trace UI can render traces stored **only** in Tempo.
No dual-export. No materialization to SQL. No cheating.

## Flow

```
App (pure OTel SDK) --> Tempo --> TempoReadOnlyStore --> MLflow UI
                                 (in-memory only)
```

1. `generate.py` - Pure OTel SDK sends traces to Tempo. No MLflow imported.
2. `tempo_reader.py` - Fetches from Tempo, builds MLflow Trace objects in memory.
3. `verify.py` - Validates the round-trip produces correct MLflow objects.
4. `tempo_store.py` - MLflow tracking store plugin that reads from Tempo on demand.
5. `serve_ui.py` - Starts MLflow UI backed by the Tempo store.

## Prerequisites

- Docker (for Tempo)

## Run

```bash
# 1. Start Tempo
docker compose -f .agent/poc/docker-compose.yml up -d

# 2. Generate traces (pure OTel, no MLflow)
uv run --with opentelemetry-sdk,opentelemetry-exporter-otlp-proto-http \
    .agent/poc/generate.py

# 3. Verify round-trip (Tempo -> MLflow Trace in memory)
uv run .agent/poc/verify.py <trace_id_from_step_2>

# 4. Start MLflow UI backed by Tempo
#    Option A: From source (no built JS - API works, UI may not render)
uv run .agent/poc/serve_ui.py --port 5003

#    Option B: With built frontend (use pip-installed mlflow in a venv)
python3 -m venv /tmp/mlflow-tempo-venv
/tmp/mlflow-tempo-venv/bin/pip install mlflow
cd /tmp && /tmp/mlflow-tempo-venv/bin/python \
    ~/Workspace/mlflow-worktrees/mlflow-grafana/.agent/poc/serve_ui.py --port 5003

# 5. Open http://localhost:5003 - traces are fetched from Tempo on each request
```

## Cleanup

```bash
docker compose -f .agent/poc/docker-compose.yml down -v
```
