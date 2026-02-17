"""
SpanExporter wrapper that translates MLflow spans to GenAI Semantic Convention
format before delegating to the underlying OTLP exporter.
"""

import logging
from typing import Sequence

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

from mlflow.environment_variables import MLFLOW_GENAI_SEMCONV_CAPTURE_CONTENT
from mlflow.tracing.export.genai_semconv.translator import translate_span_to_genai

_logger = logging.getLogger(__name__)


class GenAiSemconvSpanExporter(SpanExporter):
    """
    A SpanExporter that translates MLflow spans to OpenTelemetry GenAI Semantic
    Convention format before delegating to an inner exporter.

    This wrapper intercepts the export call, translates each span's mlflow.*
    attributes to gen_ai.* attributes, and forwards the translated spans to
    the underlying OTLP exporter.
    """

    def __init__(self, inner_exporter: SpanExporter) -> None:
        self._inner = inner_exporter

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        capture_content = MLFLOW_GENAI_SEMCONV_CAPTURE_CONTENT.get()
        try:
            translated = [
                translate_span_to_genai(span, capture_content=capture_content) for span in spans
            ]
            return self._inner.export(translated)
        except Exception:
            _logger.error("Failed to translate spans to GenAI semconv", exc_info=True)
            # Fallback: export original spans unchanged
            return self._inner.export(spans)

    def shutdown(self) -> None:
        self._inner.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self._inner.force_flush(timeout_millis)
