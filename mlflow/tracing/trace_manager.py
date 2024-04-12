import logging
import threading
from dataclasses import dataclass, field
from typing import Dict, Optional

from cachetools import TTLCache
from mlflow.entities.span import SpanType
from mlflow.tracing.utils import KeyLocalLock
from opentelemetry import trace as trace_api

from mlflow.entities import Trace, TraceData, TraceInfo
from mlflow.environment_variables import (
    MLFLOW_TRACE_BUFFER_MAX_SIZE,
    MLFLOW_TRACE_BUFFER_TTL_SECONDS,
)
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST
from mlflow.tracing import provider
from mlflow.tracing.types.wrapper import MlflowSpanWrapper, NoOpMlflowSpanWrapper

_logger = logging.getLogger(__name__)


# Internal representation to keep the state of a trace.
# Dict[str, Span] is used instead of TraceData to allow access by span_id.
@dataclass
class _Trace:
    info: TraceInfo
    span_dict: Dict[str, MlflowSpanWrapper] = field(default_factory=dict)

    def to_mlflow_trace(self) -> Trace:
        trace_data = TraceData()
        for span in self.span_dict.values():
            trace_data.spans.append(span.to_mlflow_span())
            if span.parent_span_id is None:
                trace_data.request = span.inputs
                trace_data.response = span.outputs
        return Trace(self.info, trace_data)

class InMemoryTraceManager:
    """
    Manage spans and traces created by the tracing system in memory.
    """

    _instance_lock = threading.Lock()
    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = InMemoryTraceManager()
        return cls._instance

    def __init__(self):
        # Key is trace_id. We use trace_id as a source of truth because the request_id is
        # generated in the backend and not available immediately when the span is created
        # at the client side.
        self._traces: Dict[str, _Trace] = TTLCache(
            maxsize=MLFLOW_TRACE_BUFFER_MAX_SIZE.get(),
            ttl=MLFLOW_TRACE_BUFFER_TTL_SECONDS.get(),
        )
        self._request_id_to_trace_id: Dict[str, str] = {}
        # Lock for _traces and _request_id_to_trace_id. Lock is only applied per trace_id so
        # multiple requests can be processed concurrently as long as they are for different
        # traces.
        self._lock = KeyLocalLock()

    def add_trace(self, trace_id: str, trace_info: TraceInfo):
        with self._lock.acquire(trace_id):
            self._traces[trace_id] = _Trace(info=trace_info)
            self._request_id_to_trace_id[trace_info.request_id] = trace_id

    def pop_trace(self, request_id) -> Optional[Trace]:
        """
        Pop the trace data for the given id and return it as a ready-to-publish Trace object.
        """
        trace_id = self._request_id_to_trace_id.get(request_id)
        with self._lock.acquire(trace_id):
            if trace_id in self._traces:
                trace: _Trace = self._traces.pop(trace_id, None)
                self._lock.delete(trace_id)
            else:
                _logger.debug(f"Trying to pop a trace with ID {request_id} that does not "
                              "exist in the trace buffer.")
                trace = None
        return trace.to_mlflow_trace() if trace else None

    def get_or_create_mlflow_span(self, otel_span: trace_api.Span, span_type: SpanType=None) -> MlflowSpanWrapper:
        """
        Get or create MlflowSpanWrapper instance for the given OpenTelemetry span.

        If the MlflowSpanWrapper instance for the trace_id and span_id already exists in the trace
        buffer, return it. Otherwise, create a new MlflowSpanWrapper instance and store it in the
        trace buffer.
        Also, if it is the first span created for the trace, create an empty TraceInfo object.

        Args:
            otel_span: The OpenTelemetry span to get or create the MlflowSpanWrapper for.

        Returns:
            The MlflowSpanWrapper instance for the given OpenTelemetry span.
        """
        trace_id = otel_span.get_span_context().trace_id
        with self._lock.acquire(trace_id):
            trace = self._traces.get(trace_id)

        if not trace:
            _logger.debug(f"The trace with ID {trace_id} does not exist. Skipping span creation.")
            return NoOpMlflowSpanWrapper()

        mlflow_span = trace.span_dict.get(otel_span.get_span_context().span_id)
        if not mlflow_span:
            mlflow_span = MlflowSpanWrapper(
                request_id=trace.info.request_id,
                span=otel_span,
                span_type=span_type,
            )
            trace.span_dict[mlflow_span.span_id] = mlflow_span
        return mlflow_span

    def update_span(self, span: MlflowSpanWrapper):
        trace_id = span._span.context.trace_id
        with self._lock.acquire(trace_id):
            if trace := self._traces.get(trace_id):
                trace.span_dict[span.span_id] = span
                return

    def set_trace_tag(self, request_id: str, key: str, value: str):
        """Set a tag on the trace with the given request_id."""
        trace_id = self._request_id_to_trace_id.get(request_id)

        with self._lock.acquire(trace_id):
            if trace := self._traces.get(trace_id):
                trace.info.tags[key] = str(value)
                return

        raise MlflowException(
            f"Trace with ID {request_id} not found.", error_code=RESOURCE_DOES_NOT_EXIST
        )

    def get_trace_info(self, request_id: str) -> Optional[TraceInfo]:
        """
        Get the trace info for the given request_id.
        """
        trace_id = self._request_id_to_trace_id.get(request_id)
        trace = self._traces.get(trace_id)
        return trace.info if trace else None

    def get_span_from_id(self, request_id: str, span_id: str) -> Optional[MlflowSpanWrapper]:
        """
        Get a span object for the given request_id and span_id.
        """
        trace_id = self._request_id_to_trace_id.get(request_id)
        trace = self._traces.get(trace_id)
        return trace.span_dict.get(span_id) if trace else None

    def get_root_span_id(self, request_id) -> Optional[str]:
        """
        Get the root span ID for the given trace ID.
        """
        trace_id = self._request_id_to_trace_id.get(request_id)
        if trace := self._traces.get(trace_id):
            for span in trace.span_dict.values():
                if span.parent_span_id is None:
                    return span.span_id

        return None

    def flush(self):
        """Clear all the aggregated trace data. This should only be used for testing."""
        # Not acquirng the lock as this is only used in testing. Do not use this
        # method in production code!
        self._traces.clear()
