"""Unit tests for worker.py (YUK-50, YUK-51)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from mlflow.playground.worker import (
    create_worker_worktree,
    prune_worker_worktree,
)


def _init_git_repo(repo_dir: Path) -> None:
    subprocess.check_call(["git", "init", "-b", "agent-playground"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.email", "test@example.com"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.name", "test"], cwd=repo_dir)
    (repo_dir / "README.md").write_text("seed\n")
    subprocess.check_call(["git", "add", "."], cwd=repo_dir)
    subprocess.check_call(["git", "commit", "-m", "seed"], cwd=repo_dir)


def test_create_worker_worktree_returns_path_branch_and_base(tmp_path):
    _init_git_repo(tmp_path)
    result = create_worker_worktree(tmp_path, "iss-abc")

    assert result.worktree_path == (tmp_path / ".mlflow" / "worktrees" / "iss-abc").resolve()
    assert result.worktree_path.is_dir()
    assert result.branch == "worker/iss-abc"
    assert result.base_branch == "agent-playground"
    # base_commit is a 40-char hex SHA.
    assert len(result.base_commit) == 40
    assert all(c in "0123456789abcdef" for c in result.base_commit)

    # Inside the worktree, HEAD should be on the worker branch.
    head = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=result.worktree_path, text=True
    ).strip()
    assert head == "worker/iss-abc"


def test_create_worker_worktree_refuses_existing_path(tmp_path):
    _init_git_repo(tmp_path)
    create_worker_worktree(tmp_path, "iss-abc")
    with pytest.raises(FileExistsError, match="already exists"):
        create_worker_worktree(tmp_path, "iss-abc")


def test_prune_worker_worktree_removes_path_and_branch(tmp_path):
    _init_git_repo(tmp_path)
    create_worker_worktree(tmp_path, "iss-abc")
    worktree_path = tmp_path / ".mlflow" / "worktrees" / "iss-abc"
    assert worktree_path.is_dir()

    prune_worker_worktree(tmp_path, "iss-abc", force=True)

    assert not worktree_path.exists()
    branches = subprocess.check_output(["git", "branch"], cwd=tmp_path, text=True)
    assert "worker/iss-abc" not in branches


def test_prune_worker_worktree_idempotent_on_unknown_issue(tmp_path):
    _init_git_repo(tmp_path)
    # No worktree was ever created — pruning should be a no-op, not raise.
    prune_worker_worktree(tmp_path, "iss-never-existed")
