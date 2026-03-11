import json
from unittest.mock import patch

import pytest
from google import genai
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import mlflow
from mlflow.gemini.genai_semconv_converter import _convert_part
from mlflow.tracing.processor.otel import OtelSpanProcessor
from mlflow.tracing.provider import provider as tracer_provider_wrapper

from tests.gemini.test_gemini_autolog import (
    _dummy_generate_content,
    _generate_content_response,
    multiply,
)
from tests.tracing.helper import reset_autolog_state  # noqa: F401

MODEL = "gemini-1.5-flash"


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
        client.models.generate_content(model=MODEL, contents="test content")

    llm_span = _get_llm_span(exporter, processor)
    assert llm_span.attributes["gen_ai.operation.name"] == "generate_content"
    assert llm_span.attributes["gen_ai.request.model"] == MODEL

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
            model=MODEL,
            contents="How much is 57 * 44?",
            config=genai.types.GenerateContentConfig(
                tools=[multiply],
                automatic_function_calling=genai.types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )

    llm_span = _get_llm_span(exporter, processor)
    assert llm_span.attributes["gen_ai.operation.name"] == "generate_content"
    assert llm_span.attributes["gen_ai.request.model"] == MODEL

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
    assert "multiply" in llm_span.attributes["gen_ai.tool.definitions"]

    assert list(llm_span.attributes["gen_ai.response.finish_reasons"]) == ["STOP"]
    assert not any(k.startswith("mlflow.") for k in llm_span.attributes)


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
def test_convert_part_multimodal(part, expected):
    assert _convert_part(part) == expected
