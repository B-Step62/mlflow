"""
Base class for format-specific GenAI Semantic Convention message converters.

Each autologging integration (OpenAI, Anthropic, Gemini, LangChain, etc.)
stores inputs/outputs in its provider-native structure. Subclasses of
GenAiSemconvConverter know how to extract messages from their specific format
and convert them to the GenAI semconv message structure.
"""

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from mlflow.tracing.constant import GenAiSemconvKey

_logger = logging.getLogger(__name__)


class GenAiSemconvConverter(ABC):
    """
    Base class for converting provider-specific message formats to GenAI semconv.

    Subclasses must implement `convert_inputs` and `convert_outputs` to handle
    their specific message format.
    """

    @abstractmethod
    def convert_inputs(self, inputs: Any) -> list[dict[str, Any]] | None:
        """
        Convert provider-specific inputs to GenAI semconv message format.

        Returns:
            A list of message dicts in GenAI semconv format, or None if
            the inputs cannot be converted.
        """

    @abstractmethod
    def convert_outputs(self, outputs: Any) -> list[dict[str, Any]] | None:
        """
        Convert provider-specific outputs to GenAI semconv message format.

        Returns:
            A list of message dicts in GenAI semconv format, or None if
            the outputs cannot be converted.
        """

    def extract_request_params(self, inputs: Any) -> dict[str, Any]:
        """
        Extract GenAI request parameters from inputs.

        Override in subclasses for format-specific parameter extraction.
        """
        if not isinstance(inputs, dict):
            return {}

        params: dict[str, Any] = {}
        if (temperature := inputs.get("temperature")) is not None:
            params[GenAiSemconvKey.REQUEST_TEMPERATURE] = temperature
        if (max_tokens := inputs.get("max_tokens")) is not None:
            params[GenAiSemconvKey.REQUEST_MAX_TOKENS] = max_tokens
        if (top_p := inputs.get("top_p")) is not None:
            params[GenAiSemconvKey.REQUEST_TOP_P] = top_p
        if (stop := inputs.get("stop")) is not None:
            params[GenAiSemconvKey.REQUEST_STOP_SEQUENCES] = stop
        if (tools := inputs.get("tools")) is not None:
            params[GenAiSemconvKey.TOOL_DEFINITIONS] = json.dumps(tools)
        return params

    def extract_response_attrs(self, outputs: Any) -> dict[str, Any]:
        """
        Extract GenAI response attributes from outputs.

        Override in subclasses for format-specific attribute extraction.
        """
        if not isinstance(outputs, dict):
            return {}

        attrs: dict[str, Any] = {}
        if (response_id := outputs.get("id")) is not None:
            attrs[GenAiSemconvKey.RESPONSE_ID] = response_id
        if (model := outputs.get("model")) is not None:
            attrs[GenAiSemconvKey.RESPONSE_MODEL] = model
        return attrs

    def translate(self, inputs: Any, outputs: Any) -> dict[str, Any]:
        """
        Translate inputs/outputs to GenAI semconv attributes.

        This is the main entry point called by the translator.
        """
        result: dict[str, Any] = {}

        if inputs is not None:
            if input_msgs := self.convert_inputs(inputs):
                result[GenAiSemconvKey.INPUT_MESSAGES] = json.dumps(input_msgs)
            result.update(self.extract_request_params(inputs))

        if outputs is not None:
            if output_msgs := self.convert_outputs(outputs):
                result[GenAiSemconvKey.OUTPUT_MESSAGES] = json.dumps(output_msgs)
            result.update(self.extract_response_attrs(outputs))

        return result
