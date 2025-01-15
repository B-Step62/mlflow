from typing import Optional

from mlflow.tracing.processor.local import LocalSpanProcessor
from mlflow.tracing.utils import maybe_get_request_id


class InferenceTableSpanProcessor(LocalSpanProcessor):
    """
    Defines custom hooks to be executed when a span is started or ended (before exporting).

    This processor is used when the tracing destination is Databricks Inference Table.
    It is simple in-memory processing with a custom request ID extraction logic
    from the prediction context set in the scoring server.
    """

    def generate_request_id(self) -> Optional[str]:
        """Override the default request ID generation logic"""
        return maybe_get_request_id()
