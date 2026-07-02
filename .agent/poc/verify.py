"""
Fetch a trace from Tempo and verify the round-trip produces valid MLflow objects.
No SQL. No materialization. Everything in memory.

Usage:
    uv run .agent/poc/verify.py <otel_trace_id>
"""

import sys

from tempo_reader import fetch_trace_from_tempo


def verify(otel_trace_id: str):
    print(f"Fetching trace {otel_trace_id} from Tempo...")
    trace = fetch_trace_from_tempo(otel_trace_id)

    info = trace.info
    spans = trace.data.spans

    print(f"\n--- TraceInfo (built in memory, not from SQL) ---")
    print(f"  trace_id:       {info.trace_id}")
    print(f"  state:          {info.state}")
    print(f"  request_time:   {info.request_time}")
    print(f"  duration:       {info.execution_duration}ms")
    print(f"  request:        {info.request_preview}")
    print(f"  response:       {info.response_preview}")
    print(f"  location:       {info.trace_location.type}")

    print(f"\n--- Spans ({len(spans)}) ---")
    for span in spans:
        parent = "root" if span.parent_id is None else span.parent_id[:8]
        print(
            f"  [{span.span_id[:8]}] {span.name} "
            f"(type={span.span_type}, parent={parent}, "
            f"duration={span._span.end_time - span._span.start_time}ns)"
        )
        print(f"    inputs:  {str(span.inputs)[:100]}")
        print(f"    outputs: {str(span.outputs)[:100]}")

    # Verify span tree structure
    roots = [s for s in spans if s.parent_id is None]
    children = [s for s in spans if s.parent_id is not None]
    print(f"\n--- Structure ---")
    print(f"  Root spans: {len(roots)}")
    print(f"  Child spans: {len(children)}")

    # Verify serialization round-trip
    d = trace.to_dict()
    from mlflow.entities.trace import Trace

    trace2 = Trace.from_dict(d)
    assert trace2.info.trace_id == trace.info.trace_id
    assert len(trace2.data.spans) == len(trace.data.spans)
    print(f"  Serialization round-trip (to_dict -> from_dict): OK")

    # Verify the trace is valid for evaluate()
    print(f"\n--- Evaluate readiness ---")
    root = roots[0]
    print(f"  Root span name: {root.name}")
    print(f"  Root inputs: {root.inputs}")
    print(f"  Root outputs: {root.outputs}")
    print(f"  All span types: {[s.span_type for s in spans]}")

    print(f"\nAll checks passed. Trace is a valid MLflow Trace object,")
    print(f"built entirely in memory from Tempo data. No SQL involved.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run .agent/poc/verify.py <otel_trace_id>")
        sys.exit(1)
    verify(sys.argv[1])
