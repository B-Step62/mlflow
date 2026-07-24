"""Seed sample GenAI evaluation runs in the Default experiment for UI development."""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import mlflow
import pandas as pd
from mlflow.exceptions import MlflowException
from mlflow.utils.mlflow_tags import MLFLOW_RUN_TYPE, MLFLOW_RUN_TYPE_GENAI_EVALUATE

DEFAULT_EXPERIMENT_ID = "0"
DEFAULT_EXPERIMENT_NAME = "Default"
SEED_PARAM_KEY = "eval_runs_prototype_demo"
DATASET_NAME = "support_qa_smoke"


@dataclass(frozen=True)
class SeedRunSpec:
    name: str
    answer_style: str
    latency_ms: float
    total_tokens: float
    cost_usd: float
    correctness: float
    groundedness: float
    relevance: float
    prompt_version: str


SEED_RUNS = [
    SeedRunSpec(
        name="baseline-support-agent-eval",
        answer_style="baseline",
        latency_ms=1680,
        total_tokens=4200,
        cost_usd=0.42,
        correctness=0.84,
        groundedness=0.78,
        relevance=0.88,
        prompt_version="v1-baseline",
    ),
    SeedRunSpec(
        name="grounded-rag-agent-eval",
        answer_style="grounded",
        latency_ms=1320,
        total_tokens=5100,
        cost_usd=0.51,
        correctness=0.92,
        groundedness=0.94,
        relevance=0.91,
        prompt_version="v2-grounded",
    ),
    SeedRunSpec(
        name="fast-router-agent-eval",
        answer_style="fast",
        latency_ms=840,
        total_tokens=2850,
        cost_usd=0.29,
        correctness=0.76,
        groundedness=0.72,
        relevance=0.82,
        prompt_version="v3-fast",
    ),
]


BASE_CASES = [
    {
        "question": "How do I restore a deleted MLflow run?",
        "expected_response": (
            "Open the experiment, switch the lifecycle filter to deleted runs, and restore "
            "the run from the run actions menu."
        ),
        "context": (
            "Deleted runs can be viewed by changing the lifecycle filter and restored from "
            "the run actions menu."
        ),
    },
    {
        "question": "What should I check when a GenAI app response is slow?",
        "expected_response": (
            "Check latency by trace, token usage, retriever calls, and model endpoint timing "
            "before changing prompts."
        ),
        "context": (
            "Latency investigations should inspect trace timing, token usage, retriever spans, "
            "and model endpoint timing."
        ),
    },
    {
        "question": "How can I compare prompt quality across versions?",
        "expected_response": (
            "Create an evaluation dataset, run both prompt versions against it, and compare "
            "assessment scores across evaluation runs."
        ),
        "context": (
            "Prompt versions can be compared by running evaluations on a shared dataset and "
            "reviewing assessment metrics."
        ),
    },
    {
        "question": "Why does my answer need groundedness checks?",
        "expected_response": (
            "Groundedness checks identify claims that are not supported by retrieved context "
            "or expected evidence."
        ),
        "context": (
            "Groundedness checks compare the answer against retrieved evidence and flag "
            "unsupported claims."
        ),
    },
]


def _build_outputs(style: str, case: dict[str, str]) -> str:
    if style == "baseline":
        return f"{case['expected_response']} You may also want to retry the request."
    if style == "fast":
        return case["expected_response"].split(",")[0] + "."
    return f"{case['expected_response']} Based on the provided context: {case['context']}"


def _build_dataset(style: str) -> list[dict[str, object]]:
    return [
        {
            "inputs": {"question": case["question"], "context": case["context"]},
            "outputs": _build_outputs(style, case),
            "expectations": {
                "expected_response": case["expected_response"],
                "context": case["context"],
            },
            "tags": {"dataset": "support_qa_smoke", "case_id": f"case-{index + 1}"},
        }
        for index, case in enumerate(BASE_CASES)
    ]


def _build_dataset_input(style: str):
    dataset_rows = []
    for row in _build_dataset(style):
        inputs = row["inputs"]
        expectations = row["expectations"]
        dataset_rows.append(
            {
                "question": inputs["question"],
                "context": inputs["context"],
                "response": row["outputs"],
                "expected_response": expectations["expected_response"],
            }
        )
    return mlflow.data.from_pandas(pd.DataFrame(dataset_rows), name=DATASET_NAME)


def _log_seed_run(experiment_id: str, spec: SeedRunSpec) -> None:
    with mlflow.start_run(
        experiment_id=experiment_id,
        run_name=spec.name,
        tags={
            MLFLOW_RUN_TYPE: MLFLOW_RUN_TYPE_GENAI_EVALUATE,
            "variant": spec.answer_style,
        },
    ):
        mlflow.log_input(_build_dataset_input(spec.answer_style), context="evaluation")
        mlflow.log_params(
            {
                SEED_PARAM_KEY: "true",
                "dataset": DATASET_NAME,
                "prompt_version": spec.prompt_version,
            }
        )
        mlflow.log_metrics(
            {
                "latency_ms": spec.latency_ms,
                "total_tokens": spec.total_tokens,
                "cost_usd": spec.cost_usd,
                "correctness": spec.correctness,
                "groundedness": spec.groundedness,
                "relevance": spec.relevance,
            }
        )


def _get_default_experiment_id(client: mlflow.MlflowClient) -> str:
    if experiment := client.get_experiment_by_name(DEFAULT_EXPERIMENT_NAME):
        return experiment.experiment_id

    try:
        experiment = client.get_experiment(DEFAULT_EXPERIMENT_ID)
        return experiment.experiment_id
    except MlflowException:
        return client.create_experiment(DEFAULT_EXPERIMENT_NAME)


def _find_seeded_runs(client: mlflow.MlflowClient, experiment_id: str):
    return client.search_runs(
        experiment_ids=[experiment_id],
        filter_string=f"params.{SEED_PARAM_KEY} = 'true'",
        max_results=100,
    )


def _delete_seeded_runs(client: mlflow.MlflowClient, experiment_id: str) -> None:
    for run in _find_seeded_runs(client, experiment_id):
        client.delete_run(run.info.run_id)


def seed_default_evaluation_runs(refresh: bool) -> None:
    client = mlflow.MlflowClient()
    experiment_id = _get_default_experiment_id(client)
    seeded_runs = _find_seeded_runs(client, experiment_id)
    if seeded_runs and not refresh:
        print(f"Default experiment already has {len(seeded_runs)} seeded evaluation runs.")
        return

    if refresh:
        _delete_seeded_runs(client, experiment_id)

    for spec in SEED_RUNS:
        _log_seed_run(experiment_id, spec)

    print(f"Seeded {len(SEED_RUNS)} evaluation runs in the Default experiment.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tracking-uri",
        help="Tracking URI to seed. Defaults to the active MLflow tracking URI.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Delete and recreate existing seeded runs.",
    )
    args = parser.parse_args()

    if args.tracking_uri:
        mlflow.set_tracking_uri(args.tracking_uri)

    seed_default_evaluation_runs(refresh=args.refresh)


if __name__ == "__main__":
    main()
