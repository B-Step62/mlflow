from __future__ import annotations

import contextlib
import inspect
import json
import logging
from cachetools import TTLCache
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any, Callable, Generator, Optional, Union

from mlflow.protos.databricks_trace_server_pb2 import Span
from opentelemetry import trace as trace_api

from mlflow.entities import NoOpSpan, SpanType
from mlflow.entities.span import NO_OP_SPAN_REQUEST_ID, LiveSpan, create_mlflow_span
from mlflow.entities.span_status import SpanStatus
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import BAD_REQUEST
from mlflow.tracing.core import provider
from mlflow.tracing.constant import SpanAttributeKey

from mlflow.tracing.core.provider import (
    _start_detached_otel_span,
)
from mlflow.tracing.core.trace_manager import InMemoryTraceManager
from mlflow.tracing.utils import (
    encode_span_id,
    exclude_immutable_tags,
    get_otel_attribute,
)
from mlflow.utils.annotations import experimental

_logger = logging.getLogger(__name__)


_LAST_ACTIVE_TRACE_ID_GLOBAL = None
_LAST_ACTIVE_TRACE_ID_THREAD_LOCAL = ContextVar("last_active_trace_id", default=None)

# Cache mapping between evaluation request ID to MLflow backend request ID.
# This is necessary for evaluation harness to access generated traces during
# evaluation using the dataset row ID (evaluation request ID).
_EVAL_REQUEST_ID_TO_TRACE_ID = TTLCache(maxsize=10000, ttl=3600)


def trace(
    func: Optional[Callable] = None,
    name: Optional[str] = None,
    span_type: str = SpanType.UNKNOWN,
    attributes: Optional[dict[str, Any]] = None,
    output_reducer: Optional[Callable] = None,
) -> Callable:
    """
    A decorator that creates a new span for the decorated function.

    When you decorate a function with this :py:func:`@mlflow.trace() <trace>` decorator,
    a span will be created for the scope of the decorated function. The span will automatically
    capture the input and output of the function. When it is applied to a method, it doesn't
    capture the `self` argument. Any exception raised within the function will set the span
    status to ``ERROR`` and detailed information such as exception message and stacktrace
    will be recorded to the ``attributes`` field of the span.

    For example, the following code will yield a span with the name ``"my_function"``,
    capturing the input arguments ``x`` and ``y``, and the output of the function.

    .. code-block:: python
        :test:

        import mlflow


        @mlflow.trace
        def my_function(x, y):
            return x + y

    This is equivalent to doing the following using the :py:func:`mlflow.start_span` context
    manager, but requires less boilerplate code.

    .. code-block:: python
        :test:

        import mlflow


        def my_function(x, y):
            return x + y


        with mlflow.start_span("my_function") as span:
            x = 1
            y = 2
            span.set_inputs({"x": x, "y": y})
            result = my_function(x, y)
            span.set_outputs({"output": result})


    The @mlflow.trace decorator currently support the following types of functions:

    .. list-table:: Supported Function Types
        :widths: 20 30
        :header-rows: 1

        * - Function Type
          - Supported
        * - Sync
          - ✅
        * - Async
          - ✅ (>= 2.16.0)
        * - Generator
          - ✅ (>= 2.20.2)
        * - Async Generator
          - ✅ (>= 2.20.2)

    For more examples of using the @mlflow.trace decorator, including streaming/async
    handling, see the `MLflow Tracing documentation <https://www.mlflow.org/docs/latest/tracing/api/manual-instrumentation#decorator>`_.

    .. tip::

        The @mlflow.trace decorator is useful when you want to trace a function defined by
        yourself. However, you may also want to trace a function in external libraries. In
        such case, you can use this ``mlflow.trace()`` function to directly wrap the function,
        instead of using as the decorator. This will create the exact same span as the
        one created by the decorator i.e. captures information from the function call.

        .. code-block:: python
            :test:

            import math

            import mlflow

            mlflow.trace(math.factorial)(5)

    Args:
        func: The function to be decorated. Must **not** be provided when using as a decorator.
        name: The name of the span. If not provided, the name of the function will be used.
        span_type: The type of the span. Can be either a string or a
            :py:class:`SpanType <mlflow.entities.SpanType>` enum value.
        attributes: A dictionary of attributes to set on the span.
        output_reducer: A function that reduces the outputs of the generator function into a
            single value to be set as the span output.
    """
    from mlflow.tracing.core._wrapper import wrap_function, wrap_generator

    def decorator(fn):
        if inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn):
            return wrap_generator(fn, name, span_type, attributes, output_reducer)
        else:
            if output_reducer is not None:
                raise MlflowException.invalid_parameter_value(
                    "The output_reducer argument is only supported for generator functions."
                )
            return wrap_function(fn, name, span_type, attributes)

    return decorator(func) if func else decorator



@contextlib.contextmanager
def start_span(
    name: str = "span",
    span_type: Optional[str] = SpanType.UNKNOWN,
    attributes: Optional[dict[str, Any]] = None,
) -> Generator[LiveSpan, None, None]:
    """
    Context manager to create a new span and start it as the current span in the context.

    This context manager automatically manages the span lifecycle and parent-child relationships.
    The span will be ended when the context manager exits. Any exception raised within the
    context manager will set the span status to ``ERROR``, and detailed information such as
    exception message and stacktrace will be recorded to the ``attributes`` field of the span.
    New spans can be created within the context manager, then they will be assigned as child
    spans.

    .. code-block:: python
        :test:

        import mlflow

        with mlflow.start_span("my_span") as span:
            x = 1
            y = 2
            span.set_inputs({"x": x, "y": y})

            z = x + y

            span.set_outputs(z)
            span.set_attribute("key", "value")
            # do something

    When this context manager is used in the top-level scope, i.e. not within another span context,
    the span will be treated as a root span. The root span doesn't have a parent reference and
    **the entire trace will be logged when the root span is ended**.

    .. note::

        The context manager doesn't propagate the span context across threads. If you want to create
        a child span in a different thread, you should use
        :py:func:`MLflow Client APIs <mlflow.client.MlflowClient.start_trace>`
        and pass the parent span ID explicitly.

    Args:
        name: The name of the span.
        span_type: The type of the span. Can be either a string or
            a :py:class:`SpanType <mlflow.entities.SpanType>` enum value
        attributes: A dictionary of attributes to set on the span.

    Returns:
        Yields an :py:class:`mlflow.entities.Span` that represents the created span.
    """
    try:
        otel_span = provider.start_span_in_context(name)

        # Create a new MLflow span and register it to the in-memory trace manager
        request_id = get_otel_attribute(otel_span, SpanAttributeKey.REQUEST_ID)
        mlflow_span = create_mlflow_span(otel_span, request_id, span_type)
        mlflow_span.set_attributes(attributes or {})
        InMemoryTraceManager.get_instance().register_span(mlflow_span)

    except Exception:
        _logger.debug(f"Failed to start span {name}.", exc_info=True)
        mlflow_span = NoOpSpan()
        yield mlflow_span
        return

    try:
        # Setting end_on_exit = False to suppress the default span
        # export and instead invoke MLflow span's end() method.
        with trace_api.use_span(mlflow_span._span, end_on_exit=False):
            yield mlflow_span
    finally:
        try:
            mlflow_span.end()
        except Exception:
            _logger.debug(f"Failed to end span {mlflow_span.span_id}.", exc_info=True)


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
    TBA
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
        if tags := exclude_immutable_tags(tags or {}):
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
    span: LiveSpan,
    outputs: Optional[Any] = None,
    attributes: Optional[dict[str, Any]] = None,
    status: Union[SpanStatus, str] = "OK",
    end_time_ns: Optional[int] = None,
):
    """
    End the span manually.

    Args:
        span: The span to end. This should be a LiveSpan object.
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
    if span.request_id == NO_OP_SPAN_REQUEST_ID:
        return

    span.set_attributes(attributes or {})
    if outputs is not None:
        span.set_outputs(outputs)
    span.set_status(status)

    try:
        span.end(end_time=end_time_ns)
    except Exception as e:
        _logger.warning(
            f"Failed to end span {span.span_id}: {e}. "
            "For full traceback, set logging level to debug.",
            exc_info=_logger.isEnabledFor(logging.DEBUG),
        )


def get_current_active_span() -> Optional[LiveSpan]:
    """
    Get the current active span in the global context.

    .. attention::

        This only works when the span is created with fluent APIs like `@mlflow.trace` or
        `with mlflow.start_span`. If a span is created with MlflowClient APIs, it won't be
        attached to the global context so this function will not return it.


    .. code-block:: python
        :test:

        import mlflow


        @mlflow.trace
        def f():
            span = mlflow.get_current_active_span()
            span.set_attribute("key", "value")
            return 0


        f()

    Returns:
        The current active span if exists, otherwise None.
    """
    otel_span = trace_api.get_current_span()
    # NonRecordingSpan is returned if a tracer is not instantiated.
    if otel_span is None or isinstance(otel_span, trace_api.NonRecordingSpan):
        return None

    trace_manager = InMemoryTraceManager.get_instance()
    request_id = json.loads(otel_span.attributes.get(SpanAttributeKey.REQUEST_ID))
    return trace_manager.get_span_from_id(request_id, encode_span_id(otel_span.context.span_id))


def update_current_trace(
    tags: Optional[dict[str, str]] = None,
):
    """
    Update the current active trace with the given tags.

    You can use this function either within a function decorated with `@mlflow.trace` or within the
    scope of the `with mlflow.start_span` context manager. If there is no active trace found, this
    function will raise an exception.

    Using within a function decorated with `@mlflow.trace`:

    .. code-block:: python

        @mlflow.trace
        def my_func(x):
            mlflow.update_current_trace(tags={"fruit": "apple"})
            return x + 1

    Using within the `with mlflow.start_span` context manager:

    .. code-block:: python

        with mlflow.start_span("span"):
            mlflow.update_current_trace(tags={"fruit": "apple"})

    """
    active_span = get_current_active_span()

    if not active_span:
        raise MlflowException(
            "No active trace found. Please create a span using `mlflow.start_span` or "
            "`@mlflow.trace` before calling this function.",
            error_code=BAD_REQUEST,
        )

    # Update tags for the trace stored in-memory rather than directly updating the
    # backend store. The in-memory trace will be exported when it is ended. By doing
    # this, we can avoid unnecessary server requests for each tag update.
    request_id = active_span.request_id
    with InMemoryTraceManager.get_instance().get_trace(request_id) as trace:
        trace.info.tags.update(tags or {})


def _set_last_active_trace_id(trace_id: str):
    """Internal function to set the last active trace ID."""
    global _LAST_ACTIVE_TRACE_ID_GLOBAL
    _LAST_ACTIVE_TRACE_ID_GLOBAL = trace_id
    _LAST_ACTIVE_TRACE_ID_THREAD_LOCAL.set(trace_id)


