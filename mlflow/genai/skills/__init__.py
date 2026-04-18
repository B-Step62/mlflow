"""MLflow Skill Registry — register, version, and install agent skills."""

import getpass
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import mlflow
from mlflow.entities.skill import Skill
from mlflow.entities.skill_version import SkillVersion
from mlflow.exceptions import MlflowException
from mlflow.genai.skills.constants import SKILL_NAME_RULE
from mlflow.genai.skills.skill_parser import (
    fetch_from_github,
    find_skill_directories,
    is_github_url,
    parse_skill_manifest,
    update_skill_metadata,
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
    "install_skill_from_registry",
    "install_skill_from_source",
]


def _validate_skill_name(name: str) -> None:
    if not name or SKILL_NAME_RULE.match(name) is None:
        raise MlflowException.invalid_parameter_value(
            f"Invalid skill name '{name}'. Skill names must match: {SKILL_NAME_RULE.pattern}"
        )


def _get_skill_artifact_root_uri() -> str:
    """Derive the base URI for skill artifact storage from the configured artifact store.

    For HTTP/HTTPS tracking servers, uses mlflow-artifacts: so the server proxies to its
    configured backend (S3, GCS, Azure, etc.). For local stores (SQLite, file://), reads
    the store's artifact_root_uri directly to avoid mlflow-artifacts: URIs that require
    a live server.
    """
    from mlflow.utils.uri import append_to_uri_path

    tracking_uri = mlflow.get_tracking_uri()

    # HTTP/HTTPS: route through the server's artifact proxy — works with any backend
    if tracking_uri.startswith(("http://", "https://")):
        return append_to_uri_path("mlflow-artifacts:", "skills")

    # Local stores: read artifact_root_uri directly from the store instance
    from mlflow.tracking._tracking_service.utils import _get_store
    from mlflow.utils.uri import resolve_uri_if_local

    store = _get_store(store_uri=tracking_uri)
    if hasattr(store, "artifact_root_uri"):
        artifact_root = store.artifact_root_uri
        # When serve_artifacts is enabled, the server sets artifact_root_uri to
        # "mlflow-artifacts:/" — a proxy URI that cannot be used inside the server
        # process itself. Use the actual storage destination instead (mirrors
        # handlers._get_artifact_repo_mlflow_artifacts pattern).
        if artifact_root.startswith("mlflow-artifacts:"):
            from mlflow.server.constants import ARTIFACTS_DESTINATION_ENV_VAR

            destination = os.environ.get(ARTIFACTS_DESTINATION_ENV_VAR, "./mlartifacts")
            return append_to_uri_path(resolve_uri_if_local(destination), "skills")
        return append_to_uri_path(artifact_root, "skills")

    # Fallback: store alongside the tracking directory
    from mlflow.utils.file_utils import path_to_local_file_uri
    from mlflow.store.tracking import DEFAULT_LOCAL_FILE_AND_ARTIFACT_PATH

    return append_to_uri_path(
        path_to_local_file_uri(str(Path(DEFAULT_LOCAL_FILE_AND_ARTIFACT_PATH).resolve())),
        "skills",
    )


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


def _resolve_source(source: str) -> tuple[Path, list[Path], str | None]:
    """Resolve a source to a root path, skill directories, and optional commit hash."""
    commit_hash = None
    if is_github_url(source):
        skill_root, commit_hash = fetch_from_github(source)
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
    return skill_root, skill_dirs, commit_hash


def preview_skills(source: str) -> list[dict]:
    """Preview skills found in a source without registering them.

    Args:
        source: GitHub repository URL or local directory path.

    Returns:
        List of dicts with 'name' and 'description' for each skill found.
    """
    _, skill_dirs, _ = _resolve_source(source)
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

    When the tracking URI points to an HTTP server, the registration is delegated
    to the server's /register endpoint so the server handles downloading and storage.
    When using a local store (e.g. SQLite), the client handles it directly.

    Args:
        source: GitHub repository URL or local directory path.
        tags: Optional tags to apply to each skill version.
        skill_names: Optional list of skill names to register. If provided, only
            skills whose name matches are registered. If None, all skills are registered.

    Returns:
        List of created SkillVersion objects.
    """
    tracking_uri = mlflow.get_tracking_uri()

    # Remote server — delegate registration to the server's REST endpoint
    if tracking_uri.startswith(("http://", "https://")):
        return _register_skill_via_rest(source, tags, skill_names)

    # Local store — handle directly
    return _register_skill_local(source, tags, skill_names)


def _register_skill_via_rest(
    source: str,
    tags: dict[str, str] | None = None,
    skill_names: list[str] | None = None,
) -> list[SkillVersion]:
    """Register skills by calling the MLflow server's /register REST endpoint."""
    from functools import partial

    from mlflow.utils.credentials import get_default_host_creds
    from mlflow.utils.rest_utils import http_request, verify_rest_response

    endpoint = "/ajax-api/3.0/mlflow/skills/register"
    body = {
        "source": source,
        "tags": tags,
        "skill_names": skill_names,
    }
    response = http_request(
        host_creds=partial(get_default_host_creds, mlflow.get_tracking_uri())(),
        endpoint=endpoint,
        method="POST",
        json=body,
    )
    verify_rest_response(response, endpoint)

    versions = []
    for v in response.json():
        versions.append(SkillVersion(
            name=v["name"],
            version=v["version"],
            source=v.get("source"),
            description=v.get("description"),
            manifest_content=v.get("manifest_content"),
            artifact_location=v.get("artifact_location"),
            creation_timestamp=v.get("creation_timestamp"),
            tags=v.get("tags", {}),
            aliases=v.get("aliases", []),
            created_by=v.get("created_by"),
        ))
    return versions


def _register_skill_local(
    source: str,
    tags: dict[str, str] | None = None,
    skill_names: list[str] | None = None,
) -> list[SkillVersion]:
    """Register skills directly against the local store (SQLite / file)."""
    _, skill_dirs, commit_hash = _resolve_source(source)

    client = mlflow.MlflowClient()
    versions = []

    version_tags = dict(tags or {})
    if commit_hash:
        version_tags["mlflow.skill.commit_hash"] = commit_hash

    for skill_dir in skill_dirs:
        manifest = parse_skill_manifest(skill_dir / "SKILL.md")
        name = manifest["name"]
        description = manifest.get("description")

        if skill_names is not None and name not in skill_names:
            continue

        _validate_skill_name(name)

        try:
            client.create_skill(name=name, description=description)
        except MlflowException:
            pass

        sv = client.create_skill_version(
            name=name,
            source=source,
            description=description,
            tags=version_tags,
            created_by=getpass.getuser(),
        )

        artifact_location = _store_skill_bundle(name, sv.version, skill_dir)
        client.set_skill_version_tag(
            name, sv.version, "mlflow.skill.artifact_location", artifact_location
        )

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


def _get_agent_skill_dir(
    name: str,
    agent: str,
    scope: Literal["global", "project"],
    project_path: Path | None = None,
) -> Path:
    """Resolve the agent-specific skill directory (where the symlink or copy goes)."""
    from mlflow.genai.skills.constants import AGENT_SKILL_DIRS, SUPPORTED_AGENTS

    if agent not in AGENT_SKILL_DIRS:
        raise MlflowException.invalid_parameter_value(
            f"Unsupported agent '{agent}'. Supported agents: {', '.join(SUPPORTED_AGENTS)}"
        )
    rel = AGENT_SKILL_DIRS[agent][scope if scope == "project" else "global"]
    base = Path.home() if scope == "global" else (project_path or Path.cwd())
    return base / rel / name


def _get_canonical_dir(name: str) -> Path:
    """Resolve the canonical skill directory (~/.agents/skills/<name>)."""
    from mlflow.genai.skills.constants import CANONICAL_SKILLS_DIR

    return CANONICAL_SKILLS_DIR / name


def _write_install_metadata(
    skill_md_path: Path,
    *,
    source: str | None = None,
    commit_hash: str | None = None,
    version: int | None = None,
    tracking_uri: str | None = None,
) -> None:
    """Write installation metadata into the SKILL.md frontmatter metadata field."""
    metadata: dict[str, str] = {}
    if source:
        metadata["mlflow-source"] = source
    if commit_hash:
        metadata["mlflow-commit-sha"] = commit_hash
    if version is not None:
        metadata["mlflow-version"] = str(version)
    if tracking_uri:
        metadata["mlflow-tracking-uri"] = tracking_uri
    metadata["mlflow-installed-at"] = datetime.now(tz=timezone.utc).isoformat()

    if metadata:
        update_skill_metadata(skill_md_path, metadata)


def _copy_dir(src: Path, dest: Path) -> None:
    """Copy a directory to the destination, overwriting existing files."""
    import shutil

    if dest.exists() or dest.is_symlink():
        if dest.is_symlink():
            dest.unlink()
        else:
            shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)


def _create_symlink(canonical: Path, agent_dest: Path) -> None:
    """Create a symlink from the agent skill directory to the canonical location."""
    agent_dest.parent.mkdir(parents=True, exist_ok=True)
    if agent_dest.exists() or agent_dest.is_symlink():
        if agent_dest.is_symlink():
            agent_dest.unlink()
        else:
            import shutil

            shutil.rmtree(agent_dest)
    agent_dest.symlink_to(canonical)


def _install_skill_files(
    name: str,
    src: Path,
    agent: str,
    scope: Literal["global", "project"],
    project_path: Path | None = None,
    copy: bool = False,
) -> Path:
    """Install skill files using the three-mode strategy.

    Returns the path where the agent will find the skill (symlink or copy).

    Modes:
        1. Global (scope="global"): copy to ~/.agents/skills/<name>, symlink from agent dir
        2. Project with symlink (scope="project", copy=False): copy to ~/.agents/skills/<name>,
           symlink from project agent dir
        3. Project with copy (scope="project", copy=True): copy directly to project agent dir
    """
    agent_dest = _get_agent_skill_dir(name, agent, scope, project_path)

    if scope == "project" and copy:
        # Mode 3: direct copy, no canonical
        _copy_dir(src, agent_dest)
        return agent_dest

    # Mode 1 & 2: copy to canonical, symlink from agent dir
    canonical = _get_canonical_dir(name)
    _copy_dir(src, canonical)
    _create_symlink(canonical, agent_dest)
    return agent_dest


def install_skill_from_registry(
    name: str,
    version: int | None = None,
    alias: str | None = None,
    agent: str = "claude-code",
    scope: Literal["global", "project"] = "global",
    project_path: Path | None = None,
    copy: bool = False,
) -> Path:
    """Download skill artifacts from the registry and install to an agent runtime directory.

    Args:
        name: Skill name.
        version: Specific version. If None and alias is None, installs latest.
        alias: Alias to resolve.
        agent: Target agent runtime.
        scope: "global" or "project".
        project_path: Project directory (for scope="project").
        copy: If True and scope="project", copy files directly instead of symlinking.

    Returns:
        Path to the installed skill directory.
    """
    import tempfile

    sv = load_skill(name, version=version, alias=alias)

    artifact_location = sv.artifact_location
    if not artifact_location:
        artifact_location = sv.tags.get("mlflow.skill.artifact_location")
    if not artifact_location:
        raise MlflowException(f"Skill '{name}' v{sv.version} has no stored artifacts.")

    # Download artifacts to a temp directory first, then install via three-mode strategy
    from mlflow.store.artifact.artifact_repository_registry import get_artifact_repository

    with tempfile.TemporaryDirectory(prefix="mlflow_skill_") as tmp:
        tmp_dest = Path(tmp) / name
        tmp_dest.mkdir()
        repo = get_artifact_repository(artifact_location)
        repo.download_artifacts("", dst_path=str(tmp_dest))

        agent_dest = _install_skill_files(name, tmp_dest, agent, scope, project_path, copy)

    # Write metadata to the canonical or agent copy's SKILL.md
    # For symlink modes, the canonical SKILL.md is the real file
    skill_md = _get_canonical_dir(name) / "SKILL.md" if not (scope == "project" and copy) else agent_dest / "SKILL.md"
    if skill_md.exists():
        _write_install_metadata(
            skill_md,
            source=sv.source,
            commit_hash=sv.tags.get("mlflow.skill.commit_hash"),
            version=sv.version,
            tracking_uri=mlflow.get_tracking_uri(),
        )

    _logger.info("Installed skill '%s' v%d to %s", name, sv.version, agent_dest)
    return agent_dest


def install_skill_from_source(
    source: str,
    agent: str = "claude-code",
    scope: Literal["global", "project"] = "global",
    project_path: Path | None = None,
    pin: str | None = None,
    skill_names: list[str] | None = None,
    register: bool = False,
    tags: dict[str, str] | None = None,
    copy: bool = False,
) -> list[Path]:
    """Install skills directly from a GitHub URL or local directory.

    Downloads the source, discovers skills, installs them to the agent runtime
    directory, and optionally registers them in the MLflow Skill Registry.

    Args:
        source: GitHub repository URL or local directory path.
        agent: Target agent runtime.
        scope: "global" or "project".
        project_path: Project directory (for scope="project").
        pin: Git ref to pin (branch, tag, or SHA). GitHub sources only.
        skill_names: If provided, only install skills whose name matches.
        register: If True, also register skills in the MLflow registry.
        tags: Optional tags to apply when registering.
        copy: If True and scope="project", copy directly instead of symlinking.

    Returns:
        List of paths where skills were installed.
    """
    commit_hash = None
    if is_github_url(source):
        skill_root, commit_hash = fetch_from_github(source, ref=pin or "main")
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

    # Collect matching skill names and directories
    selected_dirs: list[tuple[str, Path]] = []
    for skill_dir in skill_dirs:
        manifest = parse_skill_manifest(skill_dir / "SKILL.md")
        name = manifest["name"]
        if skill_names is not None and name not in skill_names:
            continue
        selected_dirs.append((name, skill_dir))

    # Register in MLflow if requested
    version_map: dict[str, int] = {}
    if register and selected_dirs:
        selected_names = [n for n, _ in selected_dirs]
        registered = register_skill(source=source, tags=tags, skill_names=selected_names)
        for sv in registered:
            version_map[sv.name] = sv.version

    # Install each skill using the three-mode strategy
    installed_paths = []
    for name, skill_dir in selected_dirs:
        agent_dest = _install_skill_files(name, skill_dir, agent, scope, project_path, copy)

        # Write metadata to the real SKILL.md (canonical for symlink modes, agent dir for copy)
        is_copy_mode = scope == "project" and copy
        skill_md = (agent_dest if is_copy_mode else _get_canonical_dir(name)) / "SKILL.md"
        if skill_md.exists():
            _write_install_metadata(
                skill_md,
                source=source,
                commit_hash=commit_hash,
                version=version_map.get(name),
                tracking_uri=mlflow.get_tracking_uri() if register else None,
            )

        installed_paths.append(agent_dest)
        _logger.info("Installed skill '%s' to %s", name, agent_dest)

    return installed_paths
