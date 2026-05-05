import os
import sys
from unittest import mock

import mlflow.genai.agent_server.server as agent_server_module
import mlflow.playground.agent_bootstrap as bootstrap

from mlflow.playground.agent_bootstrap import _adapt_invoke_signature


def test_adapt_invoke_signature_wraps_legacy_messages_function():
    recorded = {}

    def legacy(messages):
        recorded["messages"] = messages
        return {"role": "assistant", "content": "ok"}

    with mock.patch.object(agent_server_module, "_invoke_function", legacy):
        _adapt_invoke_signature()
        response = agent_server_module._invoke_function({"messages": [{"role": "user", "content": "hi"}]})

    assert response == {"role": "assistant", "content": "ok"}
    assert recorded["messages"] == [{"role": "user", "content": "hi"}]


def test_adapt_invoke_signature_leaves_request_functions_unchanged():
    recorded = {}

    def modern(request):
        recorded["request"] = request
        return {"role": "assistant", "content": "ok"}

    with mock.patch.object(agent_server_module, "_invoke_function", modern):
        _adapt_invoke_signature()
        response = agent_server_module._invoke_function({"messages": [{"role": "user", "content": "hi"}]})

    assert response == {"role": "assistant", "content": "ok"}
    assert recorded["request"] == {"messages": [{"role": "user", "content": "hi"}]}


def test_main_with_reload_execs_into_uvicorn_module(tmp_path, monkeypatch):
    """Default path: re-exec into ``python -m uvicorn ...:app --reload`` so
    that uvicorn becomes ``__main__`` and its spawn-child re-import doesn't
    trigger our bootstrap's ``main()`` recursively. The PID stays the same
    across exec, so the playground's process handle keeps tracking it.
    """
    captured = {}

    def fake_execv(executable, argv):
        captured["executable"] = executable
        captured["argv"] = argv
        captured["env_var"] = os.environ.get(bootstrap._REPO_DIR_ENV)

    monkeypatch.setattr(bootstrap.os, "execv", fake_execv)
    monkeypatch.setattr(sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path)])

    bootstrap.main()

    assert captured["executable"] == sys.executable
    assert "uvicorn" in captured["argv"]
    assert "mlflow.playground.agent_bootstrap:app" in captured["argv"]
    assert "--reload" in captured["argv"]
    assert "--reload-dir" in captured["argv"]
    # Repo dir is stashed in the env var so the spawn-child workers (which
    # uvicorn forks under multiprocessing.spawn) inherit it and re-run
    # discovery.
    assert captured["env_var"] == str(tmp_path)


def test_main_no_reload_invokes_uvicorn_inline(tmp_path, monkeypatch):
    """Opt-out `--no-reload`: build the app inline and hand it to uvicorn as
    an object (no reload supervisor, no import-string round trip).
    """
    captured = {}

    def fake_run(app_or_str, *, host, port):
        captured.update(app_or_str=app_or_str, host=host, port=port)

    monkeypatch.setattr(bootstrap.uvicorn, "run", fake_run)
    monkeypatch.setattr(bootstrap, "_build_app", lambda: "fake-fastapi-app")
    monkeypatch.setattr(bootstrap, "app", None)
    monkeypatch.setattr(
        sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path), "--no-reload"]
    )

    bootstrap.main()

    assert captured["app_or_str"] == "fake-fastapi-app"
    assert captured["host"] == "127.0.0.1"
