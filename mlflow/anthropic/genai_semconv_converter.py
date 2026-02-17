"""GenAI Semantic Convention converter for Anthropic message format."""

import json
from typing import Any

from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class AnthropicSemconvConverter(GenAiSemconvConverter):
    """Converts Anthropic-format inputs/outputs to GenAI semconv messages."""

    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(inputs, dict) and "messages" in inputs:
            return [_convert_message(m) for m in inputs["messages"]]
        return None

    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(outputs, dict) and "content" in outputs:
            msg = _convert_message({"role": "assistant", "content": outputs["content"]})
            if sr := outputs.get("stop_reason"):
                msg["finish_reason"] = sr
            return [msg]
        return None

    def extract_response_attrs(self, outputs: Any) -> dict[str, Any]:
        attrs = super().extract_response_attrs(outputs)
        if isinstance(outputs, dict) and "stop_reason" in outputs:
            attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] = [outputs["stop_reason"]]
        return attrs


def _convert_message(msg: dict[str, Any]) -> dict[str, Any]:
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
