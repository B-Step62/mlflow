"""Register the review-workflow webhook against the tracking server in demo_config.json.

Run after `python seed.py setup`. Points MLflow at the local receiver and subscribes
to the five events the receiver handles, using the secret the seed wrote.
"""

import json
import os
from pathlib import Path

import mlflow
from mlflow.entities.webhook import WebhookAction as A
from mlflow.entities.webhook import WebhookEntity as E
from mlflow.entities.webhook import WebhookEvent

RECEIVER_URL = os.environ.get("RECEIVER_URL", "http://127.0.0.1:8000/webhook")

cfg = json.loads(Path(os.environ.get("DEMO_CONFIG", "demo_config.json")).read_text())
mlflow.set_tracking_uri(cfg["tracking_uri"])

webhook = mlflow.MlflowClient().create_webhook(
    name="review-workflow-demo",
    url=RECEIVER_URL,
    events=[
        WebhookEvent(E.TRACE_ASSESSMENT, A.CREATED),
        WebhookEvent(E.REVIEW_QUEUE_ITEM, A.CREATED),
        WebhookEvent(E.REVIEW_QUEUE_ITEM, A.UPDATED),
        WebhookEvent(E.DATASET_RECORD, A.CREATED),
        WebhookEvent(E.DATASET_RECORD, A.UPDATED),
    ],
    secret=cfg.get("webhook_secret") or None,
)
print(f"Registered webhook {webhook.webhook_id} -> {RECEIVER_URL}")
