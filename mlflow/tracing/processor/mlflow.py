import atexit
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import json
import logging
from queue import Empty, Queue
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Union

from mlflow.entities.span import LiveSpan
from mlflow.environment_variables import MLFLOW_ENABLE_ASYNC_LOGGING
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INTERNAL_ERROR
from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan as OTelReadableSpan
from opentelemetry.sdk.trace import Span as OTelSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter

import mlflow
from mlflow.entities.trace_info import RequestIdFuture, TraceInfo
from mlflow.entities.trace_status import TraceStatus
from mlflow.tracing.constant import (
    MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS,
    TRACE_SCHEMA_VERSION,
    TRACE_SCHEMA_VERSION_KEY,
    TRUNCATION_SUFFIX,
    SpanAttributeKey,
    TraceMetadataKey,
    TraceTagKey,
)
from mlflow.tracing.trace_manager import InMemoryTraceManager, _Trace
from mlflow.tracing.utils import (
    deduplicate_span_names_in_place,
    get_otel_attribute,
    maybe_get_dependencies_schemas,
    maybe_get_request_id,
)
from mlflow.tracking.client import MlflowClient
from mlflow.tracking.context.databricks_repo_context import DatabricksRepoRunContext
from mlflow.tracking.context.git_context import GitRunContext
from mlflow.tracking.context.registry import resolve_tags
from mlflow.tracking.default_experiment import DEFAULT_EXPERIMENT_ID
from mlflow.tracking.fluent import _get_experiment_id
from mlflow.utils.mlflow_tags import TRACE_RESOLVE_TAGS_ALLOWLIST

_logger = logging.getLogger(__name__)


# We issue a warning when a trace is created under the default experiment.
# We only want to issue it once, and typically it can be achieved by using
# warnings.warn() with filterwarnings setting. However, the de-duplication does
# not work in notebooks (https://github.com/ipython/ipython/issues/11207),
# so we instead keep track of the warning issuance state manually.
_ISSUED_DEFAULT_EXPERIMENT_WARNING = False

class MlflowSpanProcessor(SimpleSpanProcessor):
    """
    Defines custom hooks to be executed when a span is started or ended (before exporting).

    This processor is used when the tracing destination is MLflow Tracking Server.
    """

    def __init__(self, span_exporter: SpanExporter, client: Optional[MlflowClient] = None):
        self.span_exporter = span_exporter
        self._client = client or MlflowClient()
        self._trace_manager = InMemoryTraceManager.get_instance()
        self._async_logging_queue = AsyncTraceTaskQueue(self._client)

    def on_start(self, span: OTelSpan, parent_context: Optional[Context] = None):
        """
        Handle the start of a span. This method is called when an OpenTelemetry span is started.

        Args:
            span: An OpenTelemetry Span object that is started.
            parent_context: The context of the span. Note that this is only passed when the context
            object is explicitly specified to OpenTelemetry start_span call. If the parent span is
            obtained from the global context, it won't be passed here so we should not rely on it.
        """
        request_id = self._trace_manager.get_request_id_from_trace_id(span.context.trace_id)
        if not request_id:
            trace_info = self._start_trace(span)
            self._trace_manager.register_trace(span.context.trace_id, trace_info)
            request_id = trace_info.request_id
        span.set_attribute(SpanAttributeKey.REQUEST_ID, json.dumps(request_id, default=str))

        # NB: This is a workaround to exclude the latency of backend StartTrace API call (within
        #   _create_trace_info()) from the execution time of the span. The API call takes ~1 sec
        #   and significantly skews the span duration.
        span._start_time = time.time_ns()

    def _start_trace(self, span: OTelSpan) -> TraceInfo:
        # The following get_* functions are not thread-safe, so we should run them in synrhonized way even when async logging is enabled.
        metadata = get_trace_metadata(span)
        tags = get_trace_tags(span)
        experiment_id = get_trace_experiment_id(span)

        print("Creating new task")
        task = StartTraceTask(
            client=self._client,
            experiment_id=experiment_id,
            # TODO: This timestamp is not accurate because it is not adjusted to exclude the
            #   latency of the backend API call. We do this adjustment for span start time
            #   above, but can't do it for trace start time until the backend API supports
            #   updating the trace start time.
            timestamp_ms=span.start_time // 1_000_000,  # nanosecond to millisecond
            request_metadata=metadata,
            tags=tags,
        )

        # If async logging is enabled, put start trace task to the async logging queue, otherwise handle it immediately.
        if MLFLOW_ENABLE_ASYNC_LOGGING.get():
            self._async_logging_queue.put(task)
        else:
            task.handle()
        return task.trace_info

    def on_end(self, span: OTelReadableSpan) -> None:
        """
        Handle the end of a span. This method is called when an OpenTelemetry span is ended.

        Args:
            span: An OpenTelemetry ReadableSpan object that is ended.
        """
        # Processing the trace only when the root span is found.
        if span._parent is not None:
            return

        task = EndTraceTask(
            span=span,
            on_end_handler=lambda span: self.span_exporter.export((span,)),
        )

        if MLFLOW_ENABLE_ASYNC_LOGGING.get():
            self._async_logging_queue.put(task)
        else:
            task.handle()


def get_trace_experiment_id(span: OTelSpan) -> str:
    experiment_id = get_otel_attribute(span, SpanAttributeKey.EXPERIMENT_ID)
    if experiment_id is None and (run := mlflow.active_run()):
        # if we're inside a run, the run's experiment id should
        # take precedence over the environment experiment id
        experiment_id = run.info.experiment_id

    if experiment_id is None:
        experiment_id = _get_experiment_id()

    global _ISSUED_DEFAULT_EXPERIMENT_WARNING
    if experiment_id == DEFAULT_EXPERIMENT_ID and not _ISSUED_DEFAULT_EXPERIMENT_WARNING:
        _logger.warning(
            "Creating a trace within the default experiment with id "
            f"'{DEFAULT_EXPERIMENT_ID}'. It is strongly recommended to not use "
            "the default experiment to log traces due to ambiguous search results and "
            "probable performance issues over time due to directory table listing performance "
            "degradation with high volumes of directories within a specific path. "
            "To avoid performance and disambiguation issues, set the experiment for "
            "your environment using `mlflow.set_experiment()` API."
        )
        _ISSUED_DEFAULT_EXPERIMENT_WARNING = True

    return experiment_id


def get_trace_metadata(span: OTelSpan) -> Dict[str, str]:
    metadata = {TRACE_SCHEMA_VERSION_KEY: str(TRACE_SCHEMA_VERSION)}
    # If the span is started within an active MLflow run, we should record it as a trace tag
    if run := mlflow.active_run():
        metadata[TraceMetadataKey.SOURCE_RUN] = run.info.run_id
    return metadata

def get_trace_tags(span: OTelSpan) -> Dict[str, str]:
    # Avoid running unnecessary context providers to avoid overhead
    unfiltered_tags = resolve_tags(ignore=[DatabricksRepoRunContext, GitRunContext])
    tags = {
        key: value
        for key, value in unfiltered_tags.items()
        if key in TRACE_RESOLVE_TAGS_ALLOWLIST
    }
    # If the trace is created in the context of MLflow model evaluation, we extract the request
    # ID from the prediction context. Otherwise, we create a new trace info by calling the
    # backend API.
    if request_id := maybe_get_request_id(is_evaluate=True):
        tags.update({TraceTagKey.EVAL_REQUEST_ID: request_id})
    if depedencies_schema := maybe_get_dependencies_schemas():
        tags.update(depedencies_schema)
    tags.update({TraceTagKey.TRACE_NAME: span.name})
    return tags


def _update_trace_info(trace: _Trace, root_span: OTelReadableSpan):
    """Update the trace info with the final values from the root span."""
    # The trace/span start time needs adjustment to exclude the latency of the backend API call. We already adjusted
    # the span start time in the on_start method, so we reflect the same to the trace start time here.
    trace.info.timestamp_ms = root_span.start_time // 1_000_000  # nanosecond to millisecond
    trace.info.execution_time_ms = (root_span.end_time - root_span.start_time) // 1_000_000
    trace.info.status = TraceStatus.from_otel_status(root_span.status)
    trace.info.request_metadata.update(
        {
            TraceMetadataKey.INPUTS: _truncate_metadata(
                root_span.attributes.get(SpanAttributeKey.INPUTS)
            ),
            TraceMetadataKey.OUTPUTS: _truncate_metadata(
                root_span.attributes.get(SpanAttributeKey.OUTPUTS)
            ),
        }
    )



def _truncate_metadata(value: Optional[str]) -> str:
    """Get truncated value of the attribute if it exceeds the maximum length."""
    if not value:
        return ""

    if len(value) > MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS:
        trunc_length = MAX_CHARS_IN_TRACE_INFO_METADATA_AND_TAGS - len(TRUNCATION_SUFFIX)
        value = value[:trunc_length] + TRUNCATION_SUFFIX
    return value

class Task:
    """
    A class to encapsulate the trace and its completion event.
    """
    def __init__(self):
        self.completion_event = threading.Event()
        self.exception = None


class StartTraceTask(Task):
    """
    A class to encapsulate the start trace task.
    """
    def __init__(
        self,
        client: MlflowClient,
        experiment_id: str,
        timestamp_ms: int,
        request_metadata: Dict[str, Any],
        tags: Dict[str, str],
    ):
        super().__init__()

        request_id_future = RequestIdFuture()
        self.trace_info = TraceInfo(
            request_id=request_id_future,
            experiment_id=experiment_id,
            timestamp_ms=timestamp_ms,
            execution_time_ms=None,
            status=TraceStatus.IN_PROGRESS,
            request_metadata=request_metadata,
            tags=tags,
        )

        self._client = client

    @property
    def request_id(self) -> Union[str, RequestIdFuture]:
        request_id = self.trace_info.request_id
        if isinstance(request_id, RequestIdFuture) and request_id.is_ready():
            return self._request_id.get_if_ready()
        return self._request_id

    def handle(self):
        """
        Handle the start trace task.

        Returns:
            The request ID of the trace.
        """
        ti = self._client._start_tracked_trace(
            experiment_id=self.trace_info.experiment_id,
            timestamp_ms=self.trace_info.timestamp_ms,
            request_metadata=self.trace_info.request_metadata,
            tags=self.trace_info.tags
        )
        self.trace_info.request_id.complete(ti.request_id)
        # Some metadata/tags are updated by the backend
        self.trace_info.request_metadata = ti.request_metadata
        self.trace_info.tags = ti.tags


class RetryableTraceException(MlflowException):
    pass

_MAX_RETRY = 5

class EndTraceTask(Task):
    """
    A class to encapsulate the end trace task.
    """
    def __init__(
        self,
        span: OTelReadableSpan,
        on_end_handler: Callable[[OTelReadableSpan], None]
    ):
        super().__init__()
        self._span = span
        self._on_end_handler = on_end_handler
        self.retry = 0

    def handle(self) -> None:
        trace_manager = InMemoryTraceManager.get_instance()
        # Request ID handling (TODO: Add more description)
        request_id = trace_manager.get_request_id_from_trace_id(self._span.context.trace_id)
        if isinstance(request_id, RequestIdFuture) and not request_id.is_ready():
            # If async logging is enabled, this exception will be caught and retried in the async logging queue.
            raise RetryableTraceException(
                "EndTrace task cannot be processed before StartTrace task is done.",
                error_code=INTERNAL_ERROR
            )

        with trace_manager.get_trace(request_id) as trace:
            if trace is None:
                _logger.warning(f"Trace data with request ID {request_id} not found. Existing keys are: {trace_manager._traces.keys()}")
                return

            _update_trace_info(trace, self._span)
            deduplicate_span_names_in_place(list(trace.span_dict.values()))

        self._on_end_handler(self._span)


class AsyncTraceTaskQueue:
    """
    This is a queue based run data processor that queue incoming data and process it using a single
    worker thread. This class is used to process traces saving in async fashion.
    """

    def __init__(self, client) -> None:
        self._queue: Queue[Task] = Queue()
        self._client = client
        self._lock = threading.RLock()

        self._stop_data_logging_thread_event = threading.Event()
        self._is_activated = False


    def put(self, task: Task) -> None:
        if not self.is_active():
            self.activate()
        self._queue.put(task)
        self._trace_status_check_threadpool.submit(self._wait_for_task, task)


    def _set_up_logging_thread(self) -> None:
        """Sets up the logging thread.

        If the logging thread is already set up, this method does nothing.
        """
        with self._lock:
            self._trace_logging_thread = threading.Thread(
                target=self._logging_loop,
                name="MLflowAsyncTracesLoggingLoop",
                daemon=True,
            )
            self._trace_logging_worker_threadpool = ThreadPoolExecutor(
                max_workers=5,
                thread_name_prefix="MLflowTraceLoggingWorkerPool",
            )

            self._trace_status_check_threadpool = ThreadPoolExecutor(
                max_workers=5,
                thread_name_prefix="MLflowAsyncTraceLoggingStatusCheck",
            )
            self._trace_logging_thread.start()

    def _logging_loop(self) -> None:
        """
        Continuously logs run data until `self._continue_to_process_data` is set to False.
        If an exception occurs during logging, a `MlflowException` is raised.
        """
        try:
            while not self._stop_data_logging_thread_event.is_set():
                self._handle_task()
            # Drain the queue after the stop event is set.
            while not self._queue.empty():
                self._handle_task()
        except Exception as e:
            from mlflow.exceptions import MlflowException

            raise MlflowException(f"Exception inside the run data logging thread: {e}")

    def _handle_task(self) -> None:
        """Process the given task in the running runs queues.
        """
        try:
            task = self._queue.get(timeout=1)
        except Empty:
            # Ignore empty queue exception
            return

        def _handle(task):
            try:
                task.handle()
                task.completion_event.set()
            except RetryableTraceException as e:
                if task.retry < _MAX_RETRY:
                    task.retry += 1
                    self._queue.put(task)
                else:
                    _logger.warning(f"Failed to process task after {_MAX_RETRY} retries. Exception: {e}", exc_info=True)
                    task.exception = e
                    task.completion_event.set()
            except Exception as e:
                _logger.error(f"Failed to log trace {task.trace}. Exception: {e}", exc_info=True)
                task.exception = e
                task.completion_event.set()

        self._trace_logging_worker_threadpool.submit(_handle, task)

    def _wait_for_task(self, task: Task) -> None:
        """Wait for given task to be processed by the logging thread.

        Args:
            trace: The task to wait for.

        Raises:
            Exception: If an exception occurred while processing the trace.
        """
        task.completion_event.wait()
        if task.exception:
            raise task.exception

    def is_active(self) -> bool:
        return self._is_activated

    def activate(self) -> None:
        """Activates the async logging queue

        1. Initializes queue draining thread.
        2. Initializes threads for checking the status of logged traces.
        3. Registering an atexit callback to ensure that any remaining log data
            is flushed before the program exits.

        If the queue is already activated, this method does nothing.
        """
        with self._lock:
            if self._is_activated:
                return

            self._set_up_logging_thread()
            atexit.register(self._at_exit_callback)

            self._is_activated = True

    def _at_exit_callback(self) -> None:
        """Callback function to be executed when the program is exiting.

        Stops the data processing thread and waits for the queue to be drained. Finally, shuts down
        the thread pools used for data logging and trace processing status check.
        """
        try:
            self.flush(keep_running=False)
        except Exception as e:
            _logger.error(f"Encountered error while trying to finish logging: {e}")

    def flush(self, keep_running=True) -> None:
        """Flush the async logging queue.

        Calling this method will flush the queue to ensure all the data are logged.

        Args:
            keep_running: If True, the logging thread will be restarted after flushing the queue.
        """
        # Stop the data processing thread.
        self._stop_data_logging_thread_event.set()
        # Waits till logging queue is drained.
        self._trace_logging_thread.join()
        self._trace_logging_worker_threadpool.shutdown(wait=True)
        self._trace_status_check_threadpool.shutdown(wait=True)

        # Restart the thread to listen to incoming data after flushing.
        self._stop_data_logging_thread_event.clear()

        if keep_running:
            self._set_up_logging_thread()