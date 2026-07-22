import pytest

from mlflow.assistant.providers import (
    ClaudeCodeProvider,
    CodexProvider,
    MlflowGatewayProvider,
    OllamaProvider,
    OpenAIProvider,
    resolve_default_provider,
)

_PROBED_PROVIDERS = {
    "claude_code": ClaudeCodeProvider,
    "codex": CodexProvider,
    "ollama": OllamaProvider,
    "mlflow_gateway": MlflowGatewayProvider,
}


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    monkeypatch.setattr("mlflow.assistant.config.CONFIG_PATH", tmp_path / "config.json")


@pytest.fixture
def availability(monkeypatch):
    """Control which providers report available; the rest report unavailable."""

    def set_available(*names: str):
        for name, cls in _PROBED_PROVIDERS.items():
            monkeypatch.setattr(cls, "is_available", lambda self, n=name: n in names)

    return set_available


@pytest.mark.parametrize(
    ("available", "expected"),
    [
        (("claude_code", "codex", "ollama", "mlflow_gateway"), "claude_code"),
        (("codex", "ollama", "mlflow_gateway"), "codex"),
        (("ollama", "mlflow_gateway"), "mlflow_gateway"),
        # A running Ollama daemon alone never wins the default pick; it stays
        # an explicit settings choice. OpenAI is the last resort: always
        # considered available locally, with the missing API key surfaced at
        # first chat instead.
        (("ollama",), "openai"),
        ((), "openai"),
    ],
)
def test_default_provider_precedence(availability, available, expected):
    availability(*available)
    provider = resolve_default_provider()
    assert provider is not None
    assert provider.name == expected


def test_probe_failure_skips_provider(availability, monkeypatch):
    availability("claude_code", "codex")

    def raise_probe_error(self):
        raise RuntimeError("probe failed")

    monkeypatch.setattr(ClaudeCodeProvider, "is_available", raise_probe_error)
    provider = resolve_default_provider()
    assert provider is not None
    assert provider.name == "codex"


def test_remote_resolution_restricted_to_remote_safe_providers(availability):
    # Even with every local provider available, a remote client can only be
    # served by providers that allow remote access.
    availability("claude_code", "codex", "ollama", "mlflow_gateway")
    provider = resolve_default_provider(remote=True)
    assert provider is not None
    assert provider.name == "mlflow_gateway"


def test_remote_resolution_skips_openai_without_api_key(availability):
    availability()
    assert resolve_default_provider(remote=True) is None


def test_remote_resolution_picks_openai_with_connection(availability, monkeypatch):
    # Remote SaaS resolution now depends on an existing gateway connection
    # (has_connection), not a config-stored API key.
    availability()
    monkeypatch.setattr(OpenAIProvider, "has_connection", lambda self: True)
    monkeypatch.setattr(OpenAIProvider, "is_available", lambda self: True)
    provider = resolve_default_provider(remote=True)
    assert provider is not None
    assert provider.name == "openai"


def test_saas_provider_models_are_curated():
    provider = OpenAIProvider()
    assert provider.list_models(api_key="ignored") == ["gpt-5.5", "gpt-5", "gpt-5-mini"]
    assert provider.model_options == ["gpt-5.5", "gpt-5", "gpt-5-mini"]
