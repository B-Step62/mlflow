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
from typing import Any, Dict

from mlflow.entities.trace import Trace
from mlflow.utils.async_logging.run_operations import RunOperations

_logger = logging.getLogger(__name__)


@dataclass
class TraceTask:
    """
    A class to encapsulate the trace and its completion event.
    """

    trace: Trace
    completion_event: threading.Event
    exception: Exception = None


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
                self._log_trace()
            # Drain the queue after the stop event is set.
            while not self._queue.empty():
                self._log_trace()
        except Exception as e:
            from mlflow.exceptions import MlflowException

            raise MlflowException(f"Exception inside the run data logging thread: {e}")

    def _log_trace(self) -> None:
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

        def logging_func(task):
            try:
                self._client._log_trace(task.trace)
                # Signal the trace logging is done.
                task.completion_event.set()

            except Exception as e:
                _logger.error(f"Failed to log trace {task.trace}. Exception: {e}", exc_info=True)
                task.exception = e
                task.completion_event.set()

        self._trace_logging_worker_threadpool.submit(logging_func, task)

    def _wait_for_trace(self, task: TraceTask) -> None:
        """Wait for given traces to be processed by the logging thread.

        Args:
            trace: The trace to wait for.

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

    # TODO: Using RunOperations class while trace logging is not run operations.
    # The class is indeed not run-specific so we should rename it in
    # a separate PR.
    def log_trace_async(self, trace: Trace) -> RunOperations:
        """Asynchronously logs traces.

        Args:
            trace: The trace to log.

        Returns:
            An object that encapsulates the asynchronous operation of logging the traces.
        """
        from mlflow import MlflowException

        if not self._is_activated:
            raise MlflowException("AsyncTraceLoggingQueue is not activated.")

        task = TraceTask(
            trace=trace,
            completion_event=threading.Event(),
        )
        self._queue.put(task)
        operation_future = self._trace_status_check_threadpool.submit(self._wait_for_trace, task)
        return RunOperations(operation_futures=[operation_future])

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
