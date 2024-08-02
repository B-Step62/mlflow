import time
from unittest import mock

import pytest

import mlflow
from mlflow.tracking.default_experiment import DEFAULT_EXPERIMENT_ID

from tests.tracing.test_fluent import DefaultTestModel


@pytest.fixture(autouse=True)
def enable_async_logging(monkeypatch):
    monkeypatch.setenv("MLFLOW_ENABLE_ASYNC_LOGGING", "true")


# Mock long network latency
@pytest.fixture
def slow_client():
    slow_client = mlflow.MlflowClient()
    original = slow_client._log_trace

    def _mock_log_trace(trace):
        time.sleep(5)
        original(trace)

    slow_client._log_trace = _mock_log_trace

    with mock.patch("mlflow.tracking.client.MlflowClient", return_value=slow_client) as client:
        yield client.return_value


def test_trace(slow_client):
    model = DefaultTestModel()
    # Prediction should not wait for the long network latency
    # (the start_trace call still takes a bit of time)
    start_time = time.time()
    model.predict(2, 5)
    assert time.time() - start_time < 3

    # In-memory trace should be available immediately
    in_memory_trace = mlflow.get_last_active_trace()
    assert in_memory_trace is not None
    assert in_memory_trace.info.status == "OK"

    # Trace should not yet be logged to the backend
    # This call will trigger a warning like "Failed to download trace data..."
    # because at this moment only TraceInfo is available in the backend, which
    # was created by the StartTrace call.
    traces = slow_client.search_traces(experiment_ids=[DEFAULT_EXPERIMENT_ID])
    assert len(traces) == 0

    # Flush
    mlflow.flush_trace_async_logging(keep_running=False)

    # Trace should be logged to the backend
    traces = slow_client.search_traces(experiment_ids=[DEFAULT_EXPERIMENT_ID])
    assert len(traces) == 1
    trace = traces[0]
    # NB: We cannot compare the entire trace object because of the start_time
    # issue mentioned in mlflow/tracing/export/mlflow.py
    assert trace.info.status == "OK"
    assert trace.info.request_id == in_memory_trace.info.request_id
    assert len(trace.data.spans) == len(in_memory_trace.data.spans)
    assert all(
        s1.to_dict() == s2.to_dict() for s1, s2 in zip(in_memory_trace.data.spans, trace.data.spans)
    )
