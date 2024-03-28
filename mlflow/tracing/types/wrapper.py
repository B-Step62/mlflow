import logging
from time import time_ns
from typing import Any, Dict, Optional

from opentelemetry import trace as trace_api

from mlflow.entities import Span, SpanContext, SpanEvent, SpanStatus
from mlflow.entities.span import SpanType
from mlflow.tracing.types.constant import TraceStatusCode

_logger = logging.getLogger(__name__)


class MLflowSpanWrapper:
    """
    A wrapper around OpenTelemetry's Span object to provide MLflow-specific functionality.

    This class is passed to the exporter class to be processed on behalf of the OpenTelemetry's
    Span object, so need to implement the same interfaces as the original Span.
    """

    def __init__(self, span: trace_api.Span, span_type: SpanType = None):
        self._span = span
        # NB: Default to UNKNOWN type, but not use it as default in the constructor
        #  cuz some upstream function want to pass None by default.
        self._span_type = span_type or SpanType.UNKNOWN
        self._inputs = None
        self._outputs = None

    @property
    def request_id(self) -> str:
        return self._span.get_span_context().trace_id

    @property
    def span_id(self) -> str:
        return self._span.get_span_context().span_id

    @property
    def name(self) -> str:
        return self._span.name

    @property
    def start_time(self) -> int:
        """
        Get the start time of the span in microseconds.
        """
        # NB: The original open-telemetry timestamp is in nanoseconds
        return self._span._start_time // 1_000

    @property
    def end_time(self) -> Optional[int]:
        """
        Get the end time of the span in microseconds.
        """
        return self._span._end_time // 1_000 if self._span._end_time else None

    @property
    def context(self) -> SpanContext:
        return self._span.get_span_context()

    @property
    def parent_span_id(self) -> str:
        if self._span.parent is None:
            return None
        return self._span.parent.span_id

    @property
    def status(self) -> SpanStatus:
        return SpanStatus.from_otel_status(self._span.status)

    @property
    def inputs(self) -> Dict[str, Any]:
        return self._inputs

    @property
    def outputs(self) -> Dict[str, Any]:
        return self._outputs

    def set_inputs(self, inputs: Dict[str, Any]):
        self._inputs = inputs

    def set_outputs(self, outputs: Dict[str, Any]):
        self._outputs = outputs

    def set_attributes(self, attributes: Dict[str, Any]):
        try:
            self._span.set_attributes(attributes)
        except Exception as e:
            _logger.warning(f"Failed to set attributes {attributes} on span {self.name}: {e}")

    def set_attribute(self, key: str, value: Any):
        self._span.set_attribute(key, value)

    def set_status(self, status: SpanStatus):
        # NB: We need to set the OpenTelemetry native StatusCode, because span's set_status
        #     method only accepts a StatusCode enum in their definition.
        #     https://github.com/open-telemetry/opentelemetry-python/blob/8ed71b15fb8fc9534529da8ce4a21e686248a8f3/opentelemetry-sdk/src/opentelemetry/sdk/trace/__init__.py#L949
        #     Working around this is possible, but requires some hack to handle automatic status
        #     propagation mechanism, so here we just use the native object that meets our
        #     current requirements at least. Nevertheless, declaring the new class extending
        #     the OpenTelemetry Status class so users code doesn't have to import the OTel's
        #     StatusCode object, which makes future migration easier.
        self._span.set_status(status.to_otel_status())

    def add_event(self, event: SpanEvent):
        self._span.add_event(event.name, event.attributes, event.timestamp)

    def end(self):
        # NB: In OpenTelemetry, status code remains UNSET if not explicitly set
        # by the user. However, there is not way to set the status when using
        # @mlflow.trace decorator. Therefore, we just automatically set the status
        # to OK if it is not ERROR.
        if self.status.status_code != TraceStatusCode.ERROR:
            self.set_status(SpanStatus(TraceStatusCode.OK))

        # Mimic the OTel's span end hook to pass this wrapper to processor/exporter
        # Ref: https://github.com/open-telemetry/opentelemetry-python/blob/216411f03a3a067177a0b927b668a87a60cf8797/opentelemetry-sdk/src/opentelemetry/sdk/trace/__init__.py#L909
        with self._span._lock:
            if self._span._start_time is None:
                _logger.warning("Calling end() on a not started span. Ignoring.")
                return
            if self._span._end_time is not None:
                _logger.warning("Calling end() on an ended span. Ignoring.")
                return

            self._span._end_time = time_ns()

        self._span._span_processor.on_end(self)

    def to_mlflow_span(self):
        """
        Create an MLflow Span object from this wrapper and the original Span object.
        """
        return Span(
            name=self._span.name,
            context=SpanContext(
                request_id=self.request_id,
                span_id=self.span_id,
            ),
            parent_span_id=self.parent_span_id,
            span_type=self._span_type,
            status=self.status,
            start_time=self.start_time,
            end_time=self.end_time,
            inputs=self.inputs,
            outputs=self.outputs,
            # Convert from MappingProxyType to dict for serialization
            attributes=dict(self._span.attributes),
            events=[
                SpanEvent(
                    name=event.name,
                    timestamp=event.timestamp,
                    # Convert from OpenTelemetry's BoundedAttributes class to a simple dict
                    attributes=dict(event.attributes),
                )
                for event in self._span.events
            ],
        )


class NoOpMLflowSpanWrapper:
    """
    No-op implementation of all MLflowSpanWrapper.

    This instance should be returned from the mlflow.start_span context manager when span
    creation fails. This class should have exactly the same interface as MLflowSpanWrapper
    so that user's setter calls do not raise runtime errors.

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
    def start_time(self):
        return None

    @property
    def end_time(self):
        return None

    @property
    def context(self):
        return None

    @property
    def parent_span_id(self):
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