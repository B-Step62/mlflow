import json
from typing import Any

from mlflow.openai.genai_semconv_converter import _convert_content
from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter

# LangChain message type → GenAI semconv role
_TYPE_TO_ROLE = {
    "system": "system",
    "human": "user",
    "ai": "assistant",
    "tool": "tool",
    "function": "tool",
}


class LangChainConverter(GenAiSemconvConverter):
    def convert_inputs(self, inputs: Any) -> list[dict] | None:
        messages = _get_messages(inputs)
        if messages is None:
            return None
        return [
            _convert_message(m)
            for m in messages
            if _get_role(m) != "system"
        ]

    def convert_system_instructions(self, inputs: Any) -> list[dict] | None:
        messages = _get_messages(inputs)
        if messages is None:
            return None
        parts = []
        for m in messages:
            if _get_role(m) != "system":
                continue
            content = m.get("content")
            if isinstance(content, str):
                parts.append({"type": "text", "content": content})
            elif isinstance(content, list):
                parts.extend(_convert_content(content))
        return parts or None

    def convert_outputs(self, outputs: dict[str, Any]) -> list[dict] | None:
        generations = outputs.get("generations")
        if not isinstance(generations, list) or not generations:
            return None
        # First batch
        batch = generations[0]
        if not isinstance(batch, list):
            return None
        result = []
        for gen in batch:
            msg = gen.get("message")
            if isinstance(msg, dict):
                result.append(_convert_message(msg))
            elif text := gen.get("text"):
                result.append({"role": "assistant", "parts": [{"type": "text", "content": text}]})
        return result or None

    def extract_request_params(self, inputs: Any) -> dict[str, Any]:
        return {}

    def extract_response_attrs(self, outputs: dict[str, Any]) -> dict[str, Any]:
        return {}


def _get_messages(inputs: Any) -> list[dict] | None:
    if not isinstance(inputs, list) or not inputs:
        return None
    first = inputs[0]
    if not isinstance(first, list):
        return None
    return first


def _get_role(msg: dict[str, Any]) -> str:
    msg_type = msg.get("type", "")
    if msg_type == "chat":
        return msg.get("role", "user")
    return _TYPE_TO_ROLE.get(msg_type, msg_type)


def _convert_message(msg: dict[str, Any]) -> dict[str, Any]:
    role = _get_role(msg)
    content = msg.get("content")
    parts = _convert_content(content)

    # AI message tool calls
    if tool_calls := msg.get("tool_calls"):
        for tc in tool_calls:
            parts.append({
                "type": "tool_call",
                "id": tc.get("id"),
                "name": tc.get("name"),
                "arguments": tc.get("args"),
            })

    # Tool message → tool_call_response
    if tool_call_id := msg.get("tool_call_id"):
        result = parts[0].get("content") if parts else None
        return {
            "role": role,
            "parts": [{"type": "tool_call_response", "id": tool_call_id, "result": result}],
        }

    return {"role": role, "parts": parts}
