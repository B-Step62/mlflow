import time
from threading import Thread
from unittest import mock

from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracing.types.model import Trace
from mlflow.tracing.types.wrapper import MLflowSpanWrapper


def test_aggregator_singleton():
    obj1 = InMemoryTraceManager.get_instance()
    obj2 = InMemoryTraceManager.get_instance()
    assert obj1 is obj2


def test_add_spans():
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.flush()

    trace_id_1 = "trace_1"
    span_1_1 = _create_test_span(trace_id_1, "span_1_1")
    span_1_1_1 = _create_test_span(trace_id_1, "span_1_1_1", parent_span_id="span_1_1")
    span_1_1_2 = _create_test_span(trace_id_1, "span_1_1_2", parent_span_id="span_1_1")

    # Add a span for a new trace
    trace_manager.add_or_update_span(span_1_1)

    assert trace_id_1 in trace_manager._traces
    assert len(trace_manager._traces[trace_id_1].span_dict) == 1

    # Add more spans to the same trace
    trace_manager.add_or_update_span(span_1_1_1)
    trace_manager.add_or_update_span(span_1_1_2)

    assert len(trace_manager._traces[trace_id_1].span_dict) == 3

    # Add a span for another trace
    trace_id_2 = "trace_2"
    span_2_1 = _create_test_span(trace_id_2, "span_2_1")
    span_2_1_1 = _create_test_span(trace_id_2, "span_2_1_1", parent_span_id="span_2_1")

    trace_manager.add_or_update_span(span_2_1)
    trace_manager.add_or_update_span(span_2_1_1)

    assert trace_id_2 in trace_manager._traces
    assert len(trace_manager._traces[trace_id_2].span_dict) == 2

    # Pop the trace data
    trace = trace_manager.pop_trace(trace_id_1)
    assert isinstance(trace, Trace)
    assert len(trace.trace_data.spans) == 3
    assert trace_id_1 not in trace_manager._traces

    trace = trace_manager.pop_trace(trace_id_2)
    assert isinstance(trace, Trace)
    assert len(trace.trace_data.spans) == 2
    assert trace_id_2 not in trace_manager._traces

    # Pop a trace that does not exist
    assert trace_manager.pop_trace("trace_3") is None


def test_start_detached_span():
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.flush()

    # Root span will create a new trace
    root_span = trace_manager.start_detached_span(name="root_span")
    trace_id = root_span.trace_id
    assert len(trace_manager._traces) == 1
    assert trace_manager.get_root_span_id(trace_id) == root_span.span_id

    # Child span will be added to the existing trace
    child_span = trace_manager.start_detached_span(
        name="child_span", trace_id=trace_id, parent_span_id=root_span.span_id
    )

    assert len(trace_manager._traces) == 1
    assert trace_manager.get_span_from_id(trace_id, span_id=child_span.span_id) == child_span


def test_add_and_pop_span_thread_safety():
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.flush()

    # Add spans from 10 different threads to 5 different traces
    trace_ids = [f"trace_{i}" for i in range(5)]
    num_threads = 10

    def add_spans(thread_id):
        for trace_id in trace_ids:
            trace_manager.add_or_update_span(_create_test_span(trace_id, f"span_{thread_id}"))

    threads = [Thread(target=add_spans, args=[i]) for i in range(num_threads)]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    for trace_id in trace_ids:
        trace = trace_manager.pop_trace(trace_id)
        assert trace is not None
        assert trace.trace_info.trace_id == trace_id
        assert len(trace.trace_data.spans) == num_threads


def test_get_span_from_id():
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.flush()

    trace_id_1 = "trace_1"
    span_1_1 = _create_test_span(trace_id_1, "span")
    span_1_2 = _create_test_span(trace_id_1, "child_span", parent_span_id=span_1_1.context.span_id)

    trace_id_2 = "trace_2"
    span_2_1 = _create_test_span(trace_id_2, "span")
    span_2_2 = _create_test_span(trace_id_2, "child_span", parent_span_id=span_2_1.context.span_id)

    # Add a span for a new trace
    trace_manager.add_or_update_span(span_1_1)
    trace_manager.add_or_update_span(span_1_2)
    trace_manager.add_or_update_span(span_2_1)
    trace_manager.add_or_update_span(span_2_2)

    assert trace_manager.get_span_from_id(trace_id_1, "span") == span_1_1
    assert trace_manager.get_span_from_id(trace_id_2, "child_span") == span_2_2


def test_ger_root_span_id():
    trace_manager = InMemoryTraceManager.get_instance()
    trace_manager.flush()

    trace_id_1 = "trace_1"
    span_1_1 = _create_test_span(trace_id_1, "span")
    span_1_2 = _create_test_span(trace_id_1, "child_span", parent_span_id=span_1_1.context.span_id)

    # Add a span for a new trace
    trace_manager.add_or_update_span(span_1_1)
    trace_manager.add_or_update_span(span_1_2)

    assert trace_manager.get_root_span_id(trace_id_1) == "span"

    # Non-existing trace
    assert trace_manager.get_root_span_id("trace_2") is None


def _create_test_span(trace_id, span_id, parent_span_id=None, start_time=None, end_time=None):
    if start_time is None:
        start_time = time.time_ns()
    if end_time is None:
        end_time = time.time_ns()

    mock_span = mock.MagicMock()
    mock_span.get_span_context().trace_id = trace_id
    mock_span.get_span_context().span_id = span_id
    mock_span.parent.span_id = parent_span_id
    mock_span.start_time = start_time
    mock_span.end_time = end_time
    mock_span.name = "test_span"

    return MLflowSpanWrapper(mock_span)
