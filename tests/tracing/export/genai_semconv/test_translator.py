import json

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanContext, SpanKind, TraceFlags
from opentelemetry.trace.status import Status, StatusCode

from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.export.genai_semconv.translator import (
    _build_genai_span_name,
    _build_readable_span,
    _get_genai_span_kind,
    _parse_json_attr,
    _translate_universal_attributes,
    translate_span_to_genai,
)


def _make_span(
    name="test_span",
    attributes=None,
    kind=SpanKind.INTERNAL,
    start_time=1000000000,
    end_time=2000000000,
):
    """Create a ReadableSpan for testing."""
    context = SpanContext(
        trace_id=0x000000000000000000000000DEADBEEF,
        span_id=0x00000000DEADBEF0,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    return ReadableSpan(
        name=name,
        context=context,
        kind=kind,
        attributes=attributes or {},
        start_time=start_time,
        end_time=end_time,
        status=Status(StatusCode.OK),
    )


class TestParseJsonAttr:
    def test_none(self):
        assert _parse_json_attr(None) is None

    def test_json_string(self):
        assert _parse_json_attr('"gpt-4o"') == "gpt-4o"

    def test_json_dict(self):
        assert _parse_json_attr('{"input_tokens": 10}') == {"input_tokens": 10}

    def test_plain_string(self):
        assert _parse_json_attr("not json {") == "not json {"

    def test_int(self):
        assert _parse_json_attr(42) == 42

    def test_dict(self):
        assert _parse_json_attr({"key": "value"}) == {"key": "value"}


class TestTranslateUniversalAttributes:
    def test_chat_model_span_type(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL")}
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "chat"

    def test_llm_span_type(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("LLM")}
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "generate_content"

    def test_embedding_span_type(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("EMBEDDING")}
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "embeddings"

    def test_tool_span_type(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("TOOL")}
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "execute_tool"

    def test_agent_span_type(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("AGENT")}
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "invoke_agent"

    def test_unmapped_span_type_returns_empty(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("CHAIN")}
        result = _translate_universal_attributes(attrs)
        assert "gen_ai.operation.name" not in result

    def test_workflow_span_type_returns_empty(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("WORKFLOW")}
        result = _translate_universal_attributes(attrs)
        assert "gen_ai.operation.name" not in result

    def test_model_name(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
        }
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.request.model"] == "gpt-4o"

    def test_provider(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            SpanAttributeKey.MODEL_PROVIDER: json.dumps("openai"),
        }
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.provider.name"] == "openai"

    def test_token_usage(self):
        usage = {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            SpanAttributeKey.CHAT_USAGE: json.dumps(usage),
        }
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.usage.input_tokens"] == 100
        assert result["gen_ai.usage.output_tokens"] == 50

    def test_tool_span_with_inputs_outputs(self):
        tool_input = {"query": "what is MLflow?"}
        tool_output = {"result": "MLflow is a platform..."}
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("TOOL"),
            SpanAttributeKey.INPUTS: json.dumps(tool_input),
            SpanAttributeKey.OUTPUTS: json.dumps(tool_output),
        }
        result = _translate_universal_attributes(attrs)
        assert result["gen_ai.operation.name"] == "execute_tool"
        assert json.loads(result["gen_ai.tool.call.arguments"]) == tool_input
        assert json.loads(result["gen_ai.tool.call.result"]) == tool_output

    def test_missing_attributes(self):
        result = _translate_universal_attributes({})
        assert result == {}

    def test_malformed_json_attributes(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: "not valid json {",
            SpanAttributeKey.MODEL: "also not valid {",
        }
        result = _translate_universal_attributes(attrs)
        # Should handle gracefully — span type won't map, model will be treated as string
        assert "gen_ai.operation.name" not in result


class TestBuildGenaiSpanName:
    def test_operation_and_model(self):
        attrs = {"gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-4o"}
        assert _build_genai_span_name("original", attrs) == "chat gpt-4o"

    def test_operation_only(self):
        attrs = {"gen_ai.operation.name": "chat"}
        assert _build_genai_span_name("original", attrs) == "chat"

    def test_no_operation(self):
        assert _build_genai_span_name("original", {}) == "original"


class TestGetGenaiSpanKind:
    def test_chat_operation_is_client(self):
        attrs = {"gen_ai.operation.name": "chat"}
        assert _get_genai_span_kind(attrs, SpanKind.INTERNAL) == SpanKind.CLIENT

    def test_embeddings_operation_is_client(self):
        attrs = {"gen_ai.operation.name": "embeddings"}
        assert _get_genai_span_kind(attrs, SpanKind.INTERNAL) == SpanKind.CLIENT

    def test_generate_content_is_client(self):
        attrs = {"gen_ai.operation.name": "generate_content"}
        assert _get_genai_span_kind(attrs, SpanKind.INTERNAL) == SpanKind.CLIENT

    def test_execute_tool_is_internal(self):
        attrs = {"gen_ai.operation.name": "execute_tool"}
        assert _get_genai_span_kind(attrs, SpanKind.CLIENT) == SpanKind.INTERNAL

    def test_invoke_agent_is_internal(self):
        attrs = {"gen_ai.operation.name": "invoke_agent"}
        assert _get_genai_span_kind(attrs, SpanKind.CLIENT) == SpanKind.INTERNAL

    def test_no_operation_keeps_original(self):
        assert _get_genai_span_kind({}, SpanKind.INTERNAL) == SpanKind.INTERNAL


class TestTranslateSpanToGenai:
    def test_full_chat_span(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
            SpanAttributeKey.MODEL_PROVIDER: json.dumps("openai"),
            SpanAttributeKey.CHAT_USAGE: json.dumps(
                {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
            ),
            SpanAttributeKey.MESSAGE_FORMAT: json.dumps("openai"),
            SpanAttributeKey.INPUTS: json.dumps(
                {"messages": [{"role": "user", "content": "Hello"}], "model": "gpt-4o"}
            ),
            SpanAttributeKey.OUTPUTS: json.dumps(
                {
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": "Hi!"},
                            "finish_reason": "stop",
                        }
                    ]
                }
            ),
        }
        span = _make_span(name="ChatCompletion.create", attributes=attrs)
        result = translate_span_to_genai(span)

        assert result.name == "chat gpt-4o"
        assert result.kind == SpanKind.CLIENT
        assert result.attributes["gen_ai.operation.name"] == "chat"
        assert result.attributes["gen_ai.request.model"] == "gpt-4o"
        assert result.attributes["gen_ai.provider.name"] == "openai"
        assert result.attributes["gen_ai.usage.input_tokens"] == 100
        assert result.attributes["gen_ai.usage.output_tokens"] == 50
        assert "gen_ai.input.messages" in result.attributes
        assert "gen_ai.output.messages" in result.attributes
        # mlflow.* attributes should be stripped
        assert not any(k.startswith("mlflow.") for k in result.attributes)

    def test_unmapped_span_type_passes_through(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAIN"),
            "custom.attribute": "preserved",
        }
        span = _make_span(name="my_chain", attributes=attrs)
        result = translate_span_to_genai(span)

        # No GenAI attrs
        assert "gen_ai.operation.name" not in result.attributes
        # Custom attrs preserved
        assert result.attributes["custom.attribute"] == "preserved"
        # mlflow.* stripped
        assert not any(k.startswith("mlflow.") for k in result.attributes)
        # Name unchanged
        assert result.name == "my_chain"

    def test_capture_content_false_strips_messages(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
            SpanAttributeKey.MESSAGE_FORMAT: json.dumps("openai"),
            SpanAttributeKey.INPUTS: json.dumps(
                {"messages": [{"role": "user", "content": "Hello"}]}
            ),
        }
        span = _make_span(attributes=attrs)
        result = translate_span_to_genai(span, capture_content=False)

        assert result.attributes["gen_ai.operation.name"] == "chat"
        assert result.attributes["gen_ai.request.model"] == "gpt-4o"
        assert "gen_ai.input.messages" not in result.attributes
        assert "gen_ai.output.messages" not in result.attributes

    def test_non_mlflow_attributes_preserved(self):
        attrs = {
            SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
            "http.method": "POST",
            "http.url": "https://api.openai.com/v1/chat/completions",
        }
        span = _make_span(attributes=attrs)
        result = translate_span_to_genai(span)

        assert result.attributes["http.method"] == "POST"
        assert result.attributes["http.url"] == "https://api.openai.com/v1/chat/completions"

    def test_span_context_preserved(self):
        attrs = {SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL")}
        span = _make_span(attributes=attrs)
        result = translate_span_to_genai(span)

        assert result.context == span.context
        assert result.start_time == span.start_time
        assert result.end_time == span.end_time
        assert result.status == span.status

    def test_empty_attributes(self):
        span = _make_span(attributes={})
        result = translate_span_to_genai(span)
        assert result.attributes == {}


class TestBuildReadableSpan:
    def test_creates_new_span_with_overrides(self):
        span = _make_span(name="original", attributes={"key": "value"}, kind=SpanKind.INTERNAL)
        new_span = _build_readable_span(
            span,
            name="new_name",
            attributes={"new_key": "new_value"},
            kind=SpanKind.CLIENT,
        )

        assert new_span.name == "new_name"
        assert new_span.attributes == {"new_key": "new_value"}
        assert new_span.kind == SpanKind.CLIENT
        assert new_span.context == span.context
        assert new_span.start_time == span.start_time
        assert new_span.end_time == span.end_time
