import json
import os
import signal
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from mlflow.server.playground.models import PlaygroundSessionData

SESSION_DIR = Path(tempfile.gettempdir()) / "mlflow-playground-sessions"
WORKSPACE_DIR = Path(tempfile.gettempdir()) / "mlflow-playground"

class PlaygroundSessionManager:
    @staticmethod
    def validate_session_id(session_id: str) -> None:
        try:
            uuid.UUID(session_id)
        except (ValueError, TypeError) as e:
            raise ValueError("Invalid session ID format") from e

    @staticmethod
    def get_session_file(session_id: str) -> Path:
        PlaygroundSessionManager.validate_session_id(session_id)
        return SESSION_DIR / f"{session_id}.json"

    @staticmethod
    def get_workspace_dir(session_id: str) -> Path:
        PlaygroundSessionManager.validate_session_id(session_id)
        return WORKSPACE_DIR / session_id

    @staticmethod
    def create(experiment_id: str) -> tuple[str, PlaygroundSessionData]:
        session_id = str(uuid.uuid4())
        session = PlaygroundSessionData(
            session_id=session_id,
            experiment_id=experiment_id,
            created_at=datetime.now(timezone.utc),
        )

        # Create workspace directories for both panels
        workspace = PlaygroundSessionManager.get_workspace_dir(session_id)
        (workspace / "panel-a" / ".claude" / "skills").mkdir(parents=True, exist_ok=True)
        (workspace / "panel-b" / ".claude" / "skills").mkdir(parents=True, exist_ok=True)

        PlaygroundSessionManager.save(session_id, session)
        return session_id, session

    @staticmethod
    def save(session_id: str, session: PlaygroundSessionData) -> None:
        PlaygroundSessionManager.validate_session_id(session_id)
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        session_file = PlaygroundSessionManager.get_session_file(session_id)

        fd, temp_path = tempfile.mkstemp(dir=SESSION_DIR, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                f.write(session.model_dump_json())
            os.replace(temp_path, session_file)
        except Exception:
            os.unlink(temp_path)
            raise

    @staticmethod
    def load(session_id: str) -> PlaygroundSessionData | None:
        try:
            session_file = PlaygroundSessionManager.get_session_file(session_id)
        except ValueError:
            return None
        if not session_file.exists():
            return None
        return PlaygroundSessionData.model_validate_json(session_file.read_text())

    @staticmethod
    def delete(session_id: str) -> None:
        PlaygroundSessionManager.validate_session_id(session_id)

        session_file = PlaygroundSessionManager.get_session_file(session_id)
        if session_file.exists():
            session_file.unlink()

        workspace = PlaygroundSessionManager.get_workspace_dir(session_id)
        if workspace.exists():
            shutil.rmtree(workspace)


def _get_process_file(session_id: str, panel_id: str) -> Path:
    PlaygroundSessionManager.validate_session_id(session_id)
    return SESSION_DIR / f"{session_id}-panel-{panel_id}.process.json"


def save_panel_process_pid(session_id: str, panel_id: str, pid: int) -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    process_file = _get_process_file(session_id, panel_id)
    process_file.write_text(json.dumps({"pid": pid}))


def get_panel_process_pid(session_id: str, panel_id: str) -> int | None:
    try:
        process_file = _get_process_file(session_id, panel_id)
    except ValueError:
        return None
    if not process_file.exists():
        return None
    data = json.loads(process_file.read_text())
    return data.get("pid")


def clear_panel_process_pid(session_id: str, panel_id: str) -> None:
    try:
        process_file = _get_process_file(session_id, panel_id)
    except ValueError:
        return
    if process_file.exists():
        process_file.unlink()


def terminate_panel_process(session_id: str, panel_id: str) -> bool:
    if pid := get_panel_process_pid(session_id, panel_id):
        try:
            os.kill(pid, signal.SIGTERM)
            clear_panel_process_pid(session_id, panel_id)
            return True
        except ProcessLookupError:
            clear_panel_process_pid(session_id, panel_id)
    return False
