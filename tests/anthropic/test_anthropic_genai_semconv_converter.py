import json

import pytest

from mlflow.anthropic.genai_semconv_converter import AnthropicConverter
from mlflow.tracing.constant import GenAiSemconvKey


@pytest.fixture
def converter():
    return AnthropicConverter()


def test_convert_inputs_basic(converter):
    inputs = {
        "messages": [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]
    }
    result = converter.convert_inputs(inputs)
    assert result == [
        {"role": "user", "parts": [{"type": "text", "content": "Hello"}]},
        {"role": "assistant", "parts": [{"type": "text", "content": "Hi there"}]},
    ]


def test_convert_inputs_with_tool_calls(converter):
    inputs = {
        "messages": [
            {"role": "user", "content": "What's the weather?"},
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "call_1",
                        "name": "get_weather",
                        "input": {"city": "SF"},
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "call_1",
                        "content": "Sunny, 72F",
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
                "id": "call_1",
                "name": "get_weather",
                "arguments": {"city": "SF"},
            }
        ],
    }
    # Single tool_result → role "tool"
    assert result[2] == {
        "role": "tool",
        "parts": [
            {
                "type": "tool_call_response",
                "id": "call_1",
                "result": "Sunny, 72F",
            }
        ],
    }


def test_convert_outputs_basic(converter):
    outputs = {
        "id": "msg_123",
        "role": "assistant",
        "content": [{"type": "text", "text": "Hello!"}],
        "model": "claude-sonnet-4-20250514",
        "stop_reason": "end_turn",
    }
    result = converter.convert_outputs(outputs)
    assert result == [
        {
            "role": "assistant",
            "parts": [{"type": "text", "content": "Hello!"}],
            "finish_reason": "end_turn",
        }
    ]


def test_convert_outputs_with_tool_use(converter):
    outputs = {
        "id": "msg_456",
        "role": "assistant",
        "content": [
            {"type": "text", "text": "Let me check."},
            {
                "type": "tool_use",
                "id": "call_2",
                "name": "search",
                "input": {"query": "weather"},
            },
        ],
        "stop_reason": "tool_use",
    }
    result = converter.convert_outputs(outputs)
    assert result == [
        {
            "role": "assistant",
            "parts": [
                {"type": "text", "content": "Let me check."},
                {
                    "type": "tool_call",
                    "id": "call_2",
                    "name": "search",
                    "arguments": {"query": "weather"},
                },
            ],
            "finish_reason": "tool_use",
        }
    ]


def test_convert_system_instructions_string(converter):
    inputs = {"system": "You are a helpful assistant.", "messages": []}
    result = converter.convert_system_instructions(inputs)
    assert result == [{"type": "text", "content": "You are a helpful assistant."}]


def test_convert_system_instructions_list(converter):
    inputs = {
        "system": [
            {"type": "text", "text": "Be concise."},
            {"type": "text", "text": "Be accurate."},
        ],
        "messages": [],
    }
    result = converter.convert_system_instructions(inputs)
    assert result == [
        {"type": "text", "content": "Be concise."},
        {"type": "text", "content": "Be accurate."},
    ]


@pytest.mark.parametrize(
    ("block", "expected"),
    [
        # Image base64
        (
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "iVBOR...",
                },
            },
            {
                "type": "blob",
                "modality": "image",
                "mime_type": "image/png",
                "content": "iVBOR...",
            },
        ),
        # Image URL
        (
            {
                "type": "image",
                "source": {"type": "url", "url": "https://example.com/img.png"},
            },
            {"type": "uri", "modality": "image", "uri": "https://example.com/img.png"},
        ),
        # Document base64
        (
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": "JVBERi...",
                },
            },
            {
                "type": "blob",
                "modality": "document",
                "mime_type": "application/pdf",
                "content": "JVBERi...",
            },
        ),
        # Document URL
        (
            {
                "type": "document",
                "source": {"type": "url", "url": "https://example.com/doc.pdf"},
            },
            {"type": "uri", "modality": "document", "uri": "https://example.com/doc.pdf"},
        ),
    ],
)
def test_convert_content_multimodal(converter, block, expected):
    inputs = {"messages": [{"role": "user", "content": [block]}]}
    result = converter.convert_inputs(inputs)
    assert result[0]["parts"] == [expected]


def test_extract_request_params(converter):
    inputs = {
        "messages": [],
        "temperature": 0.7,
        "max_tokens": 100,
        "top_p": 0.9,
        "stop_sequences": ["END", "STOP"],
        "tools": [
            {
                "name": "get_weather",
                "description": "Get weather",
                "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
            }
        ],
    }
    params = converter.extract_request_params(inputs)
    assert params[GenAiSemconvKey.REQUEST_TEMPERATURE] == 0.7
    assert params[GenAiSemconvKey.REQUEST_MAX_TOKENS] == 100
    assert params[GenAiSemconvKey.REQUEST_TOP_P] == 0.9
    assert list(params[GenAiSemconvKey.REQUEST_STOP_SEQUENCES]) == ["END", "STOP"]
    tool_defs = json.loads(params[GenAiSemconvKey.TOOL_DEFINITIONS])
    assert tool_defs[0]["name"] == "get_weather"


def test_extract_response_attrs(converter):
    outputs = {
        "id": "msg_abc",
        "model": "claude-sonnet-4-20250514",
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": "Hi"}],
    }
    attrs = converter.extract_response_attrs(outputs)
    assert attrs[GenAiSemconvKey.RESPONSE_ID] == "msg_abc"
    assert attrs[GenAiSemconvKey.RESPONSE_MODEL] == "claude-sonnet-4-20250514"
    assert attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] == ["end_turn"]
