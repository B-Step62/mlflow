"""Tests for the in-process hot-reload helper in
``mlflow.genai.agent_server.server.enable_hot_reload``.
"""

from __future__ import annotations

import logging
import sys
import threading
import types
from contextlib import contextmanager
from unittest import mock

import pytest

import mlflow.genai.agent_server.server as agent_server_module
from mlflow.genai.agent_server import enable_hot_reload


@pytest.fixture(autouse=True)
def reset_globals():
    agent_server_module._invoke_function = None
    agent_server_module._stream_function = None
    yield
    agent_server_module._invoke_function = None
    agent_server_module._stream_function = None


def _make_fake_watchfiles(batches: list[set[tuple[str, str]]]) -> types.ModuleType:
    """Build a fake ``watchfiles`` module whose ``watch`` yields the given
    batches and then stops. Lets the watcher thread terminate cleanly."""
    fake = types.ModuleType("watchfiles")

    def watch(*_args, **_kwargs):
        for batch in batches:
            yield batch

    fake.watch = watch
    return fake


@contextmanager
def _patched_watchfiles(batches: list[set[tuple[str, str]]]):
    """Inject a fake ``watchfiles`` into ``sys.modules`` for the duration of
    the block, regardless of whether the real package is installed."""
    fake = _make_fake_watchfiles(batches)
    with mock.patch.dict(sys.modules, {"watchfiles": fake}):
        yield


def _wait_for(event: threading.Event, timeout: float = 2.0) -> None:
    assert event.wait(timeout=timeout), "watcher thread did not signal in time"


def test_enable_hot_reload_calls_on_change_for_py_changes(tmp_path):
    target = tmp_path / "agent.py"
    target.touch()
    fired = threading.Event()
    calls = {"n": 0}

    def on_change():
        calls["n"] += 1
        fired.set()

    with _patched_watchfiles([{("modified", str(target))}]):
        thread = enable_hot_reload(tmp_path, on_change=on_change)
        _wait_for(fired)
        thread.join(timeout=2.0)

    assert calls["n"] == 1


def test_enable_hot_reload_ignores_non_py_changes(tmp_path):
    target = tmp_path / "notes.md"
    target.touch()
    on_change = mock.Mock()

    with _patched_watchfiles([{("modified", str(target))}]):
        thread = enable_hot_reload(tmp_path, on_change=on_change)
        thread.join(timeout=1.0)

    on_change.assert_not_called()


def test_enable_hot_reload_skips_excluded_dirs(tmp_path):
    venv_file = tmp_path / ".venv" / "lib" / "x.py"
    venv_file.parent.mkdir(parents=True)
    venv_file.touch()
    on_change = mock.Mock()

    with _patched_watchfiles([{("modified", str(venv_file))}]):
        thread = enable_hot_reload(tmp_path, on_change=on_change)
        thread.join(timeout=1.0)

    on_change.assert_not_called()


def test_enable_hot_reload_evicts_sys_modules_for_watched_files(tmp_path):
    user_module_file = tmp_path / "user_agent.py"
    user_module_file.touch()
    fake_module = types.ModuleType("user_agent_under_test")
    fake_module.__file__ = str(user_module_file)
    sys.modules["user_agent_under_test"] = fake_module

    fired = threading.Event()
    seen: dict[str, bool] = {}

    def on_change():
        seen["present"] = "user_agent_under_test" in sys.modules
        fired.set()

    try:
        with _patched_watchfiles([{("modified", str(user_module_file))}]):
            thread = enable_hot_reload(tmp_path, on_change=on_change)
            _wait_for(fired)
            thread.join(timeout=2.0)
    finally:
        sys.modules.pop("user_agent_under_test", None)

    assert seen["present"] is False


def test_enable_hot_reload_resets_invoke_function_before_callback(tmp_path):
    target = tmp_path / "agent.py"
    target.touch()
    agent_server_module._invoke_function = lambda req: {"v": "stale"}

    fired = threading.Event()
    saw: dict[str, object] = {}

    def on_change():
        saw["fn"] = agent_server_module._invoke_function
        fired.set()

    with _patched_watchfiles([{("modified", str(target))}]):
        thread = enable_hot_reload(tmp_path, on_change=on_change)
        _wait_for(fired)
        thread.join(timeout=2.0)

    assert saw["fn"] is None


def test_enable_hot_reload_continues_after_callback_failure(tmp_path):
    target = tmp_path / "agent.py"
    target.touch()
    fired_second = threading.Event()
    calls = {"n": 0}

    def on_change():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated syntax error in agent file")
        fired_second.set()

    batches: list[set[tuple[str, str]]] = [
        {("modified", str(target))},
        {("modified", str(target))},
    ]
    with _patched_watchfiles(batches):
        thread = enable_hot_reload(tmp_path, on_change=on_change)
        _wait_for(fired_second)
        thread.join(timeout=2.0)

    assert calls["n"] == 2


def test_enable_hot_reload_logs_warning_when_watchfiles_missing(tmp_path):
    """If ``watchfiles`` isn't installed the watcher must bow out gracefully
    with a warning rather than letting the ImportError bubble up the thread.

    We attach a one-shot handler to the module's logger so we can read the
    warning regardless of pytest's thread-handling for ``caplog`` (which has
    been flaky for thread-emitted records in some setups)."""
    captured: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.setLevel(logging.WARNING)
    handler.emit = captured.append  # type: ignore[assignment]
    server_logger = logging.getLogger("mlflow.genai.agent_server.server")
    server_logger.addHandler(handler)
    try:
        # Make sure any cached real `watchfiles` module is invisible so the
        # `from watchfiles import watch` inside the watcher thread fails.
        with mock.patch.dict(sys.modules, {"watchfiles": None}):
            thread = enable_hot_reload(tmp_path, on_change=lambda: None)
            thread.join(timeout=2.0)
    finally:
        server_logger.removeHandler(handler)

    assert any("watchfiles" in record.getMessage() for record in captured)
