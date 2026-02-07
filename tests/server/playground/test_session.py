import uuid

import pytest

from mlflow.server.playground.session import PlaygroundSessionManager


@pytest.fixture(autouse=True)
def _clean_sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "mlflow.server.playground.session.SESSION_DIR", tmp_path / "sessions"
    )
    monkeypatch.setattr(
        "mlflow.server.playground.session.WORKSPACE_DIR", tmp_path / "workspaces"
    )


class TestValidateSessionId:
    def test_valid_uuid(self):
        PlaygroundSessionManager.validate_session_id(str(uuid.uuid4()))

    @pytest.mark.parametrize(
        "bad_id",
        ["not-a-uuid", "", "../etc/passwd", "12345"],
    )
    def test_invalid_uuid(self, bad_id):
        with pytest.raises(ValueError, match="Invalid session ID format"):
            PlaygroundSessionManager.validate_session_id(bad_id)

    def test_none_raises(self):
        with pytest.raises(ValueError, match="Invalid session ID format"):
            PlaygroundSessionManager.validate_session_id(None)


class TestCreateSession:
    def test_creates_session_and_workspace(self):
        session_id, session = PlaygroundSessionManager.create("exp-1")

        assert uuid.UUID(session_id)
        assert session.experiment_id == "exp-1"
        assert session.config_a.panel_id == "a"
        assert session.config_b.panel_id == "b"

        workspace = PlaygroundSessionManager.get_workspace_dir(session_id)
        assert (workspace / "panel-a" / ".claude" / "skills").is_dir()
        assert (workspace / "panel-b" / ".claude" / "skills").is_dir()


class TestSaveAndLoad:
    def test_round_trip(self):
        session_id, session = PlaygroundSessionManager.create("exp-2")
        loaded = PlaygroundSessionManager.load(session_id)

        assert loaded is not None
        assert loaded.session_id == session.session_id
        assert loaded.experiment_id == "exp-2"
        assert loaded.created_at == session.created_at

    def test_load_nonexistent_returns_none(self):
        fake_id = str(uuid.uuid4())
        assert PlaygroundSessionManager.load(fake_id) is None

    def test_load_invalid_id_returns_none(self):
        assert PlaygroundSessionManager.load("bad-id") is None


class TestDeleteSession:
    def test_deletes_session_and_workspace(self):
        session_id, _ = PlaygroundSessionManager.create("exp-3")
        assert PlaygroundSessionManager.load(session_id) is not None

        PlaygroundSessionManager.delete(session_id)

        assert PlaygroundSessionManager.load(session_id) is None
        assert not PlaygroundSessionManager.get_workspace_dir(session_id).exists()

    def test_delete_nonexistent_does_not_raise(self):
        fake_id = str(uuid.uuid4())
        PlaygroundSessionManager.delete(fake_id)
