"""GenAI Semantic Convention converter for LangChain message format."""

from typing import Any

from mlflow.tracing.export.genai_semconv.converter import GenAiSemconvConverter


class LangChainSemconvConverter(GenAiSemconvConverter):
    """Converts LangChain-format inputs/outputs to GenAI semconv messages."""

    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(inputs, dict) and "messages" in inputs:
            # Wrapped in a dict with "messages" key — delegate to OpenAI-style
            from mlflow.openai.genai_semconv_converter import OpenAiSemconvConverter

            return OpenAiSemconvConverter().convert_inputs(inputs)

        if isinstance(inputs, list) and inputs:
            first = inputs[0]
            if isinstance(first, dict) and "role" in first:
                # OpenAI-style message list
                from mlflow.openai.genai_semconv_converter import _convert_message

                return [_convert_message(m) for m in inputs]
            if isinstance(first, dict) and "type" in first and "content" in first:
                # LangChain BaseMessage-like: {"type": "human", "content": "Hello"}
                return [_convert_base_message(m) for m in inputs]
        return None

    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        if isinstance(outputs, str):
            return [{"role": "assistant", "content": [{"type": "text", "text": outputs}]}]
        return None


_LANGCHAIN_ROLE_MAP = {
    "human": "user",
    "ai": "assistant",
    "system": "system",
    "tool": "tool",
}


def _convert_base_message(msg: dict[str, Any]) -> dict[str, Any]:
    role = _LANGCHAIN_ROLE_MAP.get(msg.get("type", ""), "user")
    return {
        "role": role,
        "content": [{"type": "text", "text": str(msg.get("content", ""))}],
    }
