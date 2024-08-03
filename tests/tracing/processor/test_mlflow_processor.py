import json
import time
from unittest import mock

import pytest

import mlflow.tracking.context.default_context
from mlflow.entities.span import LiveSpan
from mlflow.entities.trace_status import TraceStatus
from mlflow.environment_variables import MLFLOW_ENABLE_ASYNC_LOGGING, MLFLOW_TRACKING_USERNAME
from mlflow.pyfunc.context import Context, set_prediction_context
from mlflow.tracing.constant import (
    TRACE_SCHEMA_VERSION,
    TRACE_SCHEMA_VERSION_KEY,
    SpanAttributeKey,
    TraceMetadataKey,
)
from mlflow.tracing.processor.mlflow import MlflowSpanProcessor
from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracking.default_experiment import DEFAULT_EXPERIMENT_ID
from mlflow.utils.os import is_windows

from tests.tracing.helper import create_mock_otel_span, create_test_trace_info

_TRACE_ID = 12345
_REQUEST_ID = f"tr-{_TRACE_ID}"


# Running all tests with and without async logging enabled
@pytest.fixture(autouse=True, params=[True, False])
def is_async(request, monkeypatch):
    monkeypatch.setenv(MLFLOW_ENABLE_ASYNC_LOGGING.name, str(request.param))
    return request.param


def test_on_start(is_async, monkeypatch):
    monkeypatch.setattr(mlflow.tracking.context.default_context, "_get_source_name", lambda: "test")
    monkeypatch.setenv(MLFLOW_TRACKING_USERNAME.name, "bob")

    # Root span should create a new trace on start
    span = create_mock_otel_span(
        trace_id=_TRACE_ID, span_id=1, parent_id=None, start_time=5_000_000
    )
    trace_info = create_test_trace_info(_REQUEST_ID, 0)

    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.return_value = trace_info
    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    processor.on_start(span)
    if is_async:
        processor.flush()

    mock_client._start_tracked_trace.assert_called_once_with(
        experiment_id="0",
        timestamp_ms=5,
        request_metadata={TRACE_SCHEMA_VERSION_KEY: str(TRACE_SCHEMA_VERSION)},
        tags={
            "mlflow.traceName": "test_span",
            "mlflow.user": "bob",
            "mlflow.source.name": "test",
            "mlflow.source.type": "LOCAL",
        },
    )
    assert len(InMemoryTraceManager.get_instance()._traces) == 1

    # Child span should not create a new trace
    child_span = create_mock_otel_span(
        trace_id=_TRACE_ID, span_id=2, parent_id=1, start_time=8_000_000
    )
    mock_client._start_tracked_trace.reset_mock()
    processor.on_start(child_span)

    mock_client._start_tracked_trace.assert_not_called()


@pytest.mark.skipif(is_windows(), reason="Timestamp is not precise enough on Windows")
def test_on_start_adjust_span_timestamp_to_exclude_backend_latency(is_async, monkeypatch):
    monkeypatch.setenv("MLFLOW_TESTING", "false")
    trace_info = create_test_trace_info(_REQUEST_ID, 0)
    mock_client = mock.MagicMock()

    def _mock_start_tracked_trace(*args, **kwargs):
        time.sleep(0.5)  # Simulate backend latency
        return trace_info

    mock_client._start_tracked_trace.side_effect = _mock_start_tracked_trace
    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    original_start_time = time.time_ns()
    span = create_mock_otel_span(trace_id=_TRACE_ID, span_id=1, start_time=original_start_time)

    # make sure _start_tracked_trace is invoked
    assert processor._trace_manager.get_request_id_from_trace_id(span.context.trace_id) is None
    processor.on_start(span)

    assert span.start_time > original_start_time
    # The span timestamp should not include the backend latency (0.5 second)
    assert time.time_ns() - span.start_time < 100_000_000  # 0.1 second

    if is_async:
        processor.flush()


def test_on_start_with_experiment_id(is_async, monkeypatch):
    monkeypatch.setattr(mlflow.tracking.context.default_context, "_get_source_name", lambda: "test")
    monkeypatch.setenv(MLFLOW_TRACKING_USERNAME.name, "bob")

    experiment_id = "test_experiment_id"
    span = create_mock_otel_span(
        trace_id=_TRACE_ID, span_id=1, parent_id=None, start_time=5_000_000
    )
    span.set_attribute(SpanAttributeKey.EXPERIMENT_ID, json.dumps(experiment_id))
    trace_info = create_test_trace_info(_REQUEST_ID, experiment_id=experiment_id)

    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.return_value = trace_info
    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    processor.on_start(span)

    if is_async:
        processor.flush()

    mock_client._start_tracked_trace.assert_called_once_with(
        experiment_id=experiment_id,
        timestamp_ms=5,
        request_metadata={TRACE_SCHEMA_VERSION_KEY: str(TRACE_SCHEMA_VERSION)},
        tags={
            "mlflow.traceName": "test_span",
            "mlflow.user": "bob",
            "mlflow.source.name": "test",
            "mlflow.source.type": "LOCAL",
        },
    )


def test_on_start_during_model_evaluation(is_async):
    # Root span should create a new trace on start
    span = create_mock_otel_span(trace_id=_TRACE_ID, span_id=1)
    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.return_value = create_test_trace_info(_REQUEST_ID, 0)
    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    with set_prediction_context(Context(request_id=_REQUEST_ID, is_evaluate=True)):
        processor.on_start(span)

    if is_async:
        processor.flush()

    mock_client._start_tracked_trace.assert_called_once()


def test_on_start_during_run(is_async, monkeypatch):
    monkeypatch.setattr(mlflow.tracking.context.default_context, "_get_source_name", lambda: "test")
    monkeypatch.setenv(MLFLOW_TRACKING_USERNAME.name, "bob")

    span = create_mock_otel_span(
        trace_id=_TRACE_ID, span_id=1, parent_id=None, start_time=5_000_000
    )

    env_experiment_name = "env_experiment_id"
    run_experiment_name = "run_experiment_id"

    mlflow.create_experiment(env_experiment_name)
    run_experiment_id = mlflow.create_experiment(run_experiment_name)

    mlflow.set_experiment(experiment_name=env_experiment_name)
    trace_info = create_test_trace_info(_REQUEST_ID)
    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.return_value = trace_info
    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    with mlflow.start_run(experiment_id=run_experiment_id) as run:
        processor.on_start(span)
        expected_run_id = run.info.run_id

    if is_async:
        processor.flush()

    mock_client._start_tracked_trace.assert_called_once_with(
        # expect experiment id to be from the run, not from the environment
        experiment_id=run_experiment_id,
        timestamp_ms=5,
        # expect run id to be set
        request_metadata={
            TraceMetadataKey.SOURCE_RUN: expected_run_id,
            TRACE_SCHEMA_VERSION_KEY: str(TRACE_SCHEMA_VERSION),
        },
        tags=mock.ANY,
    )


def test_on_start_warns_default_experiment(is_async, monkeypatch):
    mlflow.tracing.processor.mlflow._ISSUED_DEFAULT_EXPERIMENT_WARNING = False
    mlflow.set_experiment(experiment_id=DEFAULT_EXPERIMENT_ID)

    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.return_value = create_test_trace_info(_REQUEST_ID, 0)

    mock_logger = mock.MagicMock()
    monkeypatch.setattr("mlflow.tracing.processor.mlflow._logger", mock_logger)

    processor = MlflowSpanProcessor(span_exporter=mock.MagicMock(), client=mock_client)

    processor.on_start(create_mock_otel_span(trace_id=123, span_id=1))
    processor.on_start(create_mock_otel_span(trace_id=234, span_id=1))
    processor.on_start(create_mock_otel_span(trace_id=345, span_id=1))

    mock_logger.warning.assert_called_once()
    warns = mock_logger.warning.call_args_list[0][0]
    assert "Creating a trace within the default" in str(warns[0])

    if is_async:
        processor.flush()


def test_on_end(is_async):
    trace_info = create_test_trace_info(_REQUEST_ID, 0)
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.register_trace(_TRACE_ID, trace_info)

    otel_span = create_mock_otel_span(
        name="foo",
        trace_id=_TRACE_ID,
        span_id=1,
        parent_id=None,
        start_time=5_000_000,
        end_time=9_000_000,
    )
    span = LiveSpan(otel_span, request_id=_REQUEST_ID)
    span.set_status("OK")
    span.set_inputs({"input1": "very long input" * 100})
    span.set_outputs({"output": "very long output" * 100})

    mock_exporter = mock.MagicMock()
    mock_client = mock.MagicMock()
    mock_client._start_tracked_trace.side_effect = Exception("error")
    processor = MlflowSpanProcessor(span_exporter=mock_exporter, client=mock_client)

    processor.on_end(otel_span)

    if is_async:
        processor.flush()

    mock_exporter.export.assert_called_once_with((otel_span,))
    # Trace info should be updated according to the span attributes
    assert trace_info.status == TraceStatus.OK
    assert trace_info.execution_time_ms == 4
    trace_input = trace_info.request_metadata.get(TraceMetadataKey.INPUTS)
    assert len(trace_input) == 250
    assert trace_input.startswith('{"input1": "very long input')
    trace_output = trace_info.request_metadata.get(TraceMetadataKey.OUTPUTS)
    assert len(trace_output) == 250
    assert trace_output.startswith('{"output": "very long output')
    assert trace_info.tags == {}

    # Non-root span should not be exported
    mock_exporter.reset_mock()
    child_span = create_mock_otel_span(trace_id=_TRACE_ID, span_id=2, parent_id=1)
    processor.on_end(child_span)
    mock_exporter.export.assert_not_called()
