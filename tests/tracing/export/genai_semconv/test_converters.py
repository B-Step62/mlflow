import json

from mlflow.openai.genai_semconv_converter import OpenAiSemconvConverter
from mlflow.tracing.constant import GenAiSemconvKey

# --- OpenAI converter ---


def test_openai_basic_messages():
    converter = OpenAiSemconvConverter()
    inputs = {
        "messages": [
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hello"},
        ],
        "model": "gpt-4o",
    }
    outputs = {
        "choices": [
            {
                "message": {"role": "assistant", "content": "Hi there!"},
                "finish_reason": "stop",
            }
        ]
    }
    result = converter.translate(inputs, outputs)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert len(input_msgs) == 2
    assert input_msgs[0]["role"] == "system"
    assert input_msgs[0]["content"] == [{"type": "text", "text": "You are helpful"}]
    assert input_msgs[1]["role"] == "user"

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi there!"}]
    assert output_msgs[0]["finish_reason"] == "stop"


def test_openai_tool_calls():
    converter = OpenAiSemconvConverter()
    inputs = {"messages": [{"role": "user", "content": "What's the weather?"}]}
    outputs = {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "function": {
                                "name": "get_weather",
                                "arguments": '{"location": "SF"}',
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
    }
    result = converter.translate(inputs, outputs)

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    parts = output_msgs[0]["content"]
    tool_part = next(p for p in parts if p["type"] == "tool_call")
    assert tool_part["name"] == "get_weather"
    assert tool_part["id"] == "call_123"


def test_openai_multipart_content():
    converter = OpenAiSemconvConverter()
    inputs = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What's in this image?"},
                    {"type": "image_url", "image_url": {"url": "http://example.com/img.png"}},
                ],
            }
        ]
    }
    result = converter.translate(inputs, None)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    parts = input_msgs[0]["content"]
    assert parts[0] == {"type": "text", "text": "What's in this image?"}
    assert parts[1]["type"] == "text"  # Non-text parts are JSON-stringified


def test_openai_no_messages_in_inputs():
    converter = OpenAiSemconvConverter()
    result = converter.translate({"model": "gpt-4o"}, None)
    assert GenAiSemconvKey.INPUT_MESSAGES not in result


def test_openai_finish_reasons():
    converter = OpenAiSemconvConverter()
    outputs = {
        "choices": [{"finish_reason": "stop"}, {"finish_reason": "length"}],
    }
    result = converter.translate(None, outputs)
    assert result[GenAiSemconvKey.RESPONSE_FINISH_REASONS] == ["stop", "length"]


# --- Converter dispatch via _get_converter ---


def test_get_converter_openai():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("openai"), OpenAiSemconvConverter)


def test_get_converter_groq_delegates_to_openai():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("groq"), OpenAiSemconvConverter)


def test_get_converter_bedrock_delegates_to_openai():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("bedrock"), OpenAiSemconvConverter)


def test_get_converter_unknown_returns_none():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert _get_converter("unknown_format") is None


def test_get_converter_none_returns_none():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert _get_converter(None) is None


# --- Base converter extract_request_params / extract_response_attrs ---


def test_extract_request_params_temperature():
    converter = OpenAiSemconvConverter()
    result = converter.extract_request_params({"temperature": 0.7})
    assert result[GenAiSemconvKey.REQUEST_TEMPERATURE] == 0.7


def test_extract_request_params_max_tokens():
    converter = OpenAiSemconvConverter()
    result = converter.extract_request_params({"max_tokens": 1000})
    assert result[GenAiSemconvKey.REQUEST_MAX_TOKENS] == 1000


def test_extract_request_params_top_p():
    converter = OpenAiSemconvConverter()
    result = converter.extract_request_params({"top_p": 0.9})
    assert result[GenAiSemconvKey.REQUEST_TOP_P] == 0.9


def test_extract_request_params_stop():
    converter = OpenAiSemconvConverter()
    result = converter.extract_request_params({"stop": ["\n"]})
    assert result[GenAiSemconvKey.REQUEST_STOP_SEQUENCES] == ["\n"]


def test_extract_request_params_tools():
    converter = OpenAiSemconvConverter()
    tools = [{"type": "function", "function": {"name": "get_weather"}}]
    result = converter.extract_request_params({"tools": tools})
    assert json.loads(result[GenAiSemconvKey.TOOL_DEFINITIONS]) == tools


def test_extract_request_params_empty():
    converter = OpenAiSemconvConverter()
    result = converter.extract_request_params({})
    assert result == {}


def test_extract_response_attrs_id():
    converter = OpenAiSemconvConverter()
    result = converter.extract_response_attrs({"id": "chatcmpl-123"})
    assert result[GenAiSemconvKey.RESPONSE_ID] == "chatcmpl-123"


def test_extract_response_attrs_model():
    converter = OpenAiSemconvConverter()
    result = converter.extract_response_attrs({"model": "gpt-4o-2024-05-13"})
    assert result[GenAiSemconvKey.RESPONSE_MODEL] == "gpt-4o-2024-05-13"


def test_extract_response_attrs_empty():
    converter = OpenAiSemconvConverter()
    result = converter.extract_response_attrs({})
    assert result == {}
