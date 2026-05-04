"""Interactive setup wizard for the MLflow Agent Playground."""

import shutil
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


@dataclass(frozen=True)
class CodingAgent:
    binary: str
    display_name: str
    worker_kind: str
    install_url: str


SUPPORTED_CODING_AGENTS: tuple[CodingAgent, ...] = (
    CodingAgent("claude", "Claude Code", "claude-code", "https://claude.ai/code"),
    CodingAgent("codex", "OpenAI Codex CLI", "codex", "https://github.com/openai/codex"),
    CodingAgent("gemini", "Gemini CLI", "gemini", "https://github.com/google-gemini/gemini-cli"),
    CodingAgent("opencode", "opencode", "opencode", "https://opencode.ai"),
)

# The only worker kind with a working implementation today. Other detected agents
# can be selected, but instrumentation/skill install is currently a no-op for them.
FUNCTIONAL_WORKER_KINDS = frozenset({"claude-code"})


def detect_installed_agents() -> list[CodingAgent]:
    """Return the subset of SUPPORTED_CODING_AGENTS whose binaries are on PATH."""
    return [agent for agent in SUPPORTED_CODING_AGENTS if shutil.which(agent.binary)]


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


def _default_tracking_uri(repo_dir: Path | None = None) -> str:
    """Return a sqlite tracking URI at the launch directory's ``mlflow.db``.

    Matches the conventional layout that ``mlflow server`` / ``mlflow ui``
    already use, so two different agent projects get two different stores
    (one ``mlflow.db`` per repo) instead of merging into a global DB under
    ``$HOME``. Falls back to ``Path.cwd()`` when no repo dir is supplied.
    """
    base = (repo_dir if repo_dir is not None else Path.cwd()).resolve()
    return f"sqlite:///{base / 'mlflow.db'}"


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
    _banner("MLflow Agent Playground · Setup")
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

    base = existing or PlaygroundUserConfig()

    selected_agent = _select_coding_agent(base.worker.kind, non_interactive=non_interactive)

    config = base if non_interactive else _prompt_for_values(base)
    config.worker.kind = selected_agent.worker_kind
    if repo_dir is not None:
        config.playground.repo_dir = str(repo_dir.resolve())

    if selected_agent.worker_kind == "claude-code":
        _install_mlflow_skills_step()

    _run_tracing_step(config, repo_dir, non_interactive=non_interactive)

    save_user_config(config, config_path)
    _show_summary(config, config_path, was_existing=existing is not None)

    if not non_interactive:
        _maybe_start_playground()

    return config


def _select_coding_agent(current_kind: str, *, non_interactive: bool) -> CodingAgent:
    """Detect installed coding agents and pick one as the playground worker.

    - 0 detected: warn and fall back to Claude Code (still the only functional worker).
    - 1 detected: use it without prompting.
    - 2+ detected: in interactive mode, prompt the user; in non-interactive mode,
      keep the existing `worker.kind` if it matches a detected agent, otherwise
      default to the first detected agent.
    """
    _section("Detect coding agent")
    detected = detect_installed_agents()

    if not detected:
        _warn("No supported coding agent found on PATH.")
        for agent in SUPPORTED_CODING_AGENTS:
            _hint(f"· {agent.display_name}: {agent.install_url}")
        fallback = SUPPORTED_CODING_AGENTS[0]
        _info(f"Defaulting to {fallback.display_name}; install it before running the playground.")
        return fallback

    for agent in detected:
        _success(f"Found {agent.display_name} ({agent.binary}) on PATH")

    if len(detected) == 1:
        only = detected[0]
        _info(f"Using {only.display_name} as the playground worker.")
        if only.worker_kind not in FUNCTIONAL_WORKER_KINDS:
            _warn(f"{only.display_name} support is not implemented yet; only Claude Code works.")
        return only

    current = next((a for a in detected if a.worker_kind == current_kind), None)
    default_agent = current or detected[0]

    if non_interactive:
        _info(f"Using {default_agent.display_name} (non-interactive default).")
        return default_agent

    click.echo("")
    click.secho("  Multiple coding agents detected. Pick one as the primary worker:", fg="cyan")
    for idx, agent in enumerate(detected, start=1):
        suffix = "" if agent.worker_kind in FUNCTIONAL_WORKER_KINDS else "  (preview)"
        click.echo(f"    {idx}) {agent.display_name}{suffix}")
    default_idx = detected.index(default_agent) + 1
    choice = click.prompt(
        click.style(f"  Choice [1-{len(detected)}]", fg="cyan"),
        type=click.IntRange(1, len(detected)),
        default=default_idx,
    )
    chosen = detected[choice - 1]
    if chosen.worker_kind not in FUNCTIONAL_WORKER_KINDS:
        _warn(f"{chosen.display_name} support is not implemented yet; only Claude Code works.")
    return chosen


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
    autolog / `@mlflow.trace` calls into the agent code. Only Claude Code
    can drive instrumentation today; other workers skip this step.
    """
    can_instrument = config.worker.kind == "claude-code"

    if non_interactive:
        if config.playground.enable_tracing and repo_dir is not None and can_instrument:
            _section("Tracing")
            _instrument(repo_dir)
        return

    _section("Tracing")
    if not can_instrument:
        _warn("Auto-instrumentation requires Claude Code; skipping for the selected worker.")
        return

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
    experiment = click.prompt(
        click.style("  Experiment name", fg="cyan"),
        default=base.mlflow.experiment,
    )

    return PlaygroundUserConfig(
        schema_version=SCHEMA_VERSION,
        mlflow=MLflowConfig(
            tracking_uri="",
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
    _kv("tracking_uri", config.mlflow.tracking_uri or "(repo-local sqlite, derived at launch)")
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
