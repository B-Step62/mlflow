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
# Upper bound on auto-parallelism. `/invocations` is async on the agent
# server side, so concurrency through uvicorn is fine; we just cap so a
# batch of 50 issues doesn't open 50 simultaneous connections.
DEFAULT_PARALLEL_CAP = 8


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


def _emit_error(issue_id: str, message: str) -> None:
    """Stream a per-issue error line to stderr immediately so single-issue
    and multi-issue runs both surface the error in the same place. Multi-
    issue summary at the end just counts; the body of each error appears
    here."""
    click.secho(f"[{issue_id}] ERROR: {message}", fg="red", err=True, bold=True)


def _run_one_issue(
    issue_id: str,
    *,
    agent_url: str,
    timeout: float,
    verbose: bool,
) -> tuple[str, bool, str | None]:
    """Run one issue's test against the agent. Returns ``(issue_id, passed, error)``.

    ``error`` is None on success (including a "passed=False" verdict — that's
    a legitimate test outcome, not an error). It carries a one-line message
    only for operational failures (missing issue, malformed row, agent
    unreachable). The error is also streamed to stderr via ``_emit_error``
    so callers don't have to inspect the tuple to surface it.
    """
    store = _store()
    try:
        issue = store.get_issue(issue_id)
    except MlflowException as exc:
        msg = str(exc)
        _emit_error(issue_id, msg)
        return issue_id, False, msg

    if issue.status in (IssueStatus.PENDING, IssueStatus.RESOLVED):
        msg = (
            f"issue is on the legacy detection path (status={issue.status}); "
            "the playground test runner doesn't apply"
        )
        _emit_error(issue_id, msg)
        return issue_id, False, msg

    try:
        row = _load_test_row(
            experiment_id=str(issue.experiment_id),
            issue_id=issue_id,
            test_case_id=issue.test_case_id,
        )
        spec = _test_spec(row)
        messages = _conversation_prefix(row)
    except (click.ClickException, MlflowException) as exc:
        msg = exc.message if isinstance(exc, click.ClickException) else str(exc)
        _emit_error(issue_id, msg)
        return issue_id, False, msg

    if verbose:
        click.secho(f"\n=== {issue_id} ===", fg="cyan", bold=True)
        click.secho(f"→ POST {agent_url}/invocations", fg="bright_black")
        click.secho(
            f"  conversation prefix: {len(messages)} message(s)",
            fg="bright_black",
        )

    try:
        raw = _invoke_agent(agent_url, messages, timeout=timeout)
    except click.ClickException as exc:
        _emit_error(issue_id, exc.message)
        return issue_id, False, exc.message

    response = normalize_agent_response(raw)
    verdict = evaluate(spec, response)
    _print_verdict_for_issue(issue_id, verdict, response, verbose=verbose)
    return issue_id, verdict.passed, None


def _print_verdict_for_issue(
    issue_id: str,
    verdict,
    response: AgentResponse,
    *,
    verbose: bool,
) -> None:
    """Like ``_print_verdict`` but prefixed with the issue id so multi-issue
    runs are readable."""
    color = "green" if verdict.passed else "red"
    label = "PASS" if verdict.passed else "FAIL"
    click.secho(f"[{issue_id}] {label} ({verdict.strategy})", fg=color, bold=True)
    for reason in verdict.reasons:
        bullet = "✔" if verdict.passed else "✗"
        click.secho(f"  {bullet} {reason}", fg=color)
    if verbose:
        if response.text:
            click.secho("  --- agent response ---", fg="cyan", bold=True)
            for line in (response.text or "").splitlines() or ["<empty>"]:
                click.echo(f"  {line}")
        if response.tool_calls:
            click.secho("  --- tool calls ---", fg="cyan", bold=True)
            for t in response.tool_calls:
                click.echo(f"  · {t}")
        if verdict.judge_reasoning:
            click.secho("  --- judge reasoning ---", fg="cyan", bold=True)
            click.echo(f"  {verdict.judge_reasoning}")


@click.command("run")
@click.argument("positional_issues", nargs=-1)
@click.option(
    "--issue",
    "issue_flags",
    multiple=True,
    help=(
        "Issue ID to run. Repeat for multiple issues. Positional args also "
        "accepted (mixed positional + flag works)."
    ),
)
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
@click.option(
    "--parallel",
    "parallel",
    default=None,
    type=click.IntRange(min=1),
    help=(
        f"Run up to N tests concurrently. Default: auto — `min(num_issues, "
        f"{DEFAULT_PARALLEL_CAP})`. Pass --parallel 1 to force sequential "
        "execution if your agent isn't threadsafe."
    ),
)
@click.option("--verbose", "-v", is_flag=True, help="Print full conversation and reasoning.")
@_wrap_mlflow_errors
def test_run(
    positional_issues: tuple[str, ...],
    issue_flags: tuple[str, ...],
    agent_url: str | None,
    timeout: float,
    parallel: int | None,
    verbose: bool,
) -> None:
    """Run the regression test for one or more Issues.

    Usage examples:

    \b
        mlflow agent test run --issue iss-1
        mlflow agent test run --issue iss-1 --issue iss-2
        mlflow agent test run iss-1 iss-2 iss-3
        mlflow agent test run iss-1 iss-2 --parallel 1   # force sequential

    Default concurrency: ``min(num_issues, DEFAULT_PARALLEL_CAP)``. The
    agent's ``/invocations`` is HTTP and uvicorn handles concurrent
    requests asynchronously, so the cap is the only safeguard — set
    ``--parallel 1`` if your agent code isn't threadsafe.

    Exits 0 if every selected issue passes; non-zero if any fail or error.
    Per-issue PASS / FAIL lines stream as they complete; a summary prints
    at the end for multi-issue runs.
    """
    # Combine positional + repeated --issue, dedupe but preserve order.
    selected: list[str] = list(dict.fromkeys((*positional_issues, *issue_flags)))

    if not selected:
        raise click.ClickException(
            "No issues specified. Pass --issue / positional ids."
        )

    resolved_url = (
        agent_url
        or os.environ.get("MLFLOW_PLAYGROUND_AGENT_URL")
        or DEFAULT_AGENT_URL
    ).rstrip("/")

    # Auto-resolve parallelism: cap at DEFAULT_PARALLEL_CAP, never exceed
    # the number of issues. User can force sequential with --parallel 1.
    effective_parallel = parallel if parallel is not None else min(len(selected), DEFAULT_PARALLEL_CAP)
    effective_parallel = max(1, min(effective_parallel, len(selected)))

    if verbose or len(selected) > 1:
        click.secho(
            f"Running {len(selected)} test{'s' if len(selected) != 1 else ''} "
            f"against {resolved_url} (parallel={effective_parallel})",
            fg="bright_black",
        )

    results: list[tuple[str, bool, str | None]] = []
    if effective_parallel <= 1 or len(selected) == 1:
        for iid in selected:
            results.append(_run_one_issue(iid, agent_url=resolved_url, timeout=timeout, verbose=verbose))
    else:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=effective_parallel) as pool:
            for result in pool.map(
                lambda iid: _run_one_issue(iid, agent_url=resolved_url, timeout=timeout, verbose=verbose),
                selected,
            ):
                results.append(result)

    # Summary
    passed = sum(1 for _, p, e in results if p and e is None)
    failed = sum(1 for _, p, e in results if not p and e is None)
    errored = sum(1 for _, _, e in results if e is not None)

    if len(results) > 1:
        click.echo()
        summary_color = "green" if failed == 0 and errored == 0 else "red"
        click.secho(
            f"Summary: {passed} passed, {failed} failed, {errored} errored",
            fg=summary_color,
            bold=True,
        )
        # Per-error lines already streamed to stderr inside `_run_one_issue`
        # via `_emit_error`; no need to repeat them in the summary block.

    if failed > 0 or errored > 0:
        sys.exit(1)


@click.group("test")
def test_commands() -> None:
    """Test-execution commands for the agent playground."""


test_commands.add_command(test_run)


__all__ = ["test_commands"]
