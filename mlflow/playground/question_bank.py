"""Question-bank storage convention for the Agent Playground.

Each experiment owns a single ``EvaluationDataset`` named
``question_bank_<experiment_id>`` containing user-curated probe questions —
recurring inputs the user wants to fire at the agent on demand or in batch.
This is the lightweight sibling of ``regression_suite``: rows here are
``inputs``-only (no ``expectations`` / ``test_spec``) — there's no notion of
pass/fail, just "ask this and show me what you get."

The dataset is created lazily on first write, mirroring the regression-suite
pattern, so empty experiments don't accumulate stub datasets.
"""

from __future__ import annotations

import uuid
from typing import Any

from mlflow.exceptions import MlflowException
from mlflow.genai.datasets import create_dataset, get_dataset
from mlflow.genai.datasets.evaluation_dataset import EvaluationDataset
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST, ErrorCode

QUESTION_BANK_DATASET_PREFIX = "question_bank_"


def question_bank_dataset_name(experiment_id: str) -> str:
    return f"{QUESTION_BANK_DATASET_PREFIX}{experiment_id}"


def get_or_create_question_bank(experiment_id: str) -> EvaluationDataset:
    name = question_bank_dataset_name(experiment_id)
    try:
        return get_dataset(name=name)
    except MlflowException as e:
        if e.error_code != ErrorCode.Name(RESOURCE_DOES_NOT_EXIST):
            raise
        return create_dataset(name=name, experiment_id=experiment_id)


def add_question(
    experiment_id: str,
    question: str,
    *,
    source_message_id: str | None = None,
) -> str:
    """Append one question row to the bank. Returns the new ``question_id``.

    ``source_message_id`` is optional metadata letting the UI track which chat
    message a question was saved from (for "added on May 5 from your refund
    conversation" style affordances later). It's stored as a tag, never used
    for lookup.
    """
    question_id = f"qb-{uuid.uuid4().hex}"
    record: dict[str, Any] = {
        "inputs": {"messages": [{"role": "user", "content": question}]},
        "tags": {
            "question_id": question_id,
            "source_message_id": source_message_id or "",
        },
    }
    dataset = get_or_create_question_bank(experiment_id)
    dataset.merge_records([record])
    return question_id


def list_questions(experiment_id: str) -> list[dict[str, Any]]:
    """Return ``[{question_id, content, dataset_record_id, source_message_id}]``
    in ``created_time`` order (oldest first).

    The cockpit chip strip reverses to "newest first" client-side; we keep
    server-side order canonical so the dataset's row insertion order is
    preserved for diagnostics.
    """
    try:
        dataset = get_dataset(name=question_bank_dataset_name(experiment_id))
    except MlflowException as e:
        if e.error_code == ErrorCode.Name(RESOURCE_DOES_NOT_EXIST):
            return []
        raise

    df = dataset.to_df()
    if df.empty:
        return []

    # Sort by created_time when present; falls back to insertion order.
    if "created_time" in df.columns:
        df = df.sort_values("created_time", ascending=True)

    out: list[dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        inputs = row.get("inputs") or {}
        messages = inputs.get("messages") or []
        content = ""
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = str(msg.get("content") or "")
                break
        tags = row.get("tags") or {}
        out.append({
            "question_id": tags.get("question_id"),
            "content": content,
            "dataset_record_id": row.get("dataset_record_id"),
            "source_message_id": tags.get("source_message_id") or None,
            "created_time": row.get("created_time"),
        })
    # Drop rows that somehow lost their tag (bad data) — they'd be
    # un-deletable from the UI anyway.
    return [q for q in out if q["question_id"]]


def delete_question(experiment_id: str, question_id: str) -> None:
    """Remove one question by ``question_id``. No-op if it doesn't exist —
    matches HTTP DELETE semantics so a double-click in the UI doesn't error.

    Resolves ``question_id`` → ``dataset_record_id`` before calling
    ``delete_records``; the underlying API works in record-id space.
    """
    try:
        dataset = get_dataset(name=question_bank_dataset_name(experiment_id))
    except MlflowException as e:
        if e.error_code == ErrorCode.Name(RESOURCE_DOES_NOT_EXIST):
            return
        raise

    df = dataset.to_df()
    if df.empty:
        return

    record_ids: list[str] = []
    for row in df.to_dict(orient="records"):
        tags = row.get("tags") or {}
        if tags.get("question_id") == question_id:
            rid = row.get("dataset_record_id")
            if rid:
                record_ids.append(rid)
    if record_ids:
        dataset.delete_records(record_ids)


__all__ = [
    "QUESTION_BANK_DATASET_PREFIX",
    "add_question",
    "delete_question",
    "get_or_create_question_bank",
    "list_questions",
    "question_bank_dataset_name",
]
