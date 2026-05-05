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


def test_main_invokes_uvicorn_with_reload_and_import_string(tmp_path, monkeypatch):
    captured = {}

    def fake_run(import_string, *, host, port, reload, reload_dirs, reload_excludes):
        captured.update(
            import_string=import_string,
            host=host,
            port=port,
            reload=reload,
            reload_dirs=reload_dirs,
            reload_excludes=reload_excludes,
            env_var=os.environ.get(bootstrap._REPO_DIR_ENV),
        )

    monkeypatch.setattr(bootstrap.uvicorn, "run", fake_run)
    monkeypatch.setattr(sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path)])

    bootstrap.main()

    assert captured["import_string"] == "mlflow.playground.agent_bootstrap:app"
    assert captured["reload"] is True
    assert captured["reload_dirs"] == [str(tmp_path)]
    assert captured["reload_excludes"] is not None
    # Repo dir is stashed in the env var so the uvicorn worker can re-build
    # `app` on each reload.
    assert captured["env_var"] == str(tmp_path)


def test_main_no_reload_disables_uvicorn_reload(tmp_path, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        bootstrap.uvicorn, "run", lambda *args, **kwargs: captured.update(kwargs)
    )
    monkeypatch.setattr(
        sys, "argv", ["agent_bootstrap", "--repo-dir", str(tmp_path), "--no-reload"]
    )

    bootstrap.main()

    assert captured["reload"] is False
    assert captured["reload_dirs"] is None
    assert captured["reload_excludes"] is None
