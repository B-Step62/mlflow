import json
import uuid

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from mlflow.langchain.langchain_tracer import MlflowLangchainTracer
from mlflow.tracing.processor.otel import OtelSpanProcessor
from mlflow.tracing.provider import provider as tracer_provider_wrapper


@pytest.fixture
def genai_semconv_capture(monkeypatch):
    monkeypatch.setenv("MLFLOW_ENABLE_OTEL_GENAI_SEMCONV", "true")
    exporter = InMemorySpanExporter()
    tracer_provider_wrapper.get_or_init_tracer("test")
    tp = tracer_provider_wrapper.get()
    processor = OtelSpanProcessor(span_exporter=exporter, export_metrics=False)
    processor._should_register_traces = False
    tp.add_span_processor(processor)
    yield exporter, processor
    processor.force_flush(timeout_millis=5000)
    processor.shutdown()


def _get_chat_span(exporter, processor):
    processor.force_flush(timeout_millis=5000)
    spans = exporter.get_finished_spans()
    return next(s for s in spans if s.attributes.get("gen_ai.operation.name") == "chat")


def _invoke_chat(messages, response, *, invocation_params=None):
    callback = MlflowLangchainTracer()
    run_id = str(uuid.uuid4())
    kwargs = {}
    if invocation_params:
        kwargs["invocation_params"] = invocation_params
    callback.on_chat_model_start(
        {},
        [messages],
        run_id=run_id,
        name="test_chat_model",
        **kwargs,
    )
    callback.on_llm_end(response, run_id=run_id)


def test_basic_chat(genai_semconv_capture):
    exporter, processor = genai_semconv_capture

    messages = [
        SystemMessage("You are helpful."),
        HumanMessage("Hello"),
    ]
    response = LLMResult(
        generations=[
            [ChatGeneration(message=AIMessage(content="Hi there!"))]
        ]
    )
    _invoke_chat(
        messages, response, invocation_params={"model": "gpt-4o", "_type": "openai-chat"}
    )

    chat_span = _get_chat_span(exporter, processor)
    assert chat_span.attributes["gen_ai.operation.name"] == "chat"
    assert chat_span.attributes["gen_ai.request.model"] == "gpt-4o"
    assert chat_span.attributes["gen_ai.provider.name"] == "openai"

    # System instructions extracted separately
    system = json.loads(chat_span.attributes["gen_ai.system_instructions"])
    assert system == [{"type": "text", "content": "You are helpful."}]

    # Input messages exclude system
    input_msgs = json.loads(chat_span.attributes["gen_ai.input.messages"])
    assert len(input_msgs) == 1
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["parts"][0] == {"type": "text", "content": "Hello"}

    # Output messages
    output_msgs = json.loads(chat_span.attributes["gen_ai.output.messages"])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["parts"][0] == {"type": "text", "content": "Hi there!"}

    assert not any(k.startswith("mlflow.") for k in chat_span.attributes)


def test_chat_with_tool_calls(genai_semconv_capture):
    exporter, processor = genai_semconv_capture

    messages = [
        HumanMessage("What's the weather in SF?"),
        AIMessage(
            content="",
            tool_calls=[
                {"name": "get_weather", "args": {"city": "SF"}, "id": "call_1", "type": "tool_call"}
            ],
        ),
        ToolMessage(content="Sunny, 72F", tool_call_id="call_1"),
    ]
    response = LLMResult(
        generations=[[ChatGeneration(message=AIMessage(content="It's sunny and 72F in SF!"))]]
    )
    _invoke_chat(messages, response)

    chat_span = _get_chat_span(exporter, processor)
    input_msgs = json.loads(chat_span.attributes["gen_ai.input.messages"])

    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["parts"][0]["content"] == "What's the weather in SF?"

    assert input_msgs[1]["role"] == "assistant"
    tool_call_part = next(p for p in input_msgs[1]["parts"] if p["type"] == "tool_call")
    assert tool_call_part["id"] == "call_1"
    assert tool_call_part["name"] == "get_weather"
    assert tool_call_part["arguments"] == {"city": "SF"}

    assert input_msgs[2]["role"] == "tool"
    assert input_msgs[2]["parts"][0]["type"] == "tool_call_response"
    assert input_msgs[2]["parts"][0]["id"] == "call_1"
    assert input_msgs[2]["parts"][0]["result"] == "Sunny, 72F"

    output_msgs = json.loads(chat_span.attributes["gen_ai.output.messages"])
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["parts"][0]["content"] == "It's sunny and 72F in SF!"


def test_chat_with_multimodal_content(genai_semconv_capture):
    exporter, processor = genai_semconv_capture

    messages = [
        HumanMessage(
            content=[
                {"type": "text", "text": "What's in this image?"},
                {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
            ]
        ),
    ]
    response = LLMResult(
        generations=[[ChatGeneration(message=AIMessage(content="A cat."))]]
    )
    _invoke_chat(messages, response)

    chat_span = _get_chat_span(exporter, processor)
    input_msgs = json.loads(chat_span.attributes["gen_ai.input.messages"])

    parts = input_msgs[0]["parts"]
    assert parts[0] == {"type": "text", "content": "What's in this image?"}
    assert parts[1] == {
        "type": "uri",
        "modality": "image",
        "mime_type": "image/png",
        "uri": "https://example.com/img.png",
    }


def test_chat_output_text_only_generation(genai_semconv_capture):
    """Plain Generation (non-chat LLM) with only text, no message dict."""
    exporter, processor = genai_semconv_capture

    callback = MlflowLangchainTracer()
    run_id = str(uuid.uuid4())
    callback.on_llm_start(
        {},
        ["Tell me a joke"],
        run_id=run_id,
        name="test_llm",
    )
    # LLMResult with plain Generation (no message field, just text)
    response = LLMResult(generations=[[{"text": "Why did the chicken cross the road?"}]])
    callback.on_llm_end(response, run_id=run_id)

    processor.force_flush(timeout_millis=5000)
    spans = exporter.get_finished_spans()
    llm_span = next(
        s for s in spans if s.attributes.get("gen_ai.operation.name") == "generate_content"
    )

    output_msgs = json.loads(llm_span.attributes["gen_ai.output.messages"])
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["parts"][0]["content"] == "Why did the chicken cross the road?"


def test_no_request_params_or_response_attrs(genai_semconv_capture):
    """LangChain converter returns empty params/attrs (stored in invocation_params, not inputs)."""
    exporter, processor = genai_semconv_capture

    messages = [HumanMessage("Hi")]
    response = LLMResult(
        generations=[[ChatGeneration(message=AIMessage(content="Hey"))]]
    )
    _invoke_chat(messages, response)

    chat_span = _get_chat_span(exporter, processor)
    # No request params like temperature, max_tokens should be set by the converter
    assert "gen_ai.request.temperature" not in chat_span.attributes
    assert "gen_ai.request.max_tokens" not in chat_span.attributes
    assert "gen_ai.request.top_p" not in chat_span.attributes
    # No response id or model from outputs
    assert "gen_ai.response.id" not in chat_span.attributes
    assert "gen_ai.response.model" not in chat_span.attributes
