from typing import Any

from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INVALID_PARAMETER_VALUE


def _parse_model_uri(model_uri: str) -> tuple[str, str]:
    """Parse a model URI of the form "<provider>:/<model-name>"."""
    # urllib.parse.urlparse is not used because provider names with underscores
    # (e.g., vertex_ai) are invalid in RFC 3986 URI schemes and would fail parsing.
    match model_uri.split(":/", 1):
        case [provider, model_path] if provider and model_path.lstrip("/"):
            return provider, model_path.lstrip("/")
        case _:
            raise MlflowException(
                f"Malformed model uri '{model_uri}'. The URI must be in the format of "
                "<provider>:/<model-name>, e.g., 'openai:/gpt-4.1-mini'.",
                error_code=INVALID_PARAMETER_VALUE,
            )


def convert_mlflow_uri_to_litellm(model_uri: str) -> str:
    """
    Convert MLflow model URI format to LiteLLM format.

    MLflow uses URIs like 'openai:/gpt-4' while LiteLLM expects 'openai/gpt-4'.
    For Databricks endpoints, MLflow uses 'endpoints:/endpoint-name' which needs
    to be converted to 'databricks/endpoints/endpoint-name' for LiteLLM.

    Args:
        model_uri: MLflow model URI (e.g., 'openai:/gpt-4', 'endpoints:/my-endpoint')

    Returns:
        LiteLLM-compatible model string (e.g., 'openai/gpt-4', 'databricks/endpoints/my-endpoint')
    """
    try:
        scheme, path = _parse_model_uri(model_uri)
    except Exception as e:
        raise MlflowException(f"Failed to convert MLflow model URI to LiteLLM format: {e}")
    if scheme in ("endpoints", "databricks"):
        return f"databricks/{path}"
    return f"{scheme}/{path}"


def get_endpoint_type(endpoint_uri: str) -> str | None:
    """
    Get the type of the endpoint if it is MLflow deployment
    endpoint. For other endpoints e.g. OpenAI, or if the
    endpoint does not specify type, return None.
    """
    from pydantic import BaseModel

    schema, path = _parse_model_uri(endpoint_uri)

    if schema != "endpoints":
        return None

    from mlflow.deployments import get_deploy_client

    client = get_deploy_client()

    endpoint = client.get_endpoint(path)
    # TODO: Standardize the return type of `get_endpoint` and remove this check
    endpoint = endpoint.dict() if isinstance(endpoint, BaseModel) else endpoint
    return endpoint.get("task", endpoint.get("endpoint_type"))


_PREDICT_ERROR_MSG = """\
Failed to call the deployment endpoint. Please check the deployment URL \
is set correctly and the input payload is valid.\n
- Error: {e}\n
- Deployment URI: {uri}\n
- Input payload: {payload}"""


def call_deployments_api(
    deployment_uri: str,
    input_data: str | dict[str, Any],
    eval_parameters: dict[str, Any] | None = None,
    endpoint_type: str | None = None,
):
    """Call the deployment endpoint with the given payload and parameters.

    Args:
        deployment_uri: The URI of the deployment endpoint.
        input_data: The input string or dictionary to send to the endpoint.
            - If it is a string, MLflow tries to construct the payload based on the endpoint type.
            - If it is a dictionary, MLflow directly sends it to the endpoint.
        eval_parameters: The evaluation parameters to send to the endpoint.
        endpoint_type: The type of the endpoint. If specified, must be 'llm/v1/completions'
            or 'llm/v1/chat'. If not specified, MLflow tries to get the endpoint type
            from the endpoint, and if not found, directly sends the payload to the endpoint.

    Returns:
        The unpacked response from the endpoint.
    """
    from mlflow.deployments import get_deploy_client

    client = get_deploy_client()

    if isinstance(input_data, str):
        payload = _construct_payload_from_str(input_data, endpoint_type)
    elif isinstance(input_data, dict):
        payload = input_data
    else:
        raise MlflowException(
            f"Invalid input data type {type(input_data)}. Must be a string or a dictionary.",
            error_code=INVALID_PARAMETER_VALUE,
        )
    payload = {**payload, **(eval_parameters or {})}

    try:
        response = client.predict(endpoint=deployment_uri, inputs=payload)
    except Exception as e:
        raise MlflowException(
            _PREDICT_ERROR_MSG.format(e=e, uri=deployment_uri, payload=payload)
        ) from e

    return _parse_response(response, endpoint_type)


def _construct_payload_from_str(prompt: str, endpoint_type: str) -> dict[str, Any]:
    if endpoint_type == "llm/v1/completions":
        return {"prompt": prompt}
    elif endpoint_type == "llm/v1/chat":
        return {"messages": [{"role": "user", "content": prompt}]}
    else:
        raise MlflowException(
            f"Unsupported endpoint type: {endpoint_type}. If string input is provided, "
            "the endpoint type must be 'llm/v1/completions' or 'llm/v1/chat'.",
            error_code=INVALID_PARAMETER_VALUE,
        )


def _parse_response(
    response: dict[str, Any], endpoint_type: str | None
) -> str | None | dict[str, Any]:
    if endpoint_type == "llm/v1/completions":
        return _parse_completions_response_format(response)
    elif endpoint_type == "llm/v1/chat":
        return _parse_chat_response_format(response)
    else:
        return response


def _parse_chat_response_format(response):
    try:
        text = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        text = None
    return text


def _parse_completions_response_format(response):
    try:
        text = response["choices"][0]["text"]
    except (KeyError, IndexError, TypeError):
        text = None
    return text
