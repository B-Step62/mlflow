"""CLI commands for MLflow Skill Registry."""

import json
import os
import sys
from pathlib import Path

import click

from mlflow.genai.skills.constants import DEFAULT_AGENT, SUPPORTED_AGENTS
from mlflow.genai.skills.skill_parser import is_github_url

# ── Interactive checkbox selector ────────────────────────────────────────────
#
# Modeled after gh CLI's Survey library approach:
#   - Relative cursor movement only (move up N lines, never absolute)
#   - Erase-and-rewrite on each render
#   - First render prints fresh; subsequent renders move up first
#   - Raw mode so Ctrl+C arrives as byte 0x03
#   - try/finally guarantees terminal state restoration
#   - select.select() with timeout for escape sequence disambiguation

# ANSI escape sequences
_ERASE_LINE = "\x1b[2K"
_CURSOR_UP = "\x1b[A"
_HIDE_CURSOR = "\x1b[?25l"
_SHOW_CURSOR = "\x1b[?25h"
_CR = "\r"

# Colors
_GREEN = "\x1b[32m"
_CYAN = "\x1b[36m"
_DIM = "\x1b[2m"
_RESET = "\x1b[0m"


def _read_key(fd: int) -> str:
    """Read a single keypress from raw-mode fd. Handles arrow escape sequences."""
    import select

    ch = os.read(fd, 1)
    if ch == b"\x1b":
        # Check if more bytes are available (escape sequence) with 50ms timeout.
        # If nothing follows, it was just the ESC key.
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            seq = os.read(fd, 2)
            match seq:
                case b"[A":
                    return "up"
                case b"[B":
                    return "down"
                case b"[C":
                    return "right"
                case b"[D":
                    return "left"
        return "escape"
    if ch == b" ":
        return "space"
    if ch in (b"\r", b"\n"):
        return "enter"
    if ch == b"\x03":
        return "ctrl-c"
    return ""


def _write(text: str) -> None:
    """Write to stdout and flush. In raw mode, \n alone won't CR — we handle that."""
    sys.stdout.write(text)
    sys.stdout.flush()


def _interactive_checkbox(
    items: list[dict[str, str | None]],
    prompt: str = "Select skill(s) to install",
) -> list[str] | None:
    """Interactive multi-select checkbox.

    Returns list of selected skill names, or None if aborted (Ctrl+C).
    Falls back to selecting all items if the terminal is not interactive.
    """
    # Non-interactive fallback
    if not sys.stdin.isatty():
        return [item["name"] for item in items]

    try:
        import termios
        import tty
    except ImportError:
        # Windows — no termios, fall back to all
        return [item["name"] for item in items]

    # Build display labels: each skill + "(all skills)" sentinel at the end
    labels: list[str] = []
    for item in items:
        name = item["name"]
        desc = item.get("description") or ""
        if desc and len(desc) > 40:
            desc = desc[:37] + "..."
        labels.append(f"{name} - {desc}" if desc else name)
    labels.append("(all skills)")

    total = len(labels)
    selected = [False] * total
    cursor = 0
    lines_printed = 0

    def render():
        nonlocal lines_printed
        out: list[str] = []

        # Move up to overwrite previous render (skip on first render)
        if lines_printed > 0:
            out.append(f"\x1b[{lines_printed}A")

        # Header line
        out.append(
            f"{_CR}{_ERASE_LINE}"
            f"{_GREEN}?{_RESET} {prompt}:  "
            f"{_DIM}[arrows move, space select, "
            f"\u2192 all, \u2190 none]{_RESET}\r\n"
        )

        # Item lines
        for i, label in enumerate(labels):
            check = f"{_CYAN}x{_RESET}" if selected[i] else " "
            pointer = f"{_CYAN}>{_RESET}" if i == cursor else " "
            out.append(f"{_CR}{_ERASE_LINE}  {pointer} [{check}]  {label}\r\n")

        _write("".join(out))
        lines_printed = total + 1  # header + items

    def cleanup(summary: str | None):
        """Replace the checkbox UI with a single summary line."""
        if lines_printed > 0:
            _write(f"\x1b[{lines_printed}A")
        for _ in range(lines_printed):
            _write(f"{_CR}{_ERASE_LINE}\r\n")
        if lines_printed > 0:
            _write(f"\x1b[{lines_printed}A")
        if summary:
            _write(f"{_CR}{_GREEN}\u2713{_RESET} {summary}\r\n")

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)

    try:
        tty.setraw(fd)
        _write(_HIDE_CURSOR)

        while True:
            render()
            key = _read_key(fd)

            match key:
                case "up":
                    cursor = (cursor - 1) % total
                case "down":
                    cursor = (cursor + 1) % total
                case "space":
                    if cursor == total - 1:
                        # Toggle "all skills"
                        new_state = not selected[-1]
                        selected = [new_state] * total
                    else:
                        selected[cursor] = not selected[cursor]
                        selected[-1] = all(selected[:-1])
                case "right":
                    selected = [True] * total
                case "left":
                    selected = [False] * total
                case "enter":
                    result = [items[i]["name"] for i in range(len(items)) if selected[i]]
                    if result:
                        cleanup(f"Selected {len(result)} skills: {', '.join(result)}")
                    else:
                        cleanup(None)
                    return result
                case "ctrl-c":
                    cleanup("Aborted.")
                    return None
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        _write(_SHOW_CURSOR)


def _parse_skill_ref(ref: str) -> tuple[str, int | None, str | None]:
    """Parse a skill reference: ``name``, ``name/version``, or ``name@alias``."""
    if "/" in ref:
        match ref.rsplit("/", 1):
            case [name, ver] if ver.isdigit():
                return name, int(ver), None
            case _:
                raise click.BadParameter(
                    f"Invalid skill reference '{ref}'. Version must be an integer (e.g. my-skill/3)."
                )
    if "@" in ref:
        match ref.rsplit("@", 1):
            case [name, alias] if alias:
                return name, None, alias
            case _:
                raise click.BadParameter(
                    f"Invalid skill reference '{ref}'. Expected format: name@alias."
                )
    return ref, None, None


def _is_github_shorthand(source: str) -> bool:
    """Check if source looks like owner/repo (GitHub shorthand, not name/version).

    owner/repo: both parts are non-numeric strings (e.g. "anthropics/skills")
    name/version: second part is all digits (e.g. "pr-review/3")
    """
    if "/" not in source or source.startswith((".", "/", "~")) or "://" in source:
        return False
    parts = source.split("/", 1)
    # name/version: second part is a digit → registry reference, not GitHub
    if parts[1].isdigit():
        return False
    # Must look like owner/repo — both parts are non-empty, no special chars
    return len(parts) == 2 and all(p and not p.startswith("-") for p in parts)


def _resolve_install_source(source: str) -> dict:
    """Classify a source argument as GitHub URL/shorthand, local path, or registry ref."""
    # Full GitHub URL
    if is_github_url(source):
        return {"type": "source", "source": source}

    # GitHub shorthand: owner/repo
    if _is_github_shorthand(source):
        return {"type": "source", "source": f"https://github.com/{source}"}

    # Local path that exists on disk
    if Path(source).expanduser().resolve().exists():
        return {"type": "source", "source": source}

    # Registry reference (name, name/3, name@alias)
    name, version, alias = _parse_skill_ref(source)
    return {"type": "registry", "name": name, "version": version, "alias": alias}


def _ensure_tracking_uri() -> None:
    """Prompt for MLflow Tracking URI if not configured for a remote server."""
    import mlflow

    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "") or mlflow.get_tracking_uri()
    if not tracking_uri.startswith(("http://", "https://")):
        uri = click.prompt(
            "MLflow Tracking URI",
            default="http://localhost:5000",
        )
        mlflow.set_tracking_uri(uri)


@click.group("skills")
def commands():
    """Manage skills in the MLflow Skill Registry."""


@commands.command("install")
@click.argument("sources", nargs=-1, required=True)
@click.option(
    "--scope",
    type=click.Choice(["global", "project"]),
    default="global",
    help="Installation scope.",
)
@click.option("--project-path", type=click.Path(), default=None, help="Project directory.")
@click.option(
    "--agent",
    type=click.Choice(SUPPORTED_AGENTS),
    default=DEFAULT_AGENT,
    help="Target agent runtime.",
)
@click.option("--pin", default=None, help="Pin to a git ref — branch, tag, or SHA (GitHub only).")
@click.option("--no-register", is_flag=True, help="Skip MLflow registry registration.")
@click.option("--copy", is_flag=True, help="Copy files directly instead of symlinking (project scope only).")
@click.option("--force", "-f", is_flag=True, help="Overwrite existing skills without prompting.")
@click.option("--tag", "-t", multiple=True, help="Tag in key=value format (for registration).")
def install_cmd(sources, scope, project_path, agent, pin, no_register, copy, force, tag):
    """Install skills from GitHub, local directories, or the MLflow registry.

    \b
    Skills are stored in ~/.agents/skills/ (canonical) and symlinked into
    the agent's skill directory. Use --copy with --scope project to copy
    files directly instead.

    \b
    Each SOURCE can be:
      GitHub URL          install from repository
      owner/repo          GitHub shorthand
      local path          install from directory
      name                install latest version from registry
      name/3              install version 3 from registry
      name@alias          install alias from registry

    \b
    Examples:
      mlflow skills install anthropics/skills
      mlflow skills install https://github.com/my-org/agent-skills
      mlflow skills install ./my-skills/pr-review
      mlflow skills install pr-review/3
      mlflow skills install pr-review@champion
      mlflow skills install anthropics/skills --scope project --copy
    """
    from mlflow.genai.skills import install_skill_from_registry, install_skill_from_source

    tags = {}
    for t in tag:
        if "=" not in t:
            raise click.BadParameter(f"Tag must be in key=value format: {t}")
        k, v = t.split("=", 1)
        tags[k] = v

    pp = Path(project_path) if project_path else None

    for source in sources:
        resolved = _resolve_install_source(source)
        if resolved["type"] == "source":
            _install_from_source(
                resolved["source"], agent, scope, pp, pin, no_register, copy, force, tags or None
            )
        else:
            dest = install_skill_from_registry(
                name=resolved["name"],
                version=resolved["version"],
                alias=resolved["alias"],
                agent=agent,
                scope=scope,
                project_path=pp,
                copy=copy,
            )
            click.echo(f"Installed {resolved['name']} → {dest}")


def _install_from_source(source, agent, scope, project_path, pin, no_register, copy, force, tags):
    """Handle installation from a GitHub URL or local directory."""
    from mlflow.genai.skills import install_skill_from_source, preview_skills

    # Preview skills in the source
    previews = preview_skills(source)
    if not previews:
        click.echo("No skills found in source.")
        return

    # Select skills to install
    if len(previews) == 1:
        selected = [previews[0]["name"]]
        click.echo(f"Found skill: {previews[0]['name']}")
    elif sys.stdin.isatty():
        # Interactive terminal — show checkbox selector
        selected = _interactive_checkbox(previews)
        if selected is None:
            click.echo("Aborted.")
            return
        if not selected:
            click.echo("No skills selected.")
            return
    else:
        # Non-interactive (piped/CI) — install all
        selected = [p["name"] for p in previews]

    # Register by default unless --no-register
    should_register = not no_register
    if should_register:
        _ensure_tracking_uri()

    paths = install_skill_from_source(
        source=source,
        agent=agent,
        scope=scope,
        project_path=project_path,
        pin=pin,
        skill_names=selected,
        register=should_register,
        tags=tags,
        copy=copy,
    )

    for path in paths:
        name = path.name
        if should_register:
            click.echo(f"Installed and registered: {name} → {path}")
        else:
            click.echo(f"Installed: {name} → {path}")


@commands.command("register")
@click.argument("source")
@click.option("--tag", "-t", multiple=True, help="Tag in key=value format.")
def register_cmd(source, tag):
    """Register skill(s) from a GitHub URL or local directory."""
    from mlflow.genai.skills import register_skill

    tags = {}
    for t in tag:
        if "=" not in t:
            raise click.BadParameter(f"Tag must be in key=value format: {t}")
        k, v = t.split("=", 1)
        tags[k] = v

    versions = register_skill(source=source, tags=tags or None)
    for sv in versions:
        click.echo(f"Registered: {sv.name} v{sv.version}")


@commands.command("list")
@click.option("--filter", "filter_string", default=None, help="Filter by name substring.")
@click.option("--max-results", default=100, type=int)
def list_cmd(filter_string, max_results):
    """List registered skills."""
    from mlflow.genai.skills import search_skills

    skills = search_skills(filter_string=filter_string, max_results=max_results)
    if not skills:
        click.echo("No skills registered.")
        return
    for s in skills:
        version_info = f" (latest: v{s.latest_version})" if s.latest_version else ""
        click.echo(f"  {s.name}{version_info} — {s.description or '(no description)'}")


@commands.command("show")
@click.argument("ref")
def show_cmd(ref):
    """Show details of a skill or skill version.

    \b
    REF can be:
      name          show latest version
      name/3        show version 3
      name@alias    show the version pointed to by alias
    """
    from mlflow.genai.skills import load_skill

    name, version, alias = _parse_skill_ref(ref)
    sv = load_skill(name, version=version, alias=alias)
    click.echo(f"Name: {sv.name}")
    click.echo(f"Version: {sv.version}")
    click.echo(f"Source: {sv.source or '(none)'}")
    click.echo(f"Description: {sv.description or '(none)'}")
    if sv.tags:
        click.echo(f"Tags: {json.dumps(sv.tags)}")
    if sv.aliases:
        click.echo(f"Aliases: {', '.join(sv.aliases)}")
