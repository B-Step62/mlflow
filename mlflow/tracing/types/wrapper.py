import functools
import json
import logging
from dataclasses import asdict
from typing import Any, Dict, List, Optional, Union

from opentelemetry.sdk.trace import ReadableSpan as OTelReadableSpan
from opentelemetry.trace import Span as OTelSpan

from mlflow.entities.span_event import SpanEvent
from mlflow.entities.span_status import SpanStatus
from mlflow.entities.trace_status import TraceStatus
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INVALID_PARAMETER_VALUE
from mlflow.tracing.types.constant import SpanAttributeKey
from mlflow.tracing.utils import TraceJSONEncoder, format_span_id, format_trace_id

_logger = logging.getLogger(__name__)


# Not using enum as we want to allow custom span type string.
class SpanType:
    """
    Predefined set of span types.
    """

    LLM = "LLM"
    CHAIN = "CHAIN"
    AGENT = "AGENT"
    TOOL = "TOOL"
    CHAT_MODEL = "CHAT_MODEL"
    RETRIEVER = "RETRIEVER"
    PARSER = "PARSER"
    EMBEDDING = "EMBEDDING"
    RERANKER = "RERANKER"
    UNKNOWN = "UNKNOWN"


def active_span_only(func):
    """ """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        self = args[0]
        if not isinstance(self._otel_span, OTelSpan):
            raise MlflowException(f"Calling {func.__name__}() is not allowed on non-active spans.")
        return func(*args, **kwargs)

    return wrapper


class Span:
    """
    A span object. TODO: Add more documentation.
    """

    def __init__(
        self,
        otel_span: Union[OTelSpan, OTelReadableSpan],
        request_id: str,
        span_type: str = SpanType.UNKNOWN,
    ):
        """
        The `span` argument can be either a OTel's Span or ReadableSpan object. The former is
        returned from the tracer's start_span method, so essentially a 'live' span. The latter
        is an immutable data object for saving the span data.

        - When user creates and updates a span during the application runtime, this class wraps
            OTelSpan object and expose the necessary getter and setter methods for users to easily
            interact with the span.
        - When user loads the span back from the storage, this class wraps the immutable
            ReadableSpan object. Then it exposes the same getter interfaces, but prohibits
            setter methods to avoid the modification of the underlying span data.

        Luckily, the Span class is a subclass of ReadableSpan, so the field accessors are the same.
        """
        self._otel_span = otel_span

        if isinstance(otel_span, OTelSpan):
            self._attributes = SpanAttributesRegistry(otel_span)
            self._attributes.set(SpanAttributeKey.REQUEST_ID, request_id)
            self._attributes.set(SpanAttributeKey.SPAN_TYPE, span_type)
        elif isinstance(otel_span, OTelReadableSpan):
            self._attributes = CachedSpanAttributesRegistry(otel_span)
            # ReadableSpan doesn't allow setting attributes, so it should be set in its constructor.
        else:
            raise MlflowException(
                "Invalid span instance is passed. Must be Span or ReadableSpan.",
                error_code=INVALID_PARAMETER_VALUE,
            )

    @property
    @functools.lru_cache(maxsize=1)
    def request_id(self) -> str:
        """
        The request ID of the span, a unique identifier for the trace it belongs to.
        Request ID is equivalent to the trace ID in OpenTelemetry, but generated
        differently by the tracing backend.
        """
        return self.get_attribute(SpanAttributeKey.REQUEST_ID)

    @property
    def span_id(self) -> str:
        """The ID of the span. This is only unique within a trace."""
        return format_span_id(self._otel_span.context.span_id)

    @property
    def name(self) -> str:
        """The name of the span."""
        return self._otel_span.name

    @property
    def start_time_ns(self) -> int:
        """The start time of the span in nanosecond."""
        return self._otel_span._start_time

    @property
    def end_time_ns(self) -> Optional[int]:
        """The end time of the span in nanosecond."""
        return self._otel_span._end_time

    @property
    def parent_id(self) -> Optional[str]:
        """The span ID of the parent span."""
        if self._otel_span.parent is None:
            return None
        return format_span_id(self._otel_span.parent.span_id)

    @property
    def status(self) -> SpanStatus:
        """The status of the span."""
        return SpanStatus.from_otel_status(self._otel_span.status)

    @property
    def inputs(self) -> Any:
        """The input values of the span."""
        return self.get_attribute(SpanAttributeKey.INPUTS)

    @property
    def outputs(self) -> Any:
        """The output values of the span."""
        return self.get_attribute(SpanAttributeKey.OUTPUTS)

    @property
    def _trace_id(self) -> str:
        """
        The OpenTelemetry trace ID of the span. Note that this should not be exposed to
        the user, instead, use request_id as an unique identifier for a trace.
        """
        return format_trace_id(self._otel_span.context.trace_id)

    @property
    def attributes(self) -> Dict[str, Any]:
        """
        Get all attributes of the span.

        Returns:
            A dictionary of all attributes of the span.
        """
        return self._attributes.get_all()

    @property
    def events(self) -> List[SpanEvent]:
        """
        Get all events of the span.

        Returns:
            A list of all events of the span.
        """
        return [
            SpanEvent(
                name=event.name,
                timestamp=event.timestamp,
                # Convert from OpenTelemetry's BoundedAttributes class to a simple dict
                # to avoid the serialization issue due to having a lock object.
                attributes=dict(event.attributes),
            )
            for event in self._otel_span.events
        ]

    def get_attribute(self, key: str) -> Optional[Any]:
        """
        Get a single attribute value from the span.

        Args:
            key: The key of the attribute to get.

        Returns:
            The value of the attribute if it exists, otherwise None.
        """
        return self._attributes.get(key)

    @active_span_only
    def set_name(self, name: str):
        """Set the name of the span."""
        self._otel_span._name = name

    @active_span_only
    def set_inputs(self, inputs: Any):
        """Set the input values to the span."""
        self.set_attribute(SpanAttributeKey.INPUTS, inputs)

    @active_span_only
    def set_outputs(self, outputs: Any):
        """Set the output values to the span."""
        self.set_attribute(SpanAttributeKey.OUTPUTS, outputs)

    @active_span_only
    def set_attributes(self, attributes: Dict[str, Any]):
        """
        Set the attributes to the span. The attributes must be a dictionary of key-value pairs.
        This method is additive, i.e. it will add new attributes to the existing ones. If an
        attribute with the same key already exists, it will be overwritten.
        """
        if not isinstance(attributes, dict):
            _logger.warning(
                f"Attributes must be a dictionary, but got {type(attributes)}. Skipping."
            )
            return

        for key, value in attributes.items():
            self.set_attribute(key, value)

    @active_span_only
    def set_attribute(self, key: str, value: Any):
        """Set a single attribute to the span."""
        self._attributes.set(key, value)

    @active_span_only
    def set_status(self, status: Union[SpanStatus, str]):
        """
        Set the status of the span.

        Args:
            status: The status of the span. This can be a
                :py:class:`SpanStatus <mlflow.entities.SpanStatus>` object or a string representing
                of the status code defined in :py:class:`TraceStatus <mlflow.entities.TraceStatus>`
                e.g. ``"OK"``, ``"ERROR"``.
        """
        if isinstance(status, str):
            status = SpanStatus(status)

        # NB: We need to set the OpenTelemetry native StatusCode, because span's set_status
        #     method only accepts a StatusCode enum in their definition.
        #     https://github.com/open-telemetry/opentelemetry-python/blob/8ed71b15fb8fc9534529da8ce4a21e686248a8f3/opentelemetry-sdk/src/opentelemetry/sdk/trace/__init__.py#L949
        #     Working around this is possible, but requires some hack to handle automatic status
        #     propagation mechanism, so here we just use the native object that meets our
        #     current requirements at least. Nevertheless, declaring the new class extending
        #     the OpenTelemetry Status class so users code doesn't have to import the OTel's
        #     StatusCode object, which makes future migration easier.
        self._otel_span.set_status(status.to_otel_status())

    @active_span_only
    def add_event(self, event: SpanEvent):
        """
        Add an event to the span.

        Args:
            event: The event to add to the span. This should be a
                :py:class:`SpanEvent <mlflow.entities.SpanEvent>` object.
        """
        self._otel_span.add_event(event.name, event.attributes, event.timestamp)

    @active_span_only
    def end(self):
        """
        End the span. This is a thin wrapper around the OpenTelemetry's end method but just
        to handle the status update.

        This method should not be called directly by the user, only by called via fluent APIs
        context exit or by MlflowClient APIs.

        :meta private:
        """
        # NB: In OpenTelemetry, status code remains UNSET if not explicitly set
        # by the user. However, there is not way to set the status when using
        # @mlflow.trace decorator. Therefore, we just automatically set the status
        # to OK if it is not ERROR.
        if self.status.status_code != TraceStatus.ERROR:
            self.set_status(SpanStatus(TraceStatus.OK))

        self._otel_span.end()

    def to_dict(self):
        # NB: OpenTelemetry Span has to_json() method, but it will write many fields that
        #  we don't use e.g. links, kind, resource, trace_state, etc. So we manually
        #  cherry-pick the fields we need here.
        return {
            "name": self.name,
            "context": {
                "span_id": self.span_id,
                "trace_id": self._trace_id,
            },
            "parent_id": self.parent_id,
            "start_time": self.start_time_ns,
            "end_time": self.end_time_ns,
            "status_code": self.status.status_code,
            "status_message": self.status.description,
            "attributes": dict(self._otel_span.attributes),
            "events": [asdict(event) for event in self.events],
        }

    @staticmethod
    def from_dict(self, data: Dict[str, Any]):
        # TODO: Implement this
        raise NotImplementedError


class SpanAttributesRegistry:
    def __init__(self, otel_span: OTelSpan):
        self._otel_span = otel_span

    def get_all(self) -> Dict[str, Any]:
        keys = self._otel_span.attributes.keys()
        return {key: self.get(key) for key in keys}

    def get(self, key: str):
        serialized_value = self._otel_span.attributes.get(key)
        return json.loads(serialized_value) if serialized_value else None

    def set(self, key: str, value: Any):
        if not isinstance(key, str):
            _logger.warning(f"Attribute key must be a string, but got {type(key)}. Skipping.")
            return

        # NB: OpenTelemetry attribute can store not only string but also a few primitives like
        #   int, float, bool, and list of them. However, we serialize all into JSON string here
        #   for the simplicity in deserialization process.
        self._otel_span.set_attribute(key, json.dumps(value, cls=TraceJSONEncoder))


class CachedSpanAttributesRegistry(SpanAttributesRegistry):
    @functools.lru_cache(maxsize=128)
    def get(self, key: str):
        return super().get(key)


class NoOpSpan:
    """
    No-op implementation of the Span interface.

    This instance should be returned from the mlflow.start_span context manager when span
    creation fails. This class should have exactly the same interface as the Span so that
    user's setter calls do not raise runtime errors.

    E.g.

    .. code-block:: python

        with mlflow.start_span("span_name") as span:
            # Even if the span creation fails, the following calls should pass.
            span.set_inputs({"x": 1})
            # Do something

    """

    @property
    def request_id(self):
        return None

    @property
    def id(self):
        return None

    @property
    def name(self):
        return None

    @property
    def start_time_ns(self):
        return None

    @property
    def end_time_ns(self):
        return None

    @property
    def context(self):
        return None

    @property
    def parent_id(self):
        return None

    @property
    def status(self):
        return None

    @property
    def inputs(self):
        return None

    @property
    def outputs(self):
        return None

    def set_inputs(self, inputs: Dict[str, Any]):
        pass

    def set_outputs(self, outputs: Dict[str, Any]):
        pass

    def set_attributes(self, attributes: Dict[str, Any]):
        pass

    def set_attribute(self, key: str, value: Any):
        pass

    def set_status(self, status: SpanStatus):
        pass

    def add_event(self, event: SpanEvent):
        pass

    def end(self):
        pass
