"""Worker dispatch helpers (Epic 8 / YUK-50, YUK-51).

The worker flow turns an Issue into an autonomously-fixed agent version:

1. ``create_worker_worktree`` clones the agent repo into
   ``.mlflow/worktrees/<issue-id>/`` on a fresh ``worker/<issue-id>`` branch.
2. ``dispatch_claude_fix`` (YUK-51) runs ``claude -p <prompt>`` in the
   worktree, telling Claude to iterate on the regression test until green,
   then invokes ``mlflow agent connect`` to bring up the fixed agent and
   register it with the playground.

The two helpers are split so the cheap setup (YUK-50) can land before the
heavier orchestration (YUK-51).
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

WORKER_BRANCH_PREFIX = "worker/"


@dataclass
class WorkerWorktree:
    worktree_path: Path
    branch: str
    base_commit: str
    base_branch: str


def _git(*args: str, cwd: Path) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def _git_run(*args: str, cwd: Path) -> None:
    subprocess.check_call(["git", *args], cwd=cwd)


def _worker_branch_for(issue_id: str) -> str:
    return f"{WORKER_BRANCH_PREFIX}{issue_id}"


def _worktree_path_for(repo_dir: Path, issue_id: str) -> Path:
    return repo_dir / ".mlflow" / "worktrees" / issue_id


def create_worker_worktree(repo_dir: Path, issue_id: str) -> WorkerWorktree:
    """Create a `worker/<issue-id>` branch + isolated worktree off the current HEAD.

    Refuses if the worktree directory or branch already exists — the caller
    (dispatch endpoint) should `prune_worker_worktree` first or refuse the
    new dispatch with a clear error.
    """
    repo_dir = repo_dir.resolve()
    branch = _worker_branch_for(issue_id)
    worktree_path = _worktree_path_for(repo_dir, issue_id)

    if worktree_path.exists():
        raise FileExistsError(f"Worktree path already exists: {worktree_path}")

    base_commit = _git("rev-parse", "HEAD", cwd=repo_dir)
    base_branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=repo_dir)

    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    _git_run("worktree", "add", "-b", branch, str(worktree_path), base_branch, cwd=repo_dir)

    return WorkerWorktree(
        worktree_path=worktree_path,
        branch=branch,
        base_commit=base_commit,
        base_branch=base_branch,
    )


def prune_worker_worktree(repo_dir: Path, issue_id: str, *, force: bool = False) -> None:
    """Best-effort cleanup of a worker worktree + branch.

    Used by the discard path (YUK-55) and by failed dispatches that need to
    roll back. ``force=True`` removes the worktree even if it has uncommitted
    changes (drop user's WIP — only set this for known-bad states).
    """
    repo_dir = repo_dir.resolve()
    branch = _worker_branch_for(issue_id)
    worktree_path = _worktree_path_for(repo_dir, issue_id)

    if worktree_path.exists():
        cmd = ["git", "worktree", "remove"]
        if force:
            cmd.append("--force")
        cmd.append(str(worktree_path))
        try:
            subprocess.check_call(cmd, cwd=repo_dir)
        except subprocess.CalledProcessError:
            # Stale worktree refs — `git worktree prune` then try again.
            subprocess.run(["git", "worktree", "prune"], cwd=repo_dir, check=False)

    # Delete the branch (best-effort; -D drops unmerged commits).
    subprocess.run(["git", "branch", "-D", branch], cwd=repo_dir, check=False)
