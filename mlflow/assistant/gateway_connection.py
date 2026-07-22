"""Wiring the assistant's SaaS vendors (OpenAI, Anthropic, Gemini) to the AI Gateway.

API keys are never stored in the assistant config file. When the user provides a
key for a SaaS vendor, it is written to the AI Gateway secret store (surfaced in
Settings > LLM Connections) and an endpoint is created for it, so the assistant
chats through the gateway (its guardrails, budget, and usage tracking apply).

All gateway resources for a vendor use the deterministic name
``mlflow-assistant-<vendor>`` so the flow is idempotent: providing a key again
rotates the existing secret rather than piling up new endpoints.
"""

import logging

from mlflow.entities.gateway_endpoint import (
    GatewayEndpointModelConfig,
    GatewayModelLinkageType,
)
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST, ErrorCode

_logger = logging.getLogger(__name__)

_NOT_FOUND = ErrorCode.Name(RESOURCE_DOES_NOT_EXIST)

# SaaS vendors the assistant offers via the gateway, restricted to a small set
# of known-good chat models that support tool calling. The first model is the
# zero-config default used by the inline API-key flow.
SAAS_VENDOR_MODEL_OPTIONS = {
    "openai": ("gpt-5.5", "gpt-5", "gpt-5-mini"),
    "anthropic": ("claude-sonnet-5", "claude-haiku-5"),
    "gemini": ("gemini-3-pro", "gemini-3-flash"),
}
SAAS_VENDOR_DEFAULT_MODEL = {
    vendor: models[0] for vendor, models in SAAS_VENDOR_MODEL_OPTIONS.items()
}
SAAS_VENDORS = frozenset(SAAS_VENDOR_DEFAULT_MODEL)


class GatewayUnsupportedError(Exception):
    """Raised when the tracking store has no AI Gateway support (e.g. FileStore)."""


def _resource_name(vendor: str) -> str:
    return f"mlflow-assistant-{vendor}"


def list_vendor_models(vendor: str) -> list[str]:
    """Curated model options for a first-class SaaS vendor."""
    if vendor not in SAAS_VENDOR_MODEL_OPTIONS:
        raise ValueError(f"Unknown SaaS vendor: {vendor!r}")
    return list(SAAS_VENDOR_MODEL_OPTIONS[vendor])


def resolve_vendor_model(vendor: str, model: str | None = None) -> str:
    """Validate a requested SaaS model and return the concrete gateway model."""
    if vendor not in SAAS_VENDOR_MODEL_OPTIONS:
        raise ValueError(f"Unknown SaaS vendor: {vendor!r}")
    if not model or model == "default":
        return SAAS_VENDOR_DEFAULT_MODEL[vendor]
    if model not in SAAS_VENDOR_MODEL_OPTIONS[vendor]:
        options = ", ".join(SAAS_VENDOR_MODEL_OPTIONS[vendor])
        raise ValueError(
            f"Model '{model}' is not supported for provider '{vendor}'. "
            f"Supported models: {options}."
        )
    return model


def _get_store():
    from mlflow.tracking._tracking_service.utils import _get_store as _get_tracking_store

    return _get_tracking_store()


def gateway_supported() -> bool:
    """Whether the backing tracking store supports AI Gateway resources.

    True on a database-backed store; False on FileStore (which has no gateway
    tables), where SaaS assistant providers are unavailable.
    """
    store = _get_store()
    try:
        store.list_gateway_endpoints()
    except (AttributeError, NotImplementedError):
        return False
    except Exception:
        # A real backend error (e.g. transient DB issue) still means gateway
        # support exists; only the "no such capability" cases above disable it.
        _logger.debug("list_gateway_endpoints failed while probing gateway support", exc_info=True)
        return True
    return True


def _is_not_found(exc: MlflowException) -> bool:
    return exc.error_code == _NOT_FOUND


def vendor_endpoint_name(vendor: str) -> str | None:
    """The gateway endpoint name backing a vendor, or None when not connected yet."""
    store = _get_store()
    name = _resource_name(vendor)
    try:
        endpoint = store.get_gateway_endpoint(name=name)
    except (AttributeError, NotImplementedError):
        return None
    except MlflowException as e:
        if _is_not_found(e):
            return None
        raise
    return endpoint.name


def update_vendor_connection_model(vendor: str, model: str | None) -> bool:
    """Update an existing vendor endpoint's model definition in place.

    Returns False when the connection does not exist yet, so callers can still
    persist the model preference and apply it when the API key is later provided.
    """
    model = resolve_vendor_model(vendor, model)
    store = _get_store()
    name = _resource_name(vendor)
    try:
        model_def = store.get_gateway_model_definition(name=name)
    except (AttributeError, NotImplementedError):
        return False
    except MlflowException as e:
        if _is_not_found(e):
            return False
        raise
    if getattr(model_def, "model_name", None) != model:
        store.update_gateway_model_definition(
            model_definition_id=model_def.model_definition_id,
            model_name=model,
            provider=vendor,
        )
    return True


def ensure_vendor_connection(vendor: str, api_key: str, model: str | None = None) -> str:
    """Create or update the gateway secret + endpoint for a SaaS vendor.

    Idempotent: rotates the existing secret and reuses the existing model
    definition/endpoint when they already exist. The existing model definition
    is updated in place when ``model`` changes. Returns the endpoint name.

    Raises:
        GatewayUnsupportedError: If the tracking store has no gateway support.
        ValueError: If ``vendor`` is not a known SaaS vendor.
    """
    model = resolve_vendor_model(vendor, model)
    if not gateway_supported():
        raise GatewayUnsupportedError(
            "This MLflow server's tracking backend does not support the AI Gateway. "
            "SaaS assistant providers require a database-backed tracking store."
        )

    store = _get_store()
    name = _resource_name(vendor)
    secret_value = {"api_key": api_key}

    try:
        secret = store.get_secret_info(secret_name=name)
    except MlflowException as e:
        if not _is_not_found(e):
            raise
        secret = store.create_gateway_secret(
            secret_name=name, secret_value=secret_value, provider=vendor
        )
    else:
        store.update_gateway_secret(secret_id=secret.secret_id, secret_value=secret_value)

    try:
        model_def = store.get_gateway_model_definition(name=name)
    except MlflowException as e:
        if not _is_not_found(e):
            raise
        model_def = store.create_gateway_model_definition(
            name=name, secret_id=secret.secret_id, provider=vendor, model_name=model
        )
    else:
        update_kwargs = {}
        if getattr(model_def, "model_name", None) != model:
            update_kwargs["model_name"] = model
        if getattr(model_def, "provider", None) != vendor:
            update_kwargs["provider"] = vendor
        if update_kwargs:
            model_def = store.update_gateway_model_definition(
                model_definition_id=model_def.model_definition_id,
                **update_kwargs,
            )

    try:
        endpoint = store.get_gateway_endpoint(name=name)
    except MlflowException as e:
        if not _is_not_found(e):
            raise
        endpoint = store.create_gateway_endpoint(
            name=name,
            model_configs=[
                GatewayEndpointModelConfig(
                    model_definition_id=model_def.model_definition_id,
                    linkage_type=GatewayModelLinkageType.PRIMARY,
                )
            ],
        )
    return endpoint.name
