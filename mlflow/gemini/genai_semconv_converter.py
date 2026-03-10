import json
from typing import Any

from mlflow.tracing.constant import GenAiSemconvKey
from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class GeminiConverter(GenAiSemconvConverter):
    def convert_inputs(self, inputs: dict[str, Any]) -> list[dict] | None:
        contents = inputs.get("contents")
        if contents is None:
            return None

        if isinstance(contents, str):
            return [{"role": "user", "parts": [{"type": "text", "content": contents}]}]

        if isinstance(contents, list):
            # Check if this is a list of Content dicts (have "role" key)
            # or a flat list of Part dicts/strings (no "role" key)
            if contents and isinstance(contents[0], dict) and "role" in contents[0]:
                return [_convert_content_dict(c) for c in contents]
            # Flat list of parts → single user message
            parts = [_convert_part(p) for p in contents]
            return [{"role": "user", "parts": parts}]

        return None

    def convert_system_instructions(self, inputs: dict[str, Any]) -> list[dict] | None:
        config = inputs.get("config")
        if not isinstance(config, dict):
            return None
        system_instruction = config.get("system_instruction")
        if system_instruction is None:
            return None
        if isinstance(system_instruction, str):
            return [{"type": "text", "content": system_instruction}]
        if isinstance(system_instruction, dict):
            # Content dict with "parts"
            parts = system_instruction.get("parts", [])
            return [_convert_part(p) for p in parts]
        return None

    def convert_outputs(self, outputs: dict[str, Any]) -> list[dict] | None:
        candidates = outputs.get("candidates")
        if not isinstance(candidates, list):
            return None
        result = []
        for candidate in candidates:
            content = candidate.get("content", {})
            parts_list = content.get("parts", [])
            role = _map_role(content.get("role", "model"))
            parts = [_convert_part(p) for p in parts_list]
            msg = {"role": role, "parts": parts}
            if finish_reason := candidate.get("finish_reason"):
                msg["finish_reason"] = finish_reason
            result.append(msg)
        return result

    def extract_request_params(self, inputs: dict[str, Any]) -> dict[str, Any]:
        config = inputs.get("config")
        if not isinstance(config, dict):
            return {}
        # Remap Gemini-specific keys to the names the base class expects
        normalized = {**config}
        if "max_output_tokens" in normalized:
            normalized["max_tokens"] = normalized.pop("max_output_tokens")
        if "stop_sequences" in normalized:
            normalized["stop"] = normalized.pop("stop_sequences")
        return super().extract_request_params(normalized)

    def extract_response_attrs(self, outputs: dict[str, Any]) -> dict[str, Any]:
        attrs: dict[str, Any] = {}
        if response_id := outputs.get("id"):
            attrs[GenAiSemconvKey.RESPONSE_ID] = response_id
        if model := outputs.get("model"):
            attrs[GenAiSemconvKey.RESPONSE_MODEL] = model
        candidates = outputs.get("candidates")
        if isinstance(candidates, list):
            reasons = [c.get("finish_reason") for c in candidates if c.get("finish_reason")]
            if reasons:
                attrs[GenAiSemconvKey.RESPONSE_FINISH_REASONS] = reasons
        return attrs


def _map_role(role: str) -> str:
    if role == "model":
        return "assistant"
    return role


def _convert_content_dict(content: dict[str, Any]) -> dict[str, Any]:
    role = _map_role(content.get("role", "user"))
    parts = [_convert_part(p) for p in content.get("parts", [])]

    # function_response parts → role "tool"
    if parts and all(p.get("type") == "tool_call_response" for p in parts):
        return {"role": "tool", "parts": parts}

    return {"role": role, "parts": parts}


def _convert_part(part: Any) -> dict[str, Any]:
    if isinstance(part, str):
        return {"type": "text", "content": part}
    if not isinstance(part, dict):
        return {"type": "text", "content": str(part)}

    match part:
        case {"text": str(text)}:
            return {"type": "text", "content": text}
        case {"inline_data": {"data": str(data), "mime_type": str(mime_type)}}:
            result = {
                "type": "blob",
                "mime_type": mime_type,
                "content": data,
            }
            if modality := _modality_from_mime_type(mime_type):
                result["modality"] = modality
            return result
        case {"file_data": {"file_uri": str(uri), "mime_type": str(mime_type)}}:
            result = {
                "type": "uri",
                "mime_type": mime_type,
                "uri": uri,
            }
            if modality := _modality_from_mime_type(mime_type):
                result["modality"] = modality
            return result
        case {"function_call": {"name": str(name), "args": dict(args)}}:
            return {
                "type": "tool_call",
                "name": name,
                "arguments": args,
            }
        case {"function_response": {"name": str(name), "response": dict(response)}}:
            return {
                "type": "tool_call_response",
                "name": name,
                "result": response,
            }
        case _:
            return {"type": "text", "content": json.dumps(part)}


def _modality_from_mime_type(mime_type: str) -> str | None:
    if mime_type.startswith("image/"):
        return "image"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("video/"):
        return "video"
    return None
