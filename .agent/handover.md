# Handover: Skill Optimization

**Branch**: `skill-optimization`  
**Date**: 2026-06-26  
**Design doc**: `.agent/skill-optimization-design.md`

---

## Problem

Public coding agent skills (`.claude/skills/*.md`) are written once, often untested, and tuned for the author's specific agent/model. A skill built for Claude Opus may perform poorly on Codex/GPT-5.5. There is no automated way to measure or improve skill quality against a specific target environment.

## What We're Building

A system to optimize coding agent skills by:
1. Running the skill on a test dataset using the Claude Agent SDK
2. Scoring each run with MLflow scorers (Guidelines, custom, etc.)
3. Showing the results to a reflection agent that edits the skill files to improve them
4. Repeating until scores plateau, then restoring the best-scoring version

---

## Architecture

One function `optimize_skill` that loops `mlflow.genai.evaluate()` + a reflection agent:

```
optimize_skill(skill_path, predict_fn, dataset, scorers, n_iterations)

  for each iteration:
    1. result = mlflow.genai.evaluate(data=dataset, predict_fn=predict_fn, scorers=scorers)
       - evaluate() runs predict_fn on each dataset row (parallel via ThreadPoolExecutor)
       - evaluate() calls scorers on each result (handles kwargs resolution per scorer signature)
       - evaluate() returns EvaluationResult with result_df (per-row) and metrics (aggregated)
       - Each iteration creates an MLflow run (audit trail)

    2. checkpoint(iteration, result.metrics, current skill file contents)

    3. reflect(skill_path, result)
       - Format result_df into a reflection prompt
       - Invoke Agent SDK to edit the skill files based on what went wrong

  After all iterations: restore the checkpoint with the best aggregate score
```

### predict_fn

Uses Claude Agent SDK (`ClaudeSDKClient`). The skill body is injected as `system_prompt`, and the agent runs with built-in tools (Read, Edit, Bash, Glob, Grep).

```python
async def predict_fn(*, input: str, **kwargs) -> str:
    skill_body = open(skill_path).read()  # MUST re-read each call, not capture once
    async with ClaudeSDKClient(
        options=ClaudeAgentOptions(
            system_prompt=skill_body,
            allowed_tools=["Read", "Edit", "Bash", "Glob", "Grep"],
            permission_mode="acceptEdits",
        ),
    ) as client:
        await client.query(input)
        result_text = ""
        async for message in client.receive_response():
            if isinstance(message, ResultMessage):
                result_text = message.text
        return result_text
```

**Why re-read each call**: The reflection agent edits the skill file between iterations. If `skill_body` is captured once at definition time, subsequent iterations would use the stale version.

**Async compatibility**: `evaluate()` auto-wraps async `predict_fn` via `_wrap_async_predict_fn` in `mlflow/genai/utils/trace_utils.py:521` using `asyncio.run()`. Confirmed in codebase.

### Tracing

Fully automatic. `mlflow.anthropic.autolog()` patches `ClaudeSDKClient.__init__` (in `mlflow/anthropic/autolog.py:21-72`) to wrap `query()` and `receive_response()`. It collects all messages and calls `process_sdk_messages()` (in `mlflow/claude_code/tracing.py`) to create full MLflow traces with:
- Root AGENT span
- Child LLM spans (with token usage, model info)
- Child TOOL spans (with tool name, input, output)

No `@mlflow.trace` decorator needed.

### reflect()

Invokes the Agent SDK with a reflection prompt. The agent sees:
- The current skill file contents
- The full `result_df` from evaluate() (all rows, all scorer outputs)
- Instructions to edit the skill file to fix failures

The agent uses its Edit tool to modify the skill file in place.

### Checkpointing

Each iteration stores `(iteration_number, metrics_dict, skill_file_text)` in memory. After all iterations, the version with the best aggregate score is written back to `skill_path`. No git, no sidecar files - just in-memory for PoC.

### Aggregate score

`result.metrics` is a dict of `{scorer_name: aggregated_value}`. For checkpoint comparison, reduce to a single number. PoC: simple average of all metric values.

---

## Why `evaluate()` (not calling scorers directly)

- **Parallel execution**: runs predict_fn across dataset rows via ThreadPoolExecutor
- **Scorer kwargs resolution**: different scorers accept different params (`inputs`, `outputs`, `expectations`, `trace`); evaluate() inspects each scorer's function signature and passes the right kwargs
- **Per-row error handling**: one failing row doesn't crash the whole eval
- **Metrics aggregation**: computes mean/median/etc per scorer
- **Audit trail**: creates an MLflow run per iteration with logged metrics, so score progression is visible in the MLflow UI

Reimplementing this is ~100 lines of fiddly glue for no benefit.

## What We Reuse From MLflow

| Concern | MLflow primitive | Codebase location |
|---------|-----------------|-------------------|
| Evaluation loop | `mlflow.genai.evaluate()` | `mlflow/genai/evaluation/base.py` |
| Scorer classes | `@scorer`, `Guidelines`, 25+ built-ins | `mlflow/genai/scorers/` |
| Agent SDK tracing | `mlflow.anthropic.autolog()` | `mlflow/anthropic/autolog.py` |
| SDK trace builder | `process_sdk_messages()` | `mlflow/claude_code/tracing.py` |
| Async predict_fn wrapping | `_wrap_async_predict_fn()` | `mlflow/genai/utils/trace_utils.py:521` |

We do NOT use `optimize_prompts` because it assumes the optimizable surface is a single prompt template in the MLflow Prompt Registry. A skill is richer - it can be multiple files, has YAML frontmatter, tool configs, etc. Future alignment with `optimize_prompts` will come with a proper skill registry.

---

## Known Issues to Address

1. **predict_fn must re-read skill file each call** - the reflection agent edits the file between iterations, so capturing `skill_body` once at definition time would use stale content
2. **Aggregate score reduction** - `result.metrics` is a dict; need a function to reduce it to a single comparable number for checkpoint comparison. Simple average for PoC.
3. **Reflection agent skill trigger risk** - if the reflection agent uses Agent SDK in the same project directory, the skill file in `.claude/skills/` could theoretically trigger via Claude Code's skill matching. Unlikely for PoC since the reflection prompt is very specific and won't match typical skill triggers.

---

## TODOs

Tasks 1, 2, 3 are independent (can parallelize). Then 4 -> 5 -> 6 sequentially.

### 1. Understand `evaluate()` result_df format
- **What**: Check `EvaluationResult.result_df` column names in `mlflow/genai/evaluation/`
- **Why**: We need to know the exact column naming convention (e.g. `{scorer_name}/value`, `{scorer_name}/rationale`?) to format the reflection prompt
- **Where to look**: `mlflow/genai/evaluation/base.py`, `mlflow/genai/evaluation/harness.py`
- **Output**: Know the column names so we can iterate over result_df rows in `reflect()`
- **Blocks**: Task 4

### 2. Write predict_fn
- **What**: Async function using `ClaudeSDKClient` that re-reads skill file each call
- **Key detail**: `system_prompt=skill_body` injects the skill, `allowed_tools` enables Read/Edit/Bash/Glob/Grep, `permission_mode="acceptEdits"` auto-approves
- **Where to write**: PoC script, e.g. `.agent/poc/optimize.py`
- **Blocks**: Task 5

### 3. Build test skill + dataset
- **What**: Create a simple skill file and 3-5 dataset examples that are easy to score
- **Requirements**: The skill should be simple enough that the reflection agent can meaningfully improve it, but flawed enough that the initial score is noticeably below 1.0
- **Example**: A skill that summarizes code files but initially misses important details, scored by a Guidelines scorer checking for completeness
- **Where to write**: `.agent/poc/test_skill.md` + `.agent/poc/dataset.json`
- **Blocks**: Task 6

### 4. Write reflect()
- **What**: Format result_df into a structured prompt, invoke Agent SDK to edit skill files
- **Input**: `skill_path` (str) + `result` (EvaluationResult)
- **Prompt structure**: Show the agent the current skill file contents + all rows from result_df with their per-scorer scores and rationales + instructions to make minimal targeted edits
- **Mechanism**: Agent SDK (`ClaudeSDKClient`) with `system_prompt` = reflection instructions, the agent calls Edit on the skill file
- **Blocked by**: Task 1 (need result_df column names)
- **Blocks**: Task 5

### 5. Write optimize_skill()
- **What**: The core loop tying everything together
- **Params**: `skill_path`, `predict_fn`, `dataset`, `scorers`, `n_iterations`
- **Logic**: for-loop calling evaluate() -> checkpoint -> reflect(), then restore best
- **Checkpoint comparison**: aggregate `result.metrics` to single number (average for PoC)
- **Blocked by**: Tasks 2, 4
- **Blocks**: Task 6

### 6. Run end-to-end PoC
- **What**: Run `optimize_skill()` with the test skill + dataset
- **Verify**:
  - Scores change across iterations (ideally improve)
  - Best checkpoint is correctly restored at the end
  - MLflow traces appear (one per predict_fn call, with LLM + tool spans)
  - MLflow runs appear (one per evaluate() call, with metrics)
  - Skill file is modified by reflection agent
- **Blocked by**: Tasks 3, 5

---

## End-to-End User Flow (PoC code)

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk.types import ResultMessage
import mlflow
from mlflow.genai.scorers import Guidelines

mlflow.anthropic.autolog()

skill_path = ".claude/skills/pr-review.md"

async def predict_fn(*, input: str, **kwargs) -> str:
    skill_body = open(skill_path).read()
    async with ClaudeSDKClient(
        options=ClaudeAgentOptions(
            system_prompt=skill_body,
            allowed_tools=["Read", "Edit", "Bash", "Glob", "Grep"],
            permission_mode="acceptEdits",
        ),
    ) as client:
        await client.query(input)
        result_text = ""
        async for message in client.receive_response():
            if isinstance(message, ResultMessage):
                result_text = message.text
        return result_text

scorers = [
    Guidelines(
        name="task_completion",
        guidelines="The agent must complete the requested code review task.",
        model="openai:/gpt-4o",
    ),
]

dataset = [
    {"inputs": {"input": "review PR #1234"}, "expectations": {"should_review": True}},
    {"inputs": {"input": "review PR #5678"}, "expectations": {"should_review": True}},
]

optimize_skill(
    skill_path=skill_path,
    predict_fn=predict_fn,
    dataset=dataset,
    scorers=scorers,
    n_iterations=5,
)
```

## Files

- `.agent/skill-optimization-design.md` - full design doc with diagrams and rationale
- `.agent/handover.md` - this file (start here)
