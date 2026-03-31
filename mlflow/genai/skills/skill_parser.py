import logging
import re
import tarfile
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import yaml

from mlflow.exceptions import MlflowException

_logger = logging.getLogger(__name__)

SKILL_MANIFEST_FILE = "SKILL.md"
_FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_skill_manifest(skill_md_path: Path) -> dict:
    """Parse SKILL.md YAML front matter and return {name, description, content}."""
    content = skill_md_path.read_text(encoding="utf-8")

    match = _FRONTMATTER_PATTERN.match(content)
    if not match:
        raise MlflowException(
            f"SKILL.md at {skill_md_path} does not contain valid YAML front matter "
            "(expected --- delimiters)."
        )

    front_matter = yaml.safe_load(match.group(1))
    if not isinstance(front_matter, dict) or "name" not in front_matter:
        raise MlflowException(
            f"SKILL.md at {skill_md_path} front matter must contain a 'name' field."
        )

    return {
        "name": front_matter["name"],
        "description": front_matter.get("description"),
        "content": content,
    }


def find_skill_directories(path: Path) -> list[Path]:
    """Find all directories containing a SKILL.md file."""
    return [item.parent for item in path.rglob(SKILL_MANIFEST_FILE)]


def is_github_url(source: str) -> bool:
    """Check if source looks like a GitHub URL."""
    try:
        parsed = urlparse(source)
        return parsed.scheme in ("http", "https") and "github.com" in (parsed.netloc or "")
    except Exception:
        return False


def fetch_from_github(repo_url: str, ref: str = "main") -> Path:
    """Download a GitHub repo as tarball and extract to a temp directory.

    Args:
        repo_url: GitHub repository URL (e.g., https://github.com/mlflow/skills)
        ref: Git ref to download (branch, tag, or commit). Defaults to "main".

    Returns:
        Path to extracted directory containing the repo contents.
    """
    import requests

    parsed = urlparse(repo_url.rstrip("/"))
    path_parts = parsed.path.strip("/").split("/")
    if len(path_parts) < 2:
        raise MlflowException(
            f"Invalid GitHub URL '{repo_url}'. Expected format: "
            "https://github.com/<owner>/<repo>"
        )
    owner, repo = path_parts[0], path_parts[1]

    tarball_url = f"https://api.github.com/repos/{owner}/{repo}/tarball/{ref}"
    _logger.info("Downloading skills from %s (ref=%s)", repo_url, ref)

    response = requests.get(tarball_url, stream=True, timeout=60)
    response.raise_for_status()

    temp_dir = Path(tempfile.mkdtemp(prefix="mlflow_skills_"))
    tarball_path = temp_dir / "repo.tar.gz"

    with open(tarball_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    extract_dir = temp_dir / "extracted"
    extract_dir.mkdir()
    with tarfile.open(tarball_path, "r:gz") as tar:
        tar.extractall(extract_dir, filter="data")

    # GitHub tarballs have a top-level directory like owner-repo-sha/
    subdirs = list(extract_dir.iterdir())
    if len(subdirs) == 1 and subdirs[0].is_dir():
        return subdirs[0]
    return extract_dir
