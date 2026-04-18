"""Tests for mlflow skills CLI — source resolution, ref parsing, and GitHub shorthand."""

import pytest

from mlflow.genai.skills.cli import (
    _is_github_shorthand,
    _parse_skill_ref,
    _resolve_install_source,
)


# ── _parse_skill_ref ──────────────────────────────────────────────────────


class TestParseSkillRef:
    def test_bare_name(self):
        assert _parse_skill_ref("pr-review") == ("pr-review", None, None)

    def test_name_with_version(self):
        assert _parse_skill_ref("pr-review/3") == ("pr-review", 3, None)

    def test_name_with_alias(self):
        assert _parse_skill_ref("pr-review@champion") == ("pr-review", None, "champion")

    def test_name_with_dots_and_underscores(self):
        assert _parse_skill_ref("my.skill_v2") == ("my.skill_v2", None, None)

    def test_version_zero(self):
        assert _parse_skill_ref("skill/0") == ("skill", 0, None)

    def test_non_digit_version_raises(self):
        with pytest.raises(Exception):
            _parse_skill_ref("skill/abc")

    def test_empty_alias_raises(self):
        with pytest.raises(Exception):
            _parse_skill_ref("skill@")


# ── _is_github_shorthand ─────────────────────────────────────────────────


class TestIsGithubShorthand:
    @pytest.mark.parametrize(
        "source",
        [
            "anthropics/skills",
            "my-org/agent-skills",
            "vercel-labs/agent-skills",
            "user123/repo",
        ],
    )
    def test_github_shorthand(self, source):
        assert _is_github_shorthand(source) is True

    @pytest.mark.parametrize(
        "source",
        [
            "pr-review/3",           # version (digit) — registry ref
            "pr-review/10",          # multi-digit version
            "./local/path",          # relative path
            "/absolute/path",        # absolute path
            "~/home/path",           # home path
            "pr-review",             # bare name
            "pr-review@champion",    # alias
            "https://github.com/a/b",  # full URL
        ],
    )
    def test_not_github_shorthand(self, source):
        assert _is_github_shorthand(source) is False


# ── _resolve_install_source ───────────────────────────────────────────────


class TestResolveInstallSource:
    def test_full_github_url(self):
        result = _resolve_install_source("https://github.com/anthropics/skills")
        assert result == {"type": "source", "source": "https://github.com/anthropics/skills"}

    def test_github_shorthand(self):
        result = _resolve_install_source("anthropics/skills")
        assert result == {"type": "source", "source": "https://github.com/anthropics/skills"}

    def test_github_shorthand_with_hyphens(self):
        result = _resolve_install_source("my-org/agent-skills")
        assert result == {"type": "source", "source": "https://github.com/my-org/agent-skills"}

    def test_registry_bare_name(self):
        result = _resolve_install_source("pr-review")
        assert result == {"type": "registry", "name": "pr-review", "version": None, "alias": None}

    def test_registry_with_version(self):
        result = _resolve_install_source("pr-review/3")
        assert result == {"type": "registry", "name": "pr-review", "version": 3, "alias": None}

    def test_registry_with_alias(self):
        result = _resolve_install_source("pr-review@champion")
        assert result == {
            "type": "registry",
            "name": "pr-review",
            "version": None,
            "alias": "champion",
        }

    def test_local_path(self, tmp_path):
        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        result = _resolve_install_source(str(skill_dir))
        assert result["type"] == "source"
        assert result["source"] == str(skill_dir)


# ── Install modes (symlink / copy) ───────────────────────────────────────


class TestInstallSkillFiles:
    """Test the three installation modes: global symlink, project symlink, project copy."""

    @pytest.fixture
    def skill_src(self, tmp_path):
        """Create a minimal skill source directory."""
        src = tmp_path / "src" / "my-skill"
        src.mkdir(parents=True)
        (src / "SKILL.md").write_text(
            "---\nname: my-skill\ndescription: test\n---\n\n# My Skill\n",
            encoding="utf-8",
        )
        (src / "scripts").mkdir()
        (src / "scripts" / "run.sh").write_text("#!/bin/bash\necho hi\n", encoding="utf-8")
        return src

    def test_global_creates_canonical_and_symlink(self, skill_src, tmp_path, monkeypatch):
        from mlflow.genai.skills import _install_skill_files
        from mlflow.genai.skills import constants

        # Override canonical dir and agent dir to use tmp_path
        canonical_base = tmp_path / "canonical"
        agent_home = tmp_path / "home"
        monkeypatch.setattr(constants, "CANONICAL_SKILLS_DIR", canonical_base)
        monkeypatch.setattr(
            constants,
            "AGENT_SKILL_DIRS",
            {"claude-code": {"global": ".claude/skills", "project": ".claude/skills"}},
        )
        monkeypatch.setattr("pathlib.Path.home", lambda: agent_home)

        result = _install_skill_files("my-skill", skill_src, "claude-code", "global")

        # Canonical dir has real files
        assert (canonical_base / "my-skill" / "SKILL.md").is_file()
        assert (canonical_base / "my-skill" / "scripts" / "run.sh").is_file()

        # Agent dir is a symlink
        agent_skill = agent_home / ".claude" / "skills" / "my-skill"
        assert agent_skill.is_symlink()
        assert agent_skill.resolve() == (canonical_base / "my-skill").resolve()

        # Reading through the symlink works
        assert (agent_skill / "SKILL.md").read_text(encoding="utf-8").startswith("---")

    def test_project_symlink_creates_canonical_and_symlink(self, skill_src, tmp_path, monkeypatch):
        from mlflow.genai.skills import _install_skill_files
        from mlflow.genai.skills import constants

        canonical_base = tmp_path / "canonical"
        project = tmp_path / "project"
        project.mkdir()
        monkeypatch.setattr(constants, "CANONICAL_SKILLS_DIR", canonical_base)

        result = _install_skill_files(
            "my-skill", skill_src, "claude-code", "project", project_path=project
        )

        # Canonical has real files
        assert (canonical_base / "my-skill" / "SKILL.md").is_file()

        # Project agent dir is a symlink
        agent_skill = project / ".claude" / "skills" / "my-skill"
        assert agent_skill.is_symlink()

    def test_project_copy_creates_direct_copy(self, skill_src, tmp_path):
        from mlflow.genai.skills import _install_skill_files

        project = tmp_path / "project"
        project.mkdir()

        result = _install_skill_files(
            "my-skill", skill_src, "claude-code", "project", project_path=project, copy=True
        )

        # Agent dir has real files (not a symlink)
        agent_skill = project / ".claude" / "skills" / "my-skill"
        assert agent_skill.is_dir()
        assert not agent_skill.is_symlink()
        assert (agent_skill / "SKILL.md").is_file()
        assert (agent_skill / "scripts" / "run.sh").is_file()

    def test_reinstall_replaces_symlink(self, skill_src, tmp_path, monkeypatch):
        from mlflow.genai.skills import _install_skill_files
        from mlflow.genai.skills import constants

        canonical_base = tmp_path / "canonical"
        agent_home = tmp_path / "home"
        monkeypatch.setattr(constants, "CANONICAL_SKILLS_DIR", canonical_base)
        monkeypatch.setattr("pathlib.Path.home", lambda: agent_home)

        # Install twice — second should cleanly replace
        _install_skill_files("my-skill", skill_src, "claude-code", "global")
        _install_skill_files("my-skill", skill_src, "claude-code", "global")

        agent_skill = agent_home / ".claude" / "skills" / "my-skill"
        assert agent_skill.is_symlink()
        assert (agent_skill / "SKILL.md").is_file()
