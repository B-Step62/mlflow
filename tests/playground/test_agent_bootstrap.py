from unittest import mock

import mlflow.genai.agent_server.server as agent_server_module

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
