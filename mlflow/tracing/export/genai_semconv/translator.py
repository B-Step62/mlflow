"""
Core translator for converting MLflow spans to OpenTelemetry GenAI Semantic Convention format.

Two-phase translation:
  Phase 1 — Universal attributes (model, provider, tokens, span type) that are already
            normalized across all autologging integrations.
  Phase 2 — Format-specific message content dispatched by MESSAGE_FORMAT attribute.
"""

import json
import logging
from typing import Any

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanKind

from mlflow.entities.span import SpanType
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.export.genai_semconv.message_handlers import (
    extract_request_params,
    extract_response_attrs,
    translate_messages_for_format,
)

_logger = logging.getLogger(__name__)

# Phase 1: Span type → GenAI operation name mapping
_SPAN_TYPE_TO_OPERATION: dict[str, str | None] = {
    SpanType.CHAT_MODEL: "chat",
    SpanType.LLM: "generate_content",
    SpanType.EMBEDDING: "embeddings",
    SpanType.TOOL: "execute_tool",
    SpanType.AGENT: "invoke_agent",
    SpanType.RETRIEVER: "execute_tool",
    SpanType.RERANKER: "execute_tool",
    # No natural GenAI semconv equivalent — pass through as-is
    SpanType.CHAIN: None,
    SpanType.WORKFLOW: None,
    SpanType.PARSER: None,
    SpanType.MEMORY: None,
    SpanType.GUARDRAIL: None,
    SpanType.EVALUATOR: None,
    SpanType.TASK: None,
    SpanType.UNKNOWN: None,
}

# GenAI semconv requires CLIENT for inference spans, INTERNAL for tool/agent spans
_OPERATION_TO_SPAN_KIND: dict[str, SpanKind] = {
    "chat": SpanKind.CLIENT,
    "text_completion": SpanKind.CLIENT,
    "embeddings": SpanKind.CLIENT,
    "generate_content": SpanKind.CLIENT,
    "execute_tool": SpanKind.INTERNAL,
    "invoke_agent": SpanKind.INTERNAL,
}


def translate_span_to_genai(span: ReadableSpan, capture_content: bool = True) -> ReadableSpan:
    """
    Translate a single MLflow span to GenAI Semantic Convention format.

    Args:
        span: The original OTel ReadableSpan with mlflow.* attributes.
        capture_content: Whether to include opt-in content (messages, tool args).

    Returns:
        A new ReadableSpan with GenAI semconv attributes.
    """
    original_attrs = dict(span.attributes or {})

    # Phase 1: Universal translation (works for all formats)
    genai_attrs = _translate_universal_attributes(original_attrs)

    if not genai_attrs:
        # No GenAI mapping — strip mlflow.* attrs and pass through
        return _create_passthrough_span(span, original_attrs)

    # Phase 2: Format-specific message translation
    if capture_content:
        message_format = _parse_json_attr(original_attrs.get(SpanAttributeKey.MESSAGE_FORMAT))
        inputs = _parse_json_attr(original_attrs.get(SpanAttributeKey.INPUTS))
        outputs = _parse_json_attr(original_attrs.get(SpanAttributeKey.OUTPUTS))

        if inputs is not None or outputs is not None:
            message_attrs = translate_messages_for_format(message_format, inputs, outputs)
            genai_attrs.update(message_attrs)

            # Extract additional request/response parameters
            if isinstance(inputs, dict):
                genai_attrs.update(extract_request_params(inputs))
            if isinstance(outputs, dict):
                genai_attrs.update(extract_response_attrs(outputs))

    # Merge: Keep non-mlflow.* attrs, add GenAI attrs
    merged_attrs = {k: v for k, v in original_attrs.items() if not k.startswith("mlflow.")}
    merged_attrs.update(genai_attrs)

    new_name = _build_genai_span_name(span.name, genai_attrs)
    new_kind = _get_genai_span_kind(genai_attrs, span.kind)

    return _build_readable_span(span, name=new_name, attributes=merged_attrs, kind=new_kind)


def _translate_universal_attributes(mlflow_attrs: dict[str, Any]) -> dict[str, Any]:
    """Phase 1: Translate normalized MLflow attributes to GenAI semconv attributes."""
    genai_attrs: dict[str, Any] = {}

    # 1. Operation name from span type
    span_type = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.SPAN_TYPE))
    if span_type is not None:
        operation = _SPAN_TYPE_TO_OPERATION.get(span_type)
        if operation:
            genai_attrs["gen_ai.operation.name"] = operation

    # 2. Model
    model = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.MODEL))
    if model:
        genai_attrs["gen_ai.request.model"] = model

    # 3. Provider
    provider = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.MODEL_PROVIDER))
    if provider:
        genai_attrs["gen_ai.provider.name"] = provider

    # 4. Token usage
    usage = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.CHAT_USAGE))
    if isinstance(usage, dict):
        if (input_tokens := usage.get("input_tokens")) is not None:
            genai_attrs["gen_ai.usage.input_tokens"] = input_tokens
        if (output_tokens := usage.get("output_tokens")) is not None:
            genai_attrs["gen_ai.usage.output_tokens"] = output_tokens

    # 5. Tool attributes (for TOOL spans)
    if span_type == SpanType.TOOL:
        inputs = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.INPUTS))
        if inputs is not None:
            genai_attrs["gen_ai.tool.call.arguments"] = json.dumps(inputs)
        outputs = _parse_json_attr(mlflow_attrs.get(SpanAttributeKey.OUTPUTS))
        if outputs is not None:
            genai_attrs["gen_ai.tool.call.result"] = json.dumps(outputs)

    return genai_attrs


def _build_genai_span_name(original_name: str, genai_attrs: dict[str, Any]) -> str:
    """
    Build GenAI semconv span name: "{operation} {model}" (e.g., "chat gpt-4o").

    Falls back to the original span name if operation or model is missing.
    """
    operation = genai_attrs.get("gen_ai.operation.name")
    model = genai_attrs.get("gen_ai.request.model")

    if operation and model:
        return f"{operation} {model}"
    if operation:
        return operation
    return original_name


def _get_genai_span_kind(genai_attrs: dict[str, Any], original_kind: SpanKind) -> SpanKind:
    """
    Get the correct SpanKind for GenAI semconv.

    GenAI semconv requires CLIENT for inference spans and INTERNAL for tool/agent spans.
    """
    operation = genai_attrs.get("gen_ai.operation.name")
    if operation and operation in _OPERATION_TO_SPAN_KIND:
        return _OPERATION_TO_SPAN_KIND[operation]
    return original_kind


def _create_passthrough_span(span: ReadableSpan, original_attrs: dict[str, Any]) -> ReadableSpan:
    """Create a span with mlflow.* attributes stripped but no GenAI translation."""
    cleaned_attrs = {k: v for k, v in original_attrs.items() if not k.startswith("mlflow.")}
    return _build_readable_span(span, name=span.name, attributes=cleaned_attrs, kind=span.kind)


def _build_readable_span(
    original: ReadableSpan,
    name: str,
    attributes: dict[str, Any],
    kind: SpanKind,
) -> ReadableSpan:
    """
    Construct a new ReadableSpan with overridden name, attributes, and kind.

    ReadableSpan objects are frozen, so we must create new instances.
    """
    return ReadableSpan(
        name=name,
        context=original.context,
        parent=original.parent,
        resource=original.resource,
        attributes=attributes,
        events=original.events,
        links=original.links,
        kind=kind,
        instrumentation_scope=original.instrumentation_scope,
        status=original.status,
        start_time=original.start_time,
        end_time=original.end_time,
    )


def _parse_json_attr(value: Any) -> Any:
    """
    Parse a JSON-encoded attribute value.

    MLflow stores span attributes as JSON-encoded strings (e.g., '"gpt-4o"' for strings,
    '{"input_tokens": 10}' for dicts). This helper unwraps them.
    """
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError):
            return value
    return value
