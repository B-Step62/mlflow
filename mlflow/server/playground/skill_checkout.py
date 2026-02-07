import shutil
import subprocess
import tarfile
from io import BytesIO
from pathlib import Path

# Repo layouts:
#   "nested"  – skills live under .claude/skills/<name>/SKILL.md  (project-embedded)
#   "root"    – skills live under <name>/SKILL.md                 (standalone skills repo)

_NESTED_PREFIX = ".claude/skills"


def _detect_layout_at_ref(repo_path: Path, ref: str) -> str:
    check = subprocess.run(
        ["git", "ls-tree", "--name-only", ref, f"{_NESTED_PREFIX}/"],
        cwd=repo_path,
        capture_output=True,
    )
    if check.returncode == 0 and check.stdout.strip():
        return "nested"
    return "root"


def _detect_layout_working_tree(repo_path: Path) -> str:
    skills_dir = repo_path / ".claude" / "skills"
    if skills_dir.is_dir() and any(
        (d / "SKILL.md").exists() for d in skills_dir.iterdir() if d.is_dir()
    ):
        return "nested"
    return "root"


def checkout_skills_from_commit(
    repo_path: Path,
    commit_ref: str,
    destination: Path,
    skill_names: list[str] | None = None,
) -> list[str]:
    layout = _detect_layout_at_ref(repo_path, commit_ref)
    archive_path = _NESTED_PREFIX if layout == "nested" else "."

    result = subprocess.run(
        ["git", "archive", commit_ref, "--", archive_path],
        cwd=repo_path,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ValueError(
            f"git archive failed for ref '{commit_ref}': {result.stderr.decode().strip()}"
        )

    # For nested layout, skill dirs start at depth 2 (.claude/skills/<name>/...)
    # For root layout, skill dirs start at depth 0 (<name>/...)
    prefix_depth = 2 if layout == "nested" else 0

    extracted = []
    with tarfile.open(fileobj=BytesIO(result.stdout)) as tar:
        valid_skills: set[str] = set()
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if (
                len(parts) >= prefix_depth + 2
                and parts[prefix_depth + 1] == "SKILL.md"
            ):
                valid_skills.add(parts[prefix_depth])

        for member in tar.getmembers():
            parts = Path(member.name).parts
            if len(parts) <= prefix_depth:
                continue
            skill_name = parts[prefix_depth]
            if skill_name not in valid_skills:
                continue
            if skill_names and skill_name not in skill_names:
                continue

            member.name = str(Path(*parts[prefix_depth:]))
            tar.extract(member, destination, filter="data")
            if skill_name not in extracted:
                extracted.append(skill_name)

    return sorted(extracted)


def checkout_skills_from_working_tree(
    repo_path: Path,
    destination: Path,
    skill_names: list[str] | None = None,
) -> list[str]:
    layout = _detect_layout_working_tree(repo_path)
    skills_dir = repo_path / ".claude" / "skills" if layout == "nested" else repo_path

    if not skills_dir.is_dir():
        return []

    copied = []
    for entry in sorted(skills_dir.iterdir()):
        if not entry.is_dir():
            continue
        if not (entry / "SKILL.md").exists():
            continue
        if skill_names and entry.name not in skill_names:
            continue

        target = destination / entry.name
        shutil.copytree(entry, target, dirs_exist_ok=True)
        copied.append(entry.name)

    return sorted(copied)


def list_skills_at_ref(repo_path: Path, ref: str) -> list[str]:
    if ref == "working-tree":
        layout = _detect_layout_working_tree(repo_path)
        skills_dir = repo_path / ".claude" / "skills" if layout == "nested" else repo_path
        if not skills_dir.is_dir():
            return []
        return sorted(
            d.name for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()
        )

    layout = _detect_layout_at_ref(repo_path, ref)
    prefix = f"{_NESTED_PREFIX}/" if layout == "nested" else ""

    # List top-level entries (or .claude/skills/ entries for nested)
    if layout == "nested":
        result = subprocess.run(
            ["git", "ls-tree", "--name-only", ref, f"{_NESTED_PREFIX}/"],
            cwd=repo_path,
            capture_output=True,
        )
    else:
        result = subprocess.run(
            ["git", "ls-tree", "--name-only", ref],
            cwd=repo_path,
            capture_output=True,
        )
    if result.returncode != 0:
        raise ValueError(
            f"git ls-tree failed for ref '{ref}': {result.stderr.decode().strip()}"
        )

    skills = []
    for line in result.stdout.decode().strip().splitlines():
        skill_name = Path(line).name
        check = subprocess.run(
            ["git", "cat-file", "-e", f"{ref}:{prefix}{skill_name}/SKILL.md"],
            cwd=repo_path,
            capture_output=True,
        )
        if check.returncode == 0:
            skills.append(skill_name)

    return sorted(skills)


def list_recent_commits(repo_path: Path, count: int = 20) -> list[dict[str, str]]:
    try:
        result = subprocess.run(
            ["git", "log", f"--max-count={count}", "--format=%H %s"],
            cwd=repo_path,
            capture_output=True,
        )
    except FileNotFoundError as e:
        raise ValueError(f"git log failed: {e}") from e
    if result.returncode != 0:
        raise ValueError(f"git log failed: {result.stderr.decode().strip()}")

    commits = []
    for line in result.stdout.decode().strip().splitlines():
        if not line:
            continue
        match line.split(" ", 1):
            case [hash_val, message]:
                commits.append({"hash": hash_val, "message": message})
            case _:
                continue

    return commits
