from __future__ import annotations

import json
import logging
import os
from typing import TYPE_CHECKING, Any

import pydantic
import requests

if TYPE_CHECKING:
    from mlflow.gateway.providers import BaseProvider
    from mlflow.types.llm import ChatMessage

from mlflow.entities.assessment import Feedback
from mlflow.entities.assessment_source import AssessmentSource, AssessmentSourceType
from mlflow.exceptions import MlflowException
from mlflow.gateway.config import EndpointType
from mlflow.genai.discovery.utils import _pydantic_to_response_format
from mlflow.genai.judges.adapters.base_adapter import (
    AdapterInvocationInput,
    AdapterInvocationOutput,
    BaseJudgeAdapter,
)
from mlflow.genai.judges.utils.parsing_utils import (
    _sanitize_justification,
    _strip_markdown_code_blocks,
)
from mlflow.genai.utils.model_utils import (
    _parse_model_uri,
    call_deployments_api,
    get_endpoint_type,
)
from mlflow.protos.databricks_pb2 import BAD_REQUEST, INVALID_PARAMETER_VALUE

_logger = logging.getLogger(__name__)

# "endpoints" is a special case for MLflow deployment endpoints (e.g. Databricks model serving).
_NATIVE_PROVIDERS = ["openai", "anthropic", "gemini", "mistral", "endpoints"]


def _invoke_via_gateway(
    model_uri: str,
    provider: str,
    prompt: str | list[dict[str, str]],
    inference_params: dict[str, Any] | None = None,
    response_format: type[pydantic.BaseModel] | None = None,
    base_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> str:
    """
    Invoke the judge model via native AI Gateway adapters.

    Supports both string prompts (via ``score_model_on_payload``) and
    ChatMessage-style message lists (via the provider infrastructure).

    Args:
        model_uri: The full model URI.
        provider: The provider name.
        prompt: The prompt to evaluate. Either a string or a list of message dicts.
        inference_params: Optional dictionary of inference parameters to pass to the
            model (e.g., temperature, top_p, max_tokens).
        response_format: Optional Pydantic model class for structured output.
            Only used for ChatMessage-style prompts.

    Returns:
        The JSON response string from the model.

    Raises:
        MlflowException: If the provider is not natively supported or invocation fails.
    """
    if provider not in _NATIVE_PROVIDERS:
        raise MlflowException(
            f"LiteLLM is required for using '{provider}' LLM. Please install it with "
            "`pip install litellm`.",
            error_code=BAD_REQUEST,
        )

    if isinstance(prompt, str):
        return _score_model_on_payload(
            model_uri=model_uri,
            payload=prompt,
            eval_parameters=inference_params,
            extra_headers=extra_headers,
            proxy_url=base_url,
            endpoint_type=get_endpoint_type(model_uri) or EndpointType.LLM_V1_CHAT,
        )

    _, model_name = _parse_model_uri(model_uri)
    rf_dict = _pydantic_to_response_format(response_format) if response_format else None
    return _call_llm_provider_api(
        provider,
        model_name,
        messages=prompt,
        eval_parameters=inference_params,
        response_format=rf_dict,
    )


def _score_model_on_payload(
    model_uri,
    payload,
    eval_parameters=None,
    extra_headers=None,
    proxy_url=None,
    endpoint_type=None,
):
    """Call the model identified by the given uri with the given string prompt."""
    from mlflow.deployments import get_deploy_client

    eval_parameters = eval_parameters or {}
    extra_headers = extra_headers or {}

    prefix, suffix = _parse_model_uri(model_uri)

    if prefix in ["gateway", "endpoints"]:
        if isinstance(payload, str) and endpoint_type is None:
            client = get_deploy_client()
            endpoint_type = client.get_endpoint(suffix).endpoint_type
        return call_deployments_api(suffix, payload, eval_parameters, endpoint_type)
    elif prefix in ("model", "runs"):
        # TODO: call _load_model_or_server
        raise NotImplementedError

    # Import here to avoid loading gateway module at the top level
    from mlflow.gateway.provider_registry import is_supported_provider

    if is_supported_provider(prefix):
        return _call_llm_provider_api(
            prefix, suffix, payload, eval_parameters, extra_headers, proxy_url
        )

    raise MlflowException(
        f"Unknown model uri prefix '{prefix}'",
        error_code=INVALID_PARAMETER_VALUE,
    )


def _call_llm_provider_api(
    provider_name: str,
    model: str,
    input_data: str,
    eval_parameters: dict[str, Any],
    extra_headers: dict[str, str],
    proxy_url: str | None = None,
) -> str:
    from mlflow.gateway.config import Provider
    from mlflow.gateway.schemas import chat

    provider = _get_provider_instance(provider_name, model)

    chat_request = chat.RequestPayload(
        model=model,
        messages=[
            chat.RequestMessage(role="user", content=input_data),
        ],
        **eval_parameters,
    )

    filtered_keys = {"messages", *eval_parameters.keys()}

    payload = {
        k: v
        for k, v in chat_request.model_dump(exclude_none=True).items()
        if (v is not None) and (k in filtered_keys)
    }
    chat_payload = provider.adapter_class.chat_to_model(payload, provider.config)
    chat_payload.update(eval_parameters)

    if provider_name in [Provider.AMAZON_BEDROCK, Provider.BEDROCK]:
        if proxy_url or extra_headers:
            _logger.warning(
                "Proxy URL and extra headers are not supported for Bedrock LLMs. "
                "Ignoring the provided proxy URL and extra headers.",
            )
        response = provider._request(chat_payload)
    else:
        response = _send_request(
            endpoint=proxy_url or provider.get_endpoint_url("llm/v1/chat"),
            headers=provider.headers | extra_headers,
            payload=chat_payload,
        )
    chat_response = provider.adapter_class.model_to_chat(response, provider.config)
    if len(chat_response.choices) == 0:
        raise MlflowException(
            "Failed to score the provided input as the judge LLM did not return "
            "any chat completion results in the response."
        )
    content = chat_response.choices[0].message.content

    # NB: Evaluation only handles text content for now.
    return content[0].text if isinstance(content, list) else content


def _get_provider_instance(provider: str, model: str) -> BaseProvider:
    from mlflow.gateway.config import EndpointConfig, Provider

    def _get_route_config(config):
        return EndpointConfig(
            name=provider,
            endpoint_type="llm/v1/chat",
            model={
                "provider": provider,
                "name": model,
                "config": config.model_dump(),
            },
        )

    if provider == Provider.OPENAI:
        from mlflow.gateway.providers.openai import OpenAIConfig, OpenAIProvider
        from mlflow.openai.model import _get_api_config, _OAITokenHolder

        api_config = _get_api_config()
        api_token = _OAITokenHolder(api_config.api_type)
        api_token.refresh()

        config = OpenAIConfig(
            openai_api_key=api_token.token,
            openai_api_type=api_config.api_type or "openai",
            openai_api_base=api_config.api_base,
            openai_api_version=api_config.api_version,
            openai_deployment_name=api_config.deployment_id,
            openai_organization=api_config.organization,
        )
        return OpenAIProvider(_get_route_config(config))

    elif provider == Provider.ANTHROPIC:
        from mlflow.gateway.providers.anthropic import AnthropicConfig, AnthropicProvider

        config = AnthropicConfig(anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY"))
        return AnthropicProvider(_get_route_config(config))

    elif provider in [Provider.AMAZON_BEDROCK, Provider.BEDROCK]:
        from mlflow.gateway.config import AWSIdAndKey, AWSRole
        from mlflow.gateway.providers.bedrock import AmazonBedrockConfig, AmazonBedrockProvider

        if aws_role_arn := os.environ.get("AWS_ROLE_ARN"):
            aws_config = AWSRole(
                aws_region=os.environ.get("AWS_REGION"),
                aws_role_arn=aws_role_arn,
            )
        else:
            aws_config = AWSIdAndKey(
                aws_region=os.environ.get("AWS_REGION"),
                aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
                aws_session_token=os.environ.get("AWS_SESSION_TOKEN"),
            )
        config = AmazonBedrockConfig(aws_config=aws_config)
        return AmazonBedrockProvider(_get_route_config(config))

    elif provider == Provider.MISTRAL:
        from mlflow.gateway.providers.mistral import MistralConfig, MistralProvider

        config = MistralConfig(mistral_api_key=os.environ.get("MISTRAL_API_KEY"))
        return MistralProvider(_get_route_config(config))

    elif provider == Provider.TOGETHERAI:
        from mlflow.gateway.providers.togetherai import TogetherAIConfig, TogetherAIProvider

        config = TogetherAIConfig(togetherai_api_key=os.environ.get("TOGETHERAI_API_KEY"))
        return TogetherAIProvider(_get_route_config(config))

    raise MlflowException(f"Provider '{provider}' is not supported for evaluation.")


def _send_request(
    endpoint: str, headers: dict[str, str], payload: dict[str, Any]
) -> dict[str, Any]:
    try:
        response = requests.post(
            url=endpoint,
            headers=headers,
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
    except requests.exceptions.HTTPError as e:
        raise MlflowException(
            f"Failed to call LLM endpoint at {endpoint}.\n- Error: {e}\n- Input payload: {payload}."
        )

    return response.json()


class GatewayAdapter(BaseJudgeAdapter):
    """Adapter for native AI Gateway providers (fallback when LiteLLM is not available)."""

    @classmethod
    def is_applicable(
        cls,
        model_uri: str,
        prompt: str | list["ChatMessage"],
    ) -> bool:
        model_provider, _ = _parse_model_uri(model_uri)
        if model_provider not in _NATIVE_PROVIDERS:
            return False
        # "endpoints" (Databricks model serving) only supports string prompts
        # via score_model_on_payload; _get_provider_instance doesn't handle it.
        if isinstance(prompt, list) and model_provider == "endpoints":
            return False
        return True

    def invoke(self, input_params: AdapterInvocationInput) -> AdapterInvocationOutput:
        if input_params.trace is not None:
            raise MlflowException(
                "LiteLLM is required for using traces with judges. "
                "Please install it with `pip install litellm`.",
            )

        # base_url and extra_headers are not supported for deployment endpoints
        if input_params.model_provider == "endpoints" and (
            input_params.base_url is not None or input_params.extra_headers is not None
        ):
            raise MlflowException(
                "base_url and extra_headers are not supported for deployment "
                "endpoints (endpoints:/...). The endpoint URL is determined by the "
                "deployment target configuration.",
                error_code=INVALID_PARAMETER_VALUE,
            )

        if isinstance(input_params.prompt, str):
            prompt = input_params.prompt
        else:
            prompt = [{"role": msg.role, "content": msg.content} for msg in input_params.prompt]

        response = _invoke_via_gateway(
            input_params.model_uri,
            input_params.model_provider,
            prompt,
            inference_params=input_params.inference_params,
            response_format=input_params.response_format,
            base_url=input_params.base_url,
            extra_headers=input_params.extra_headers,
        )

        cleaned_response = _strip_markdown_code_blocks(response)

        try:
            response_dict = json.loads(cleaned_response)
        except json.JSONDecodeError as e:
            raise MlflowException(
                f"Failed to parse response from judge model. Response: {response}",
                error_code=BAD_REQUEST,
            ) from e

        feedback = Feedback(
            name=input_params.assessment_name,
            value=response_dict["result"],
            rationale=_sanitize_justification(response_dict.get("rationale", "")),
            source=AssessmentSource(
                source_type=AssessmentSourceType.LLM_JUDGE, source_id=input_params.model_uri
            ),
        )

        return AdapterInvocationOutput(feedback=feedback)
