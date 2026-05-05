"""Seed sample Issues across all 5 kanban columns for local UI testing.

Reads ``~/.mlflow/playground/config.yaml`` to find the tracking URI + experiment
the playground is using, then writes ~10 issues directly through the tracking
store so the kanban (``/experiments/<id>/issues``) has cards to render in every
column.

Usage::

    uv run python dev/seed_playground_issues.py             # uses config defaults
    uv run python dev/seed_playground_issues.py --count 25  # 25 issues, distributed
    uv run python dev/seed_playground_issues.py \
        --tracking-uri sqlite:///./mlflow.db --experiment my-exp
"""

from __future__ import annotations

import argparse
import random
import uuid
from pathlib import Path

import mlflow
from mlflow.claude_code.playground_setup import (
    DEFAULT_CONFIG_PATH,
    _default_tracking_uri,
    load_user_config,
)
from mlflow.entities.issue import IssueStatus
from mlflow.tracking._tracking_service.utils import _get_store
from mlflow.tracking.client import MlflowClient

# Distribution roughly mirrors a healthy in-flight kanban: lots of fresh
# todos, a handful actively being worked on, a few awaiting review, some
# closed, and one or two rejections.
DEFAULT_DISTRIBUTION = {
    IssueStatus.TODO: 4,
    IssueStatus.IN_PROGRESS: 2,
    IssueStatus.REVIEW: 2,
    IssueStatus.DONE: 2,
    IssueStatus.REJECTED: 1,
}

SAMPLE_TITLES = [
    "Agent recommends deprecated SDK method",
    "Refund response misses §4.2 of policy",
    "Tool call leaks PII in arguments",
    "Wrong currency in summary table",
    "Hallucinated invoice number",
    "Greeting reply for follow-up turn",
    "Agent retries on 4xx instead of failing fast",
    "Citation formatting drops year",
    "Returns wrong unit (kg vs lb)",
    "Confidently wrong on edge-case dates",
    "Skips the disclaimer on regulated topics",
    "Suggests unsafe SQL pattern",
    "Drops the second tool call after a retry",
    "Empty-string fallback masks failure",
    "Tone too casual for compliance scope",
    "Misroutes to non-existent agent skill",
    "Truncates long table responses",
    "Cites internal-only doc to external user",
]

SAMPLE_RATIONALES = [
    "Must mention §4.2 of the refund policy when asked about timelines.",
    "Should refuse and escalate, not answer with a guess.",
    "Tool call arguments must not contain raw user emails.",
    "Currency must match the user's locale setting.",
    "Agent should ask a clarifying question instead of inventing IDs.",
    "Should call `cancel_account` exactly once with the correct id.",
    "Citations must include four-digit year inside the brackets.",
    "Must convert metric to imperial when the user is US-based.",
    "Should respond with the disclaimer before the recommendation.",
    "Empty intermediate result should surface as an explicit failure.",
]


def _resolve_uris(config_path: Path) -> tuple[str, str]:
    config = load_user_config(config_path)
    if config is None:
        raise SystemExit(
            f"No playground config at {config_path}. Run `mlflow agent playground` once first "
            "so the config is created, or pass --tracking-uri / --experiment explicitly."
        )
    tracking_uri = config.mlflow.tracking_uri or _default_tracking_uri(
        Path(config.playground.repo_dir) if config.playground.repo_dir else None
    )
    experiment_name = config.mlflow.experiment or "agent-playground"
    return tracking_uri, experiment_name


def _ensure_experiment(experiment_name: str) -> str:
    client = MlflowClient()
    experiment = client.get_experiment_by_name(experiment_name)
    if experiment is not None:
        return experiment.experiment_id
    return client.create_experiment(experiment_name)


def _fake_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _seed_one(experiment_id: str, status: IssueStatus, idx: int, rng: random.Random) -> str:
    title = rng.choice(SAMPLE_TITLES)
    rationale = rng.choice(SAMPLE_RATIONALES)
    issue = _get_store().create_issue(
        experiment_id=experiment_id,
        name=f"[{idx:02d}] {title}",
        description=rationale,
        status=status,
        priority=rng.randint(2, 4),
        source_trace_id=_fake_id("tr"),
        source_feedback_id=_fake_id("fb"),
        source_conversation_id=_fake_id("conv"),
        labels=rng.sample(["refunds", "tools", "tone", "safety", "format"], k=rng.randint(0, 2)),
    )
    return issue.issue_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--tracking-uri", default=None)
    parser.add_argument("--experiment", default=None)
    parser.add_argument(
        "--count",
        type=int,
        default=None,
        help="Total issues to seed; uses the default 11-issue distribution when omitted.",
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    tracking_uri = args.tracking_uri
    experiment_name = args.experiment
    if not tracking_uri or not experiment_name:
        cfg_uri, cfg_exp = _resolve_uris(args.config)
        tracking_uri = tracking_uri or cfg_uri
        experiment_name = experiment_name or cfg_exp

    mlflow.set_tracking_uri(tracking_uri)
    print(f"tracking_uri = {tracking_uri}")

    experiment_id = _ensure_experiment(experiment_name)
    print(f"experiment   = {experiment_name} (id={experiment_id})")

    if args.count is not None:
        # Spread the requested total across the 5 columns proportionally to
        # the default distribution so the board still feels lifelike.
        weights = list(DEFAULT_DISTRIBUTION.items())
        total_default = sum(c for _, c in weights)
        distribution = {
            status: max(1, round(args.count * count / total_default)) for status, count in weights
        }
    else:
        distribution = dict(DEFAULT_DISTRIBUTION)

    rng = random.Random(args.seed)
    created: dict[str, list[str]] = {}
    idx = 1
    for status, count in distribution.items():
        ids = [_seed_one(experiment_id, status, idx + i, rng) for i in range(count)]
        idx += count
        created[status.value] = ids

    print("seeded:")
    for status, ids in created.items():
        print(f"  {status:12s} {len(ids)} issue(s) — first id {ids[0] if ids else '-'}")
    print(f"\nOpen the kanban at /experiments/{experiment_id}/issues to verify the columns render.")


if __name__ == "__main__":
    main()
