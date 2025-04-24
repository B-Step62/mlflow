import logging
from typing import Any, Optional, Sequence

from cachetools import TTLCache
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter

from mlflow.environment_variables import (
    _ENABLE_TRACE_DUAL_WRITE_IN_DB_MODEL_SERVING,
    MLFLOW_TRACE_BUFFER_MAX_SIZE,
    MLFLOW_TRACE_BUFFER_TTL_SECONDS,
)
from mlflow.tracing.export.databricks import DatabricksSpanExporter
from mlflow.tracing.fluent import _set_last_active_trace_id
from mlflow.tracing.trace_manager import InMemoryTraceManager

_logger = logging.getLogger(__name__)


def pop_trace(request_id: str) -> Optional[dict[str, Any]]:
    """
    Pop the completed trace data from the buffer. This method is used in
    the Databricks model serving so please be careful when modifying it.
    """
    return _TRACE_BUFFER.pop(request_id, None)


# For Inference Table, we use special TTLCache to store the finished traces
# so that they can be retrieved by Databricks model serving. The values
# in the buffer are not Trace dataclass, but rather a dictionary with the schema
# that is used within Databricks model serving.
def _initialize_trace_buffer():  # Define as a function for testing purposes
    return TTLCache(
        maxsize=MLFLOW_TRACE_BUFFER_MAX_SIZE.get(),
        ttl=MLFLOW_TRACE_BUFFER_TTL_SECONDS.get(),
    )


_TRACE_BUFFER = _initialize_trace_buffer()


class InferenceTableSpanExporter(SpanExporter):
    """
    An exporter implementation that logs the traces to Inference Table.

    Currently the Inference Table does not use collector to receive the traces,
    but rather actively fetches the trace during the prediction process. In the
    future, we may consider using collector-based approach and this exporter should
    send the traces instead of storing them in the buffer.
    """

    def __init__(self):
        self._trace_manager = InMemoryTraceManager.get_instance()

        # NB: When this env var is set to true, MLflow will export traces to both
        #  inference table and the MLflow backend for better propagation latency.
        self._is_dual_write_enabled = _ENABLE_TRACE_DUAL_WRITE_IN_DB_MODEL_SERVING.get()
        if self._is_dual_write_enabled:
            self._databricks_exporter = DatabricksSpanExporter()

    def export(self, spans: Sequence[ReadableSpan]):
        """
        Export the spans to Inference Table via the TTLCache buffer.

        Args:
            spans: A sequence of OpenTelemetry ReadableSpan objects passed from
                a span processor. Only root spans for each trace should be exported.
        """
        for span in spans:
            if span._parent is not None:
                _logger.debug("Received a non-root span. Skipping export.")
                continue

            trace = self._trace_manager.pop_trace(span.context.trace_id)
            if trace is None:
                _logger.debug(f"Trace for span {span} not found. Skipping export.")
                continue

            _set_last_active_trace_id(trace.info.request_id)

            # Add the trace to the in-memory buffer so it can be retrieved by upstream
            _TRACE_BUFFER[trace.info.request_id] = trace.to_dict()

            if self._is_dual_write_enabled:
                if trace.info.experiment_id is None:
                    _logger.debug(
                        "Dual write is enabled, but experiment ID is not set "
                        "for the trace. Skipping trace server export."
                    )
                    continue
                self._databricks_exporter._log_trace_async(trace)

    def flush(self, terminate: bool = False):
        """Flushes the exporter if async logging is enabled."""
        if self._is_dual_write_enabled:
            self._databricks_exporter.flush(terminate=terminate)
