"""GenAI Semantic Convention converter for OpenAI message format."""

import json
from typing import Any

from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class OpenAiSemconvConverter(GenAiSemconvConverter):
    """Converts OpenAI-format inputs/outputs to GenAI semconv messages."""

    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(inputs, dict) and "messages" in inputs:
            return [_convert_message(m) for m in inputs["messages"]]
        return None

    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(outputs, dict) and "choices" in outputs:
            out_msgs = []
            for choice in outputs["choices"]:
                msg = _convert_message(choice.get("message", {}))
                if fr := choice.get("finish_reason"):
                    msg["finish_reason"] = fr
                out_msgs.append(msg)
            return out_msgs
        return None

    def extract_response_attrs(self, outputs: Any) -> dict[str, Any]:
        attrs = super().extract_response_attrs(outputs)
        if isinstance(outputs, dict) and "choices" in outputs:
            reasons = [c.get("finish_reason") for c in outputs["choices"] if c.get("finish_reason")]
            if reasons:
                attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] = reasons
        return attrs


def _convert_message(msg: dict[str, Any]) -> dict[str, Any]:
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
