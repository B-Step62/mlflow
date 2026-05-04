"""Interactive setup wizard for the MLflow Agent Playground."""

import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import click
import yaml

from mlflow.claude_code.repo_inspect import (
    ClaudeDetection,
    FileInspection,
    FunctionCandidate,
    detect_with_claude,
    find_function_def_line,
    inspect_file,
    inspect_repo,
    scaffold_autolog,
    scaffold_decorator,
)

DEFAULT_CONFIG_DIR = Path.home() / ".mlflow" / "playground"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.yaml"
SCHEMA_VERSION = 1
DEFAULT_EXPERIMENT_NAME = "agent-playground"
DEFAULT_MAX_TOKENS_PER_ISSUE = 50_000


@dataclass
class MLflowConfig:
    tracking_uri: str = ""
    experiment: str = DEFAULT_EXPERIMENT_NAME
    token_env: str = "MLFLOW_TRACKING_TOKEN"


@dataclass
class WorkerConfig:
    kind: str = "claude-code"
    api_key_env: str = "ANTHROPIC_API_KEY"
    max_tokens_per_issue: int = DEFAULT_MAX_TOKENS_PER_ISSUE


@dataclass
class GitConfig:
    use_existing_credentials: bool = True


@dataclass
class PlaygroundConfig:
    enable_tracing: bool = True
    install_claude_skills: bool = False


@dataclass
class PlaygroundUserConfig:
    schema_version: int = SCHEMA_VERSION
    mlflow: MLflowConfig = field(default_factory=MLflowConfig)
    worker: WorkerConfig = field(default_factory=WorkerConfig)
    git: GitConfig = field(default_factory=GitConfig)
    playground: PlaygroundConfig = field(default_factory=PlaygroundConfig)


def _default_tracking_uri() -> str:
    return f"sqlite:///{DEFAULT_CONFIG_DIR / 'mlruns.db'}"


def _from_dict(raw: dict[str, Any]) -> PlaygroundUserConfig:
    return PlaygroundUserConfig(
        schema_version=raw.get("schema_version", SCHEMA_VERSION),
        mlflow=MLflowConfig(**(raw.get("mlflow") or {})),
        worker=WorkerConfig(**(raw.get("worker") or {})),
        git=GitConfig(**(raw.get("git") or {})),
        playground=PlaygroundConfig(**(raw.get("playground") or {})),
    )


def load_user_config(
    config_path: Path = DEFAULT_CONFIG_PATH,
) -> PlaygroundUserConfig | None:
    if not config_path.exists():
        return None
    raw = yaml.safe_load(config_path.read_text())
    if not raw:
        return None
    return _from_dict(raw)


def save_user_config(
    config: PlaygroundUserConfig, config_path: Path = DEFAULT_CONFIG_PATH
) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(yaml.safe_dump(asdict(config), sort_keys=False))


def run_setup_wizard(
    config_path: Path = DEFAULT_CONFIG_PATH,
    non_interactive: bool = False,
    repo_dir: Path | None = None,
) -> PlaygroundUserConfig:
    existing = load_user_config(config_path)
    if existing is not None:
        click.echo(
            f"Found existing playground config at {config_path}. "
            "Press Enter to keep each value, or type a new one."
        )
    else:
        click.echo("Setting up MLflow Agent Playground.")

    base = existing or PlaygroundUserConfig(
        mlflow=MLflowConfig(tracking_uri=_default_tracking_uri())
    )

    config = base if non_interactive else _prompt_for_values(base)

    if repo_dir is not None:
        _run_repo_inspection_step(repo_dir, non_interactive=non_interactive)

    save_user_config(config, config_path)
    _show_summary(config, config_path, was_existing=existing is not None)
    return config


def _run_repo_inspection_step(repo_dir: Path, non_interactive: bool) -> None:
    click.echo("")

    if shutil.which("claude"):
        click.echo(f"Inspecting {repo_dir} with Claude...")
        detection = detect_with_claude(repo_dir)
        if detection is not None:
            _apply_claude_detection(detection, repo_dir, non_interactive)
            return
        click.echo("Claude detection didn't yield a result; falling back to heuristic.")

    click.echo(f"Inspecting {repo_dir} for agent entrypoints (heuristic)...")
    inspection = inspect_repo(repo_dir)

    decorator_candidates = inspection.decorator_candidates
    autolog_targets = inspection.autolog_targets()

    if not decorator_candidates and not autolog_targets:
        click.echo(
            "Nothing to scaffold — repo already has @invoke decorators / autolog calls."
        )
        return

    if decorator_candidates:
        click.echo("")
        click.echo(
            f"Found {len(decorator_candidates)} candidate function(s) for @invoke:"
        )
        for c in decorator_candidates:
            rel = c.file.relative_to(repo_dir)
            click.echo(f"  - {rel}:{c.line_no}  def {c.function_name}(...)")
        if non_interactive or click.confirm(
            "Add @invoke() to all of these (with .bak backup)?", default=True
        ):
            for c in decorator_candidates:
                _patch_decorator(c, repo_dir)

    if autolog_targets:
        click.echo("")
        click.echo(f"Found {len(autolog_targets)} framework autolog opportunit(ies):")
        for finsp, fw in autolog_targets:
            rel = finsp.file.relative_to(repo_dir)
            click.echo(f"  - {rel}: mlflow.{fw}.autolog()")
        if non_interactive or click.confirm(
            "Add autolog() calls to all of these?", default=True
        ):
            for finsp, fw in autolog_targets:
                _patch_autolog(finsp, fw, repo_dir)


def _apply_claude_detection(
    detection: ClaudeDetection, repo_dir: Path, non_interactive: bool
) -> None:
    rel = detection.entrypoint_file.relative_to(repo_dir)
    file_inspection = inspect_file(detection.entrypoint_file)
    if file_inspection is None:
        click.echo(f"Could not parse {rel}; skipping scaffold.")
        return

    if file_inspection.has_invoke_decorator:
        click.echo(
            f"Detected entrypoint: {rel} def {detection.entrypoint_function}(...) "
            "— already has @invoke."
        )
    else:
        line_no = find_function_def_line(
            detection.entrypoint_file, detection.entrypoint_function
        )
        if line_no is None:
            click.echo(
                f"Claude pointed at {rel}:{detection.entrypoint_function} "
                "but no such function exists; skipping."
            )
            return
        candidate = FunctionCandidate(
            file=detection.entrypoint_file,
            function_name=detection.entrypoint_function,
            line_no=line_no,
        )
        click.echo(
            f"Detected entrypoint: {rel}:{candidate.line_no}  def {candidate.function_name}(...)"
        )
        if non_interactive or click.confirm(
            f"Add @invoke() above {candidate.function_name}? (with .bak backup)",
            default=True,
        ):
            _patch_decorator(candidate, repo_dir)

    framework = detection.framework
    if framework and framework not in file_inspection.autologged_frameworks:
        click.echo(f"Detected framework: {framework}")
        if non_interactive or click.confirm(
            f"Add mlflow.{framework}.autolog() to {rel}?", default=True
        ):
            _patch_autolog(file_inspection, framework, repo_dir)


def _patch_decorator(candidate: FunctionCandidate, repo_dir: Path) -> None:
    rel = candidate.file.relative_to(repo_dir)
    if scaffold_decorator(candidate):
        click.echo(f"  + patched {rel}: added @invoke() to {candidate.function_name}")
    else:
        click.echo(f"  · skipped {rel}: already has @invoke")


def _patch_autolog(
    file_inspection: FileInspection, framework: str, repo_dir: Path
) -> None:
    rel = file_inspection.file.relative_to(repo_dir)
    if scaffold_autolog(file_inspection, framework):
        click.echo(f"  + patched {rel}: added mlflow.{framework}.autolog()")
    else:
        click.echo(f"  · skipped {rel}: mlflow.{framework}.autolog() already present")


def _prompt_for_values(base: PlaygroundUserConfig) -> PlaygroundUserConfig:
    tracking_uri = click.prompt(
        "MLflow tracking URI",
        default=base.mlflow.tracking_uri or _default_tracking_uri(),
    )
    experiment = click.prompt("Experiment name", default=base.mlflow.experiment)
    enable_tracing = click.confirm(
        "Enable agent tracing (autolog)?", default=base.playground.enable_tracing
    )
    install_claude_skills = click.confirm(
        "Install Claude skills (cockpit + worker prompts)?",
        default=base.playground.install_claude_skills,
    )
    start_now = click.confirm("Start the playground server now?", default=False)
    if start_now:
        click.echo(
            "Run `mlflow agent playground` to start the cockpit "
            "(blocks the terminal; opens your browser)."
        )

    return PlaygroundUserConfig(
        schema_version=SCHEMA_VERSION,
        mlflow=MLflowConfig(
            tracking_uri=tracking_uri,
            experiment=experiment,
            token_env=base.mlflow.token_env,
        ),
        worker=base.worker,
        git=base.git,
        playground=PlaygroundConfig(
            enable_tracing=enable_tracing,
            install_claude_skills=install_claude_skills,
        ),
    )


def _show_summary(
    config: PlaygroundUserConfig, config_path: Path, was_existing: bool
) -> None:
    verb = "Updated" if was_existing else "Created"
    click.echo("")
    click.echo("=" * 50)
    click.echo(f"{verb} {config_path}")
    click.echo(f"  tracking_uri: {config.mlflow.tracking_uri}")
    click.echo(f"  experiment:   {config.mlflow.experiment}")
    click.echo(
        f"  tracing:      {'enabled' if config.playground.enable_tracing else 'disabled'}"
    )
    click.echo("=" * 50)
    click.echo("")
    click.echo("Next: `mlflow agent playground` to open the cockpit (lands in YUK-8).")
