import base64
import json
from unittest import mock

import boto3
import pytest
from botocore.exceptions import NoCredentialsError
from packaging.version import Version

import mlflow
from mlflow.tracing.constant import SpanAttributeKey

from tests.tracing.helper import get_traces

_IS_CONVERSE_API_AVAILABLE = Version(boto3.__version__) >= Version("1.35")



# https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
_ANTHROPIC_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"

_CONVERSE_REQUEST = {
    "modelId": _ANTHROPIC_MODEL_ID,
    "messages": [{"role": "user", "content": [{"text": "Hi"}]}],
    "inferenceConfig": {
        "maxTokens": 300,
        "temperature": 0.1,
        "topP": 0.9,
    },
}

_CONVERSE_RESPONSE = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [{"text": "Hello! How can I help you today?"}],
        },
    },
    "stopReason": "end_turn",
    "usage": {"inputTokens": 8, "outputTokens": 12},
    "metrics": {"latencyMs": 551},
}

_CONVERSE_EXPECTED_CHAT_ATTRIBUTE = [
    {
        "role": "user",
        "content": [{"text": "Hi", "type": "text"}],
    },
    {
        "role": "assistant",
        "content": [{"text": "Hello! How can I help you today?", "type": "text"}],
    },
]


# https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
_CONVERSE_TOOL_CALLING_REQUEST = {
    "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "messages": [
        {"role": "user", "content": [{"text": "What's the weather like in San Francisco?"}]},
        {
            "role": "assistant",
            "content": [
                {"text": "I'll use the get_unit function to determine the temperature unit."},
                {
                    "toolUse": {
                        "toolUseId": "tool_1",
                        "name": "get_unit",
                        "input": {"location": "San Francisco, CA"},
                    }
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "toolResult": {
                        "toolUseId": "tool_1",
                        "content": [{"json": {"unit": "fahrenheit"}}],
                    }
                }
            ],
        },
    ],
    "inferenceConfig": {
        "maxTokens": 300,
        "temperature": 0.1,
        "topP": 0.9,
    },
    "toolConfig": {
        "tools": [
            {
                "toolSpec": {
                    "name": "get_unit",
                    "description": "Get the temperature unit in a given location",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "location": {
                                    "type": "string",
                                    "description": "The city and state, e.g., San Francisco, CA",
                                },
                            },
                            "required": ["location"],
                        },
                    },
                },
            },
            {
                "toolSpec": {
                    "name": "get_weather",
                    "description": "Get the current weather in a given location",
                    "inputSchema": {
                        "json": {
                            "type": "object",
                            "properties": {
                                "location": {
                                    "type": "string",
                                    "description": "The city and state, e.g., San Francisco, CA",
                                },
                                "unit": {
                                    "type": "string",
                                    "enum": ["celsius", "fahrenheit"],
                                    "description": '"celsius" or "fahrenheit"',
                                },
                            },
                            "required": ["location"],
                        },
                    },
                },
            },
        ]
    },
}

_CONVERSE_TOOL_CALLING_RESPONSE = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [
                {"text": "Now I'll check the current weather in San Francisco."},
                {
                    "toolUse": {
                        "toolUseId": "tool_2",
                        "name": "get_weather",
                        "input": '{"location": "San Francisco, CA", "unit": "fahrenheit"}',
                    }
                },
            ],
        },
    },
    "stopReason": "end_turn",
    "usage": {"inputTokens": 8, "outputTokens": 12},
    "metrics": {"latencyMs": 551},
}

_CONVERSE_TOOL_CALLING_EXPECTED_CHAT_ATTRIBUTE = [
    {
        "role": "user",
        "content": [{"text": "What's the weather like in San Francisco?", "type": "text"}],
    },
    {
        "role": "assistant",
        "content": [
            {
                "text": "I'll use the get_unit function to determine the temperature unit.",
                "type": "text",
            },
        ],
        "tool_calls": [
            {
                "id": "tool_1",
                "function": {
                    "name": "get_unit",
                    "arguments": '{"location": "San Francisco, CA"}',
                },
                "type": "function",
            },
        ],
    },
    {
        "role": "tool",
        "content": [{"text": '{"unit": "fahrenheit"}', "type": "text"}],
        "tool_call_id": "tool_1",
    },
    {
        "role": "assistant",
        "content": [
            {"text": "Now I'll check the current weather in San Francisco.", "type": "text"},
        ],
        "tool_calls": [
            {
                "id": "tool_2",
                "function": {
                    "name": "get_weather",
                    "arguments": '{"location": "San Francisco, CA", "unit": "fahrenheit"}',
                },
                "type": "function",
            },
        ],
    },
]

_CONVERSE_TOOL_CALLING_EXPECTED_TOOL_ATTRIBUTE = [
    {
        "type": "function",
        "function": {
            "name": "get_unit",
            "description": "Get the temperature unit in a given location",
            "parameters": {
                "properties": {
                    "location": {
                        "description": "The city and state, e.g., San Francisco, CA",
                        "type": "string",
                    },
                },
                "required": ["location"],
                "type": "object",
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "properties": {
                    "location": {
                        "description": "The city and state, e.g., San Francisco, CA",
                        "type": "string",
                    },
                    "unit": {
                        "description": '"celsius" or "fahrenheit"',
                        "enum": ["celsius", "fahrenheit"],
                        "type": "string",
                    },
                },
                "required": ["location"],
                "type": "object",
            },
        },
    },
]


def _get_test_image(is_base64: bool):
    with open("tests/resources/images/test.png", "rb") as f:
        image_bytes = f.read()
        return base64.b64encode(image_bytes).decode("utf-8") if is_base64 else image_bytes


def _get_converse_multi_modal_request(is_base64: bool):
    return {
        "modelId": _ANTHROPIC_MODEL_ID,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"text": "What text is in this image?"},
                    {
                        "image": {
                            "format": "png",
                            "source": {"bytes": _get_test_image(is_base64)},
                        },
                    },
                ],
            }
        ],
    }


_CONVERSE_MULTI_MODAL_RESPONSE = {
    "output": {
        "message": {
            "role": "assistant",
            "content": [{"text": "MLflow"}],
        },
    },
    "stopReason": "end_turn",
    "usage": {"inputTokens": 8, "outputTokens": 2},
}

_CONVERSE_MULTI_MODAL_EXPECTED_CHAT_ATTRIBUTE = [
    {
        "role": "user",
        "content": [
            {"text": "What text is in this image?", "type": "text"},
            {
                "image_url": {
                    "url": f"data:image/png;base64,{_get_test_image(True)}",
                    "detail": "auto",
                },
                "type": "image_url",
            },
        ],
    },
    {
        "role": "assistant",
        "content": [{"text": "MLflow", "type": "text"}],
    },
]


@pytest.mark.skipif(not _IS_CONVERSE_API_AVAILABLE, reason="Converse API is not available")
@pytest.mark.parametrize(
    ("_request", "response", "expected_chat_attr", "expected_tool_attr"),
    [
        # 1. Normal conversation
        (
            _CONVERSE_REQUEST,
            _CONVERSE_RESPONSE,
            _CONVERSE_EXPECTED_CHAT_ATTRIBUTE,
            None,
        ),
        # 2. Conversation with tool calling
        (
            _CONVERSE_TOOL_CALLING_REQUEST,
            _CONVERSE_TOOL_CALLING_RESPONSE,
            _CONVERSE_TOOL_CALLING_EXPECTED_CHAT_ATTRIBUTE,
            _CONVERSE_TOOL_CALLING_EXPECTED_TOOL_ATTRIBUTE,
        ),
        # 3. Conversation with image input (raw bytes)
        (
            _get_converse_multi_modal_request(is_base64=False),
            _CONVERSE_MULTI_MODAL_RESPONSE,
            _CONVERSE_MULTI_MODAL_EXPECTED_CHAT_ATTRIBUTE,
            None,
        ),
        # 2. Conversation with image input (base64)
        (
            _get_converse_multi_modal_request(is_base64=True),
            _CONVERSE_MULTI_MODAL_RESPONSE,
            _CONVERSE_MULTI_MODAL_EXPECTED_CHAT_ATTRIBUTE,
            None,
        ),
    ],
)
def test_bedrock_autolog_converse(_request, response, expected_chat_attr, expected_tool_attr):
    mlflow.bedrock.autolog()

    client = boto3.client("bedrock-runtime", region_name="us-west-2")

    with mock.patch("botocore.client.BaseClient._make_api_call", return_value=response):
        response = client.converse(**_request)

    traces = get_traces()
    assert len(traces) == 1
    assert traces[0].info.status == "OK"

    assert len(traces[0].data.spans) == 1
    span = traces[0].data.spans[0]
    assert span.name == "BedrockRuntime.converse"
    assert span.inputs is not None  # request with bytes is stringified and not recoverable
    assert span.outputs == response
    assert span.get_attribute(SpanAttributeKey.CHAT_MESSAGES) == expected_chat_attr
    assert span.get_attribute(SpanAttributeKey.CHAT_TOOLS) == expected_tool_attr


@pytest.mark.skipif(not _IS_CONVERSE_API_AVAILABLE, reason="Converse API is not available")
def test_bedrock_autolog_converse_error():
    mlflow.bedrock.autolog()

    client = boto3.client("bedrock-runtime", region_name="us-west-2")

    with pytest.raises(NoCredentialsError, match="Unable to locate credentials"):
        client.converse(**_CONVERSE_REQUEST)

    traces = get_traces()
    assert len(traces) == 1
    assert traces[0].info.status == "ERROR"

    span = traces[0].data.spans[0]
    assert span.name == "BedrockRuntime.converse"
    assert span.status.status_code == "ERROR"
    assert span.inputs == _CONVERSE_REQUEST
    assert span.outputs is None
    assert len(span.events) == 1
    assert (
        span.get_attribute(SpanAttributeKey.CHAT_MESSAGES) == _CONVERSE_EXPECTED_CHAT_ATTRIBUTE[:1]
    )


@pytest.mark.skipif(not _IS_CONVERSE_API_AVAILABLE, reason="Converse API is not available")
def test_bedrock_autolog_converse_skip_unsupported_content():
    mlflow.bedrock.autolog()

    client = boto3.client("bedrock-runtime", region_name="us-west-2")

    with mock.patch("botocore.client.BaseClient._make_api_call", return_value=_CONVERSE_RESPONSE):
        client.converse(
            modelId=_ANTHROPIC_MODEL_ID,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"video": b"\xe3\x81\xad\xe3\x81\x93"},
                        {"text": "What you can see in this video?"},
                    ],
                }
            ],
        )

    traces = get_traces()
    assert len(traces) == 1
    assert traces[0].info.status == "OK"

    span = traces[0].data.spans[0]
    assert span.name == "BedrockRuntime.converse"
    assert span.get_attribute(SpanAttributeKey.CHAT_MESSAGES) == [
        {
            "role": "user",
            "content": [{"text": "What you can see in this video?", "type": "text"}],
        },
        {
            "role": "assistant",
            "content": [{"text": "Hello! How can I help you today?", "type": "text"}],
        },
    ]


@pytest.mark.skipif(not _IS_CONVERSE_API_AVAILABLE, reason="Converse API is not available")
@pytest.mark.parametrize(
    ("_request", "expected_response", "expected_chat_attr", "expected_tool_attr"),
    [
        # 1. Normal conversation
        (
            _CONVERSE_REQUEST,
            _CONVERSE_RESPONSE,
            _CONVERSE_EXPECTED_CHAT_ATTRIBUTE,
            None,
        ),
        # 2. Conversation with tool calling
        (
            _CONVERSE_TOOL_CALLING_REQUEST,
            _CONVERSE_TOOL_CALLING_RESPONSE,
            _CONVERSE_TOOL_CALLING_EXPECTED_CHAT_ATTRIBUTE,
            _CONVERSE_TOOL_CALLING_EXPECTED_TOOL_ATTRIBUTE,
        ),
    ],
)
def test_bedrock_autolog_converse_stream(
    _request, expected_response, expected_chat_attr, expected_tool_attr
):
    mlflow.bedrock.autolog()

    client = boto3.client("bedrock-runtime", region_name="us-west-2")

    with mock.patch(
        "botocore.client.BaseClient._make_api_call",
        return_value={"stream": _event_stream(expected_response)},
    ):
        response = client.converse_stream(**_request)

    assert get_traces() == []

    chunks = list(response["stream"])
    assert chunks == list(_event_stream(expected_response))

    traces = get_traces()
    assert len(traces) == 1
    assert traces[0].info.status == "OK"

    assert len(traces[0].data.spans) == 1
    span = traces[0].data.spans[0]
    assert span.name == "BedrockRuntime.converse_stream"
    assert span.inputs == _request
    assert span.outputs == expected_response
    assert span.get_attribute(SpanAttributeKey.CHAT_MESSAGES) == expected_chat_attr
    assert span.get_attribute(SpanAttributeKey.CHAT_TOOLS) == expected_tool_attr
    assert len(span.events) > 0
    assert span.events[0].name == "messageStart"
    assert json.loads(span.events[0].attributes["json"]) == {"role": "assistant"}


def _event_stream(raw_response, chunk_size=10):
    """Split the raw response into chunks to simulate the event stream."""
    content = raw_response["output"]["message"]["content"]

    yield {"messageStart": {"role": "assistant"}}

    text_content = content[0]["text"]
    for i in range(0, len(text_content), chunk_size):
        yield {"contentBlockDelta": {"delta": {"text": text_content[i : i + chunk_size]}}}

    yield {"contentBlockStop": {}}

    yield from _generate_tool_use_chunks_if_present(content)

    yield {"messageStop": {"stopReason": "end_turn"}}

    yield {"metadata": {"usage": raw_response["usage"], "metrics": {"latencyMs": 551}}}


def _generate_tool_use_chunks_if_present(content, chunk_size=10):
    if len(content) > 1 and (tool_content := content[1].get("toolUse")):
        yield {
            "contentBlockStart": {
                "start": {
                    "toolUse": {
                        "toolUseId": tool_content["toolUseId"],
                        "name": tool_content["name"],
                    }
                }
            }
        }

        for i in range(0, len(tool_content["input"]), chunk_size):
            yield {
                "contentBlockDelta": {
                    "delta": {"toolUse": {"input": tool_content["input"][i : i + chunk_size]}}
                }
            }
        yield {"contentBlockStop": {}}
