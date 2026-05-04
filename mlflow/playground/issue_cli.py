"""``mlflow agent issue {create,accept,reject}`` — terminal-driven Issue lifecycle.

This is the headless equivalent of the cockpit's annotation-rail flow, so the
Epic 3 demo is fully runnable from the shell:

    mlflow agent issue create --rationale "..." --trace-id tr-... --experiment <id>
    mlflow agent test run --issue mlf-iss-...   (YUK-27)
    mlflow agent issue accept mlf-iss-...
    mlflow agent issue reject mlf-iss-...

Auto-generation of the regression test row (YUK-14) and the regression-dataset
append on accept (YUK-15) are wired through small hook points so the agents
shipping those features can drop in real implementations without revisiting
this file. Until they do, the CLI prints a one-line notice on stderr so the
user knows what's stubbed.
"""

from __future__ import annotations

import functools
import os
from typing import Any, Callable

import click

from mlflow.entities.issue import IssueStatus
from mlflow.exceptions import MlflowException


def _wrap_mlflow_errors(fn: Callable) -> Callable:
    """Translate ``MlflowException`` into a clean click-rendered CLI error."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        try:
            return fn(*args, **kwargs)
        except MlflowException as e:
            raise click.ClickException(str(e)) from e

    return wrapper


def _resolve_tracking_uri() -> str:
    """Mirror the playground server's URI resolution so the CLI talks to the
    same DB that ``mlflow agent playground`` is writing to from this cwd."""
    from mlflow.claude_code.playground_setup import _default_tracking_uri

    env = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    return env or _default_tracking_uri()


def _resolve_default_experiment() -> str:
    """Default experiment for `issue create`. Reads the playground config if it
    exists, else falls back to the hardcoded default."""
    from mlflow.claude_code.playground_setup import (
        DEFAULT_CONFIG_PATH,
        DEFAULT_EXPERIMENT_NAME,
        load_user_config,
    )

    config = load_user_config(DEFAULT_CONFIG_PATH)
    if config and config.mlflow.experiment:
        return config.mlflow.experiment
    return DEFAULT_EXPERIMENT_NAME


def _store():
    """Resolve a tracking store bound to the playground's local DB.

    The CLI talks to the store directly (rather than going through the REST
    layer) so it works without the playground server running — same model as
    the existing ``mlflow.cli`` commands. The tracking URI resolution still
    matches the server's, so a CLI run and a server run from the same cwd
    operate on the same sqlite file.
    """
    import mlflow

    mlflow.set_tracking_uri(_resolve_tracking_uri())
    from mlflow.tracking._tracking_service.utils import _get_store

    return _get_store()


def _resolve_experiment_id(store: Any, experiment: str) -> str:
    """Accept either an experiment name or an experiment id."""
    if experiment.isdigit():
        return experiment
    exp = store.get_experiment_by_name(experiment)
    if exp is None:
        raise click.ClickException(
            f"Experiment {experiment!r} not found in {_resolve_tracking_uri()}. "
            "Run `mlflow agent playground` first or pass --experiment with an existing id."
        )
    return exp.experiment_id


def _emit_issue(issue, *, header: str) -> None:
    """Pretty-print an Issue's identifying fields."""
    click.secho(header, fg="green", bold=True)
    click.echo(f"  id:       {issue.issue_id}")
    click.echo(f"  status:   {issue.status}")
    if issue.assignee:
        click.echo(f"  assignee: {issue.assignee}")
    if issue.source_trace_id:
        click.echo(f"  trace:    {issue.source_trace_id}")
    if issue.test_case_id:
        click.echo(f"  test:     {issue.test_case_id}")


@click.group("issue")
def issue_commands() -> None:
    """Drive the agent-playground Issue lifecycle from the terminal."""


@issue_commands.command("create")
@click.option("--rationale", required=True, help="Why this trace is wrong; becomes the Issue body.")
@click.option(
    "--trace-id",
    required=True,
    help="The failing trace this Issue is anchored to.",
)
@click.option(
    "--expected",
    default=None,
    help="Optional expected output, used by the test-case generator (YUK-14).",
)
@click.option(
    "--title",
    default=None,
    help="Short Issue title. Auto-derived from --rationale if omitted.",
)
@click.option(
    "--experiment",
    default=None,
    help=(
        "Experiment id or name to attach the Issue to. "
        "Defaults to the playground config's experiment, or 'agent-playground'."
    ),
)
@_wrap_mlflow_errors
def create(
    rationale: str,
    trace_id: str,
    expected: str | None,
    title: str | None,
    experiment: str | None,
) -> None:
    """Create a new Issue from a trace + rationale.

    The Issue starts at ``state=todo`` with ``source_trace_id`` set so the
    cockpit / worker can find it. Auto-test-case generation (YUK-14) is hooked
    in if available; otherwise the Issue is created without ``test_case_id``
    and the user can attach one later.
    """
    store = _store()
    exp_id = _resolve_experiment_id(store, experiment or _resolve_default_experiment())

    derived_title = title or (rationale.strip().splitlines()[0][:60] or "Untitled issue")

    issue = store.create_issue(
        experiment_id=exp_id,
        name=derived_title,
        description=rationale,
        status=IssueStatus.TODO,
        source_trace_id=trace_id,
    )

    test_case_id = _try_generate_test_case(
        rationale=rationale,
        trace_id=trace_id,
        expected=expected,
        issue_id=issue.issue_id,
    )

    _emit_issue(issue, header=f"Created issue {issue.issue_id}")
    if test_case_id:
        click.echo(f"  test_case_id (from YUK-14 hook): {test_case_id}")


@issue_commands.command("accept")
@click.argument("issue_id")
@_wrap_mlflow_errors
def accept(issue_id: str) -> None:
    """Mark an Issue as resolved and append its test row to the regression suite.

    Transitions the Issue ``review -> done`` (the legal exit edge for an
    accepted draft per design.md §6.5). When YUK-15's regression-suite
    helper is available, the test row is appended; otherwise the CLI prints
    a one-line stderr notice and the transition still succeeds.
    """
    store = _store()
    moved = store.transition_issue(
        issue_id=issue_id,
        target_status=IssueStatus.DONE,
        assignee="",
    )
    _emit_issue(moved, header=f"Accepted issue {moved.issue_id}")
    _try_append_to_regression_suite(moved)


@issue_commands.command("reject")
@click.argument("issue_id")
@_wrap_mlflow_errors
def reject(issue_id: str) -> None:
    """Mark an Issue as rejected. Legal from todo / in_progress / review."""
    store = _store()
    moved = store.transition_issue(
        issue_id=issue_id,
        target_status=IssueStatus.REJECTED,
        assignee="",
    )
    _emit_issue(moved, header=f"Rejected issue {moved.issue_id}")


# --- Hook points for YUK-14 / YUK-15 ----------------------------------------
#
# These two helpers exist so that the agents shipping the test-case generator
# (YUK-14) and the regression-dataset convention (YUK-15) can wire their
# implementations in without touching the click commands. Until then, both
# print a one-line stderr notice and return a sentinel.


def _try_generate_test_case(
    *,
    rationale: str,
    trace_id: str,
    expected: str | None,
    issue_id: str,
) -> str | None:
    """Optional hook: invoke YUK-14's test-case generator if it's available.

    Returns the new ``test_case_id`` on success, or ``None`` if the generator
    isn't wired up yet. Never raises — a missing generator is a soft failure
    so the rest of the CLI flow keeps working.
    """
    try:
        from mlflow.playground.test_case_generator import generate_test_case  # type: ignore
    except ImportError:
        click.secho(
            "  note: auto-test-case generation not wired up yet (YUK-14).",
            fg="yellow",
            err=True,
        )
        return None
    try:
        return generate_test_case(
            rationale=rationale,
            trace_id=trace_id,
            expected=expected,
            issue_id=issue_id,
        )
    except Exception as e:  # noqa: BLE001
        click.secho(
            f"  warn: test-case generator raised {type(e).__name__}: {e}",
            fg="yellow",
            err=True,
        )
        return None


def _try_append_to_regression_suite(issue) -> None:
    """Optional hook: append the Issue's test row to the regression suite (YUK-15)."""
    try:
        from mlflow.playground.regression_suite import append_for_issue  # type: ignore
    except ImportError:
        click.secho(
            "  note: regression-suite append not wired up yet (YUK-15).",
            fg="yellow",
            err=True,
        )
        return
    try:
        append_for_issue(issue)
    except Exception as e:  # noqa: BLE001
        click.secho(
            f"  warn: regression-suite append raised {type(e).__name__}: {e}",
            fg="yellow",
            err=True,
        )
