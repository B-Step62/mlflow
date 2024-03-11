from abc import ABC, abstractmethod
from mlflow.traces.types import Trace

class TraceClient(ABC):
    @abstractmethod
    def log_trace(self, trace: Trace):
        pass
