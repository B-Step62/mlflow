from collections import defaultdict
from contextlib import contextmanager
import inspect
import logging
import threading
from typing import Any, Dict

_logger = logging.getLogger(__name__)


def capture_function_input_args(func, args, kwargs) -> Dict[str, Any]:
    try:
        # Avoid capturing `self`
        func_signature = inspect.signature(func)
        bound_arguments = func_signature.bind(*args, **kwargs)
        bound_arguments.apply_defaults()

        # Remove `self` from bound arguments if it exists
        if bound_arguments.arguments.get("self"):
            del bound_arguments.arguments["self"]

        return bound_arguments.arguments
    except Exception:
        _logger.warning(f"Failed to capture inputs for function {func.__name__}.")
        return {}


class KeyLocalLock():
    """
    A class to provide a lock for the given trace ID. This is particularly useful to
    ensure the thread-safety for an operation that should not happen concurrently for
    the same trace.
    """
    def __init__(self):
        self.trace_locks = defaultdict(threading.Lock)
        # A lock for the above dictionary itself. This is to ensure the modification
        # of the dictionary is also thread-safe.
        self.registry_lock = threading.Lock()

    @contextmanager
    def acquire(self, request_id):
        with self.registry_lock:
            lock = self.trace_locks[request_id]

        with lock:
            yield

    def delete(self, request_id):
        with self.registry_lock:
            if request_id in self.trace_locks:
                self.trace_locks.pop(request_id)
        return
