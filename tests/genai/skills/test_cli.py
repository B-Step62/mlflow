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
