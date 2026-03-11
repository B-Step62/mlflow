import json
from unittest.mock import patch

import pytest
from google import genai
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import mlflow
from mlflow.gemini.genai_semconv_converter import GeminiConverter
from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.processor.otel import OtelSpanProcessor
from mlflow.tracing.provider import provider as tracer_provider_wrapper

from tests.gemini.test_gemini_autolog import (
    _dummy_generate_content,
    _generate_content_response,
    multiply,
)
from tests.tracing.helper import reset_autolog_state  # noqa: F401


@pytest.fixture
def converter():
    return GeminiConverter()


def test_convert_inputs_string(converter):
    inputs = {"contents": "Hello world"}
    result = converter.convert_inputs(inputs)
    assert result == [{"role": "user", "parts": [{"type": "text", "content": "Hello world"}]}]


def test_convert_inputs_content_list(converter):
    inputs = {
        "contents": [
            {"role": "user", "parts": [{"text": "Hi"}]},
            {"role": "model", "parts": [{"text": "Hello!"}]},
        ]
    }
    result = converter.convert_inputs(inputs)
    assert result == [
        {"role": "user", "parts": [{"type": "text", "content": "Hi"}]},
        {"role": "assistant", "parts": [{"type": "text", "content": "Hello!"}]},
    ]


def test_convert_inputs_parts_list(converter):
    inputs = {
        "contents": [
            {"text": "First part"},
            "Second part",
        ]
    }
    result = converter.convert_inputs(inputs)
    assert result == [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "First part"},
                {"type": "text", "content": "Second part"},
            ],
        }
    ]


def test_convert_inputs_with_tool_calls(converter):
    inputs = {
        "contents": [
            {"role": "user", "parts": [{"text": "What's the weather?"}]},
            {
                "role": "model",
                "parts": [{"function_call": {"name": "get_weather", "args": {"city": "SF"}}}],
            },
            {
                "role": "user",
                "parts": [
                    {
                        "function_response": {
                            "name": "get_weather",
                            "response": {"result": "Sunny"},
                        }
                    }
                ],
            },
        ]
    }
    result = converter.convert_inputs(inputs)
    assert result[0] == {
        "role": "user",
        "parts": [{"type": "text", "content": "What's the weather?"}],
    }
    assert result[1] == {
        "role": "assistant",
        "parts": [
            {
                "type": "tool_call",
                "name": "get_weather",
                "arguments": {"city": "SF"},
            }
        ],
    }
    # function_response → role "tool"
    assert result[2] == {
        "role": "tool",
        "parts": [
            {
                "type": "tool_call_response",
                "name": "get_weather",
                "result": {"result": "Sunny"},
            }
        ],
    }


def test_convert_outputs_basic(converter):
    outputs = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": "Hello!"}],
                    "role": "model",
                },
                "finish_reason": "STOP",
            }
        ]
    }
    result = converter.convert_outputs(outputs)
    assert result == [
        {
            "role": "assistant",
            "parts": [{"type": "text", "content": "Hello!"}],
            "finish_reason": "STOP",
        }
    ]


def test_convert_outputs_with_tool_call(converter):
    outputs = {
        "candidates": [
            {
                "content": {
                    "parts": [{"function_call": {"name": "search", "args": {"q": "test"}}}],
                    "role": "model",
                },
                "finish_reason": "STOP",
            }
        ]
    }
    result = converter.convert_outputs(outputs)
    assert result == [
        {
            "role": "assistant",
            "parts": [
                {
                    "type": "tool_call",
                    "name": "search",
                    "arguments": {"q": "test"},
                }
            ],
            "finish_reason": "STOP",
        }
    ]


def test_convert_system_instructions(converter):
    inputs = {
        "contents": "Hi",
        "config": {"system_instruction": "Be helpful"},
    }
    result = converter.convert_system_instructions(inputs)
    assert result == [{"type": "text", "content": "Be helpful"}]


def test_convert_system_instructions_content_dict(converter):
    inputs = {
        "contents": "Hi",
        "config": {
            "system_instruction": {
                "role": "system",
                "parts": [{"text": "Be concise."}],
            }
        },
    }
    result = converter.convert_system_instructions(inputs)
    assert result == [{"type": "text", "content": "Be concise."}]


@pytest.mark.parametrize(
    ("part", "expected"),
    [
        # inline_data (image)
        (
            {"inline_data": {"data": "iVBOR...", "mime_type": "image/png"}},
            {
                "type": "blob",
                "modality": "image",
                "mime_type": "image/png",
                "content": "iVBOR...",
            },
        ),
        # file_data (image)
        (
            {"file_data": {"file_uri": "gs://bucket/img.jpg", "mime_type": "image/jpeg"}},
            {
                "type": "uri",
                "modality": "image",
                "mime_type": "image/jpeg",
                "uri": "gs://bucket/img.jpg",
            },
        ),
        # inline_data (audio)
        (
            {"inline_data": {"data": "audiodata", "mime_type": "audio/mp3"}},
            {
                "type": "blob",
                "modality": "audio",
                "mime_type": "audio/mp3",
                "content": "audiodata",
            },
        ),
        # file_data (video)
        (
            {"file_data": {"file_uri": "gs://bucket/vid.mp4", "mime_type": "video/mp4"}},
            {
                "type": "uri",
                "modality": "video",
                "mime_type": "video/mp4",
                "uri": "gs://bucket/vid.mp4",
            },
        ),
    ],
)
def test_convert_content_multimodal(converter, part, expected):
    inputs = {
        "contents": [
            {"role": "user", "parts": [part]},
        ]
    }
    result = converter.convert_inputs(inputs)
    assert result[0]["parts"] == [expected]


def test_extract_request_params(converter):
    inputs = {
        "contents": "Hi",
        "config": {
            "temperature": 0.5,
            "max_output_tokens": 200,
            "top_p": 0.8,
            "stop_sequences": ["\n"],
            "tools": [{"function_declarations": [{"name": "search"}]}],
        },
    }
    params = converter.extract_request_params(inputs)
    assert params[GenAiSemconvKey.REQUEST_TEMPERATURE] == 0.5
    assert params[GenAiSemconvKey.REQUEST_MAX_TOKENS] == 200
    assert params[GenAiSemconvKey.REQUEST_TOP_P] == 0.8
    assert list(params[GenAiSemconvKey.REQUEST_STOP_SEQUENCES]) == ["\n"]
    tool_defs = json.loads(params[GenAiSemconvKey.TOOL_DEFINITIONS])
    assert tool_defs[0]["function_declarations"][0]["name"] == "search"


def test_extract_response_attrs(converter):
    outputs = {
        "candidates": [
            {
                "content": {"parts": [{"text": "Hi"}], "role": "model"},
                "finish_reason": "STOP",
            }
        ]
    }
    attrs = converter.extract_response_attrs(outputs)
    assert attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] == ["STOP"]
    assert GenAiSemconvKey.RESPONSE_ID not in attrs


# --- Integration tests ---


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


def _get_llm_span(exporter, processor):
    processor.force_flush(timeout_millis=5000)
    spans = exporter.get_finished_spans()
    return next(s for s in spans if s.attributes.get("gen_ai.operation.name") == "generate_content")


@pytest.mark.usefixtures("reset_autolog_state")
def test_autolog_basic(genai_semconv_capture):
    exporter, processor = genai_semconv_capture

    mlflow.gemini.autolog()
    with patch(
        "google.genai.models.Models._generate_content",
        new=_dummy_generate_content(is_async=False),
    ):
        client = genai.Client(api_key="dummy")
        client.models.generate_content(model="gemini-1.5-flash", contents="test content")

    llm_span = _get_llm_span(exporter, processor)
    assert llm_span.attributes["gen_ai.operation.name"] == "generate_content"
    assert llm_span.attributes["gen_ai.request.model"] == "gemini-1.5-flash"

    input_msgs = json.loads(llm_span.attributes["gen_ai.input.messages"])
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["parts"][0]["type"] == "text"
    assert input_msgs[0]["parts"][0]["content"] == "test content"

    output_msgs = json.loads(llm_span.attributes["gen_ai.output.messages"])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["parts"][0]["content"] == "test answer"
    assert output_msgs[0]["finish_reason"] == "STOP"

    assert list(llm_span.attributes["gen_ai.response.finish_reasons"]) == ["STOP"]
    assert not any(k.startswith("mlflow.") for k in llm_span.attributes)


@pytest.mark.usefixtures("reset_autolog_state")
def test_autolog_with_tool_calls(genai_semconv_capture):
    exporter, processor = genai_semconv_capture

    tool_call_content = {
        "parts": [
            {
                "function_call": {
                    "name": "multiply",
                    "args": {"a": 57.0, "b": 44.0},
                }
            }
        ],
        "role": "model",
    }
    response = _generate_content_response(tool_call_content)

    def _generate_content(self, model, contents, config):
        return response

    mlflow.gemini.autolog()
    with patch("google.genai.models.Models._generate_content", new=_generate_content):
        client = genai.Client(api_key="dummy")
        client.models.generate_content(
            model="gemini-1.5-flash",
            contents="How much is 57 * 44?",
            config=genai.types.GenerateContentConfig(
                tools=[multiply],
                automatic_function_calling=genai.types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )

    llm_span = _get_llm_span(exporter, processor)
    assert llm_span.attributes["gen_ai.operation.name"] == "generate_content"
    assert llm_span.attributes["gen_ai.request.model"] == "gemini-1.5-flash"

    input_msgs = json.loads(llm_span.attributes["gen_ai.input.messages"])
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["parts"][0]["content"] == "How much is 57 * 44?"

    output_msgs = json.loads(llm_span.attributes["gen_ai.output.messages"])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    tool_part = output_msgs[0]["parts"][0]
    assert tool_part["type"] == "tool_call"
    assert tool_part["name"] == "multiply"
    assert tool_part["arguments"] == {"a": 57.0, "b": 44.0}

    assert "gen_ai.tool.definitions" in llm_span.attributes
    tool_defs_str = llm_span.attributes["gen_ai.tool.definitions"]
    assert "multiply" in tool_defs_str

    assert list(llm_span.attributes["gen_ai.response.finish_reasons"]) == ["STOP"]
    assert not any(k.startswith("mlflow.") for k in llm_span.attributes)
