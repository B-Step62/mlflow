"""Interactive setup wizard for the MLflow Agent Playground."""

from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

import click
import yaml

from mlflow.claude_code.repo_inspect import instrument_with_claude

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
    repo_dir: str = ""


@dataclass
class PlaygroundUserConfig:
    schema_version: int = SCHEMA_VERSION
    mlflow: MLflowConfig = field(default_factory=MLflowConfig)
    worker: WorkerConfig = field(default_factory=WorkerConfig)
    git: GitConfig = field(default_factory=GitConfig)
    playground: PlaygroundConfig = field(default_factory=PlaygroundConfig)


def _default_tracking_uri() -> str:
    return f"sqlite:///{DEFAULT_CONFIG_DIR / 'mlruns.db'}"


def _filter_known(cls: type, raw: dict[str, Any] | None) -> dict[str, Any]:
    """Drop keys not present on `cls`, so renamed/removed config fields don't crash."""
    if not raw:
        return {}
    known = {f.name for f in fields(cls)}
    return {k: v for k, v in raw.items() if k in known}


def _from_dict(raw: dict[str, Any]) -> PlaygroundUserConfig:
    return PlaygroundUserConfig(
        schema_version=raw.get("schema_version", SCHEMA_VERSION),
        mlflow=MLflowConfig(**_filter_known(MLflowConfig, raw.get("mlflow"))),
        worker=WorkerConfig(**_filter_known(WorkerConfig, raw.get("worker"))),
        git=GitConfig(**_filter_known(GitConfig, raw.get("git"))),
        playground=PlaygroundConfig(**_filter_known(PlaygroundConfig, raw.get("playground"))),
    )


def load_user_config(config_path: Path = DEFAULT_CONFIG_PATH) -> PlaygroundUserConfig | None:
    if not config_path.exists():
        return None
    raw = yaml.safe_load(config_path.read_text())
    if not raw:
        return None
    return _from_dict(raw)


def save_user_config(config: PlaygroundUserConfig, config_path: Path = DEFAULT_CONFIG_PATH) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(yaml.safe_dump(asdict(config), sort_keys=False))


# --- styling helpers ----------------------------------------------------------

_BAR = "─" * 56


def _banner(title: str) -> None:
    click.echo("")
    click.secho(f"╭{_BAR}╮", fg="cyan")
    padded = title.ljust(len(_BAR) - 1)
    click.secho("│ ", fg="cyan", nl=False)
    click.secho(padded, fg="cyan", bold=True, nl=False)
    click.secho("│", fg="cyan")
    click.secho(f"╰{_BAR}╯", fg="cyan")


def _section(title: str) -> None:
    click.echo("")
    click.secho(f"▶ {title}", fg="cyan", bold=True)


def _success(message: str) -> None:
    click.secho(f"  ✔ {message}", fg="green")


def _info(message: str) -> None:
    click.secho(f"  • {message}", fg="white")


def _warn(message: str) -> None:
    click.secho(f"  ! {message}", fg="yellow")


def _error(message: str) -> None:
    click.secho(f"  ✗ {message}", fg="red", bold=True)


def _hint(message: str) -> None:
    click.secho(f"    {message}", fg="bright_black")


def _kv(label: str, value: str) -> None:
    click.echo(
        "  " + click.style(f"{label:<14}", fg="cyan") + click.style(value, fg="white", bold=True)
    )


# --- wizard -------------------------------------------------------------------


def run_setup_wizard(
    config_path: Path = DEFAULT_CONFIG_PATH,
    non_interactive: bool = False,
    repo_dir: Path | None = None,
) -> PlaygroundUserConfig:
    existing = load_user_config(config_path)
    _banner("MLflow Claude Code · Setup")
    if existing is not None:
        click.secho(
            f"  Found existing config at {config_path}.",
            fg="bright_black",
        )
        click.secho(
            "  Press Enter to keep each value, or type a new one.",
            fg="bright_black",
        )
    else:
        click.secho(
            "  Let's get the playground configured.",
            fg="bright_black",
        )

    base = existing or PlaygroundUserConfig(
        mlflow=MLflowConfig(tracking_uri=_default_tracking_uri())
    )

    config = base if non_interactive else _prompt_for_values(base)
    if repo_dir is not None:
        config.playground.repo_dir = str(repo_dir.resolve())

    _install_mlflow_skills_step()

    _run_tracing_step(config, repo_dir, non_interactive=non_interactive)

    save_user_config(config, config_path)
    _show_summary(config, config_path, was_existing=existing is not None)

    if not non_interactive:
        _maybe_start_playground()

    return config


def _install_mlflow_skills_step() -> None:
    from mlflow.assistant.skill_installer import install_skills

    skills_path = Path.home() / ".claude" / "skills"
    _section("Install MLflow Claude skills")
    _info(f"target: {skills_path}")
    try:
        installed = install_skills(skills_path)
    except Exception as e:
        _error(f"Failed to install skills: {e}")
        return
    if not installed and _init_skills_submodule_if_dev():
        try:
            installed = install_skills(skills_path)
        except Exception as e:
            _error(f"Failed to install skills: {e}")
            return
    if not installed:
        _error("Could not install MLflow skills — package data is empty.")
        _hint("If you installed mlflow from source, run:")
        _hint("  git submodule update --init mlflow/assistant/skills")
        return
    _success(f"Installed {len(installed)} skill(s):")
    for name in installed:
        click.secho(f"    · {name}", fg="bright_black")


def _init_skills_submodule_if_dev() -> bool:
    """Auto-initialize the `mlflow/assistant/skills` git submodule for source installs.

    Returns True if a `git submodule update --init` ran successfully. Returns
    False when there's nothing we can do — `git` isn't on PATH, the on-disk
    skills directory isn't inside a git repo (PyPI / wheel install), or the
    submodule init itself fails.
    """
    import shutil
    import subprocess

    if not shutil.which("git"):
        return False
    try:
        import mlflow.assistant

        skills_path = Path(mlflow.assistant.__file__).resolve().parent / "skills"
    except Exception:
        return False
    if not skills_path.exists():
        return False
    try:
        top = subprocess.run(
            ["git", "-C", str(skills_path), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False
    try:
        rel = skills_path.relative_to(top)
    except ValueError:
        return False
    _info("initializing skills submodule (one-time dev setup)...")
    try:
        result = subprocess.run(
            ["git", "-C", top, "submodule", "update", "--init", "--", str(rel)],
            timeout=180,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return result.returncode == 0


def _run_tracing_step(
    config: PlaygroundUserConfig, repo_dir: Path | None, non_interactive: bool
) -> None:
    """Decide whether to enable tracing AND instrument the repo, in one prompt.

    Mutates `config.playground.enable_tracing` based on the user's answer
    (or the existing value, in non-interactive mode). When the answer is
    yes and `repo_dir` is provided, hands off to Claude to write the
    autolog / `@mlflow.trace` calls into the agent code.
    """
    if non_interactive:
        if config.playground.enable_tracing and repo_dir is not None:
            _section("Tracing")
            _instrument(repo_dir)
        return

    _section("Tracing")
    prompt = (
        "  Enable MLflow tracing in this repo? "
        "(adds autolog + @mlflow.trace to your agent)"
        if repo_dir is not None
        else "  Enable agent tracing (autolog + @mlflow.trace)?"
    )
    enable = click.confirm(
        click.style(prompt, fg="cyan"),
        default=config.playground.enable_tracing,
    )
    config.playground.enable_tracing = enable
    if enable and repo_dir is not None:
        _instrument(repo_dir)


def _instrument(repo_dir: Path) -> None:
    _info(f"target: {repo_dir}")
    _info("delegating to Claude (this may take a minute)...")
    rc = instrument_with_claude(repo_dir)
    if rc is None:
        _error("Could not run `claude` — is Claude Code installed and on your PATH?")
        _hint("Install: https://claude.ai/code")
        return
    if rc != 0:
        _warn(f"Claude exited with code {rc}. Review the output above.")
        return
    _success("Claude finished instrumenting the repo.")
    _hint("Tip: review the diff with `git diff` before committing.")


def _prompt_for_values(base: PlaygroundUserConfig) -> PlaygroundUserConfig:
    _section("MLflow connection")
    tracking_uri = click.prompt(
        click.style("  Tracking URI", fg="cyan"),
        default=base.mlflow.tracking_uri or _default_tracking_uri(),
    )
    experiment = click.prompt(
        click.style("  Experiment name", fg="cyan"),
        default=base.mlflow.experiment,
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
            enable_tracing=base.playground.enable_tracing,
            repo_dir=base.playground.repo_dir,
        ),
    )


def _show_summary(config: PlaygroundUserConfig, config_path: Path, was_existing: bool) -> None:
    verb = "Updated" if was_existing else "Created"
    _section(f"{verb} {config_path}")
    _kv("tracking_uri", config.mlflow.tracking_uri)
    _kv("experiment", config.mlflow.experiment)
    _kv("tracing", "enabled" if config.playground.enable_tracing else "disabled")
    _kv("worker", config.worker.kind)
    if config.playground.repo_dir:
        _kv("repo_dir", config.playground.repo_dir)


def _maybe_start_playground() -> None:
    _section("Next steps")
    if click.confirm(
        click.style("  Start the local MLflow playground now?", fg="cyan"),
        default=False,
    ):
        click.secho("  Run: ", fg="bright_black", nl=False)
        click.secho("mlflow agent playground", fg="green", bold=True)
        _hint("(starts a local MLflow server and opens the playground UI)")
    else:
        click.secho("  When you're ready, run: ", fg="bright_black", nl=False)
        click.secho("mlflow agent playground", fg="green", bold=True)
