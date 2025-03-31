
from mlflow.entities import LiveSpan, Span, SpanType, SpanStatus, SpanStatusCode
from mlflow.entities.span import SpanAttributeKey, NO_OP_SPAN_REQUEST_ID
from mlflow.exceptions import MlflowException
from mlflow.tracing.apis.tracking import get_otel_attribute
from mlflow.tracing.constant import NO_OP_SPAN_REQUEST_ID
from mlflow.tracing.trace_manager import InMemoryTraceManager

from typing import Any, Optional


def start_detached_span(
    name: str,
    span_type: str = SpanType.UNKNOWN,
    parent_span: Optional[LiveSpan] = None,
    inputs: Optional[Any] = None,
    attributes: Optional[dict[str, str]] = None,
    tags: Optional[dict[str, str]] = None,
    experiment_id: Optional[str] = None,
    start_time_ns: Optional[int] = None,
) -> Span:
    """
    Create a new trace object and start a root span under it.

    """
    # If parent span is no-op span, the child should also be no-op too
    if parent_span and parent_span.request_id == NO_OP_SPAN_REQUEST_ID:
        return NoOpSpan()

    try:
        # Create new trace and a root span
        # Once OTel span is created, SpanProcessor.on_start is invoked
        # TraceInfo is created and logged into backend store inside on_start method
        otel_span = _start_detached_otel_span(
            name, experiment_id=experiment_id, start_time_ns=start_time_ns
        )

        if parent_span:
            request_id = parent_span.request_id
        else:
            request_id = get_otel_attribute(otel_span, SpanAttributeKey.REQUEST_ID)

        mlflow_span = create_mlflow_span(otel_span, request_id, span_type)

        # # If the span is a no-op span i.e. tracing is disabled, do nothing
        if isinstance(mlflow_span, NoOpSpan):
            return mlflow_span

        if inputs is not None:
            mlflow_span.set_inputs(inputs)
        mlflow_span.set_attributes(attributes or {})

        trace_manager = InMemoryTraceManager.get_instance()
        if tags := exclude_immutable_tags(tags or {})
            # Update trace tags for trace in in-memory trace manager
            with trace_manager.get_trace(request_id) as trace:
                trace.info.tags.update(tags)

        # Register new span in the in-memory trace manager
        trace_manager.register_span(mlflow_span)

        return mlflow_span
    except Exception as e:
        _logger.warning(
            f"Failed to start span {name}: {e}. "
            "For full traceback, set logging level to debug.",
            exc_info=_logger.isEnabledFor(logging.DEBUG),
        )
    return NoOpSpan()


def end_span(
    request_id: str,
    span_id: str,
    outputs: Optional[Any] = None,
    attributes: Optional[dict[str, Any]] = None,
    status: Union[SpanStatus, str] = "OK",
    end_time_ns: Optional[int] = None,
):
    """
    End the span with the given trace ID and span ID.

    Args:
        request_id: The ID of the trace to end.
        span_id: The ID of the span to end.
        outputs: Outputs to set on the span.
        attributes: A dictionary of attributes to set on the span. If the span already has
            attributes, the new attributes will be merged with the existing ones. If the same
            key already exists, the new value will overwrite the old one.
        status: The status of the span. This can be a
            :py:class:`SpanStatus <mlflow.entities.SpanStatus>` object or a string
            representing the status code defined in
            :py:class:`SpanStatusCode <mlflow.entities.SpanStatusCode>`
            e.g. ``"OK"``, ``"ERROR"``. The default status is OK.
        end_time_ns: The end time of the span in nano seconds since the UNIX epoch.
            If not provided, the current time will be used.
    """
    if request_id == NO_OP_SPAN_REQUEST_ID:
        return

    trace_manager = InMemoryTraceManager.get_instance()
    span = trace_manager.get_span_from_id(request_id, span_id)

    if span is None:
        raise MlflowException(
            f"Span with ID {span_id} is not found or already finished.",
            error_code=RESOURCE_DOES_NOT_EXIST,
        )
    span.set_attributes(attributes or {})
    if outputs is not None:
        span.set_outputs(outputs)
    span.set_status(status)

    try:
        span.end(end_time=end_time_ns)
    except Exception as e:
        _logger.warning(
            f"Failed to end span {span_id}: {e}. "
            "For full traceback, set logging level to debug.",
            exc_info=_logger.isEnabledFor(logging.DEBUG),
        )



def _start_detached_otel_span(
    name: str,
    parent: Optional[trace.Span] = None,
    experiment_id: Optional[str] = None,
    start_time_ns: Optional[int] = None,
) -> Optional[tuple[str, trace.Span]]:
    """
    Start a new OpenTelemetry span that is not part of the current trace context, but with the
    explicit parent span ID if provided.

    Args:
        name: The name of the span.
        parent: The parent OpenTelemetry span. If not provided, the span will be created as a root
                span.
        experiment_id: The ID of the experiment. This is used to associate the span with a specific
            experiment in MLflow.
        start_time_ns: The start time of the span in nanoseconds.
            If not provided, the current timestamp is used.

    Returns:
        The newly created OpenTelemetry span.
    """
    tracer = _get_tracer(__name__)
    context = trace.set_span_in_context(parent) if parent else None
    attributes = {}

    # Set start time and experiment to attribute so we can pass it to the span processor
    if start_time_ns:
        attributes[SpanAttributeKey.START_TIME_NS] = json.dumps(start_time_ns)
    if experiment_id:
        attributes[SpanAttributeKey.EXPERIMENT_ID] = json.dumps(experiment_id)
    return tracer.start_span(name, context=context, attributes=attributes, start_time=start_time_ns)