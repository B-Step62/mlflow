from types import SimpleNamespace
from unittest import mock

import pytest

from mlflow.assistant import gateway_connection
from mlflow.assistant.gateway_connection import (
    GatewayUnsupportedError,
    ensure_vendor_connection,
    gateway_supported,
    list_vendor_models,
    resolve_vendor_model,
    update_vendor_connection_model,
    vendor_endpoint_name,
)
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST


def _not_found() -> MlflowException:
    return MlflowException("missing", error_code=RESOURCE_DOES_NOT_EXIST)


def _gateway_store() -> mock.MagicMock:
    """A store that supports the gateway and reports every resource as missing."""
    store = mock.MagicMock()
    store.list_gateway_endpoints.return_value = []
    store.get_secret_info.side_effect = _not_found()
    store.get_gateway_model_definition.side_effect = _not_found()
    store.get_gateway_endpoint.side_effect = _not_found()
    store.create_gateway_secret.return_value = SimpleNamespace(secret_id="sec-1")
    store.create_gateway_model_definition.return_value = SimpleNamespace(
        model_definition_id="md-1", model_name="gpt-5.5", provider="openai"
    )
    store.create_gateway_endpoint.return_value = SimpleNamespace(name="mlflow-assistant-openai")
    return store


@pytest.fixture
def patched_store():
    store = _gateway_store()
    with mock.patch.object(gateway_connection, "_get_store", return_value=store):
        yield store


def test_gateway_supported_true_when_store_lists_endpoints(patched_store):
    assert gateway_supported() is True


@pytest.mark.parametrize("exc", [AttributeError("no gateway"), NotImplementedError("FileStore")])
def test_gateway_supported_false_without_gateway_tables(exc):
    store = mock.MagicMock()
    store.list_gateway_endpoints.side_effect = exc
    with mock.patch.object(gateway_connection, "_get_store", return_value=store):
        assert gateway_supported() is False


def test_ensure_vendor_connection_creates_secret_model_and_endpoint(patched_store):
    endpoint_name = ensure_vendor_connection("openai", "sk-secret")

    assert endpoint_name == "mlflow-assistant-openai"
    patched_store.create_gateway_secret.assert_called_once_with(
        secret_name="mlflow-assistant-openai",
        secret_value={"api_key": "sk-secret"},
        provider="openai",
    )
    # Uses the vendor's default model for the endpoint's model definition.
    _, kwargs = patched_store.create_gateway_model_definition.call_args
    assert kwargs["provider"] == "openai"
    assert kwargs["model_name"] == "gpt-5.5"
    assert kwargs["secret_id"] == "sec-1"
    patched_store.create_gateway_endpoint.assert_called_once()


def test_ensure_vendor_connection_rotates_existing_secret(patched_store):
    # Secret + endpoint already exist: rotate the secret, reuse the endpoint.
    patched_store.get_secret_info.side_effect = None
    patched_store.get_secret_info.return_value = SimpleNamespace(secret_id="sec-existing")
    patched_store.get_gateway_model_definition.side_effect = None
    patched_store.get_gateway_model_definition.return_value = SimpleNamespace(
        model_definition_id="md-existing", model_name="gpt-5.5", provider="openai"
    )
    patched_store.get_gateway_endpoint.side_effect = None
    patched_store.get_gateway_endpoint.return_value = SimpleNamespace(
        name="mlflow-assistant-openai"
    )

    endpoint_name = ensure_vendor_connection("openai", "sk-new")

    assert endpoint_name == "mlflow-assistant-openai"
    patched_store.update_gateway_secret.assert_called_once_with(
        secret_id="sec-existing", secret_value={"api_key": "sk-new"}
    )
    patched_store.create_gateway_secret.assert_not_called()
    patched_store.update_gateway_model_definition.assert_not_called()
    patched_store.create_gateway_endpoint.assert_not_called()


def test_ensure_vendor_connection_uses_requested_model(patched_store):
    ensure_vendor_connection("openai", "sk-secret", model="gpt-5-mini")

    _, kwargs = patched_store.create_gateway_model_definition.call_args
    assert kwargs["model_name"] == "gpt-5-mini"


def test_ensure_vendor_connection_updates_existing_model(patched_store):
    patched_store.get_secret_info.side_effect = None
    patched_store.get_secret_info.return_value = SimpleNamespace(secret_id="sec-existing")
    patched_store.get_gateway_model_definition.side_effect = None
    patched_store.get_gateway_model_definition.return_value = SimpleNamespace(
        model_definition_id="md-existing", model_name="gpt-5.5", provider="openai"
    )
    patched_store.get_gateway_endpoint.side_effect = None
    patched_store.get_gateway_endpoint.return_value = SimpleNamespace(
        name="mlflow-assistant-openai"
    )

    ensure_vendor_connection("openai", "sk-new", model="gpt-5")

    patched_store.update_gateway_model_definition.assert_called_once_with(
        model_definition_id="md-existing", model_name="gpt-5"
    )


def test_update_vendor_connection_model_updates_existing_model(patched_store):
    patched_store.get_gateway_model_definition.side_effect = None
    patched_store.get_gateway_model_definition.return_value = SimpleNamespace(
        model_definition_id="md-existing", model_name="gpt-5.5"
    )

    assert update_vendor_connection_model("openai", "gpt-5-mini") is True
    patched_store.update_gateway_model_definition.assert_called_once_with(
        model_definition_id="md-existing",
        model_name="gpt-5-mini",
        provider="openai",
    )


def test_update_vendor_connection_model_returns_false_when_missing(patched_store):
    assert update_vendor_connection_model("openai", "gpt-5-mini") is False
    patched_store.update_gateway_model_definition.assert_not_called()


def test_ensure_vendor_connection_unknown_vendor(patched_store):
    with pytest.raises(ValueError, match="Unknown SaaS vendor"):
        ensure_vendor_connection("cohere", "sk-x")


def test_rejects_unknown_model(patched_store):
    with pytest.raises(ValueError, match="not supported"):
        ensure_vendor_connection("openai", "sk-x", model="text-embedding-3-large")


def test_list_vendor_models_returns_curated_options():
    assert list_vendor_models("openai") == ["gpt-5.5", "gpt-5", "gpt-5-mini"]


def test_resolve_vendor_model_defaults_to_first_option():
    assert resolve_vendor_model("openai", None) == "gpt-5.5"
    assert resolve_vendor_model("openai", "default") == "gpt-5.5"


def test_ensure_vendor_connection_unsupported_store():
    store = mock.MagicMock()
    store.list_gateway_endpoints.side_effect = NotImplementedError("FileStore")
    with mock.patch.object(gateway_connection, "_get_store", return_value=store):
        with pytest.raises(GatewayUnsupportedError, match="does not support the AI Gateway"):
            ensure_vendor_connection("openai", "sk-x")


def test_vendor_endpoint_name_returns_none_when_missing(patched_store):
    assert vendor_endpoint_name("openai") is None


def test_vendor_endpoint_name_returns_name_when_present(patched_store):
    patched_store.get_gateway_endpoint.side_effect = None
    patched_store.get_gateway_endpoint.return_value = SimpleNamespace(
        name="mlflow-assistant-anthropic"
    )
    assert vendor_endpoint_name("anthropic") == "mlflow-assistant-anthropic"
