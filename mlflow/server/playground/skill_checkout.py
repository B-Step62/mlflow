import shutil
import subprocess
import tarfile
from io import BytesIO
from pathlib import Path


def checkout_skills_from_commit(
    repo_path: Path,
    commit_ref: str,
    destination: Path,
    skill_names: list[str] | None = None,
) -> list[str]:
    result = subprocess.run(
        ["git", "archive", commit_ref, "--", ".claude/skills"],
        cwd=repo_path,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ValueError(
            f"git archive failed for ref '{commit_ref}': {result.stderr.decode().strip()}"
        )

    extracted = []
    with tarfile.open(fileobj=BytesIO(result.stdout)) as tar:
        # Pre-scan to find skill directories that contain SKILL.md
        valid_skills: set[str] = set()
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if len(parts) >= 4 and parts[2] and parts[3] == "SKILL.md":
                valid_skills.add(parts[2])

        for member in tar.getmembers():
            parts = Path(member.name).parts
            if len(parts) < 3:
                continue
            skill_name = parts[2]
            if skill_name not in valid_skills:
                continue
            if skill_names and skill_name not in skill_names:
                continue

            member.name = str(Path(*parts[2:]))
            tar.extract(member, destination, filter="data")
            if skill_name not in extracted:
                extracted.append(skill_name)

    return sorted(extracted)


def checkout_skills_from_working_tree(
    repo_path: Path,
    destination: Path,
    skill_names: list[str] | None = None,
) -> list[str]:
    skills_dir = repo_path / ".claude" / "skills"
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
        skills_dir = repo_path / ".claude" / "skills"
        if not skills_dir.is_dir():
            return []
        return sorted(
            d.name for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").exists()
        )

    # Use git ls-tree to list skill directories at the given ref
    result = subprocess.run(
        ["git", "ls-tree", "--name-only", ref, ".claude/skills/"],
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
        # Verify the skill has a SKILL.md manifest
        check = subprocess.run(
            ["git", "cat-file", "-e", f"{ref}:.claude/skills/{skill_name}/SKILL.md"],
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
