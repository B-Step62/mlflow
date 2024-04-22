from unittest.mock import MagicMock

from mlflow.entities import LiveSpan
from mlflow.tracing.export.mlflow import MlflowSpanExporter
from mlflow.tracing.trace_manager import InMemoryTraceManager

from tests.tracing.helper import create_mock_otel_span, create_test_trace_info


def test_export():
    trace_id = 12345
    request_id = f"tr-{trace_id}"
    otel_span = create_mock_otel_span(
        name="test_span",
        trace_id=trace_id,
        span_id=1,
        parent_id=None,
        start_time=0,
        end_time=1_000_000,  # nano seconds
    )
    span = LiveSpan(otel_span, request_id=request_id)
    span.set_inputs({"input1": "very long input" * 100})
    span.set_outputs({"output": "very long output" * 100})

    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.register_trace(trace_id, create_test_trace_info(request_id, 0))
    trace_manager.register_span(span)

    mock_client = MagicMock()
    exporter = MlflowSpanExporter(mock_client)

    # Export the first child span -> no client call
    exporter.export([otel_span])
    assert mock_client._upload_trace_data.call_count == 1
    trace_info, trace_data = mock_client._upload_trace_data.call_args[0]
    assert len(trace_data.spans) == 1

    # Spans should be cleared from the aggregator
    assert len(exporter._trace_manager._traces) == 0

    mock_client._upload_ended_trace_info.assert_called_once_with(
        request_id=request_id,
        timestamp_ms=1,
        status="OK",
        request_metadata={},
        tags={},
    )
