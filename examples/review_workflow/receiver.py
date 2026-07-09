"""Reference webhook receiver for MLflow's review-queue workflow.

This is *customer-owned glue*, not part of MLflow. It shows how a small
FastAPI service can turn MLflow webhook events into an automated
trace -> curate -> review -> promote -> CI loop. MLflow owns and emits the
events; the business logic lives here: which topic routes to which queue,
what the QA gate checks, and how approved staging records get promoted into
the golden dataset.

Run:

    pip install -r requirements.txt   # plus `pip install mlflow`
    uvicorn receiver:app --port 8000

Then create an MLflow webhook that POSTs to http://<host>:8000/webhook.
Configuration is read at startup from the JSON file named by $DEMO_CONFIG
(default ./demo_config.json), which the seed script writes.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request, Response

import mlflow
from mlflow.genai.datasets import get_dataset
from mlflow.genai.review_queues import add_items_to_review_queue

logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="%(asctime)s %(levelname)s %(message)s",
)
_log = logging.getLogger("review_workflow")

# CI dispatches are simulated by appending to this file next to the receiver.
CI_DISPATCH_LOG = Path(__file__).parent / "ci_dispatch.log"


def load_config() -> dict:
    path = Path(os.environ.get("DEMO_CONFIG", "./demo_config.json"))
    if not path.exists():
        raise RuntimeError(
            f"Config file {path} not found. Run the seed script to generate "
            "demo_config.json, or point $DEMO_CONFIG at your own copy."
        )
    with path.open() as f:
        return json.load(f)


# Read config and wire up the MLflow client at startup.
CONFIG = load_config()
mlflow.set_tracking_uri(CONFIG["tracking_uri"])

_log.info(
    "[startup] tracking_uri=%s experiment=%s topic_queues=%s "
    "staging=%s golden=%s second_queue=%s secret=%s",
    CONFIG.get("tracking_uri"),
    CONFIG.get("experiment_id"),
    CONFIG.get("topic_queues"),
    CONFIG.get("staging_dataset_id"),
    CONFIG.get("golden_dataset_id"),
    CONFIG.get("second_queue_id"),
    "set" if CONFIG.get("webhook_secret") else "none",
)

app = FastAPI(title="MLflow review-workflow webhook receiver")


# ---------------------------------------------------------------------------
# Signature verification: HMAC-SHA256 over the RAW body, before JSON parsing.
# ---------------------------------------------------------------------------
def verify_signature(
    raw_body: bytes, delivery_id: str, timestamp: str, signature: str, secret: str
) -> bool:
    signed = f"{delivery_id}.{timestamp}.{raw_body.decode('utf-8')}"
    digest = hmac.new(secret.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).digest()
    expected = "v1," + base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, signature or "")


# ---------------------------------------------------------------------------
# Customer-owned business logic (the "glue" that does not live in MLflow).
# ---------------------------------------------------------------------------
def qa_ok(record: dict | None) -> bool:
    """Trivial stand-in for a real QA gate.

    Real glue might run schema validation, PII/secret scans, dedup checks,
    etc. Here we simply require the record to have non-empty ``inputs``.
    """
    return bool(record and record.get("inputs"))


def _fetch_record(dataset_id: str, record_id: str) -> dict | None:
    """Look up a single dataset record by id via the dataset dataframe."""
    df = get_dataset(dataset_id=dataset_id).to_df()
    matches = df[df["dataset_record_id"] == record_id]
    if matches.empty:
        return None
    return matches.iloc[0].to_dict()


def _is_approved(tags: dict | None) -> bool:
    """Read the reviewer's ``Approve?`` verdict from the review-feedback tag."""
    feedback = json.loads((tags or {}).get("mlflow.review.feedback", "{}"))
    entry = feedback.get("Approve?") or {}
    return str(entry.get("value")).lower() in {"approve", "pass", "true", "yes"}


def _dispatch_ci(record_id: str) -> None:
    """Simulate a CI dispatch by appending a JSON line to the dispatch log."""
    line = {
        "dataset_record_id": record_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    with CI_DISPATCH_LOG.open("a") as f:
        f.write(json.dumps(line) + "\n")


# ---------------------------------------------------------------------------
# Handlers, one per (entity, action). Each returns a one-line result string.
# ---------------------------------------------------------------------------
def handle_trace_assessment_created(data: dict) -> str:
    # Step 3: route a topic-tagged trace to that topic's review queue.
    # Only react to the "topic" assessment; ignore reviewers' own answers.
    name = data.get("assessment_name")
    if name != "topic":
        return f"ignored assessment '{name}'"
    value = str(data.get("value"))
    topic_queues = CONFIG.get("topic_queues", {})
    if value not in topic_queues:
        return f"topic '{value}' has no queue mapping"
    queue_id = topic_queues[value]
    trace_id = data["trace_id"]
    add_items_to_review_queue(queue_id, item_ids=[trace_id], item_type="trace")
    return f"topic={value} -> queue {queue_id} (trace {trace_id})"


def handle_dataset_record_created(data: dict) -> str:
    dataset_id = data.get("dataset_id")
    record_id = data.get("dataset_record_id")

    if dataset_id == CONFIG.get("staging_dataset_id"):
        # Step 5: QA-gate the new staging record; if it passes, send it to the
        # second review queue for a human approval pass.
        record = _fetch_record(dataset_id, record_id)
        passed = qa_ok(record)
        _log.info("[qa] record %s -> %s", record_id, "PASS" if passed else "FAIL")
        if not passed:
            return f"staging record {record_id} failed QA, not queued"
        queue_id = CONFIG["second_queue_id"]
        add_items_to_review_queue(queue_id, item_ids=[record_id], item_type="dataset_record")
        return f"staging record {record_id} passed QA -> queue {queue_id}"

    if dataset_id == CONFIG.get("golden_dataset_id"):
        # Step 9: a newly-approved golden record landed; dispatch CI.
        _dispatch_ci(record_id)
        return f"golden record {record_id} -> CI dispatched ({CI_DISPATCH_LOG.name})"

    return f"dataset {dataset_id} is not managed by this receiver"


def handle_review_queue_item_updated(data: dict) -> str:
    # Steps 7-8: when the second-queue review of a staging record completes,
    # read the verdict and promote approved records into the golden dataset.
    if data.get("queue_id") != CONFIG.get("second_queue_id"):
        return f"queue {data.get('queue_id')} not the QA-review queue, ignored"
    if str(data.get("status", "")).upper() != "COMPLETE":
        return f"status {data.get('status')} != COMPLETE, ignored"
    if data.get("item_type") != "dataset_record":
        return f"item_type {data.get('item_type')} != dataset_record, ignored"

    record_id = data["item_id"]
    record = _fetch_record(CONFIG["staging_dataset_id"], record_id)
    if record is None:
        return f"record {record_id} not found in staging dataset"

    if not _is_approved(record.get("tags")):
        return f"record {record_id} rejected, not merging"

    golden_id = CONFIG["golden_dataset_id"]
    # Merging fires a golden dataset_record.created, which handler
    # handle_dataset_record_created turns into a CI dispatch (step 9).
    get_dataset(dataset_id=golden_id).merge_records(
        [{"inputs": record.get("inputs"), "expectations": record.get("expectations")}]
    )
    return f"record {record_id} approved -> merged into golden dataset {golden_id}"


HANDLERS = {
    ("trace_assessment", "created"): handle_trace_assessment_created,
    ("dataset_record", "created"): handle_dataset_record_created,
    ("review_queue_item", "updated"): handle_review_queue_item_updated,
}

# These fire as a side effect of our own actions (attaching items to a queue,
# merging records). Ignored on purpose so the receiver never reacts to itself.
NOOP_EVENTS = {
    ("review_queue_item", "created"),
    ("dataset_record", "updated"),
}


def dispatch(entity: str, action: str, data: dict) -> str:
    key = (entity, action)
    if key in NOOP_EVENTS:
        _log.debug("[noop] %s.%s ignored to avoid loops", entity, action)
        return "noop"
    handler = HANDLERS.get(key)
    if handler is None:
        return f"no handler for ({entity}, {action})"
    return handler(data)


# ---------------------------------------------------------------------------
# The single webhook endpoint.
# ---------------------------------------------------------------------------
@app.post("/webhook")
async def webhook(request: Request) -> Response:
    raw_body = await request.body()

    # Verify the signature on the RAW body before parsing (only if a secret
    # is configured). A mismatch is the one case that returns non-2xx.
    secret = CONFIG.get("webhook_secret")
    if secret:
        ok = verify_signature(
            raw_body,
            request.headers.get("X-MLflow-Delivery-Id", ""),
            request.headers.get("X-MLflow-Timestamp", ""),
            request.headers.get("X-MLflow-Signature", ""),
            secret,
        )
        if not ok:
            _log.warning(
                "[webhook] 401 signature mismatch (delivery_id=%s)",
                request.headers.get("X-MLflow-Delivery-Id"),
            )
            return Response(status_code=401)

    # Parse + dispatch defensively: any error is logged and swallowed so we
    # still return 200. A non-2xx would make MLflow retry and storm us.
    entity = action = None
    try:
        envelope = json.loads(raw_body.decode("utf-8"))
        entity = envelope.get("entity")
        action = envelope.get("action")
        data = envelope.get("data") or {}
        result = dispatch(entity, action, data)
        _log.info("[webhook] %s.%s: %s", entity, action, result)
    except Exception:
        _log.exception("[webhook] error handling %s.%s", entity, action)
    return Response(status_code=200)
