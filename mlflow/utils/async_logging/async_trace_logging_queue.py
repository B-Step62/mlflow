"""
Defines an AsyncTraceLoggingQueue that provides async fashion trace writes using
queue based approach.
"""

import atexit
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from queue import Empty, Queue
import time
from typing import Any, Dict, List

from mlflow.entities.span import LiveSpan
from mlflow.entities.trace import Trace
from mlflow.entities.trace_info import RequestIdFuture, TraceInfo
from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INTERNAL_ERROR

_logger = logging.getLogger(__name__)


@dataclass
class Task:
    """
    A class to encapsulate the trace and its completion event.
    """
    # NB: These fields cannot have default values due to how dataclass works with inheritance.
    completion_event: threading.Event
    exception: Exception


@dataclass
class StartTraceTask(Task):
    """
    A class to encapsulate the start trace task.
    """
    request_id_future: RequestIdFuture
    experiment_id: str
    timestamp_ms: int
    request_metadata: Dict[str, Any]
    tags: Dict[str, str]


_END_TRACE_MAX_RETRY = 5

@dataclass
class EndTraceTask(Task):
    """
    A class to encapsulate the end trace task.
    """
    trace_info: TraceInfo
    spans: List[LiveSpan]
    retry: int = 0


class AsyncTraceLoggingQueue:
    """
    This is a queue based run data processor that queue incoming data and process it using a single
    worker thread. This class is used to process traces saving in async fashion.
    """

    def __init__(self, client) -> None:
        self._queue: Queue[Trace] = Queue()
        self._client = client
        self._lock = threading.RLock()

        self._stop_data_logging_thread_event = threading.Event()
        self._is_activated = False

    def _at_exit_callback(self) -> None:
        """Callback function to be executed when the program is exiting.

        Stops the data processing thread and waits for the queue to be drained. Finally, shuts down
        the thread pools used for data logging and trace processing status check.
        """
        try:
            # Stop the data processing thread
            self._stop_data_logging_thread_event.set()
            # Waits till logging queue is drained.
            self._trace_logging_thread.join()
            self._trace_logging_worker_threadpool.shutdown(wait=True)
            self._trace_status_check_threadpool.shutdown(wait=True)
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

    def _logging_loop(self) -> None:
        """
        Continuously logs run data until `self._continue_to_process_data` is set to False.
        If an exception occurs during logging, a `MlflowException` is raised.
        """
        try:
            while not self._stop_data_logging_thread_event.is_set():
                self._process_task()
            # Drain the queue after the stop event is set.
            while not self._queue.empty():
                self._process_task()
        except Exception as e:
            from mlflow.exceptions import MlflowException

            raise MlflowException(f"Exception inside the run data logging thread: {e}")

    def _process_task(self) -> None:
        """Process the traces in the running runs queues.

        For each run in the running runs queues, this method retrieves the next trace of run
        from the queue and processes it by calling the `_trace_logging_func` method with the run
        ID and trace. If the trace is empty, it is skipped. After processing the trace,
        the processed watermark is updated and the trace event is set.
        If an exception occurs during processing, the exception is logged and the trace event
        is set with the exception. If the queue is empty, it is ignored.
        """
        try:
            task = self._queue.get(timeout=1)
        except Empty:
            # Ignore empty queue exception
            return

        def _handle(task):
            try:
                if isinstance(task, EndTraceTask):
                    # Check if StartTraceTask is already processed.
                    if not task.trace_info.request_id.is_ready():
                        if task.retry < _END_TRACE_MAX_RETRY:
                            task.retry += 1
                            time.sleep(2 ** task.retry)
                            self._queue.put(task)
                            _logger.debug(f"Retrying trace logging event {task.retry} time.")
                            return
                        else:
                            _logger.warning(
                                f"Trace logging event is dropped after {task.retry} retries. "
                            )

                else:
                    raise MlflowException(
                        f"Unknown task type: {type(task)}",
                        error_code=INTERNAL_ERROR,
                    )

                # Signal the trace logging is done.
                task
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

    def __getstate__(self) -> Dict[str, Any]:
        """Return the state of the object for pickling.

        This method is called by the `pickle` module when the object is being pickled. It returns a
        dictionary containing the object's state, with non-picklable attributes removed.

        Returns:
            A dictionary containing the object's state.
        """
        state = self.__dict__.copy()
        del state["_queue"]
        del state["_lock"]
        del state["_is_activated"]

        if "_stop_data_logging_thread_event" in state:
            del state["_stop_data_logging_thread_event"]
        if "_trace_logging_thread" in state:
            del state["_trace_logging_thread"]
        if "_trace_logging_worker_threadpool" in state:
            del state["_trace_logging_worker_threadpool"]
        if "_trace_status_check_threadpool" in state:
            del state["_trace_status_check_threadpool"]

        return state

    def __setstate__(self, state):
        """Set the state of the object from a given state dictionary.

        It pops back the removed non-picklable attributes from `self.__getstate__()`.

        Args:
            state : A dictionary containing the state of the object.
        """
        self.__dict__.update(state)
        self._queue = Queue()
        self._lock = threading.RLock()
        self._is_activated = False
        self._trace_logging_thread = None
        self._trace_logging_worker_threadpool = None
        self._trace_status_check_threadpool = None
        self._stop_data_logging_thread_event = threading.Event()


    def start_trace_async(self, trace_info: TraceInfo):
        if (
            not isinstance(trace_info.request_id, RequestIdFuture)
            or trace_info.request_id.is_ready()
        ):
            raise MlflowException(
                "The request_id must be a RequestIdFuture that is not ready yet, when submitted to the async queue.",
                error_code=INTERNAL_ERROR,
            )

        task = StartTraceTask(
            request_id_future=trace_info.request_id,
            experiment_id=trace_info.experiment_id,
            timestamp_ms=trace_info.timestamp_ms,
            request_metadata=trace_info.request_metadata,
            tags=trace_info.tags,
            completion_event=threading.Event(),
            exception=None,
        )
        self._queue.put(task)


    def log_trace_async(self, trace: Trace):
        """Asynchronously logs traces.

        Args:
            trace: The trace to log.

        Returns:
            An object that encapsulates the asynchronous operation of logging the traces.
        """
        from mlflow import MlflowException

        if not self._is_activated:
            raise MlflowException("AsyncTraceLoggingQueue is not activated.")

        task = EndTraceTask(
            trace=trace,
            completion_event=threading.Event(),
            exception=None,
        )
        self._queue.put(task)
        self._trace_status_check_threadpool.submit(self._wait_for_task, task)

    def is_active(self) -> bool:
        return self._is_activated

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
