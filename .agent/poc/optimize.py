"""
Skill Optimization PoC

Optimizes a coding agent skill by running it on a test dataset,
scoring results, and letting a reflection agent edit the skill to improve.
"""

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import mlflow
from mlflow.genai.scorers import Guidelines

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SKILL_PATH = Path(__file__).parent / "test_skill.md"
DATASET_PATH = Path(__file__).parent / "dataset.json"


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------
@dataclass
class Checkpoint:
    iteration: int
    metrics: dict
    skill_text: str
    aggregate: float = 0.0


def aggregate_score(metrics: dict) -> float:
    values = [v for v in metrics.values() if isinstance(v, (int, float))]
    return sum(values) / len(values) if values else 0.0


# ---------------------------------------------------------------------------
# predict_fn  (Task 2)
# ---------------------------------------------------------------------------
async def predict_fn(*, input: str, **kwargs) -> str:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    from claude_agent_sdk.types import AssistantMessage, TextBlock

    skill_body = SKILL_PATH.read_text()

    async with ClaudeSDKClient(
        options=ClaudeAgentOptions(
            system_prompt=skill_body,
            allowed_tools=["Read", "Bash(cat:*)"],
            permission_mode="acceptEdits",
            max_turns=5,
        ),
    ) as client:
        await client.query(input)
        result_text = ""
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        result_text = block.text
        return result_text


# ---------------------------------------------------------------------------
# reflect  (Task 4)
# ---------------------------------------------------------------------------
async def reflect(skill_path: Path, result) -> None:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    from claude_agent_sdk.types import AssistantMessage

    result_df = result.result_df

    rows_summary = []
    for _, row in result_df.iterrows():
        row_info = {
            "request": str(row.get("request", "")),
            "response": str(row.get("response", ""))[:500],
        }
        for col in result_df.columns:
            if col.endswith("/value") or col.endswith("/rationale"):
                row_info[col] = str(row.get(col, ""))
        rows_summary.append(row_info)

    current_skill = skill_path.read_text()

    reflection_prompt = f"""You are a skill optimizer. Your job is to improve a coding agent skill file
based on evaluation results.

## Current Skill File ({skill_path.name})

```
{current_skill}
```

## Evaluation Results

Each row below is one test case with its scores and rationales:

```json
{json.dumps(rows_summary, indent=2)}
```

## Aggregate Metrics

```json
{json.dumps(dict(result.metrics), indent=2, default=str)}
```

## Instructions

1. Analyze which test cases scored poorly and why.
2. Identify specific weaknesses in the skill instructions.
3. Edit the skill file to address these weaknesses.
4. Make minimal, targeted changes. Do not rewrite the entire skill unless necessary.
5. The skill file is at: {skill_path}

Use the Edit tool to modify the skill file now."""

    async with ClaudeSDKClient(
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit"],
            permission_mode="acceptEdits",
            max_turns=10,
        ),
    ) as client:
        await client.query(reflection_prompt)
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                logger.info("Reflection agent responded")


# ---------------------------------------------------------------------------
# optimize_skill  (Task 5)
# ---------------------------------------------------------------------------
def optimize_skill(
    skill_path: Path,
    predict_fn,
    dataset: list[dict],
    scorers: list,
    n_iterations: int = 3,
) -> Checkpoint:
    mlflow.anthropic.autolog()

    checkpoints: list[Checkpoint] = []

    for i in range(n_iterations):
        logger.info(f"=== Iteration {i + 1}/{n_iterations} ===")

        result = mlflow.genai.evaluate(
            data=dataset,
            predict_fn=predict_fn,
            scorers=scorers,
        )

        metrics = dict(result.metrics)
        score = aggregate_score(metrics)
        checkpoint = Checkpoint(
            iteration=i,
            metrics=metrics,
            skill_text=skill_path.read_text(),
            aggregate=score,
        )
        checkpoints.append(checkpoint)

        logger.info(f"Iteration {i + 1} score: {score:.3f} | metrics: {metrics}")

        if i < n_iterations - 1:
            import asyncio

            logger.info("Running reflection agent...")
            asyncio.run(reflect(skill_path, result))
            logger.info("Reflection complete. Skill updated.")

    best = max(checkpoints, key=lambda c: c.aggregate)
    logger.info(
        f"Best iteration: {best.iteration + 1} with score {best.aggregate:.3f}"
    )

    skill_path.write_text(best.skill_text)
    logger.info("Restored best skill version.")

    return best


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    dataset = json.loads(DATASET_PATH.read_text())

    scorers = [
        Guidelines(
            name="completeness",
            guidelines=(
                "The summary must contain all three required sections: "
                "Purpose, Key Functions, and Dependencies. "
                "Each section must have substantive content, not just a heading."
            ),
            model="openai:/databricks-gpt-5-5",
        ),
        Guidelines(
            name="conciseness",
            guidelines=(
                "The summary should be concise and avoid unnecessary detail. "
                "No code snippets should be included. "
                "Each function description should be one line or less."
            ),
            model="openai:/databricks-gpt-5-5",
        ),
    ]

    best = optimize_skill(
        skill_path=SKILL_PATH,
        predict_fn=predict_fn,
        dataset=dataset,
        scorers=scorers,
        n_iterations=3,
    )

    print(f"\nDone. Best score: {best.aggregate:.3f} (iteration {best.iteration + 1})")
    print(f"Final skill:\n{SKILL_PATH.read_text()}")


if __name__ == "__main__":
    main()
