import json

from mlflow.anthropic.genai_semconv_converter import AnthropicSemconvConverter
from mlflow.gemini.genai_semconv_converter import GeminiSemconvConverter
from mlflow.langchain.genai_semconv_converter import LangChainSemconvConverter
from mlflow.openai.genai_semconv_converter import OpenAiSemconvConverter
from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.export.genai_semconv.default_converter import DefaultSemconvConverter

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


# --- Anthropic converter ---


def test_anthropic_basic_messages():
    converter = AnthropicSemconvConverter()
    inputs = {
        "messages": [{"role": "user", "content": "Hello"}],
        "model": "claude-3-5-sonnet",
    }
    outputs = {
        "content": [{"type": "text", "text": "Hi there!"}],
        "stop_reason": "end_turn",
    }
    result = converter.translate(inputs, outputs)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert len(input_msgs) == 1
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello"}]

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi there!"}]
    assert output_msgs[0]["finish_reason"] == "end_turn"


def test_anthropic_tool_use_blocks():
    converter = AnthropicSemconvConverter()
    outputs = {
        "content": [
            {"type": "text", "text": "I'll check the weather."},
            {
                "type": "tool_use",
                "id": "toolu_123",
                "name": "get_weather",
                "input": {"location": "SF"},
            },
        ],
        "stop_reason": "tool_use",
    }
    result = converter.translate(None, outputs)

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    parts = output_msgs[0]["content"]
    assert len(parts) == 2
    assert parts[0] == {"type": "text", "text": "I'll check the weather."}
    assert parts[1]["type"] == "tool_call"
    assert parts[1]["name"] == "get_weather"
    assert parts[1]["id"] == "toolu_123"


def test_anthropic_stop_reason():
    converter = AnthropicSemconvConverter()
    outputs = {"content": [{"type": "text", "text": "done"}], "stop_reason": "end_turn"}
    result = converter.translate(None, outputs)
    assert result[GenAiSemconvKey.RESPONSE_FINISH_REASONS] == ["end_turn"]


# --- Gemini converter ---


def test_gemini_basic_contents():
    converter = GeminiSemconvConverter()
    inputs = {"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}
    outputs = {"candidates": [{"content": {"role": "model", "parts": [{"text": "Hi!"}]}}]}
    result = converter.translate(inputs, outputs)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert len(input_msgs) == 1
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello"}]

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "model"
    assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi!"}]


def test_gemini_no_contents():
    converter = GeminiSemconvConverter()
    result = converter.translate({"model": "gemini-pro"}, None)
    assert GenAiSemconvKey.INPUT_MESSAGES not in result


# --- LangChain converter ---


def test_langchain_openai_style_messages():
    converter = LangChainSemconvConverter()
    inputs = [
        {"role": "system", "content": "You are helpful"},
        {"role": "user", "content": "Hi"},
    ]
    result = converter.translate(inputs, None)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert len(input_msgs) == 2
    assert input_msgs[0]["role"] == "system"
    assert input_msgs[1]["role"] == "user"


def test_langchain_base_message_format():
    converter = LangChainSemconvConverter()
    inputs = [
        {"type": "human", "content": "Hello"},
        {"type": "ai", "content": "Hi there!"},
    ]
    result = converter.translate(inputs, None)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert len(input_msgs) == 2
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[1]["role"] == "assistant"


def test_langchain_string_output():
    converter = LangChainSemconvConverter()
    result = converter.translate(None, "This is the response")

    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    assert len(output_msgs) == 1
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["content"] == [{"type": "text", "text": "This is the response"}]


def test_langchain_dict_with_messages_delegates_to_openai():
    converter = LangChainSemconvConverter()
    inputs = {"messages": [{"role": "user", "content": "Hello"}]}
    result = converter.translate(inputs, None)

    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert input_msgs[0]["role"] == "user"


# --- Default converter ---


def test_default_detects_openai_format():
    converter = DefaultSemconvConverter()
    inputs = {"messages": [{"role": "user", "content": "Hello"}]}
    result = converter.translate(inputs, None)
    assert GenAiSemconvKey.INPUT_MESSAGES in result


def test_default_detects_gemini_format():
    converter = DefaultSemconvConverter()
    inputs = {"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}
    result = converter.translate(inputs, None)
    assert GenAiSemconvKey.INPUT_MESSAGES in result


def test_default_message_list():
    converter = DefaultSemconvConverter()
    inputs = [{"role": "user", "content": "Hello"}]
    result = converter.translate(inputs, None)
    assert GenAiSemconvKey.INPUT_MESSAGES in result


def test_default_string_input():
    converter = DefaultSemconvConverter()
    result = converter.translate("Hello world", None)
    input_msgs = json.loads(result[GenAiSemconvKey.INPUT_MESSAGES])
    assert input_msgs[0]["role"] == "user"
    assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello world"}]


def test_default_string_output():
    converter = DefaultSemconvConverter()
    result = converter.translate(None, "Response text")
    output_msgs = json.loads(result[GenAiSemconvKey.OUTPUT_MESSAGES])
    assert output_msgs[0]["role"] == "assistant"
    assert output_msgs[0]["content"] == [{"type": "text", "text": "Response text"}]


def test_default_dict_output_with_choices():
    converter = DefaultSemconvConverter()
    outputs = {
        "choices": [{"message": {"role": "assistant", "content": "Hi!"}, "finish_reason": "stop"}]
    }
    result = converter.translate(None, outputs)
    assert GenAiSemconvKey.OUTPUT_MESSAGES in result


def test_default_dict_output_with_content_list():
    converter = DefaultSemconvConverter()
    outputs = {"content": [{"type": "text", "text": "Hi!"}]}
    result = converter.translate(None, outputs)
    assert GenAiSemconvKey.OUTPUT_MESSAGES in result


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


def test_get_converter_anthropic():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("anthropic"), AnthropicSemconvConverter)


def test_get_converter_gemini():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("gemini"), GeminiSemconvConverter)


def test_get_converter_langchain():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("langchain"), LangChainSemconvConverter)


def test_get_converter_unknown_falls_back():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter("unknown_format"), DefaultSemconvConverter)


def test_get_converter_none_falls_back():
    from mlflow.tracing.export.genai_semconv.translator import _get_converter

    assert isinstance(_get_converter(None), DefaultSemconvConverter)


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
