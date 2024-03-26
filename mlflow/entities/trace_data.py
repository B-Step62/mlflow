from dataclasses import dataclass, field
from typing import List

from mlflow.entities._mlflow_object import _MLflowObject
from mlflow.entities.span import Span


@dataclass
class TraceData(_MLflowObject):
    """A container object that holds the spans data of a trace.

    Args:
        spans: List of spans that are part of the trace.
    """

    spans: List[Span] = field(default_factory=list)
