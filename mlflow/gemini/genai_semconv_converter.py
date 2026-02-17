"""GenAI Semantic Convention converter for Gemini message format."""

import json
from typing import Any

from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class GeminiSemconvConverter(GenAiSemconvConverter):
    """Converts Gemini-format inputs/outputs to GenAI semconv messages."""

    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(inputs, dict) and "contents" in inputs:
            return [_convert_content(c) for c in inputs["contents"]]
        return None

    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(outputs, dict) and "candidates" in outputs:
            return [
                _convert_content(candidate["content"])
                for candidate in outputs["candidates"]
                if "content" in candidate
            ]
        return None


def _convert_content(content: dict[str, Any]) -> dict[str, Any]:
    role = content.get("role", "user")
    parts: list[dict[str, Any]] = []
    for part in content.get("parts", []):
        if isinstance(part, dict) and "text" in part:
            parts.append({"type": "text", "text": part["text"]})
        else:
            parts.append({"type": "text", "text": json.dumps(part)})
    return {"role": role, "content": parts}
