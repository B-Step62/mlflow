import logging

from mlflow.assistant.providers.base import AssistantProvider
from mlflow.assistant.providers.claude_code import ClaudeCodeProvider
from mlflow.assistant.providers.codex import CodexProvider
from mlflow.assistant.providers.mlflow_gateway import MlflowGatewayProvider
from mlflow.assistant.providers.ollama import OllamaProvider
from mlflow.assistant.providers.openai import AnthropicProvider, GeminiProvider, OpenAIProvider
from mlflow.assistant.providers.openai_compatible import OpenAICompatibleProvider

_logger = logging.getLogger(__name__)

__all__ = [
    "AnthropicProvider",
    "AssistantProvider",
    "ClaudeCodeProvider",
    "CodexProvider",
    "GeminiProvider",
    "MlflowGatewayProvider",
    "OllamaProvider",
    "OpenAICompatibleProvider",
    "OpenAIProvider",
    "list_providers",
    "resolve_default_provider",
]


def _build_providers() -> list[AssistantProvider]:
    # Display order for the provider picker: local coding agents first, then the
    # first-class SaaS vendors, then the gateway, then Ollama last. This is the
    # ORDER USERS SEE; the auto-resolution order is separate (see
    # `_default_provider_precedence`).
    return [
        ClaudeCodeProvider(),
        CodexProvider(),
        OpenAIProvider(),
        AnthropicProvider(),
        GeminiProvider(),
        MlflowGatewayProvider(),
        OllamaProvider(),
    ]


def list_providers() -> list[AssistantProvider]:
    return _build_providers()


def _default_provider_precedence() -> list[AssistantProvider]:
    # Order in which providers are considered when no provider is explicitly
    # selected in config: local coding agents first, then endpoints configured
    # on this MLflow server, and finally the OpenAI API, which can still need
    # an API key collected at the first chat. Ollama is deliberately not a
    # default (a locally running daemon is too weak a signal of intent); it
    # remains available as an explicit choice in settings.
    return [
        ClaudeCodeProvider(),
        CodexProvider(),
        MlflowGatewayProvider(),
        OpenAIProvider(),
        AnthropicProvider(),
        GeminiProvider(),
    ]


def resolve_default_provider(remote: bool = False) -> AssistantProvider | None:
    """Pick the best available provider when none is selected in config.

    Availability checks here are cheap probes (CLI on PATH, server responding,
    endpoint configured), NOT full auth checks: the first chat is the real
    connection test, and its failure is surfaced with a machine-readable code
    the UI can turn into a recovery prompt.

    Args:
        remote: Whether the requesting client is remote. Remote clients are
            restricted to providers that allow remote access, and to SaaS
            providers whose gateway connection already exists (remote clients
            cannot set up a new one).
    """
    for provider in _default_provider_precedence():
        if remote:
            if not provider.allows_remote_access:
                continue
            has_connection = getattr(provider, "has_connection", None)
            if provider.requires_api_key and not (has_connection and has_connection()):
                continue
        try:
            if provider.is_available():
                return provider
        except Exception:
            _logger.debug(
                "Availability probe failed for assistant provider %r", provider.name, exc_info=True
            )
    return None
