"""Delegate agent instrumentation to Claude.

We don't try to identify entrypoints, frameworks, or tool functions ourselves —
that's a job for an LLM. The Python side just shells out to `claude` with a
single prompt and lets it edit the repo.
"""

import shutil
import subprocess
from pathlib import Path

INSTRUMENT_PROMPT = """\
Two-step setup for the MLflow Claude Code playground.

**Step 1 — Register the entrypoint** (Playground-specific, not covered by any skill):
- Identify the agent's chat/invoke entrypoint. Tools, helpers, CLI wrappers, and \
`__main__` blocks are NOT entrypoints.
- Add `@invoke()` (from `mlflow.genai.agent_server`) and `@mlflow.trace` above it.
- `@invoke()` alone does not create a span; `@mlflow.trace` ensures a root span \
exists for direct calls and for `update_current_trace()`.

**Step 2 — Instrument tracing**:
- Use the `instrumenting-with-mlflow-tracing` skill. Follow it.
"""


def instrument_with_claude(
    repo_dir: Path,
    *,
    timeout: float = 600.0,
) -> int | None:
    """Run `claude` in `repo_dir` to instrument the agent with MLflow tracing.

    Output is streamed to the terminal so the user can watch Claude work.

    Returns the claude process exit code, or None if `claude` isn't on PATH /
    the call timed out / OS error.
    """
    if not shutil.which("claude"):
        return None
    try:
        result = subprocess.run(
            ["claude", "-p", INSTRUMENT_PROMPT],
            cwd=repo_dir,
            timeout=timeout,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    return result.returncode
