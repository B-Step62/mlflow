import io
import json
from typing import Any, Union

from botocore.response import StreamingBody

import mlflow
from mlflow.bedrock.stream import InvokeModelStreamWrapper
from mlflow.bedrock.utils import skip_if_trace_disabled
from mlflow.entities import SpanType
from mlflow.tracing.utils import start_client_span_or_trace

_BEDROCK_SPAN_PREFIX = "BedrockRuntime."



@skip_if_trace_disabled
def _patched_invoke_model(original, self, *args, **kwargs):
    with mlflow.start_span(name=f"{_BEDROCK_SPAN_PREFIX}{original.__name__}") as span:
        # NB: Bedrock client doesn't accept any positional arguments
        span.set_inputs(kwargs)

        result = original(self, *args, **kwargs)

        result["body"] = _buffer_stream(result["body"])
        parsed_response_body = _parse_invoke_model_response_body(result["body"])

        # Determine the span type based on the key in the response body.
        # As of 2024 Dec 9th, all supported embedding models in Bedrock returns the response body
        # with the key "embedding". This might change in the future.
        span_type = SpanType.EMBEDDING if "embedding" in parsed_response_body else SpanType.LLM
        span.set_span_type(span_type)
        span.set_outputs({**result, "body": parsed_response_body})

        return result



@skip_if_trace_disabled
def _patched_invoke_model_with_response_stream(original, self, *args, **kwargs):
    client = mlflow.MlflowClient()

    span = start_client_span_or_trace(
        client=client,
        name=f"{_BEDROCK_SPAN_PREFIX}{original.__name__}",
        # NB: Since we don't inspect the response body for this method, the span type is unknown.
        # We assume it is LLM as using streaming for embedding is not common.
        span_type=SpanType.LLM,
        inputs=kwargs,
    )

    result = original(self, *args, **kwargs)

    # To avoid consuming the stream during serialization, set dummy outputs for the span.
    span.set_outputs({**result, "body": "EventStream"})

    result["body"] = InvokeModelStreamWrapper(stream=result["body"], client=client, span=span)
    return result


def _buffer_stream(raw_stream: StreamingBody) -> StreamingBody:
    """
    Create a buffered stream from the raw byte stream.

    The boto3's invoke_model() API returns the LLM response as a byte stream.
    We need to read the stream data to set the span outputs, however, the stream
    can only be read once and not seekable (https://github.com/boto/boto3/issues/564).
    To work around this, we create a buffered stream that can be read multiple times.
    """
    buffered_response = io.BytesIO(raw_stream.read())
    buffered_response.seek(0)
    return StreamingBody(buffered_response, raw_stream._content_length)


def _parse_invoke_model_response_body(response_body: StreamingBody) -> Union[dict[str, Any], str]:
    content = response_body.read()
    try:
        return json.loads(content)
    except Exception:
        # When failed to parse the response body as JSON, return the raw response
        return content
    finally:
        # Reset the stream position to the beginning
        response_body._raw_stream.seek(0)
        # Boto3 uses this attribute to validate the amount of data read from the stream matches
        # the content length, so we need to reset it as well.
        # https://github.com/boto/botocore/blob/f88e981cb1a6cd0c64bc89da262ab76f9bfa9b7d/botocore/response.py#L164C17-L164C32
        response_body._amount_read = 0
