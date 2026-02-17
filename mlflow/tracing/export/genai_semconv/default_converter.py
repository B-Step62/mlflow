"""Default/fallback GenAI Semantic Convention converter for unknown message formats."""

import json
from typing import Any

from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class DefaultSemconvConverter(GenAiSemconvConverter):
    """
    Fallback converter that uses heuristics to detect the message format
    from the structure of inputs/outputs.
    """

    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        # Detect from structure and delegate to the right converter
        if isinstance(inputs, dict):
            if "messages" in inputs:
                from mlflow.openai.genai_semconv_converter import OpenAiSemconvConverter

                return OpenAiSemconvConverter().convert_inputs(inputs)
            if "contents" in inputs:
                from mlflow.gemini.genai_semconv_converter import GeminiSemconvConverter

                return GeminiSemconvConverter().convert_inputs(inputs)

        # Direct message list
        if (
            isinstance(inputs, list)
            and inputs
            and isinstance(inputs[0], dict)
            and "role" in inputs[0]
        ):
            from mlflow.openai.genai_semconv_converter import _convert_message

            return [_convert_message(m) for m in inputs]

        if isinstance(inputs, str):
            return [{"role": "user", "content": [{"type": "text", "text": inputs}]}]

        if inputs is not None:
            return [{"role": "user", "content": [{"type": "text", "text": json.dumps(inputs)}]}]

        return None

    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(outputs, dict) and "choices" in outputs:
            from mlflow.openai.genai_semconv_converter import OpenAiSemconvConverter

            return OpenAiSemconvConverter().convert_outputs(outputs)

        if (
            isinstance(outputs, dict)
            and "content" in outputs
            and isinstance(outputs["content"], list)
        ):
            from mlflow.anthropic.genai_semconv_converter import AnthropicSemconvConverter

            return AnthropicSemconvConverter().convert_outputs(outputs)

        if isinstance(outputs, str):
            return [{"role": "assistant", "content": [{"type": "text", "text": outputs}]}]

        if outputs is not None:
            return [
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": json.dumps(outputs)}],
                }
            ]

        return None
