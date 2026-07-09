"""Seed + drive the MLflow review-queue workflow demo.

Two phases:

  python seed.py setup    # create experiment, schemas, datasets, queues, traces;
                          # write demo_config.json. Run this FIRST.
  python seed.py score    # client-side "scoring pass": log a `topic` + `is_problematic`
                          # feedback on each seeded trace. Run this AFTER the receiver
                          # is up and the webhook is registered, to kick off the flow.

In Databricks this scoring step is a managed online scorer; OSS has no server-side
model execution, so the demo scores traces from the client. Either way it produces
`topic` feedback assessments, which fire the `trace_assessment.created` webhook.
"""

import json
import os
import sys
from pathlib import Path

import mlflow
from mlflow.entities import AssessmentSource
from mlflow.genai import label_schemas as ls
from mlflow.genai import review_queues as rq
from mlflow.genai.datasets import create_dataset, get_dataset

CONFIG_PATH = Path(os.environ.get("DEMO_CONFIG", "demo_config.json"))
WEBHOOK_SECRET = "demo-secret"

# The seeded support questions (all rentals-topic so they route to the one demo queue).
QUESTIONS = [
    "How do I break my apartment lease early?",
    "Can my landlord raise the rent mid-lease?",
    "What's the deposit for a rental in Chicago?",
    "Is subletting my rental allowed?",
]


def _schema_id(name: str, experiment_id: str) -> str:
    return next(s.schema_id for s in ls.list_label_schemas(experiment_id=experiment_id) if s.name == name)


def setup() -> dict:
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
    mlflow.set_tracking_uri(tracking_uri)

    exp = mlflow.get_experiment_by_name("review-workflow-demo")
    experiment_id = exp.experiment_id if exp else mlflow.create_experiment("review-workflow-demo")
    mlflow.set_experiment(experiment_id=experiment_id)

    # Review criteria (FEEDBACK) + ground truth (EXPECTATION).
    existing = {s.name for s in ls.list_label_schemas(experiment_id=experiment_id)}
    schemas = [
        ("Topic correct?", "feedback", ls.InputPassFail(positive_label="Correct", negative_label="Incorrect")),
        ("Anonymized?", "feedback", ls.InputPassFail(positive_label="Yes", negative_label="No")),
        ("Approve?", "feedback", ls.InputPassFail(positive_label="Approve", negative_label="Reject")),
        ("answer", "expectation", ls.InputText()),
    ]
    for name, stype, inp in schemas:
        if name not in existing:
            ls.create_label_schema(name=name, type=stype, input=inp, experiment_id=experiment_id)

    # Topic queue (trace review): the PM who owns "rentals".
    rentals_queue = rq.create_review_queue(
        name="Rentals review",
        queue_type="custom",
        users=["pm@example.com"],
        schema_ids=[_schema_id("Topic correct?", experiment_id), _schema_id("Anonymized?", experiment_id)],
        experiment_id=experiment_id,
    )

    # Staging + golden datasets.
    staging = create_dataset(name="staging-qa", experiment_id=experiment_id)
    golden = create_dataset(name="golden-qa", experiment_id=experiment_id)

    # Second queue (dataset review): the reviewer pool, bound to the staging dataset.
    second_queue = rq.create_review_queue(
        name="Staged record approval",
        queue_type="custom",
        users=["rev1@example.com", "rev2@example.com"],
        schema_ids=[_schema_id("Approve?", experiment_id), _schema_id("answer", experiment_id)],
        experiment_id=experiment_id,
        dataset_id=staging.dataset_id,
    )

    # Demo traces.
    @mlflow.trace
    def support_agent(question: str) -> str:
        return f"Here is some guidance about: {question}"

    trace_ids = []
    for q in QUESTIONS:
        support_agent(q)
        trace_ids.append(mlflow.get_last_active_trace_id())

    config = {
        "tracking_uri": tracking_uri,
        "experiment_id": str(experiment_id),
        "topic_queues": {"rentals": rentals_queue.queue_id},
        "staging_dataset_id": staging.dataset_id,
        "golden_dataset_id": golden.dataset_id,
        "second_queue_id": second_queue.queue_id,
        "webhook_secret": WEBHOOK_SECRET,
        "trace_ids": trace_ids,
    }
    CONFIG_PATH.write_text(json.dumps(config, indent=2))
    print(f"Wrote {CONFIG_PATH}")
    print(json.dumps(config, indent=2))
    return config


def _topic_for(question: str) -> str:
    q = question.lower()
    return "rentals" if any(k in q for k in ("lease", "rent", "sublet", "landlord", "deposit")) else "other"


def score() -> None:
    """Client-side scoring pass: label each trace with topic + is_problematic."""
    config = json.loads(CONFIG_PATH.read_text())
    mlflow.set_tracking_uri(config["tracking_uri"])
    source = AssessmentSource(source_type="CODE", source_id="topic-scorer")
    for tid, q in zip(config["trace_ids"], QUESTIONS):
        mlflow.log_feedback(trace_id=tid, name="topic", value=_topic_for(q), source=source)
        mlflow.log_feedback(trace_id=tid, name="is_problematic", value=("deposit" in q.lower()), source=source)
        print(f"scored {tid}: topic={_topic_for(q)}")


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else "setup"
    if phase == "setup":
        setup()
    elif phase == "score":
        score()
    else:
        raise SystemExit(f"unknown phase {phase!r}; use 'setup' or 'score'")
