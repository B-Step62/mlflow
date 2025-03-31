from __future__ import annotations

import contextlib
import functools
import importlib
import inspect
import json
import logging
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any, Callable, Generator, Optional, Union

from cachetools import TTLCache
from opentelemetry import trace as trace_api

from mlflow import MlflowClient
from mlflow.entities import NoOpSpan, SpanType, Trace
from mlflow.entities.span import LiveSpan, create_mlflow_span
from mlflow.entities.span_event import SpanEvent
from mlflow.entities.span_status import SpanStatusCode
from mlflow.entities.trace_status import TraceStatus
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import BAD_REQUEST
from mlflow.tracing import provider
from mlflow.tracing.constant import (
    STREAM_CHUNK_EVENT_NAME_FORMAT,
    STREAM_CHUNK_EVENT_VALUE_KEY,
    SpanAttributeKey,
)
from mlflow.tracing.display import get_display_handler
from mlflow.tracing.provider import (
    is_tracing_enabled,
    safe_set_span_in_context,
)
from mlflow.tracing.trace_manager import InMemoryTraceManager
from mlflow.tracing.utils import (
    TraceJSONEncoder,
    capture_function_input_args,
    encode_span_id,
    end_client_span_or_trace,
    get_otel_attribute,
    start_client_span_or_trace,
)
from mlflow.utils.annotations import experimental

_logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    import pandas


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

    def decorator(fn):
        if inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn):
            return _wrap_generator(fn, name, span_type, attributes, output_reducer)
        else:
            if output_reducer is not None:
                raise MlflowException.invalid_parameter_value(
                    "The output_reducer argument is only supported for generator functions."
                )
            return _wrap_function(fn, name, span_type, attributes)

    return decorator(func) if func else decorator


def _wrap_function(
    fn: Callable,
    name: Optional[str] = None,
    span_type: str = SpanType.UNKNOWN,
    attributes: Optional[dict[str, Any]] = None,
) -> Callable:
    class _WrappingContext:
        # define the wrapping logic as a coroutine to avoid code duplication
        # between sync and async cases
        @staticmethod
        def _wrapping_logic(fn, args, kwargs):
            span_name = name or fn.__name__

            with start_span(name=span_name, span_type=span_type, attributes=attributes) as span:
                span.set_attribute(SpanAttributeKey.FUNCTION_NAME, fn.__name__)
                span.set_inputs(capture_function_input_args(fn, args, kwargs))
                result = yield  # sync/async function output to be sent here
                span.set_outputs(result)
                try:
                    yield result
                except GeneratorExit:
                    # Swallow `GeneratorExit` raised when the generator is closed
                    pass

        def __init__(self, fn, args, kwargs):
            self.coro = self._wrapping_logic(fn, args, kwargs)

        def __enter__(self):
            next(self.coro)
            return self.coro

        def __exit__(self, exc_type, exc_value, traceback):
            # Since the function call occurs outside the coroutine,
            # if an exception occurs, we need to throw it back in, so that
            # we return control to the coro (in particular, so that the __exit__'s
            # of start_span and OTel's use_span can execute).
            if exc_type is not None:
                self.coro.throw(exc_type, exc_value, traceback)
            self.coro.close()

    if inspect.iscoroutinefunction(fn):

        async def wrapper(*args, **kwargs):
            with _WrappingContext(fn, args, kwargs) as wrapping_coro:
                return wrapping_coro.send(await fn(*args, **kwargs))
    else:

        def wrapper(*args, **kwargs):
            with _WrappingContext(fn, args, kwargs) as wrapping_coro:
                return wrapping_coro.send(fn(*args, **kwargs))

    return functools.wraps(fn)(wrapper)


def _wrap_generator(
    fn: Callable,
    name: Optional[str] = None,
    span_type: str = SpanType.UNKNOWN,
    attributes: Optional[dict[str, Any]] = None,
    output_reducer: Optional[Callable] = None,
) -> Callable:
    """
    Wrap a generator function to create a span.

    Generator functions need special handling because of its lazy evaluation nature.
    Let's say we have a generator function like this:

    ```
    @mlflow.trace
    def generate_stream():
        # B
        for i in range(10):
            # C
            yield i * 2
        # E


    stream = generate_stream()
    # A
    for chunk in stream:
        # D
        pass
    # F
    ```

    The execution order is A -> B -> C -> D -> C -> D -> ... -> E -> F.
    The span should only be "active" at B, C, and E, namely, when the code execution
    is inside the generator function. Otherwise it will create wrong span tree, or
    even worse, leak span context and pollute subsequent traces.
    """

    def _start_stream_span(fn, args, kwargs):
        try:
            return start_client_span_or_trace(
                client=MlflowClient(),
                name=name or fn.__name__,
                parent_span=get_current_active_span(),
                span_type=span_type,
                attributes=attributes,
                inputs=capture_function_input_args(fn, args, kwargs),
            )
        except Exception as e:
            _logger.debug(f"Failed to start stream span: {e}")
            return NoOpSpan()

    def _end_stream_span(
        span: LiveSpan,
        outputs: Optional[list[Any]] = None,
        output_reducer: Optional[Callable] = None,
        error: Optional[Exception] = None,
    ):
        client = MlflowClient()
        if error:
            span.add_event(SpanEvent.from_exception(error))
            end_client_span_or_trace(client, span, status=SpanStatusCode.ERROR)
            return

        if output_reducer:
            try:
                outputs = output_reducer(outputs)
            except Exception as e:
                _logger.debug(f"Failed to reduce outputs from stream: {e}")
        end_client_span_or_trace(client, span, outputs=outputs)

    def _record_chunk_event(span: LiveSpan, chunk: Any, chunk_index: int):
        try:
            event = SpanEvent(
                name=STREAM_CHUNK_EVENT_NAME_FORMAT.format(index=chunk_index),
                # OpenTelemetry SpanEvent only support str-str key-value pairs for attributes
                attributes={STREAM_CHUNK_EVENT_VALUE_KEY: json.dumps(chunk, cls=TraceJSONEncoder)},
            )
            span.add_event(event)
        except Exception as e:
            _logger.debug(f"Failing to record chunk event for span {span.name}: {e}")

    if inspect.isgeneratorfunction(fn):

        def wrapper(*args, **kwargs):
            span = _start_stream_span(fn, args, kwargs)
            generator = fn(*args, **kwargs)

            i = 0
            outputs = []
            while True:
                try:
                    # NB: Set the span to active only when the generator is running
                    with safe_set_span_in_context(span):
                        value = next(generator)
                except StopIteration:
                    break
                except Exception as e:
                    _end_stream_span(span, error=e)
                    raise e
                else:
                    outputs.append(value)
                    _record_chunk_event(span, value, i)
                    yield value
                    i += 1
            _end_stream_span(span, outputs, output_reducer)
    else:

        async def wrapper(*args, **kwargs):
            span = _start_stream_span(fn, args, kwargs)
            generator = fn(*args, **kwargs)

            i = 0
            outputs = []
            while True:
                try:
                    with safe_set_span_in_context(span):
                        value = await generator.__anext__()
                except StopAsyncIteration:
                    break
                except Exception as e:
                    _end_stream_span(span, error=e)
                    raise e
                else:
                    outputs.append(value)
                    _record_chunk_event(span, value, i)
                    yield value
                    i += 1
            _end_stream_span(span, outputs, output_reducer)

    return functools.wraps(fn)(wrapper)


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


    .. tip::

        If you want more explicit control over the trace lifecycle, you can use
        :py:func:`MLflow Client APIs <mlflow.client.MlflowClient.start_trace>`. It provides lower
        level to start and end traces manually, as well as setting the parent spans explicitly.
        However, it is generally recommended to use this context manager as long as it satisfies
        your requirements, because it requires less boilerplate code and is less error-prone.

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
