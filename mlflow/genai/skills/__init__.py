"""MLflow Skill Registry — register, version, and install agent skills."""

import getpass
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import mlflow
from mlflow.entities.skill import Skill
from mlflow.entities.skill_version import SkillVersion
from mlflow.exceptions import MlflowException
from mlflow.genai.skills.constants import (
    SKILL_METADATA_FILENAME,
    SKILL_NAME_RULE,
)
from mlflow.genai.skills.skill_parser import (
    fetch_from_github,
    find_skill_directories,
    is_github_url,
    parse_skill_manifest,
)

_logger = logging.getLogger(__name__)

__all__ = [
    "register_skill",
    "preview_skills",
    "load_skill",
    "search_skills",
    "set_skill_tag",
    "delete_skill_tag",
    "set_skill_alias",
    "delete_skill_alias",
    "delete_skill",
    "delete_skill_version",
    "install_skill",
]


def _validate_skill_name(name: str) -> None:
    if not name or SKILL_NAME_RULE.match(name) is None:
        raise MlflowException.invalid_parameter_value(
            f"Invalid skill name '{name}'. Skill names must match: {SKILL_NAME_RULE.pattern}"
        )


def _get_skill_artifact_root_uri() -> str:
    """Derive the base URI for skill artifact storage from the configured artifact store.

    Uses the default experiment's artifact location to infer the artifact root, so skills
    are stored in the same artifact store as runs (local filesystem, S3, GCS, etc.).
    """
    from mlflow.utils.uri import append_to_uri_path

    client = mlflow.MlflowClient()
    exp = client.get_experiment("0")
    if exp and exp.artifact_location:
        # Default experiment artifact_location is "{root}/0" — strip the experiment ID component
        base = exp.artifact_location.rstrip("/").rsplit("/", 1)[0]
        return append_to_uri_path(base, "skills")
    return append_to_uri_path(mlflow.get_tracking_uri(), "skill_artifacts")


def _store_skill_bundle(name: str, version: int, skill_dir: Path) -> str:
    """Upload skill bundle to the configured MLflow artifact store.

    Returns:
        The artifact URI where the skill bundle was stored.
    """
    from mlflow.store.artifact.artifact_repository_registry import get_artifact_repository
    from mlflow.utils.uri import append_to_uri_path

    artifact_uri = append_to_uri_path(_get_skill_artifact_root_uri(), name, str(version))
    repo = get_artifact_repository(artifact_uri)
    repo.log_artifacts(str(skill_dir), artifact_path=None)
    return artifact_uri


def _resolve_source(source: str) -> tuple[Path, list[Path]]:
    """Resolve a source to a root path and list of skill directories."""
    if is_github_url(source):
        skill_root = fetch_from_github(source)
    else:
        skill_root = Path(source).expanduser().resolve()
        if not skill_root.exists():
            raise MlflowException(f"Source path '{source}' does not exist.")

    skill_dirs = find_skill_directories(skill_root)
    if not skill_dirs:
        if (skill_root / "SKILL.md").exists():
            skill_dirs = [skill_root]
        else:
            raise MlflowException(
                f"No SKILL.md files found in '{source}'. "
                "Each skill must contain a SKILL.md manifest."
            )
    return skill_root, skill_dirs


def preview_skills(source: str) -> list[dict]:
    """Preview skills found in a source without registering them.

    Args:
        source: GitHub repository URL or local directory path.

    Returns:
        List of dicts with 'name' and 'description' for each skill found.
    """
    _, skill_dirs = _resolve_source(source)
    results = []
    for skill_dir in skill_dirs:
        manifest = parse_skill_manifest(skill_dir / "SKILL.md")
        results.append({
            "name": manifest["name"],
            "description": manifest.get("description"),
        })
    return results


def register_skill(
    source: str,
    tags: dict[str, str] | None = None,
    skill_names: list[str] | None = None,
) -> list[SkillVersion]:
    """Register skill(s) from a GitHub URL or local directory path.

    Finds all SKILL.md files in the source, registers each as a versioned skill.
    If the skill already exists, creates a new version.

    Args:
        source: GitHub repository URL or local directory path.
        tags: Optional tags to apply to each skill version.
        skill_names: Optional list of skill names to register. If provided, only
            skills whose name matches are registered. If None, all skills are registered.

    Returns:
        List of created SkillVersion objects.
    """
    _, skill_dirs = _resolve_source(source)

    client = mlflow.MlflowClient()
    versions = []

    for skill_dir in skill_dirs:
        manifest = parse_skill_manifest(skill_dir / "SKILL.md")
        name = manifest["name"]
        description = manifest.get("description")

        if skill_names is not None and name not in skill_names:
            continue

        _validate_skill_name(name)

        # Create or get the registered skill
        try:
            client.create_skill(name=name, description=description)
        except MlflowException:
            pass

        # Store bundle files and get artifact_location
        # We need the version number first, but it's auto-incremented by the store.
        # Create the version first, then store artifacts and update location.
        sv = client.create_skill_version(
            name=name,
            source=source,
            description=description,
            tags=tags,
            created_by=getpass.getuser(),
        )

        artifact_location = _store_skill_bundle(name, sv.version, skill_dir)
        # Update the artifact_location on the version
        # For now we set it via a tag since we just created the version
        # TODO: add a dedicated update method
        client.set_skill_version_tag(name, sv.version, "mlflow.skill.artifact_location", artifact_location)

        versions.append(sv)
        _logger.info("Registered skill '%s' version %d", name, sv.version)

    return versions


def load_skill(
    name: str,
    version: int | None = None,
    alias: str | None = None,
) -> SkillVersion:
    """Load a skill by name and optional version or alias.

    Args:
        name: Skill name.
        version: Specific version number. If None and alias is None, loads latest.
        alias: Alias to resolve (e.g., "champion"). Mutually exclusive with version.

    Returns:
        SkillVersion object.
    """
    client = mlflow.MlflowClient()
    if version is not None and alias is not None:
        raise MlflowException.invalid_parameter_value(
            "Cannot specify both 'version' and 'alias'."
        )
    if alias is not None:
        return client.get_skill_version_by_alias(name, alias)
    if version is not None:
        return client.get_skill_version(name, version)
    return client.get_latest_skill_version(name)


def search_skills(
    filter_string: str | None = None,
    max_results: int = 100,
) -> list[Skill]:
    """Search registered skills."""
    return list(
        mlflow.MlflowClient().search_skills(
            filter_string=filter_string, max_results=max_results,
        )
    )


def set_skill_tag(name: str, version: int, key: str, value: str) -> None:
    mlflow.MlflowClient().set_skill_version_tag(name, version, key, value)


def delete_skill_tag(name: str, version: int, key: str) -> None:
    mlflow.MlflowClient().delete_skill_version_tag(name, version, key)


def set_skill_alias(name: str, alias: str, version: int) -> None:
    mlflow.MlflowClient().set_skill_alias(name, alias, version)


def delete_skill_alias(name: str, alias: str) -> None:
    mlflow.MlflowClient().delete_skill_alias(name, alias)


def delete_skill(name: str) -> None:
    mlflow.MlflowClient().delete_skill(name)


def delete_skill_version(name: str, version: int) -> None:
    mlflow.MlflowClient().delete_skill_version(name, version)


def install_skill(
    name: str,
    version: int | None = None,
    alias: str | None = None,
    scope: Literal["global", "project"] = "global",
    project_path: Path | None = None,
) -> Path:
    """Download skill artifacts and install to Claude Code skills directory.

    Args:
        name: Skill name.
        version: Specific version. If None and alias is None, installs latest.
        alias: Alias to resolve.
        scope: "global" installs to ~/.claude/skills/, "project" to {project}/.claude/skills/.
        project_path: Required when scope="project".

    Returns:
        Path to the installed skill directory.
    """
    sv = load_skill(name, version=version, alias=alias)

    # Resolve artifact location — check dedicated field first, then tag fallback
    artifact_location = sv.artifact_location
    if not artifact_location:
        artifact_location = sv.tags.get("mlflow.skill.artifact_location")
    if not artifact_location:
        raise MlflowException(f"Skill '{name}' v{sv.version} has no stored artifacts.")

    # Determine destination
    if scope == "global":
        dest = Path.home() / ".claude" / "skills" / name
    elif scope == "project":
        if project_path is None:
            project_path = Path.cwd()
        dest = Path(project_path) / ".claude" / "skills" / name
    else:
        raise MlflowException.invalid_parameter_value(f"Invalid scope: {scope}")

    # Download skill files using MLflow's artifact infrastructure (supports S3, GCS, Azure, etc.)
    from mlflow.store.artifact.artifact_repository_registry import get_artifact_repository

    dest.mkdir(parents=True, exist_ok=True)
    repo = get_artifact_repository(artifact_location)
    repo.download_artifacts("", dst_path=str(dest))

    # Write metadata sidecar for trace linkage
    metadata = {
        "name": sv.name,
        "version": sv.version,
        "source": sv.source,
        "tracking_uri": mlflow.get_tracking_uri(),
        "installed_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    sidecar_path = dest / SKILL_METADATA_FILENAME
    sidecar_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    _logger.info("Installed skill '%s' v%d to %s", name, sv.version, dest)
    return dest
