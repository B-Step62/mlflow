import hashlib
import subprocess
import tempfile
from pathlib import Path

REPO_CACHE_DIR = Path(tempfile.gettempdir()) / "mlflow-playground-repo-cache"

_REMOTE_PREFIXES = ("https://", "http://", "git@", "ssh://")


def is_remote_url(repo: str) -> bool:
    return any(repo.startswith(prefix) for prefix in _REMOTE_PREFIXES)


def _url_to_cache_key(url: str) -> str:
    normalized = url.strip().rstrip("/")
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def resolve_repo(repo: str) -> Path:
    if not is_remote_url(repo):
        return Path(repo).expanduser()

    REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = _url_to_cache_key(repo)
    clone_path = REPO_CACHE_DIR / cache_key

    if clone_path.exists():
        result = subprocess.run(
            ["git", "fetch", "origin", "+refs/heads/*:refs/heads/*"],
            cwd=clone_path,
            capture_output=True,
        )
        if result.returncode != 0:
            raise ValueError(
                f"git fetch failed for '{repo}': {result.stderr.decode().strip()}"
            )
    else:
        result = subprocess.run(
            ["git", "clone", "--bare", repo, clone_path],
            capture_output=True,
        )
        if result.returncode != 0:
            raise ValueError(
                f"git clone failed for '{repo}': {result.stderr.decode().strip()}"
            )

    return clone_path
