import subprocess
from pathlib import Path

import pytest

from mlflow.server.playground.repo_cache import (
    _url_to_cache_key,
    is_remote_url,
    resolve_repo,
)


class TestIsRemoteUrl:
    @pytest.mark.parametrize(
        "url",
        [
            "https://github.com/mlflow/skills",
            "http://github.com/mlflow/skills",
            "git@github.com:mlflow/skills.git",
            "ssh://git@github.com/mlflow/skills",
        ],
    )
    def test_remote_urls(self, url: str):
        assert is_remote_url(url)

    @pytest.mark.parametrize(
        "path",
        [
            "/home/user/repo",
            "./relative/path",
            "relative/path",
            "C:\\Windows\\path",
        ],
    )
    def test_local_paths(self, path: str):
        assert not is_remote_url(path)


class TestUrlToCacheKey:
    def test_deterministic(self):
        key1 = _url_to_cache_key("https://github.com/mlflow/skills")
        key2 = _url_to_cache_key("https://github.com/mlflow/skills")
        assert key1 == key2

    def test_length(self):
        key = _url_to_cache_key("https://github.com/mlflow/skills")
        assert len(key) == 16

    def test_trailing_slash_normalized(self):
        key1 = _url_to_cache_key("https://github.com/mlflow/skills")
        key2 = _url_to_cache_key("https://github.com/mlflow/skills/")
        assert key1 == key2

    def test_different_urls_differ(self):
        key1 = _url_to_cache_key("https://github.com/mlflow/skills")
        key2 = _url_to_cache_key("https://github.com/mlflow/other")
        assert key1 != key2


class TestResolveRepo:
    def test_local_path_passthrough(self, tmp_path):
        result = resolve_repo(str(tmp_path))
        assert result == Path(tmp_path)

    def test_clone_remote_repo(self, tmp_path, monkeypatch):
        # Create a local git repo to use as a "remote" via file:// protocol
        source = tmp_path / "source"
        source.mkdir()
        subprocess.run(["git", "init"], cwd=source, capture_output=True, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=source,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"], cwd=source, capture_output=True
        )
        skills_dir = source / ".claude" / "skills" / "alpha"
        skills_dir.mkdir(parents=True)
        (skills_dir / "SKILL.md").write_text("# Alpha")
        subprocess.run(["git", "add", "."], cwd=source, capture_output=True, check=True)
        subprocess.run(
            ["git", "commit", "-m", "init"], cwd=source, capture_output=True, check=True
        )

        # Point cache dir to tmp to avoid polluting system temp
        cache_dir = tmp_path / "cache"
        monkeypatch.setattr(
            "mlflow.server.playground.repo_cache.REPO_CACHE_DIR", cache_dir
        )

        # Use https:// prefix so is_remote_url returns True, but override
        # the clone command by using file:// URL trick:
        # We'll test with file:// by making is_remote_url also accept file://
        # Actually, let's just test with a real file:// URL by temporarily
        # adding it to _REMOTE_PREFIXES
        monkeypatch.setattr(
            "mlflow.server.playground.repo_cache._REMOTE_PREFIXES",
            ("https://", "http://", "git@", "ssh://", "file://"),
        )

        file_url = f"file://{source}"
        result = resolve_repo(file_url)

        assert result.exists()
        assert result.parent == cache_dir
        # Verify it's a bare repo by checking git works
        log_result = subprocess.run(
            ["git", "log", "--oneline"], cwd=result, capture_output=True
        )
        assert log_result.returncode == 0
        assert b"init" in log_result.stdout

    def test_cache_hit_fetches_instead_of_cloning(self, tmp_path, monkeypatch):
        source = tmp_path / "source"
        source.mkdir()
        subprocess.run(["git", "init"], cwd=source, capture_output=True, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=source,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"], cwd=source, capture_output=True
        )
        (source / "file.txt").write_text("v1")
        subprocess.run(["git", "add", "."], cwd=source, capture_output=True, check=True)
        subprocess.run(
            ["git", "commit", "-m", "first"], cwd=source, capture_output=True, check=True
        )

        cache_dir = tmp_path / "cache"
        monkeypatch.setattr(
            "mlflow.server.playground.repo_cache.REPO_CACHE_DIR", cache_dir
        )
        monkeypatch.setattr(
            "mlflow.server.playground.repo_cache._REMOTE_PREFIXES",
            ("https://", "http://", "git@", "ssh://", "file://"),
        )

        file_url = f"file://{source}"

        # First call clones
        result1 = resolve_repo(file_url)
        assert result1.exists()

        # Add a second commit to source
        (source / "file.txt").write_text("v2")
        subprocess.run(["git", "add", "."], cwd=source, capture_output=True, check=True)
        subprocess.run(
            ["git", "commit", "-m", "second"], cwd=source, capture_output=True, check=True
        )

        # Second call should fetch (not re-clone) and see the new commit
        result2 = resolve_repo(file_url)
        assert result1 == result2

        log_result = subprocess.run(
            ["git", "log", "--oneline"], cwd=result2, capture_output=True
        )
        assert log_result.returncode == 0
        assert b"second" in log_result.stdout

    def test_invalid_remote_url_raises(self, tmp_path, monkeypatch):
        cache_dir = tmp_path / "cache"
        monkeypatch.setattr(
            "mlflow.server.playground.repo_cache.REPO_CACHE_DIR", cache_dir
        )

        with pytest.raises(ValueError, match="git clone failed"):
            resolve_repo("https://invalid.example.com/no-such-repo.git")
