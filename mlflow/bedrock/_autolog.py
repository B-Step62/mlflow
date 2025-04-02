import logging

from botocore.client import BaseClient

from mlflow.bedrock import FLAVOR_NAME
from mlflow.bedrock.patch.agent import _patched_invoke_agent
from mlflow.bedrock.patch.converse import _patched_converse, _patched_converse_stream
from mlflow.bedrock.patch.invoke_model import _patched_invoke_model, _patched_invoke_model_with_response_stream

from mlflow.utils.autologging_utils import safe_patch

_BEDROCK_RUNTIME_SERVICE_NAME = "bedrock-runtime"
_BEDROCK_AGENT_RUNTIME_SERVICE_NAME = "bedrock-agent-runtime"

def patched_create_client(original, self, *args, **kwargs):
    """
    Patched version of the boto3 ClientCreator.create_client method that returns
    a patched client class.
    """
    if kwargs.get("service_name") == _BEDROCK_RUNTIME_SERVICE_NAME:
        client = original(self, *args, **kwargs)
        patch_bedrock_runtime_client(client.__class__)
        return client

    elif kwargs.get("service_name") == _BEDROCK_AGENT_RUNTIME_SERVICE_NAME:
        client = original(self, *args, **kwargs)
        patch_bedrock_agent_runtime_client(client.__class__)
        return client

    return original(self, *args, **kwargs)


def patch_bedrock_runtime_client(client_class: type[BaseClient]):
    """
    Patch the BedrockRuntime client to log traces and models.
    """
    # The most basic model invocation API
    safe_patch(FLAVOR_NAME, client_class, "invoke_model", _patched_invoke_model)
    safe_patch(
        FLAVOR_NAME,
        client_class,
        "invoke_model_with_response_stream",
        _patched_invoke_model_with_response_stream,
    )

    if hasattr(client_class, "converse"):
        # The new "converse" API was introduced in boto3 1.35 to access all models
        # with the consistent chat format.
        # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime/client/converse.html
        safe_patch(FLAVOR_NAME, client_class, "converse", _patched_converse)

    if hasattr(client_class, "converse_stream"):
        safe_patch(FLAVOR_NAME, client_class, "converse_stream", _patched_converse_stream)


def patch_bedrock_agent_runtime_client(client_class: type[BaseClient]):
    """
    Patch the BedrockRuntime client to log traces and models.
    """
    # The most basic model invocation API
    safe_patch(FLAVOR_NAME, client_class, "invoke_agent", _patched_invoke_agent)
    # safe_patch(FLAVOR_NAME, client_class, "invoke_inline_agent", _patched_invoke_inline_agent)
