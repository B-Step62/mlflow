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


def test_main_default_invokes_uvicorn_inline_without_reload(tmp_path, monkeypatch):
    """Default path: hand the app object to uvicorn directly (no reload, no
    import-string round trip). Inline build is what works reliably today.
    """
    captured = {}

    def fake_run(app_or_str, *, host, port):
        captured.update(
            app_or_str=app_or_str,
            host=host,
            port=port,
            env_var=os.environ.get(bootstrap._REPO_DIR_ENV),
        )

    monkeypatch.setattr(bootstrap.uvicorn, "run", fake_run)
    monkeypatch.setattr(bootstrap, "_build_app", lambda: "fake-fastapi-app")
    monkeypatch.setattr(bootstrap, "app", None)
    monkeypatch.setattr(sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path)])

    bootstrap.main()

    assert captured["app_or_str"] == "fake-fastapi-app"
    assert captured["host"] == "127.0.0.1"
    # Repo dir is stashed in the env var even on the no-reload path so reload
    # can be turned on later without restarting the bootstrap from scratch.
    assert captured["env_var"] == str(tmp_path)


def test_main_with_reload_uses_import_string(tmp_path, monkeypatch):
    """Opt-in `--reload` flag delegates to uvicorn's reload supervisor with
    an import string so the worker re-imports on file changes.
    """
    captured = {}

    def fake_run(import_string, *, host, port, reload, reload_dirs, reload_excludes):
        captured.update(
            import_string=import_string,
            reload=reload,
            reload_dirs=reload_dirs,
            reload_excludes=reload_excludes,
        )

    monkeypatch.setattr(bootstrap.uvicorn, "run", fake_run)
    monkeypatch.setattr(
        sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path), "--reload"]
    )

    bootstrap.main()

    assert captured["import_string"] == "mlflow.playground.agent_bootstrap:app"
    assert captured["reload"] is True
    assert captured["reload_dirs"] == [str(tmp_path)]
    assert captured["reload_excludes"] is not None
