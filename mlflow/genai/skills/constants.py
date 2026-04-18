import re
from pathlib import Path

SKILL_NAME_RULE = re.compile(r"^[a-zA-Z0-9_.-]+$")

# Canonical skill storage — single source of truth for installed skills.
# Both global and project-scoped symlink installs store real files here.
CANONICAL_SKILLS_DIR = Path.home() / ".agents" / "skills"

# Agent runtime → skill directory relative paths (from home or project root).
AGENT_SKILL_DIRS: dict[str, dict[str, str]] = {
    "claude-code": {
        "global": ".claude/skills",
        "project": ".claude/skills",
    },
    "cursor": {
        "global": ".cursor/skills",
        "project": ".cursor/skills",
    },
    "copilot": {
        "global": ".github/skills",
        "project": ".github/skills",
    },
    "gemini": {
        "global": ".gemini/skills",
        "project": ".gemini/skills",
    },
    "codex": {
        "global": ".codex/skills",
        "project": ".codex/skills",
    },
}

SUPPORTED_AGENTS = list(AGENT_SKILL_DIRS.keys())
DEFAULT_AGENT = "claude-code"
