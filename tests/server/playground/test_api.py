import subprocess

import pytest
from fastapi.testclient import TestClient

from mlflow.server.assistant.api import _require_localhost
from mlflow.server.playground.api import playground_router

SKILL_MANIFEST = "SKILL.md"


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi import FastAPI

    monkeypatch.setattr(
        "mlflow.server.playground.session.SESSION_DIR", tmp_path / "sessions"
    )
    monkeypatch.setattr(
        "mlflow.server.playground.session.WORKSPACE_DIR", tmp_path / "workspaces"
    )

    app = FastAPI()
    app.include_router(playground_router)
    app.dependency_overrides[_require_localhost] = lambda: None
    return TestClient(app)


@pytest.fixture
def git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"], cwd=repo, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"], cwd=repo, capture_output=True
    )

    skills_dir = repo / ".claude" / "skills"
    alpha = skills_dir / "alpha"
    alpha.mkdir(parents=True)
    (alpha / SKILL_MANIFEST).write_text("# Alpha")

    subprocess.run(["git", "add", "."], cwd=repo, capture_output=True, check=True)
    subprocess.run(
        ["git", "commit", "-m", "init"], cwd=repo, capture_output=True, check=True
    )
    return repo


class TestSessionEndpoints:
    def test_create_session(self, client):
        resp = client.post(
            "/ajax-api/3.0/mlflow/playground/sessions",
            json={"experiment_id": "0"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["experiment_id"] == "0"
        assert "session_id" in data
        assert data["config_a"]["panel_id"] == "a"
        assert data["config_b"]["panel_id"] == "b"

    def test_get_session(self, client):
        create_resp = client.post(
            "/ajax-api/3.0/mlflow/playground/sessions",
            json={"experiment_id": "1"},
        )
        session_id = create_resp.json()["session_id"]

        resp = client.get(f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["session_id"] == session_id

    def test_get_nonexistent_session(self, client):
        import uuid

        fake = str(uuid.uuid4())
        resp = client.get(f"/ajax-api/3.0/mlflow/playground/sessions/{fake}")
        assert resp.status_code == 404

    def test_delete_session(self, client):
        create_resp = client.post(
            "/ajax-api/3.0/mlflow/playground/sessions",
            json={"experiment_id": "2"},
        )
        session_id = create_resp.json()["session_id"]

        resp = client.delete(f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"

        resp = client.get(f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}")
        assert resp.status_code == 404

    def test_delete_nonexistent_session(self, client):
        import uuid

        fake = str(uuid.uuid4())
        resp = client.delete(f"/ajax-api/3.0/mlflow/playground/sessions/{fake}")
        assert resp.status_code == 404


class TestUpdatePanelConfig:
    def test_update_model(self, client):
        create_resp = client.post(
            "/ajax-api/3.0/mlflow/playground/sessions",
            json={"experiment_id": "0"},
        )
        session_id = create_resp.json()["session_id"]

        resp = client.put(
            f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}/panels/a/config",
            json={"model": "opus"},
        )
        assert resp.status_code == 200
        assert resp.json()["config_a"]["model"] == "opus"
        # config_b should be unchanged
        assert resp.json()["config_b"]["model"] == "sonnet"

    def test_update_with_skills_checkout(self, client, git_repo):
        create_resp = client.post(
            "/ajax-api/3.0/mlflow/playground/sessions",
            json={"experiment_id": "0"},
        )
        session_id = create_resp.json()["session_id"]

        resp = client.put(
            f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}/panels/b/config",
            json={
                "skills": [
                    {
                        "name": "alpha",
                        "repo": str(git_repo),
                        "commit_id": "working-tree",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["config_b"]["skills"]) == 1
        assert resp.json()["config_b"]["skills"][0]["name"] == "alpha"

    def test_update_nonexistent_session(self, client):
        import uuid

        fake = str(uuid.uuid4())
        resp = client.put(
            f"/ajax-api/3.0/mlflow/playground/sessions/{fake}/panels/a/config",
            json={"model": "haiku"},
        )
        assert resp.status_code == 404


class TestSkillEndpoints:
    def test_list_skills(self, client, git_repo):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/list",
            params={"repo": str(git_repo), "ref": "working-tree"},
        )
        assert resp.status_code == 200
        skills = resp.json()["skills"]
        assert len(skills) == 1
        assert skills[0]["name"] == "alpha"

    def test_list_skills_at_commit(self, client, git_repo):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/list",
            params={"repo": str(git_repo), "ref": "HEAD"},
        )
        assert resp.status_code == 200
        assert len(resp.json()["skills"]) == 1

    def test_list_commits(self, client, git_repo):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/commits",
            params={"repo": str(git_repo)},
        )
        assert resp.status_code == 200
        commits = resp.json()["commits"]
        assert len(commits) == 1
        assert commits[0]["message"] == "init"

    def test_list_commits_with_count(self, client, git_repo):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/commits",
            params={"repo": str(git_repo), "count": 5},
        )
        assert resp.status_code == 200
        assert len(resp.json()["commits"]) == 1

    def test_list_skills_invalid_ref(self, client, git_repo):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/list",
            params={"repo": str(git_repo), "ref": "nonexistent"},
        )
        assert resp.status_code == 400

    def test_list_skills_remote_url_working_tree_rejected(self, client):
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/list",
            params={
                "repo": "https://github.com/mlflow/skills",
                "ref": "working-tree",
            },
        )
        assert resp.status_code == 400
        assert "working-tree" in resp.json()["detail"]

    def test_list_commits_remote_url(self, client, git_repo, monkeypatch):
        # Use monkeypatch to make resolve_repo return the local git_repo
        # when given a remote URL
        monkeypatch.setattr(
            "mlflow.server.playground.api.resolve_repo",
            lambda repo: git_repo,
        )
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/commits",
            params={"repo": "https://github.com/mlflow/skills"},
        )
        assert resp.status_code == 200
        commits = resp.json()["commits"]
        assert len(commits) == 1
        assert commits[0]["message"] == "init"

    def test_list_skills_remote_url_at_commit(self, client, git_repo, monkeypatch):
        monkeypatch.setattr(
            "mlflow.server.playground.api.resolve_repo",
            lambda repo: git_repo,
        )
        resp = client.get(
            "/ajax-api/3.0/mlflow/playground/skills/list",
            params={
                "repo": "https://github.com/mlflow/skills",
                "ref": "HEAD",
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["skills"]) == 1
