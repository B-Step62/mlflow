import logging
from typing import Optional

import mlflow
from mlflow.bedrock.chat import convert_message_to_mlflow_chat, convert_tool_to_mlflow_chat_tool
from mlflow.bedrock.stream import ConverseStreamWrapper
from mlflow.bedrock.utils import skip_if_trace_disabled
from mlflow.entities import SpanType
from mlflow.tracing.utils import (
    set_span_chat_messages,
    set_span_chat_tools,
    start_client_span_or_trace,
)

_BEDROCK_SPAN_PREFIX = "BedrockRuntime."

_logger = logging.getLogger(__name__)



@skip_if_trace_disabled
def _patched_converse(original, self, *args, **kwargs):
    with mlflow.start_span(
        name=f"{_BEDROCK_SPAN_PREFIX}{original.__name__}",
        span_type=SpanType.CHAT_MODEL,
    ) as span:
        # NB: Bedrock client doesn't accept any positional arguments
        span.set_inputs(kwargs)
        _set_tool_attributes(span, kwargs)

        result = None
        try:
            result = original(self, *args, **kwargs)
            span.set_outputs(result)
        finally:
            _set_chat_messages_attributes(span, kwargs.get("messages", []), result)
        return result


@skip_if_trace_disabled
def _patched_converse_stream(original, self, *args, **kwargs):
    # NB: Do not use fluent API to create a span for streaming response. If we do so,
    # the span context will remain active until the stream is fully exhausted, which
    # can lead to super hard-to-debug issues.
    client = mlflow.MlflowClient()
    span = start_client_span_or_trace(
        client=client,
        name=f"{_BEDROCK_SPAN_PREFIX}{original.__name__}",
        span_type=SpanType.CHAT_MODEL,
        inputs=kwargs,
    )
    _set_tool_attributes(span, kwargs)

    result = original(self, *args, **kwargs)

    if span:
        result["stream"] = ConverseStreamWrapper(
            stream=result["stream"],
            span=span,
            client=client,
            inputs=kwargs,
        )

    return result


def _set_chat_messages_attributes(span, messages: list[dict], response: Optional[dict]):
    """
    Extract standard chat span attributes for the Bedrock Converse API call.

    NB: We only support standard attribute extraction for the Converse API, because
    the InvokeModel API exposes the raw API spec from each LLM provider, hence
    maintaining the compatibility for all providers is significantly cumbersome.
    """
    try:
        messages = [*messages]  # shallow copy to avoid appending to the original list
        if response:
            messages.append(response["output"]["message"])
        messages = [convert_message_to_mlflow_chat(msg) for msg in messages]
        set_span_chat_messages(span, messages)
    except Exception as e:
        _logger.debug(f"Failed to set messages for {span}. Error: {e}")


def _set_tool_attributes(span, kwargs):
    """Extract tool attributes for the Bedrock Converse API call."""
    if tool_config := kwargs.get("toolConfig"):
        try:
            tools = [convert_tool_to_mlflow_chat_tool(tool) for tool in tool_config["tools"]]
            set_span_chat_tools(span, tools)
        except Exception as e:
            _logger.debug(f"Failed to set tools for {span}. Error: {e}")
