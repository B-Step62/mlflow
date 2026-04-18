"""Tests for SKILL.md parsing and metadata read/write."""

import pytest

from mlflow.genai.skills.skill_parser import (
    parse_skill_manifest,
    read_skill_metadata,
    update_skill_metadata,
)


@pytest.fixture
def skill_md(tmp_path):
    """Create a basic SKILL.md file."""
    path = tmp_path / "SKILL.md"
    path.write_text(
        "---\n"
        "name: test-skill\n"
        "description: A test skill\n"
        "---\n"
        "\n"
        "# Test Skill\n"
        "\n"
        "Instructions go here.\n",
        encoding="utf-8",
    )
    return path


@pytest.fixture
def skill_md_with_metadata(tmp_path):
    """Create a SKILL.md with existing metadata."""
    path = tmp_path / "SKILL.md"
    path.write_text(
        "---\n"
        "name: test-skill\n"
        "description: A test skill\n"
        "metadata:\n"
        "    github-repo: https://github.com/example/repo\n"
        "    github-ref: refs/heads/main\n"
        "---\n"
        "\n"
        "# Test Skill\n",
        encoding="utf-8",
    )
    return path


class TestParseSkillManifest:
    def test_basic(self, skill_md):
        result = parse_skill_manifest(skill_md)
        assert result["name"] == "test-skill"
        assert result["description"] == "A test skill"
        assert "content" in result
        assert "metadata" in result

    def test_with_metadata(self, skill_md_with_metadata):
        result = parse_skill_manifest(skill_md_with_metadata)
        assert result["name"] == "test-skill"
        assert result["metadata"]["github-repo"] == "https://github.com/example/repo"

    def test_no_frontmatter_raises(self, tmp_path):
        path = tmp_path / "SKILL.md"
        path.write_text("# Just markdown\n", encoding="utf-8")
        with pytest.raises(Exception, match="YAML front matter"):
            parse_skill_manifest(path)

    def test_no_name_raises(self, tmp_path):
        path = tmp_path / "SKILL.md"
        path.write_text("---\ndescription: no name\n---\n", encoding="utf-8")
        with pytest.raises(Exception, match="name"):
            parse_skill_manifest(path)


class TestReadSkillMetadata:
    def test_reads_metadata(self, skill_md_with_metadata):
        metadata = read_skill_metadata(skill_md_with_metadata)
        assert metadata["github-repo"] == "https://github.com/example/repo"

    def test_no_metadata_returns_empty(self, skill_md):
        metadata = read_skill_metadata(skill_md)
        assert metadata == {}

    def test_nonexistent_file_returns_empty(self, tmp_path):
        metadata = read_skill_metadata(tmp_path / "nonexistent.md")
        assert metadata == {}


class TestUpdateSkillMetadata:
    def test_adds_metadata_to_file_without_metadata(self, skill_md):
        update_skill_metadata(skill_md, {"mlflow-version": "1", "mlflow-source": "test"})

        metadata = read_skill_metadata(skill_md)
        assert metadata["mlflow-version"] == "1"
        assert metadata["mlflow-source"] == "test"

        # Verify body is preserved
        content = skill_md.read_text(encoding="utf-8")
        assert "# Test Skill" in content
        assert "Instructions go here." in content

    def test_merges_with_existing_metadata(self, skill_md_with_metadata):
        update_skill_metadata(skill_md_with_metadata, {"mlflow-version": "2"})

        metadata = read_skill_metadata(skill_md_with_metadata)
        # New key added
        assert metadata["mlflow-version"] == "2"
        # Existing keys preserved
        assert metadata["github-repo"] == "https://github.com/example/repo"
        assert metadata["github-ref"] == "refs/heads/main"

    def test_overwrites_existing_key(self, skill_md_with_metadata):
        update_skill_metadata(skill_md_with_metadata, {"github-ref": "refs/tags/v1.0"})

        metadata = read_skill_metadata(skill_md_with_metadata)
        assert metadata["github-ref"] == "refs/tags/v1.0"

    def test_preserves_name_and_description(self, skill_md):
        update_skill_metadata(skill_md, {"mlflow-version": "1"})

        result = parse_skill_manifest(skill_md)
        assert result["name"] == "test-skill"
        assert result["description"] == "A test skill"

    def test_preserves_markdown_body(self, skill_md):
        update_skill_metadata(skill_md, {"key": "value"})

        content = skill_md.read_text(encoding="utf-8")
        assert "# Test Skill" in content
        assert "Instructions go here." in content
