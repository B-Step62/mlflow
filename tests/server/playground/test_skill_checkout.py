import subprocess
from pathlib import Path

import pytest

from mlflow.server.playground.skill_checkout import (
    checkout_skills_from_commit,
    checkout_skills_from_working_tree,
    list_recent_commits,
    list_skills_at_ref,
)

SKILL_MANIFEST = "SKILL.md"


@pytest.fixture
def git_repo(tmp_path):
    """Create a temporary git repo with two skills."""
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"], cwd=repo, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"], cwd=repo, capture_output=True
    )

    skills_dir = repo / ".claude" / "skills"

    # Skill alpha
    alpha = skills_dir / "alpha"
    alpha.mkdir(parents=True)
    (alpha / SKILL_MANIFEST).write_text("# Alpha Skill")
    (alpha / "code.py").write_text("print('alpha')")

    # Skill beta
    beta = skills_dir / "beta"
    beta.mkdir(parents=True)
    (beta / SKILL_MANIFEST).write_text("# Beta Skill")

    # A directory without SKILL.md (should be ignored)
    (skills_dir / "not-a-skill").mkdir()
    (skills_dir / "not-a-skill" / "README.md").write_text("not a skill")

    subprocess.run(["git", "add", "."], cwd=repo, capture_output=True, check=True)
    subprocess.run(
        ["git", "commit", "-m", "initial commit"],
        cwd=repo,
        capture_output=True,
        check=True,
    )

    return repo


class TestCheckoutSkillsFromCommit:
    def test_extracts_all_skills(self, git_repo, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        names = checkout_skills_from_commit(git_repo, "HEAD", dest)

        assert names == ["alpha", "beta"]
        assert (dest / "alpha" / SKILL_MANIFEST).exists()
        assert (dest / "alpha" / "code.py").exists()
        assert (dest / "beta" / SKILL_MANIFEST).exists()

    def test_filters_by_skill_names(self, git_repo, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        names = checkout_skills_from_commit(
            git_repo, "HEAD", dest, skill_names=["alpha"]
        )

        assert names == ["alpha"]
        assert (dest / "alpha" / SKILL_MANIFEST).exists()
        assert not (dest / "beta").exists()

    def test_invalid_ref_raises(self, git_repo, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        with pytest.raises(ValueError, match="git archive failed"):
            checkout_skills_from_commit(git_repo, "nonexistent-ref", dest)


class TestCheckoutSkillsFromWorkingTree:
    def test_copies_all_skills(self, git_repo, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        names = checkout_skills_from_working_tree(git_repo, dest)

        assert names == ["alpha", "beta"]
        assert (dest / "alpha" / SKILL_MANIFEST).exists()
        assert (dest / "alpha" / "code.py").read_text() == "print('alpha')"

    def test_filters_by_skill_names(self, git_repo, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        names = checkout_skills_from_working_tree(
            git_repo, dest, skill_names=["beta"]
        )

        assert names == ["beta"]
        assert not (dest / "alpha").exists()

    def test_no_skills_dir_returns_empty(self, tmp_path):
        dest = tmp_path / "out"
        dest.mkdir()
        repo = tmp_path / "empty-repo"
        repo.mkdir()
        assert checkout_skills_from_working_tree(repo, dest) == []


class TestListSkillsAtRef:
    def test_working_tree(self, git_repo):
        skills = list_skills_at_ref(git_repo, "working-tree")
        assert skills == ["alpha", "beta"]

    def test_commit_ref(self, git_repo):
        skills = list_skills_at_ref(git_repo, "HEAD")
        assert skills == ["alpha", "beta"]

    def test_working_tree_no_skills_dir(self, tmp_path):
        assert list_skills_at_ref(tmp_path, "working-tree") == []

    def test_invalid_ref_raises(self, git_repo):
        with pytest.raises(ValueError, match="git ls-tree failed"):
            list_skills_at_ref(git_repo, "nonexistent-ref")


class TestListRecentCommits:
    def test_returns_commits(self, git_repo):
        commits = list_recent_commits(git_repo)
        assert len(commits) == 1
        assert commits[0]["message"] == "initial commit"
        assert len(commits[0]["hash"]) == 40

    def test_respects_count(self, git_repo):
        # Add a second commit
        (git_repo / "file.txt").write_text("new")
        subprocess.run(["git", "add", "."], cwd=git_repo, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "second"],
            cwd=git_repo,
            capture_output=True,
        )

        commits = list_recent_commits(git_repo, count=1)
        assert len(commits) == 1
        assert commits[0]["message"] == "second"

    def test_invalid_repo_raises(self, tmp_path):
        with pytest.raises(ValueError, match="git log failed"):
            list_recent_commits(tmp_path / "not-a-repo")
