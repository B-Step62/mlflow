import json
import re
import time

import mlflow
from mlflow.bedrock.stream import AgentStreamWrapper
from mlflow.entities import Document, SpanType
from mlflow.tracing.provider import detach_span_from_context, set_span_in_context
from mlflow.tracing.utils import set_span_chat_messages, start_client_span_or_trace, end_client_span_or_trace, construct_full_inputs

_BEDROCK_SPAN_PREFIX = "Bedrock."

def _patched_invoke_agent(original, self, *args, **kwargs):
    """
    Patched version of the BedrockRuntimeClient.invoke_agent method that logs traces and models.
    """
    # NB: Do not use fluent API to create a span for streaming response. If we do so,
    # the span context will remain active until the stream is fully exhausted, which
    # can lead to super hard-to-debug issues.
    client = mlflow.MlflowClient()
    input_text = kwargs.get("inputText")
    span = start_client_span_or_trace(
        client=client,
        name=f"{_BEDROCK_SPAN_PREFIX}{original.__name__}",
        span_type=SpanType.AGENT,
        inputs=input_text,
        attributes=kwargs,
    )
    result = original(self, *args, **kwargs)
    if span:
        result["completion"] = AgentStreamWrapper(
            stream=result["completion"],
            span=span,
            client=client,
            inputs=kwargs,
        )

    return result