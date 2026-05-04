"""``mlflow agent test run --issue X`` — execute an Issue's regression test.

Used by the worker (M2) and by Epic 6's ``[I fixed this]`` button. Fetches
the test row YUK-14 / YUK-15 stored, replays the conversation prefix
against the user's agent, and reports a pass / fail verdict per the
:func:`mlflow.playground.test_runner.evaluate` rules.

Exit code: 0 on pass, 1 on fail or any operational error (missing
issue, agent unreachable, malformed row). The verdict is also printed
in human-readable form so workers and humans can read it the same way.
"""

from __future__ import annotations

import functools
import os
import sys
from typing import Any, Callable

import click
import httpx

from mlflow.entities.issue import IssueStatus
from mlflow.exceptions import MlflowException
from mlflow.playground.test_runner import (
    AgentResponse,
    evaluate,
    normalize_agent_response,
)


DEFAULT_AGENT_URL = "http://127.0.0.1:8000"
DEFAULT_TIMEOUT_SECONDS = 120.0


def _wrap_mlflow_errors(fn: Callable) -> Callable:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        try:
            return fn(*args, **kwargs)
        except MlflowException as e:
            raise click.ClickException(str(e)) from e

    return wrapper


def _resolve_tracking_uri() -> str:
    from mlflow.claude_code.playground_setup import _default_tracking_uri

    env = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    return env or _default_tracking_uri()


def _store():
    import mlflow

    mlflow.set_tracking_uri(_resolve_tracking_uri())
    from mlflow.tracking._tracking_service.utils import _get_store

    return _get_store()


def _load_test_row(experiment_id: str, issue_id: str, test_case_id: str | None) -> dict[str, Any]:
    """Fetch the regression-suite row for this issue.

    Prefers ``test_case_id`` when the Issue has one; falls back to the
    ``tags.issue_id`` cell so the CLI still works for issues created via
    the ``mlflow agent issue create`` path before YUK-14 wiring lands.
    """
    from mlflow.exceptions import MlflowException as _Mlf
    from mlflow.playground.regression_suite import (
        get_or_create_regression_dataset,
        regression_dataset_name,
    )

    try:
        dataset = get_or_create_regression_dataset(experiment_id)
    except _Mlf as e:
        raise click.ClickException(
            f"Could not open regression dataset {regression_dataset_name(experiment_id)!r}: {e}"
        )

    df = dataset.to_df()
    rows = df.to_dict(orient="records") if not df.empty else []
    match: dict[str, Any] | None = None

    if test_case_id:
        for row in rows:
            expectations = row.get("expectations") or {}
            if expectations.get("test_case_id") == test_case_id:
                match = row
                break

    if match is None:
        for row in rows:
            tags = row.get("tags") or {}
            if tags.get("issue_id") == issue_id:
                match = row
                break

    if match is None:
        raise click.ClickException(
            f"No regression-suite row found for issue {issue_id!r} "
            f"(test_case_id={test_case_id!r}). Has the test case been generated?"
        )
    return match


def _conversation_prefix(row: dict[str, Any]) -> list[dict[str, Any]]:
    inputs = row.get("inputs") or {}
    messages = inputs.get("messages")
    if not isinstance(messages, list):
        raise click.ClickException(
            f"Regression-suite row missing inputs.messages (got {type(inputs).__name__}). "
            "The row may be from an unrelated dataset; check the test_case_id."
        )
    return messages


def _test_spec(row: dict[str, Any]) -> dict[str, Any]:
    expectations = row.get("expectations") or {}
    spec = expectations.get("test_spec")
    if not isinstance(spec, dict):
        raise click.ClickException(
            "Regression-suite row missing expectations.test_spec; cannot evaluate."
        )
    return spec


def _invoke_agent(
    agent_url: str,
    messages: list[dict[str, Any]],
    *,
    timeout: float,
) -> dict[str, Any]:
    """POST to the agent's ``/invocations`` and return the parsed JSON.

    Mirrors the playground server's call-shape closely enough that we can
    swap real / mock agents transparently.
    """
    payload = {"messages": messages}
    try:
        response = httpx.post(
            f"{agent_url.rstrip('/')}/invocations",
            json=payload,
            timeout=timeout,
            headers={"x-mlflow-return-trace-id": "true"},
        )
    except httpx.HTTPError as e:
        raise click.ClickException(
            f"Could not reach agent at {agent_url!r}: {type(e).__name__}: {e}. "
            "Is the agent server running? Pass --agent-url to override."
        ) from e

    if not response.is_success:
        raise click.ClickException(
            f"Agent invocation failed ({response.status_code}): "
            f"{response.text[:500] or '<empty body>'}"
        )

    try:
        return response.json()
    except ValueError as e:
        raise click.ClickException(f"Agent returned non-JSON response: {e}") from e


def _print_verdict(verdict, response: AgentResponse, *, verbose: bool) -> None:
    color = "green" if verdict.passed else "red"
    label = "PASS" if verdict.passed else "FAIL"
    click.secho(f"{label} ({verdict.strategy})", fg=color, bold=True)
    for reason in verdict.reasons:
        bullet = "✔" if verdict.passed else "✗"
        click.secho(f"  {bullet} {reason}", fg=color)

    if verbose:
        click.secho("\n--- agent response ---", fg="cyan", bold=True)
        click.echo(response.text or "<empty>")
        if response.tool_calls:
            click.secho("\n--- tool calls ---", fg="cyan", bold=True)
            for t in response.tool_calls:
                click.echo(f"  · {t}")
        if verdict.judge_reasoning:
            click.secho("\n--- judge reasoning ---", fg="cyan", bold=True)
            click.echo(verdict.judge_reasoning)


@click.command("run")
@click.option("--issue", "issue_id", required=True, help="Issue ID to run the test for.")
@click.option(
    "--agent-url",
    default=None,
    help=f"Agent server base URL (default: {DEFAULT_AGENT_URL} or MLFLOW_PLAYGROUND_AGENT_URL).",
)
@click.option(
    "--timeout",
    default=DEFAULT_TIMEOUT_SECONDS,
    show_default=True,
    type=float,
    help="Per-request timeout for /invocations (seconds).",
)
@click.option("--verbose", "-v", is_flag=True, help="Print full conversation and reasoning.")
@_wrap_mlflow_errors
def test_run(issue_id: str, agent_url: str | None, timeout: float, verbose: bool) -> None:
    """Run the regression test for a single Issue. Exits 0 on pass, 1 on fail."""
    store = _store()
    issue = store.get_issue(issue_id)

    if issue.status in (IssueStatus.PENDING, IssueStatus.RESOLVED):
        click.secho(
            f"  note: issue {issue_id!r} is on the legacy detection path (status="
            f"{issue.status}); the playground test runner doesn't apply.",
            fg="yellow",
            err=True,
        )
        sys.exit(1)

    row = _load_test_row(
        experiment_id=str(issue.experiment_id),
        issue_id=issue_id,
        test_case_id=issue.test_case_id,
    )
    spec = _test_spec(row)
    messages = _conversation_prefix(row)

    resolved_url = (
        agent_url
        or os.environ.get("MLFLOW_PLAYGROUND_AGENT_URL")
        or DEFAULT_AGENT_URL
    ).rstrip("/")
    if verbose:
        click.secho(f"→ POST {resolved_url}/invocations", fg="bright_black")
        click.secho(
            f"  conversation prefix: {len(messages)} message(s)",
            fg="bright_black",
        )

    raw = _invoke_agent(resolved_url, messages, timeout=timeout)
    response = normalize_agent_response(raw)

    verdict = evaluate(spec, response)
    _print_verdict(verdict, response, verbose=verbose)

    if not verdict.passed:
        sys.exit(1)


@click.group("test")
def test_commands() -> None:
    """Test-execution commands for the agent playground."""


test_commands.add_command(test_run)


__all__ = ["test_commands"]
