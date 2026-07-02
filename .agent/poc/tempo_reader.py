"""
Read traces from Grafana Tempo and build MLflow Trace objects entirely in memory.
No SQL. No materialization. No cheating.

This module is the core of the POC - it proves that Tempo-stored traces
can be converted to MLflow's internal Trace representation without any
intermediate storage.
"""

import json

import requests
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from mlflow.entities.span import Span
from mlflow.entities.trace import Trace
from mlflow.entities.trace_data import TraceData
from mlflow.entities.trace_info import TraceInfo
from mlflow.entities.trace_location import (
    MlflowExperimentLocation,
    TraceLocation,
    TraceLocationType,
)
from mlflow.entities.trace_state import TraceState

TEMPO_API = "http://localhost:3200"


def fetch_trace_from_tempo(otel_trace_id: str) -> Trace:
    """
    Fetch a trace from Tempo and build an MLflow Trace object in memory.
    No SQL, no persistence - everything is derived from Tempo's response.
    """
    resp = requests.get(
        f"{TEMPO_API}/api/traces/{otel_trace_id}",
        headers={"Accept": "application/protobuf"},
    )
    resp.raise_for_status()

    # Parse OTLP protobuf
    request = ExportTraceServiceRequest()
    request.ParseFromString(resp.content)

    # Convert OTel proto spans to MLflow Span objects
    mlflow_spans = []
    for resource_spans in request.resource_spans:
        resource = resource_spans.resource
        for scope_spans in resource_spans.scope_spans:
            for otel_span in scope_spans.spans:
                mlflow_span = Span.from_otel_proto(otel_span, resource=resource)
                mlflow_spans.append(mlflow_span)

    # Build TraceInfo entirely from span data
    trace_info = _build_trace_info(otel_trace_id, mlflow_spans)

    return Trace(info=trace_info, data=TraceData(spans=mlflow_spans))


def _build_trace_info(otel_trace_id: str, spans: list[Span]) -> TraceInfo:
    """Derive TraceInfo from span data. Nothing is persisted or stored."""
    root = next((s for s in spans if s.parent_id is None), None)
    if root is None:
        root = spans[0]

    # Derive state from root span's OTel status
    status = root._span.status
    from opentelemetry.trace import StatusCode as OTelStatusCode

    if status.status_code == OTelStatusCode.ERROR:
        state = TraceState.ERROR
    elif status.status_code == OTelStatusCode.OK:
        state = TraceState.OK
    else:
        state = TraceState.STATE_UNSPECIFIED

    # Timing from root span (nanoseconds -> milliseconds)
    start_ns = root._span.start_time
    end_ns = root._span.end_time
    request_time_ms = start_ns // 1_000_000
    duration_ms = (end_ns - start_ns) // 1_000_000

    # Previews from root span inputs/outputs
    request_preview = _get_span_io(root, "inputs")
    response_preview = _get_span_io(root, "outputs")

    # The trace_id MLflow uses (tr- prefix + hex)
    mlflow_trace_id = root.trace_id

    return TraceInfo(
        trace_id=mlflow_trace_id,
        trace_location=TraceLocation(
            type=TraceLocationType.MLFLOW_EXPERIMENT,
            mlflow_experiment=MlflowExperimentLocation(experiment_id="0"),
        ),
        request_time=request_time_ms,
        state=state,
        request_preview=_truncate(request_preview, 1000),
        response_preview=_truncate(response_preview, 1000),
        execution_duration=duration_ms,
    )


def _get_span_io(span: Span, which: str) -> str | None:
    if which == "inputs":
        val = span.inputs
    else:
        val = span.outputs
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return json.dumps(val)


def _truncate(s: str | None, max_len: int) -> str | None:
    if s is None:
        return None
    if len(s) <= max_len:
        return s
    return s[:max_len]
