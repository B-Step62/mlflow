import json
from typing import Any

from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class AnthropicConverter(GenAiSemconvConverter):
    def convert_inputs(self, inputs: dict[str, Any]) -> list[dict] | None:
        messages = inputs.get("messages")
        if not isinstance(messages, list):
            return None
        return [_convert_message(m) for m in messages]

    def convert_system_instructions(self, inputs: dict[str, Any]) -> list[dict] | None:
        system = inputs.get("system")
        if isinstance(system, str):
            return [{"type": "text", "content": system}]
        if isinstance(system, list):
            return [_convert_block(b) for b in system]
        return None

    def convert_outputs(self, outputs: dict[str, Any]) -> list[dict] | None:
        content = outputs.get("content")
        if not isinstance(content, list):
            return None
        parts = [_convert_output_block(b) for b in content]
        result = {"role": outputs.get("role", "assistant"), "parts": parts}
        if stop_reason := outputs.get("stop_reason"):
            result["finish_reason"] = stop_reason
        return [result]

    def extract_request_params(self, inputs: dict[str, Any]) -> dict[str, Any]:
        params = super().extract_request_params(inputs)
        if (stop_sequences := inputs.get("stop_sequences")) is not None:
            if isinstance(stop_sequences, str):
                stop_sequences = [stop_sequences]
            params[GenAiSemconvKey.REQUEST_STOP_SEQUENCES] = stop_sequences
        if GenAiSemconvKey.TOOL_DEFINITIONS in params:
            params[GenAiSemconvKey.TOOL_DEFINITIONS] = json.dumps(inputs.get("tools", []))
        return params

    def extract_response_attrs(self, outputs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().extract_response_attrs(outputs)
        if stop_reason := outputs.get("stop_reason"):
            attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] = [stop_reason]
        return attrs


def _convert_message(msg: dict[str, Any]) -> dict[str, Any]:
    role = msg.get("role", "user")
    content = msg.get("content")

    if isinstance(content, str):
        return {"role": role, "parts": [{"type": "text", "content": content}]}

    if isinstance(content, list):
        parts = []
        has_tool_result = False
        for block in content:
            converted = _convert_block(block)
            parts.append(converted)
            if converted.get("type") == "tool_call_response":
                has_tool_result = True
        # Single tool_result block → role becomes "tool"
        if has_tool_result and len(parts) == 1:
            return {"role": "tool", "parts": parts}
        return {"role": role, "parts": parts}

    return {"role": role, "parts": []}


def _convert_block(block: dict[str, Any]) -> dict[str, Any]:
    match block:
        case {"type": "text", "text": str(text)}:
            return {"type": "text", "content": text}
        case {"type": "image", "source": {"type": "base64", "media_type": str(mt), "data": str(d)}}:
            return {
                "type": "blob",
                "modality": "image",
                "mime_type": mt,
                "content": d,
            }
        case {"type": "image", "source": {"type": "url", "url": str(url)}}:
            return {"type": "uri", "modality": "image", "uri": url}
        case {"type": "tool_use", "id": str(tid), "name": str(name), "input": input_data}:
            return {
                "type": "tool_call",
                "id": tid,
                "name": name,
                "arguments": input_data,
            }
        case {"type": "tool_result", "tool_use_id": str(tid)}:
            result = block.get("content", "")
            return {"type": "tool_call_response", "id": tid, "result": result}
        case {
            "type": "document",
            "source": {"type": "base64", "media_type": str(mt), "data": str(d)},
        }:
            return {
                "type": "blob",
                "modality": "document",
                "mime_type": mt,
                "content": d,
            }
        case {"type": "document", "source": {"type": "url", "url": str(url)}}:
            return {"type": "uri", "modality": "document", "uri": url}
        case _:
            return {"type": "text", "content": json.dumps(block)}


def _convert_output_block(block: dict[str, Any]) -> dict[str, Any]:
    match block:
        case {"type": "text", "text": str(text)}:
            return {"type": "text", "content": text}
        case {"type": "tool_use", "id": str(tid), "name": str(name), "input": input_data}:
            return {
                "type": "tool_call",
                "id": tid,
                "name": name,
                "arguments": input_data,
            }
        case _:
            return {"type": "text", "content": json.dumps(block)}
