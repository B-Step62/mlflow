import re
from pathlib import Path

SKILL_NAME_RULE = re.compile(r"^[a-zA-Z0-9_.-]+$")

# Agent runtime → skill installation directories.
# Each entry maps scope to a path (or a callable that takes project_path).
AGENT_SKILL_DIRS: dict[str, dict[str, Path | str]] = {
    "claude-code": {
        "global": Path.home() / ".claude" / "skills",
        "project": ".claude/skills",
    },
    "cursor": {
        "global": Path.home() / ".cursor" / "skills",
        "project": ".cursor/skills",
    },
    "copilot": {
        "global": Path.home() / ".github" / "skills",
        "project": ".github/skills",
    },
    "gemini": {
        "global": Path.home() / ".gemini" / "skills",
        "project": ".gemini/skills",
    },
    "codex": {
        "global": Path.home() / ".codex" / "skills",
        "project": ".codex/skills",
    },
}

SUPPORTED_AGENTS = list(AGENT_SKILL_DIRS.keys())
DEFAULT_AGENT = "claude-code"
