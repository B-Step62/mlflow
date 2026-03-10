import json

import pytest

from mlflow.gemini.genai_semconv_converter import GeminiConverter
from mlflow.tracing.constant import GenAiSemconvKey


@pytest.fixture
def converter():
    return GeminiConverter()


def test_convert_inputs_string(converter):
    inputs = {"contents": "Hello world"}
    result = converter.convert_inputs(inputs)
    assert result == [
        {"role": "user", "parts": [{"type": "text", "content": "Hello world"}]}
    ]


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
                "parts": [
                    {"function_call": {"name": "get_weather", "args": {"city": "SF"}}}
                ],
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
                    "parts": [
                        {"function_call": {"name": "search", "args": {"q": "test"}}}
                    ],
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
