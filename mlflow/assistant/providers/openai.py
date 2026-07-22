"""SaaS vendor presets (OpenAI, Anthropic, Gemini) for the MLflow Assistant.

These providers do NOT store API keys in the assistant config. When the user
provides a key, it is written to the AI Gateway secret store (see
`mlflow.assistant.gateway_connection`) and the assistant chats through a gateway
endpoint, so the gateway's guardrails, budget, and usage tracking apply. The
per-vendor `list_models` path still dials the vendor API directly, used only by
the setup wizard's key-verification step (which passes the key in explicitly).
"""

from typing import ClassVar

from mlflow.assistant.config import ProviderConfig
from mlflow.assistant.gateway_connection import (
    SAAS_VENDOR_DEFAULT_MODEL,
    gateway_supported,
    list_vendor_models,
    vendor_endpoint_name,
)
from mlflow.assistant.providers.mlflow_gateway import MlflowGatewayProvider
from mlflow.assistant.providers.openai_compatible import (
    OpenAICompatibleProvider,
    list_openai_style_models,
)
from mlflow.assistant.types import ErrorCode, Event


class _SaaSVendorProvider(OpenAICompatibleProvider):
    """A SaaS vendor served through the AI Gateway.

    Availability tracks whether the tracking store supports the gateway; the key
    is provided out of band (diverted to a gateway secret) and chat is routed
    through the vendor's gateway endpoint.
    """

    def __init__(
        self,
        name: str,
        display_name: str,
        description: str,
        default_base_url: str,
    ) -> None:
        super().__init__(
            name=name,
            display_name=display_name,
            description=description,
            connection_hint="Add the API key in the Assistant to start chatting.",
            list_models_fn=list_openai_style_models,
            default_base_url=default_base_url,
            allows_remote_access=True,
            requires_api_key=True,
            default_model=SAAS_VENDOR_DEFAULT_MODEL[name],
        )

    def is_available(self) -> bool:
        return gateway_supported()

    def has_connection(self) -> bool:
        """Whether a gateway endpoint (and its secret) exists for this vendor."""
        return vendor_endpoint_name(self.name) is not None

    @property
    def model_options(self) -> list[str]:
        return list_vendor_models(self.name)

    def list_models(self, base_url: str | None = None, api_key: str | None = None) -> list[str]:
        """Return the curated assistant model set, not the vendor's full catalog."""
        return self.model_options

    def _resolve_chat(
        self, config: ProviderConfig, tracking_uri: str
    ) -> "tuple[str | None, str | None, str | None, Event | None]":
        # Route through the vendor's gateway endpoint rather than dialing the
        # vendor API directly, so the gateway (which holds the key) applies.
        endpoint = vendor_endpoint_name(self.name)
        if endpoint is None:
            return (
                None,
                None,
                None,
                Event.from_error(
                    f"{self.display_name} needs an API key. Add it to start chatting.",
                    code=ErrorCode.API_KEY_MISSING,
                ),
            )
        chat_url = MlflowGatewayProvider._build_chat_url(None, tracking_uri)
        if not chat_url:
            return (
                None,
                None,
                None,
                Event.from_error(f"{self.display_name} chat URL could not be resolved."),
            )
        # The gateway authenticates to the vendor with the endpoint's secret, so
        # no key is sent on the assistant -> gateway request.
        return chat_url, endpoint, None, None


class OpenAIProvider(_SaaSVendorProvider):
    OPENAI_PROVIDER_NAME: ClassVar[str] = "openai"

    def __init__(self) -> None:
        super().__init__(
            name=self.OPENAI_PROVIDER_NAME,
            display_name="OpenAI",
            description="AI-powered assistant using an OpenAI model via the AI Gateway.",
            default_base_url="https://api.openai.com/v1",
        )


class AnthropicProvider(_SaaSVendorProvider):
    ANTHROPIC_PROVIDER_NAME: ClassVar[str] = "anthropic"

    def __init__(self) -> None:
        super().__init__(
            name=self.ANTHROPIC_PROVIDER_NAME,
            display_name="Anthropic",
            description="AI-powered assistant using an Anthropic Claude model via the AI Gateway.",
            default_base_url="https://api.anthropic.com/v1",
        )


class GeminiProvider(_SaaSVendorProvider):
    GEMINI_PROVIDER_NAME: ClassVar[str] = "gemini"

    def __init__(self) -> None:
        super().__init__(
            name=self.GEMINI_PROVIDER_NAME,
            display_name="Gemini",
            description="AI-powered assistant using a Google Gemini model via the AI Gateway.",
            default_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        )
