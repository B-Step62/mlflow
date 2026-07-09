# Review-workflow webhook receiver (reference example)

A small [FastAPI](https://fastapi.tiangolo.com/) service that listens for MLflow
webhook events and drives an automated **trace -> curate -> review -> promote -> CI**
loop for a review-queue workflow.

This is **customer-owned glue**, not part of MLflow. MLflow owns and emits the
events; the receiver owns the business logic. In particular, the following all
live *here*, not in MLflow:

- the **topic -> review queue** map (`topic_queues`),
- the **QA gate** (`qa_ok`), and
- the **staging -> golden** promotion / merge rules.

Treat it as prototype-quality reference code to copy and adapt.

## Quickstart

Two things you can test: the in-app **review notification** (a count badge on the
experiment's **Review** sidenav item), and the full automated workflow.

### Prerequisites: server env vars

Webhooks are locked down by default. For a **local** demo, export these before
launching the MLflow server so it inherits them:

```bash
export MLFLOW_WEBHOOK_ALLOWED_SCHEMES=https,http   # allow an http receiver
export MLFLOW_WEBHOOK_ALLOW_PRIVATE_IPS=true       # allow 127.0.0.1
# Stable key so webhook secrets stay decryptable across restarts (else delivery fails):
export MLFLOW_WEBHOOK_SECRET_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
export MLFLOW_SERVER_BASE_URL=http://localhost:5000
```

For the full UI (to click the flow and see the badge), launch the dev server
(backend + React) from the repo root with those vars exported:

```bash
uv run dev/run_dev_server.py
```

### A. See the in-app review notification (no receiver needed)

1. Open an experiment, go to **Traces** or **Datasets**, select rows, and
   **Flag for review** into a review queue.
2. The **Review** item in the left sidenav now shows a red count of pending
   items; it decrements as you complete reviews.

### B. Run the full automated workflow

From this directory, against the same tracking server:

```bash
pip install -r requirements.txt            # fastapi + uvicorn (mlflow already installed)
export DEMO_CONFIG=$PWD/demo_config.json
python seed.py setup                       # experiment, schemas, datasets, queues, traces
python register_webhook.py                 # subscribe the receiver to the 5 events
uvicorn receiver:app --port 8000 &         # start the receiver
python seed.py score                       # label traces -> fires the first webhook
```

Then work the UI (curate a trace into the staging dataset, approve the staged
record in the second queue); the receiver routes, QA-gates, promotes approved
records into the golden dataset, and appends to `ci_dispatch.log`. Tail the
receiver's stdout to watch each step.

## The 9-step flow

Steps marked **[receiver]** are what this app does; the rest happen in MLflow or
in the MLflow UI (human actions).

1. Your GenAI app logs a **trace** to an MLflow experiment.
2. A triager adds a **`topic` assessment** to the trace in the UI (e.g.
   `topic=rentals`). MLflow fires `trace_assessment.created`.
3. **[receiver]** Map the topic to a review queue via `topic_queues` and attach
   the trace to it (`add_items_to_review_queue`, `item_type="trace"`). All other
   assessments, including reviewers' own answers, are ignored.
4. A **domain expert** works the topic queue and curates a good trace into the
   **staging dataset**. MLflow fires `dataset_record.created` (staging).
5. **[receiver]** Run the **QA gate** (`qa_ok`) on the new staging record. If it
   passes, attach it to the **second review queue** for a final approval pass
   (`add_items_to_review_queue`, `item_type="dataset_record"`).
6. A **reviewer** works the second queue, answers the **`Approve?`** question,
   and marks the queue item **COMPLETE**. MLflow fires
   `review_queue_item.updated` with `status="COMPLETE"`.
7. **[receiver]** Fetch the record from the staging dataset and read the verdict
   from `tags["mlflow.review.feedback"]` (the `Approve?` entry).
8. **[receiver]** If **approved**, merge the record's `inputs` + `expectations`
   into the **golden dataset** (`merge_records`). If rejected, log and stop.
   The merge fires `dataset_record.created` (golden).
9. **[receiver]** See the new golden record and **dispatch CI** (here: append a
   JSON line to `ci_dispatch.log`), e.g. to re-run your eval suite against the
   updated golden set.

### Avoiding loops

Attaching items and merging records make MLflow emit
`review_queue_item.created` and `dataset_record.updated` events. The receiver
**ignores both** (logged at debug only) so it never reacts to its own actions.

## What the receiver does per event

| entity              | action    | receiver behaviour                                                        |
| ------------------- | --------- | ------------------------------------------------------------------------- |
| `trace_assessment`  | `created` | If `assessment_name == "topic"`, route the trace to `topic_queues[value]` |
| `dataset_record`    | `created` | Staging -> QA gate -> second queue; golden -> CI dispatch                 |
| `review_queue_item` | `updated` | On second-queue `COMPLETE` + approved verdict, merge into golden          |
| `review_queue_item` | `created` | No-op (loop avoidance)                                                     |
| `dataset_record`    | `updated` | No-op (loop avoidance)                                                     |

## Webhook contract

MLflow POSTs a JSON envelope:

```json
{ "entity": "<entity>", "action": "<action>", "timestamp": "<iso8601>", "data": { } }
```

with headers `X-MLflow-Delivery-Id`, `X-MLflow-Timestamp`, and (only when the
webhook was created with a secret) `X-MLflow-Signature: v1,<base64>`. The
receiver verifies the signature as HMAC-SHA256 over
`f"{delivery_id}.{timestamp}.{raw_body}"` on the **raw** body before parsing,
and returns **401** on mismatch. Every other outcome returns **200** so MLflow
does not retry-storm the receiver.

## Configuration

Read at startup from the JSON file named by `$DEMO_CONFIG` (default
`./demo_config.json`, written by the seed script):

```json
{
  "tracking_uri": "http://localhost:5000",
  "experiment_id": "0",
  "topic_queues": { "rentals": "rq-rentals", "billing": "rq-billing" },
  "staging_dataset_id": "d-staging",
  "golden_dataset_id": "d-golden",
  "second_queue_id": "rq-qa-review",
  "webhook_secret": "s3cr3t"
}
```

Leave `webhook_secret` empty/absent to disable signature verification (dev only).

## Run

```bash
pip install -r requirements.txt   # plus: pip install mlflow
uvicorn receiver:app --port 8000
```

Then create an MLflow webhook pointing at `http://<host>:8000/webhook` (with the
same secret you put in `demo_config.json`). Point `$DEMO_CONFIG` at a different
file if your config lives elsewhere.
