from dataclasses import dataclass
from unittest.mock import MagicMock

from opentelemetry.sdk.trace import ReadableSpan

from mlflow.entities import Span, TraceStatus
from mlflow.entities.trace_data import TraceData
from mlflow.tracing.export.mlflow import MlflowSpanExporter
from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracing.types.constant import (
    MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS,
    TRUNCATION_SUFFIX,
    TraceMetadataKey,
    TraceTagKey,
)
from mlflow.tracing.types.wrapper import MlflowSpanWrapper


@dataclass
class _MockSpanContext:
    trace_id: str
    span_id: str


class _MockOTelSpan(ReadableSpan):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._parent = kwargs.get("parent", None)
        self._attributes = {}

    def set_attribute(self, key, value):
        self._attributes[key] = value


def test_export():
    trace_id = "trace_id"
    request_id = "tr-123"
    otel_span_root = _MockOTelSpan(
        name="test_span",
        context=_MockSpanContext(trace_id, "span_id_1"),
        parent=None,
        attributes={
            "key1": "value1",
        },
        start_time=0,
        end_time=4_000_000,  # nano seconds
    )
    root_span = MlflowSpanWrapper(otel_span_root, request_id=request_id)
    root_span.set_inputs({"input1": "very long input" * 100})
    root_span.set_outputs({"output": "very long output" * 100})

    otel_span_child_1 = _MockOTelSpan(
        name="test_span_child_1",
        context=_MockSpanContext(trace_id, "span_id_2"),
        parent=otel_span_root.context,
        attributes={
            "key2": "value2",
        },
        start_time=1_000_000,
        end_time=2_000_000,
    )
    span_child_1 = MlflowSpanWrapper(otel_span_child_1, request_id=request_id)

    otel_span_child_2 = _MockOTelSpan(
        name="test_span_child_2",
        context=_MockSpanContext(trace_id, "span_id_3"),
        parent=otel_span_root.context,
        start_time=2_000_000,
        end_time=3_000_000,
    )
    span_child_2 = MlflowSpanWrapper(otel_span_child_2, request_id=request_id)

    for span in [root_span, span_child_1, span_child_2]:
        InMemoryTraceManager.get_instance().add_or_update_span(span)

    mock_client = MagicMock()
    exporter = MlflowSpanExporter(mock_client)

    # Export the first child span -> no client call
    exporter.export([otel_span_child_1])
    assert mock_client.log_trace.call_count == 0

    # Export the second child span -> no client call
    exporter.export([otel_span_child_2])
    assert mock_client.log_trace.call_count == 0

    # Export the root span -> client call
    exporter.export([otel_span_root])

    assert mock_client.log_trace.call_count == 1
    client_call_args = mock_client.log_trace.call_args[0][0]

    # Trace info should inherit fields from the root span
    trace_info = client_call_args.info
    assert trace_info.request_id == request_id
    assert trace_info.timestamp_ms == 0
    assert trace_info.execution_time_ms == 4
    assert trace_info.tags[TraceTagKey.TRACE_NAME] == "test_span"

    # Inputs and outputs in TraceInfo attributes should be serialized and truncated
    inputs = trace_info.request_metadata[TraceMetadataKey.INPUTS]
    assert inputs.startswith('{"input1": "very long input')
    assert inputs.endswith(TRUNCATION_SUFFIX)
    assert len(inputs) == MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS

    outputs = trace_info.request_metadata[TraceMetadataKey.OUTPUTS]
    assert outputs.startswith('{"output": "very long output')
    assert outputs.endswith(TRUNCATION_SUFFIX)
    assert len(outputs) == MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS

    # All 3 spans should be in the logged trace data
    assert len(client_call_args.data.spans) == 3

    # Spans should be cleared from the aggregator
    assert len(exporter._trace_manager._traces) == 0


def test_deduplicate_span_names():
    span_names = ["red", "red", "blue", "red", "green", "blue"]

    spans = [
        Span(
            name=span_name,
            context=_MockSpanContext("trace_id", span_id=i),
            parent_id=None,
            status_code=TraceStatus.OK.value,
            status_message="",
            start_time=0,
            end_time=1,
        )
        for i, span_name in enumerate(span_names)
    ]

    trace_data = TraceData(spans=spans)
    MlflowSpanExporter._deduplicate_span_names_in_place(trace_data)

    assert [span.name for span in trace_data.spans] == [
        "red_1",
        "red_2",
        "blue_1",
        "red_3",
        "green",
        "blue_2",
    ]
    # Check if the span order is preserved
    assert [span.context.span_id for span in trace_data.spans] == [0, 1, 2, 3, 4, 5]


def test_deduplicate_span_names_empty_spans():
    trace_data = TraceData(spans=[])
    MlflowSpanExporter._deduplicate_span_names_in_place(trace_data)
    assert trace_data.spans == []