"""Claude Code CLI as a single-turn LLM provider.

Used by playground test-case generation and judge evaluation when the user
has the ``claude`` CLI installed but no Databricks model-serving credentials
configured. The CLI's existing subscription auth (`claude login`) covers
the call, so users with a Claude subscription don't have to set
``DATABRICKS_HOST`` / ``DATABRICKS_TOKEN`` just to use these flows.

Shape of each call:

  * Single ``claude -p PROMPT --max-turns 1`` invocation.
  * ``--tools ""`` disables every tool — these are pure inference calls,
    not agent runs. The fix-it dispatcher in
    :mod:`mlflow.playground.worker` is what runs agentic Claude with tools
    and a worktree.
  * ``--json-schema`` enforces the Pydantic schema natively when supplied,
    so we don't need prompt-based JSON coaxing or a parse-retry loop.
  * ``--output-format json`` returns one envelope on stdout; we extract
    ``result`` (the assistant text).
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from typing import Any

import pydantic

_logger = logging.getLogger(__name__)

CLAUDE_TIMEOUT_SECONDS = 60.0


class ClaudeCLIError(RuntimeError):
    """Raised when the ``claude`` CLI is unusable (missing, timed out, errored)."""


def is_claude_cli_available() -> bool:
    return shutil.which("claude") is not None


def call_claude(
    prompt: str,
    *,
    response_schema: type[pydantic.BaseModel] | None = None,
    timeout: float = CLAUDE_TIMEOUT_SECONDS,
) -> str:
    """Run ``claude -p PROMPT`` once and return the assistant text.

    When ``response_schema`` is supplied the CLI's ``--json-schema`` flag
    enforces structured output; the returned string is guaranteed to parse
    against ``response_schema`` (the CLI errors out otherwise, which we
    surface as :class:`ClaudeCLIError`).
    """
    if not is_claude_cli_available():
        raise ClaudeCLIError(
            "The `claude` CLI is not available on PATH. Install Claude Code "
            "(`npm install -g @anthropic-ai/claude-code`) and run `claude "
            "login`, or set DATABRICKS_HOST / DATABRICKS_TOKEN to fall back "
            "to the Databricks model-serving endpoint."
        )

    # `--max-turns 1` is too tight when `--json-schema` is in play: the CLI
    # uses an internal tool turn to validate the structured output, so the
    # final reply lands on turn 2. Give it a small budget either way; pure
    # text generation still finishes in 1 turn.
    cmd: list[str] = [
        "claude",
        "-p",
        prompt,
        "--max-turns",
        "5",
        "--output-format",
        "json",
        "--tools",
        "",
    ]
    if response_schema is not None:
        cmd.extend(["--json-schema", json.dumps(response_schema.model_json_schema())])

    # Run from a neutral cwd so the inner Claude doesn't inherit project-level
    # `.claude/settings.json` hooks from wherever this call originates. The
    # worker dispatcher installs MLflow tracing hooks into the worker
    # worktree's `.claude/settings.json` (see
    # `mlflow.playground.worker._install_claude_tracing_hooks`); if the
    # judge call inherits those hooks it fires `mlflow autolog claude` shell
    # subcommands on every turn, blows past `--max-turns 5`, and returns
    # `subtype: error_max_turns` with no verdict. Judge prompts are
    # self-contained (the agent response is embedded as text), so a neutral
    # cwd is safe.
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            cwd=tempfile.gettempdir(),
        )
    except subprocess.TimeoutExpired as e:
        raise ClaudeCLIError(f"Claude CLI timed out after {timeout}s") from e

    # On error the CLI often exits non-zero with empty stderr but a populated
    # JSON envelope on stdout (e.g. `subtype=error_max_turns`). Parse stdout
    # first so the surfaced message is actionable.
    envelope: dict[str, Any] | None = None
    if proc.stdout.strip().startswith("{"):
        try:
            envelope = json.loads(proc.stdout)
        except json.JSONDecodeError:
            envelope = None

    if proc.returncode != 0:
        if envelope is not None:
            subtype = envelope.get("subtype") or "error"
            errors = envelope.get("errors") or []
            detail = "; ".join(str(e) for e in errors) if errors else subtype
            raise ClaudeCLIError(f"Claude CLI failed ({subtype}): {detail}")
        stderr = proc.stderr.strip() or f"exit code {proc.returncode}"
        raise ClaudeCLIError(f"Claude CLI failed: {stderr}")

    if envelope is None:
        raise ClaudeCLIError(
            f"Claude CLI returned non-JSON envelope: {proc.stdout[:200]!r}"
        )

    # `--json-schema` puts the validated payload in `structured_output`;
    # plain text calls put the assistant reply in `result`.
    if response_schema is not None:
        structured = envelope.get("structured_output")
        if not isinstance(structured, (dict, list)):
            raise ClaudeCLIError(
                f"Claude CLI envelope missing `structured_output` field: {envelope!r}"
            )
        return json.dumps(structured)

    result = envelope.get("result")
    if not isinstance(result, str):
        raise ClaudeCLIError(
            f"Claude CLI envelope missing string `result` field: {envelope!r}"
        )
    return result


__all__ = [
    "CLAUDE_TIMEOUT_SECONDS",
    "ClaudeCLIError",
    "call_claude",
    "is_claude_cli_available",
]
