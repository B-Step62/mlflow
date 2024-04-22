import json
import logging
from typing import Optional

from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan, Span
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter

from mlflow.entities.span_status import SpanStatus
from mlflow.entities.trace import Trace
from mlflow.entities.trace_info import TraceInfo
from mlflow.entities.trace_status import TraceStatus
from mlflow.tracing.constant import (
    MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS,
    TRUNCATION_SUFFIX,
    SpanAttributeKey,
    TraceMetadataKey,
    TraceTagKey,
)
from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracing.utils import deduplicate_span_names_in_place, encode_trace_id, get_request_id
from mlflow.tracking.client import MlflowClient
from mlflow.tracking.fluent import _get_experiment_id

_logger = logging.getLogger(__name__)


class MlflowSpanProcessor(SimpleSpanProcessor):
    """
    SpanProcessor is an instance that defines custom hooks to be executed when a span is started
    or ended (before exporting). The responsibility of this is
    TODO: Add more docstring
    """

    def __init__(self, span_exporter: SpanExporter):
        self.span_exporter = span_exporter
        self._client = MlflowClient()
        self._trace_manager = InMemoryTraceManager.get_instance()

    def on_start(self, span: Span, parent_context: Optional[Context] = None):
        request_id = self._trace_manager.get_request_id_from_trace_id(span.context.trace_id)
        if not request_id:
            trace_info = self._create_trace_info(span)
            self._trace_manager.register_trace(span.context.trace_id, trace_info)
            request_id = trace_info.request_id
        span.set_attribute(SpanAttributeKey.REQUEST_ID, json.dumps(request_id))

    def _create_trace_info(self, span: Span) -> TraceInfo:
        try:
            experiment_id = span.attributes.get(
                SpanAttributeKey.EXPERIMENT_ID, _get_experiment_id()
            )
            return self._client._start_tracked_trace(
                experiment_id=experiment_id,
                timestamp_ms=span.start_time // 1_000_000,  # nanosecond to millisecond
            )

        # TODO: This catches all exceptions from the tracking server so the in-memory tracing still
        # works if the backend APIs are not ready. Once backend is ready, we should catch more
        # specific exceptions and handle them accordingly.
        except Exception:
            _logger.debug(
                "Failed to start a trace in the tracking server. This may be because the "
                "backend APIs are not available. Fallback to client-side generation",
                exc_info=True,
            )

        return TraceInfo(
            request_id=encode_trace_id(span.context.trace_id),
            experiment_id=experiment_id,
            timestamp_ms=span.start_time // 1_000_000,  # nanosecond to millisecond
            execution_time_ms=None,
            status=TraceStatus.IN_PROGRESS,
        )

    def on_end(self, span: ReadableSpan) -> None:
        """
        Export the spans to MLflow backend.

        Args:
            spans: A sequence of OpenTelemetry ReadableSpan objects to be exported.
        """
        # Processing the trace only when the root span is found.
        if span._parent is not None:
            return

        request_id = get_request_id(span)
        with self._trace_manager.get_trace(request_id) as trace:
            if trace is None:
                _logger.debug(f"Trace data with request ID {request_id} not found.")
                return

            self._update_trace_info(trace, span)
            deduplicate_span_names_in_place(list(trace.span_dict.values()))

        super().on_end(span)

    def _update_trace_info(self, trace: Trace, root_span: ReadableSpan):
        """Update the trace info with the final values from the root span."""
        trace.info.timestamp_ms = root_span.start_time // 1_000_000  # nanosecond to millisecond
        trace.info.execution_time_ms = (root_span.end_time - root_span.start_time) // 1_000_000
        trace.info.status = SpanStatus.from_otel_status(root_span.status).status_code
        trace.info.request_metadata.update(
            {
                TraceMetadataKey.INPUTS: self._truncate_metadata(
                    root_span.attributes.get(SpanAttributeKey.INPUTS)
                ),
                TraceMetadataKey.OUTPUTS: self._truncate_metadata(
                    root_span.attributes.get(SpanAttributeKey.OUTPUTS)
                ),
            }
        )
        # Mutable info like trace name should be recorded in tags
        trace.info.tags.update(
            {
                TraceTagKey.TRACE_NAME: root_span.name,
            }
        )

    def _truncate_metadata(self, value: Optional[str]) -> str:
        """Get truncated value of the attribute if it exceeds the maximum length."""
        if not value:
            return ""

        if len(value) > MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS:
            trunc_length = MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS - len(TRUNCATION_SUFFIX)
            value = value[:trunc_length] + TRUNCATION_SUFFIX
        return value
