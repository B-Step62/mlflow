"""
Format-specific message handlers for translating MLflow span inputs/outputs
to GenAI Semantic Convention message format.

Each handler knows how to extract messages from a specific provider format
(OpenAI, Anthropic, Gemini, LangChain, etc.) and convert them to the GenAI
semconv `gen_ai.input.messages` / `gen_ai.output.messages` attribute format.

The MESSAGE_FORMAT span attribute is the dispatch key.
"""

import json
import logging
from collections.abc import Callable
from typing import Any

_logger = logging.getLogger(__name__)


def translate_messages_for_format(
    message_format: str | None,
    inputs: Any,
    outputs: Any,
) -> dict[str, Any]:
    """
    Translate inputs/outputs to GenAI semconv message attributes.

    Args:
        message_format: The MESSAGE_FORMAT attribute value (e.g., "openai", "anthropic").
        inputs: Parsed span inputs (dict, list, or string).
        outputs: Parsed span outputs (dict, list, or string).

    Returns:
        Dict of GenAI semconv attributes (gen_ai.input.messages, gen_ai.output.messages, etc.)
    """
    handler = _FORMAT_HANDLERS.get(message_format) if message_format else None
    if handler:
        try:
            return handler(inputs, outputs)
        except Exception:
            _logger.debug(f"Handler for '{message_format}' failed, using default", exc_info=True)
    return _default_handler(inputs, outputs)


def extract_request_params(inputs: dict[str, Any]) -> dict[str, Any]:
    """Extract GenAI request parameters from span inputs."""
    params: dict[str, Any] = {}
    if "temperature" in inputs:
        params["gen_ai.request.temperature"] = inputs["temperature"]
    if "max_tokens" in inputs:
        params["gen_ai.request.max_tokens"] = inputs["max_tokens"]
    if "top_p" in inputs:
        params["gen_ai.request.top_p"] = inputs["top_p"]
    if "stop" in inputs:
        params["gen_ai.request.stop_sequences"] = inputs["stop"]
    if "tools" in inputs:
        params["gen_ai.tool.definitions"] = json.dumps(inputs["tools"])
    return params


def extract_response_attrs(outputs: dict[str, Any]) -> dict[str, Any]:
    """Extract GenAI response attributes from span outputs."""
    attrs: dict[str, Any] = {}
    if "id" in outputs:
        attrs["gen_ai.response.id"] = outputs["id"]
    if "model" in outputs:
        attrs["gen_ai.response.model"] = outputs["model"]
    # Finish reasons from OpenAI-style choices
    if "choices" in outputs:
        reasons = [c.get("finish_reason") for c in outputs["choices"] if c.get("finish_reason")]
        if reasons:
            attrs["gen_ai.response.finish_reasons"] = reasons
    # Finish reason from Anthropic-style stop_reason
    elif "stop_reason" in outputs:
        attrs["gen_ai.response.finish_reasons"] = [outputs["stop_reason"]]
    return attrs


# ---------------------------------------------------------------------------
# OpenAI handler (also covers Groq, Bedrock, LiteLLM)
# ---------------------------------------------------------------------------


def _openai_handler(inputs: Any, outputs: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}

    if isinstance(inputs, dict) and "messages" in inputs:
        genai_msgs = [_convert_openai_message(m) for m in inputs["messages"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    if isinstance(outputs, dict) and "choices" in outputs:
        out_msgs = []
        for choice in outputs["choices"]:
            msg = _convert_openai_message(choice.get("message", {}))
            if fr := choice.get("finish_reason"):
                msg["finish_reason"] = fr
            out_msgs.append(msg)
        result["gen_ai.output.messages"] = json.dumps(out_msgs)

    return result


def _convert_openai_message(msg: dict[str, Any]) -> dict[str, Any]:
    role = msg.get("role", "user")
    content = msg.get("content")
    parts: list[dict[str, Any]] = []

    if isinstance(content, str):
        parts.append({"type": "text", "text": content})
    elif isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append({"type": "text", "text": item.get("text", "")})
            else:
                parts.append({"type": "text", "text": json.dumps(item)})
    elif content is not None:
        parts.append({"type": "text", "text": str(content)})

    # Handle tool_calls on the message
    if tool_calls := msg.get("tool_calls"):
        for tc in tool_calls:
            func = tc.get("function", {})
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id"),
                    "name": func.get("name"),
                    "arguments": func.get("arguments", "{}"),
                }
            )

    return {"role": role, "content": parts}


# ---------------------------------------------------------------------------
# Anthropic handler
# ---------------------------------------------------------------------------


def _anthropic_handler(inputs: Any, outputs: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}

    if isinstance(inputs, dict) and "messages" in inputs:
        genai_msgs = [_convert_anthropic_message(m) for m in inputs["messages"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    if isinstance(outputs, dict) and "content" in outputs:
        msg = _convert_anthropic_message({"role": "assistant", "content": outputs["content"]})
        if sr := outputs.get("stop_reason"):
            msg["finish_reason"] = sr
        result["gen_ai.output.messages"] = json.dumps([msg])

    return result


def _convert_anthropic_message(msg: dict[str, Any]) -> dict[str, Any]:
    role = msg.get("role", "user")
    content = msg.get("content")
    parts: list[dict[str, Any]] = []

    if isinstance(content, str):
        parts.append({"type": "text", "text": content})
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append({"type": "text", "text": block.get("text", "")})
                elif block.get("type") == "tool_use":
                    parts.append(
                        {
                            "type": "tool_call",
                            "id": block.get("id"),
                            "name": block.get("name"),
                            "arguments": json.dumps(block.get("input", {})),
                        }
                    )
                else:
                    parts.append({"type": "text", "text": json.dumps(block)})

    return {"role": role, "content": parts}


# ---------------------------------------------------------------------------
# Gemini handler
# ---------------------------------------------------------------------------


def _gemini_handler(inputs: Any, outputs: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}

    if isinstance(inputs, dict) and "contents" in inputs:
        genai_msgs = [_convert_gemini_content(c) for c in inputs["contents"]]
        result["gen_ai.input.messages"] = json.dumps(genai_msgs)

    if isinstance(outputs, dict) and "candidates" in outputs:
        out_msgs = [
            _convert_gemini_content(candidate["content"])
            for candidate in outputs["candidates"]
            if "content" in candidate
        ]
        result["gen_ai.output.messages"] = json.dumps(out_msgs)

    return result


def _convert_gemini_content(content: dict[str, Any]) -> dict[str, Any]:
    role = content.get("role", "user")
    parts: list[dict[str, Any]] = []
    for part in content.get("parts", []):
        if isinstance(part, dict) and "text" in part:
            parts.append({"type": "text", "text": part["text"]})
        else:
            parts.append({"type": "text", "text": json.dumps(part)})
    return {"role": role, "content": parts}


# ---------------------------------------------------------------------------
# LangChain handler
# ---------------------------------------------------------------------------


def _langchain_handler(inputs: Any, outputs: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}

    if isinstance(inputs, list) and inputs:
        first = inputs[0]
        if isinstance(first, dict) and "role" in first:
            # OpenAI-style message list
            result["gen_ai.input.messages"] = json.dumps(
                [_convert_openai_message(m) for m in inputs]
            )
        elif isinstance(first, dict) and "type" in first and "content" in first:
            # LangChain BaseMessage-like: {"type": "human", "content": "Hello"}
            role_map = {"human": "user", "ai": "assistant", "system": "system", "tool": "tool"}
            genai_msgs = []
            for m in inputs:
                role = role_map.get(m.get("type", ""), "user")
                genai_msgs.append(
                    {
                        "role": role,
                        "content": [{"type": "text", "text": str(m.get("content", ""))}],
                    }
                )
            result["gen_ai.input.messages"] = json.dumps(genai_msgs)
    elif isinstance(inputs, dict) and "messages" in inputs:
        # Wrapped in a dict with "messages" key
        return _openai_handler(inputs, outputs)

    if isinstance(outputs, str):
        result["gen_ai.output.messages"] = json.dumps(
            [{"role": "assistant", "content": [{"type": "text", "text": outputs}]}]
        )

    return result


# ---------------------------------------------------------------------------
# Default heuristic handler
# ---------------------------------------------------------------------------


def _default_handler(inputs: Any, outputs: Any) -> dict[str, Any]:
    """Try to detect format from structure and extract messages heuristically."""
    result: dict[str, Any] = {}

    # Try to detect input format from structure
    if isinstance(inputs, dict):
        if "messages" in inputs:
            return _openai_handler(inputs, outputs)
        if "contents" in inputs:
            return _gemini_handler(inputs, outputs)

    # Direct message list
    if isinstance(inputs, list) and inputs and isinstance(inputs[0], dict) and "role" in inputs[0]:
        result["gen_ai.input.messages"] = json.dumps([_convert_openai_message(m) for m in inputs])
    elif isinstance(inputs, str):
        result["gen_ai.input.messages"] = json.dumps(
            [{"role": "user", "content": [{"type": "text", "text": inputs}]}]
        )
    elif inputs is not None:
        result["gen_ai.input.messages"] = json.dumps(
            [{"role": "user", "content": [{"type": "text", "text": json.dumps(inputs)}]}]
        )

    # Output handling
    if isinstance(outputs, dict) and "choices" in outputs:
        openai_result = _openai_handler(inputs, outputs)
        if "gen_ai.output.messages" in openai_result:
            result["gen_ai.output.messages"] = openai_result["gen_ai.output.messages"]
    elif (
        isinstance(outputs, dict) and "content" in outputs and isinstance(outputs["content"], list)
    ):
        anthropic_result = _anthropic_handler(inputs, outputs)
        if "gen_ai.output.messages" in anthropic_result:
            result["gen_ai.output.messages"] = anthropic_result["gen_ai.output.messages"]
    elif isinstance(outputs, str):
        result["gen_ai.output.messages"] = json.dumps(
            [{"role": "assistant", "content": [{"type": "text", "text": outputs}]}]
        )
    elif outputs is not None:
        result["gen_ai.output.messages"] = json.dumps(
            [{"role": "assistant", "content": [{"type": "text", "text": json.dumps(outputs)}]}]
        )

    return result


# Format handler registry — keyed by MESSAGE_FORMAT attribute value
_FORMAT_HANDLERS: dict[str, Callable] = {
    "openai": _openai_handler,
    "anthropic": _anthropic_handler,
    "gemini": _gemini_handler,
    "bedrock": _openai_handler,  # Bedrock converse uses OpenAI-compatible format
    "groq": _openai_handler,  # Groq uses OpenAI-compatible format
    "langchain": _langchain_handler,
    # llamaindex, ag2, autogen — handled by default heuristic
}
