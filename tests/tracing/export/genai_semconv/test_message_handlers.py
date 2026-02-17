import json

from mlflow.tracing.export.genai_semconv.message_handlers import (
    _anthropic_handler,
    _default_handler,
    _gemini_handler,
    _langchain_handler,
    _openai_handler,
    extract_request_params,
    extract_response_attrs,
    translate_messages_for_format,
)


class TestOpenAIHandler:
    def test_basic_messages(self):
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
        result = _openai_handler(inputs, outputs)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert len(input_msgs) == 2
        assert input_msgs[0]["role"] == "system"
        assert input_msgs[0]["content"] == [{"type": "text", "text": "You are helpful"}]
        assert input_msgs[1]["role"] == "user"
        assert input_msgs[1]["content"] == [{"type": "text", "text": "Hello"}]

        output_msgs = json.loads(result["gen_ai.output.messages"])
        assert len(output_msgs) == 1
        assert output_msgs[0]["role"] == "assistant"
        assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi there!"}]
        assert output_msgs[0]["finish_reason"] == "stop"

    def test_tool_calls(self):
        inputs = {
            "messages": [{"role": "user", "content": "What's the weather?"}],
        }
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
        result = _openai_handler(inputs, outputs)

        output_msgs = json.loads(result["gen_ai.output.messages"])
        parts = output_msgs[0]["content"]
        assert any(p["type"] == "tool_call" for p in parts)
        tool_part = next(p for p in parts if p["type"] == "tool_call")
        assert tool_part["name"] == "get_weather"
        assert tool_part["id"] == "call_123"

    def test_multipart_content(self):
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
        result = _openai_handler(inputs, {})

        input_msgs = json.loads(result["gen_ai.input.messages"])
        parts = input_msgs[0]["content"]
        assert parts[0] == {"type": "text", "text": "What's in this image?"}
        # Non-text parts are JSON-stringified
        assert parts[1]["type"] == "text"

    def test_no_messages_in_inputs(self):
        result = _openai_handler({"model": "gpt-4o"}, {})
        assert "gen_ai.input.messages" not in result

    def test_no_choices_in_outputs(self):
        result = _openai_handler({}, {"usage": {"total_tokens": 10}})
        assert "gen_ai.output.messages" not in result


class TestAnthropicHandler:
    def test_basic_messages(self):
        inputs = {
            "messages": [{"role": "user", "content": "Hello"}],
            "model": "claude-3-5-sonnet",
        }
        outputs = {
            "content": [{"type": "text", "text": "Hi there!"}],
            "stop_reason": "end_turn",
        }
        result = _anthropic_handler(inputs, outputs)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert len(input_msgs) == 1
        assert input_msgs[0]["role"] == "user"
        assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello"}]

        output_msgs = json.loads(result["gen_ai.output.messages"])
        assert len(output_msgs) == 1
        assert output_msgs[0]["role"] == "assistant"
        assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi there!"}]
        assert output_msgs[0]["finish_reason"] == "end_turn"

    def test_tool_use_blocks(self):
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
        result = _anthropic_handler({}, outputs)

        output_msgs = json.loads(result["gen_ai.output.messages"])
        parts = output_msgs[0]["content"]
        assert len(parts) == 2
        assert parts[0] == {"type": "text", "text": "I'll check the weather."}
        assert parts[1]["type"] == "tool_call"
        assert parts[1]["name"] == "get_weather"
        assert parts[1]["id"] == "toolu_123"

    def test_string_content(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = _anthropic_handler(inputs, {})

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello"}]


class TestGeminiHandler:
    def test_basic_contents(self):
        inputs = {
            "contents": [{"role": "user", "parts": [{"text": "Hello"}]}],
        }
        outputs = {
            "candidates": [{"content": {"role": "model", "parts": [{"text": "Hi!"}]}}],
        }
        result = _gemini_handler(inputs, outputs)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert len(input_msgs) == 1
        assert input_msgs[0]["role"] == "user"
        assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello"}]

        output_msgs = json.loads(result["gen_ai.output.messages"])
        assert len(output_msgs) == 1
        assert output_msgs[0]["role"] == "model"
        assert output_msgs[0]["content"] == [{"type": "text", "text": "Hi!"}]

    def test_no_contents(self):
        result = _gemini_handler({"model": "gemini-pro"}, {})
        assert "gen_ai.input.messages" not in result


class TestLangChainHandler:
    def test_openai_style_messages(self):
        inputs = [
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hi"},
        ]
        result = _langchain_handler(inputs, None)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert len(input_msgs) == 2
        assert input_msgs[0]["role"] == "system"
        assert input_msgs[1]["role"] == "user"

    def test_base_message_format(self):
        inputs = [
            {"type": "human", "content": "Hello"},
            {"type": "ai", "content": "Hi there!"},
        ]
        result = _langchain_handler(inputs, None)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert len(input_msgs) == 2
        assert input_msgs[0]["role"] == "user"
        assert input_msgs[1]["role"] == "assistant"

    def test_string_output(self):
        result = _langchain_handler([], "This is the response")

        output_msgs = json.loads(result["gen_ai.output.messages"])
        assert len(output_msgs) == 1
        assert output_msgs[0]["role"] == "assistant"
        assert output_msgs[0]["content"] == [{"type": "text", "text": "This is the response"}]

    def test_dict_with_messages_delegates_to_openai(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = _langchain_handler(inputs, None)

        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert input_msgs[0]["role"] == "user"


class TestDefaultHandler:
    def test_detects_openai_format(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = _default_handler(inputs, None)
        assert "gen_ai.input.messages" in result

    def test_detects_gemini_format(self):
        inputs = {"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}
        result = _default_handler(inputs, None)
        assert "gen_ai.input.messages" in result

    def test_message_list(self):
        inputs = [{"role": "user", "content": "Hello"}]
        result = _default_handler(inputs, None)
        assert "gen_ai.input.messages" in result

    def test_string_input(self):
        result = _default_handler("Hello world", None)
        input_msgs = json.loads(result["gen_ai.input.messages"])
        assert input_msgs[0]["role"] == "user"
        assert input_msgs[0]["content"] == [{"type": "text", "text": "Hello world"}]

    def test_string_output(self):
        result = _default_handler(None, "Response text")
        output_msgs = json.loads(result["gen_ai.output.messages"])
        assert output_msgs[0]["role"] == "assistant"
        assert output_msgs[0]["content"] == [{"type": "text", "text": "Response text"}]

    def test_dict_output_with_choices(self):
        outputs = {
            "choices": [
                {"message": {"role": "assistant", "content": "Hi!"}, "finish_reason": "stop"}
            ]
        }
        result = _default_handler(None, outputs)
        assert "gen_ai.output.messages" in result

    def test_dict_output_with_content_list(self):
        outputs = {"content": [{"type": "text", "text": "Hi!"}]}
        result = _default_handler(None, outputs)
        assert "gen_ai.output.messages" in result


class TestTranslateMessagesForFormat:
    def test_openai_format(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = translate_messages_for_format("openai", inputs, None)
        assert "gen_ai.input.messages" in result

    def test_anthropic_format(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        outputs = {"content": [{"type": "text", "text": "Hi!"}]}
        result = translate_messages_for_format("anthropic", inputs, outputs)
        assert "gen_ai.input.messages" in result
        assert "gen_ai.output.messages" in result

    def test_unknown_format_falls_back(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = translate_messages_for_format("unknown_format", inputs, None)
        # Default handler should detect the OpenAI structure
        assert "gen_ai.input.messages" in result

    def test_none_format_uses_default(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = translate_messages_for_format(None, inputs, None)
        assert "gen_ai.input.messages" in result

    def test_groq_delegates_to_openai(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = translate_messages_for_format("groq", inputs, None)
        assert "gen_ai.input.messages" in result

    def test_bedrock_delegates_to_openai(self):
        inputs = {"messages": [{"role": "user", "content": "Hello"}]}
        result = translate_messages_for_format("bedrock", inputs, None)
        assert "gen_ai.input.messages" in result


class TestExtractRequestParams:
    def test_temperature(self):
        result = extract_request_params({"temperature": 0.7})
        assert result["gen_ai.request.temperature"] == 0.7

    def test_max_tokens(self):
        result = extract_request_params({"max_tokens": 1000})
        assert result["gen_ai.request.max_tokens"] == 1000

    def test_top_p(self):
        result = extract_request_params({"top_p": 0.9})
        assert result["gen_ai.request.top_p"] == 0.9

    def test_stop(self):
        result = extract_request_params({"stop": ["\n"]})
        assert result["gen_ai.request.stop_sequences"] == ["\n"]

    def test_tools(self):
        tools = [{"type": "function", "function": {"name": "get_weather"}}]
        result = extract_request_params({"tools": tools})
        assert json.loads(result["gen_ai.tool.definitions"]) == tools

    def test_empty_inputs(self):
        result = extract_request_params({})
        assert result == {}


class TestExtractResponseAttrs:
    def test_response_id(self):
        result = extract_response_attrs({"id": "chatcmpl-123"})
        assert result["gen_ai.response.id"] == "chatcmpl-123"

    def test_response_model(self):
        result = extract_response_attrs({"model": "gpt-4o-2024-05-13"})
        assert result["gen_ai.response.model"] == "gpt-4o-2024-05-13"

    def test_openai_finish_reasons(self):
        outputs = {
            "choices": [
                {"finish_reason": "stop"},
                {"finish_reason": "length"},
            ]
        }
        result = extract_response_attrs(outputs)
        assert result["gen_ai.response.finish_reasons"] == ["stop", "length"]

    def test_anthropic_stop_reason(self):
        result = extract_response_attrs({"stop_reason": "end_turn"})
        assert result["gen_ai.response.finish_reasons"] == ["end_turn"]

    def test_empty_outputs(self):
        result = extract_response_attrs({})
        assert result == {}
