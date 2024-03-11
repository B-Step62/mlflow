from mlflow.traces.client.base import TraceClient
from mlflow.traces.client.dummy import DummyTraceClient, DummyTraceClientWithHTMLDisplay

def get_trace_client() -> TraceClient:
    """
    Get the trace client to use for logging traces.
    """
    from mlflow.utils.databricks_utils import is_in_databricks_runtime
    if is_in_databricks_runtime():
        return DummyTraceClientWithHTMLDisplay()
    else:
        return DummyTraceClient()
