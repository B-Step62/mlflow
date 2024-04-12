from typing import Optional

from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.util._once import Once

from mlflow.tracing.clients import TraceClient, get_trace_client
from mlflow.tracing.export.mlflow import MlflowSpanExporter

# Once() object ensures a function is executed only once in a process.
# Note that it doesn't work as expected in a distributed environment.
_TRACER_PROVIDER_INITIALIZED = Once()


def get_tracer(module_name: str):
    """
    Get a tracer instance for the given module name.
    """
    # Initiate tracer provider only once in the application lifecycle
    _TRACER_PROVIDER_INITIALIZED.do_once(_setup_tracer_provider)

    tracer_provider = trace_api.get_tracer_provider()
    return tracer_provider.get_tracer(module_name)


def _setup_tracer_provider(client: Optional[TraceClient] = None):
    """
    Instantiate a tracer provider and set it as the global tracer provider.
    """
    client = client or get_trace_client()

    # TODO: Make factory method for exporters once we support more sink destinations
    exporter = MlflowSpanExporter(client)

    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace_api.set_tracer_provider(tracer_provider)


def start_detached_otel_span(name: str, parent_span: Optional[trace_api.Span]) -> trace_api.Span:
    """
    Start a new OpenTelemetry span that is not part of the current trace context, but with the
    explicit parent span ID if provided.

    Args:
        name: The name of the span.
        request_id: The request (trace) ID for the span. Only used for getting the parent span
            for the given parent_span_id. If not provided, a new trace will be created.
        parent_span_id: The parent span ID of the span. If None, the span will be a root span.
        span_type: The type of the span.

    Returns:
        The newly created span (wrapped in MlflowSpanWrapper). If any error occurs, returns a
        NoOpMlflowSpanWrapper that has exact same interface but no-op implementations.
    """
    tracer = get_tracer(__name__)
    if parent_span:
        context = trace_api.set_span_in_context(parent_span)
    else:
        context = None

    return tracer.start_span(name, context=context)
