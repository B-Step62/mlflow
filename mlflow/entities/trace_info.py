from dataclasses import dataclass, field
from typing import Dict

from mlflow.entities._mlflow_object import _MLflowObject
from mlflow.entities.trace_status import TraceStatus
from mlflow.protos.service_pb2 import TraceAttribute as ProtoTraceAttribute
from mlflow.protos.service_pb2 import TraceInfo as ProtoTraceInfo
from mlflow.protos.service_pb2 import TraceTag as ProtoTraceTag


@dataclass
class TraceInfo(_MLflowObject):
    """Metadata about a trace.

    Args:
        trace_id: id of the trace.
        experiment_id: id of the experiment.
        start_time: start time of the trace.
        end_time: end time of the trace.
        status: status of the trace.
        attributes: attributes associated with the trace.
        tags: tags associated with the trace.
    """

    trace_id: str
    experiment_id: str
    start_time: int
    end_time: int
    status: TraceStatus
    attributes: Dict[str, str] = field(default_factory=dict)
    tags: Dict[str, str] = field(default_factory=dict)

    def __eq__(self, other):
        if type(other) is type(self):
            return self.__dict__ == other.__dict__
        return False

    @property
    def set_attributes(self, attributes: Dict[str, str]):
        self.attributes.update(attributes)

    @property
    def set_tags(self, tags: Dict[str, str]):
        self.tags.update(tags)

    def to_proto(self):
        proto = ProtoTraceInfo()
        proto.trace_id = self.trace_id
        proto.experiment_id = self.experiment_id
        proto.start_time = self.start_time
        proto.end_time = self.end_time
        proto.status = TraceStatus.from_string(self.status)

        for key, value in self.attributes.items():
            attr_proto = ProtoTraceAttribute()
            attr_proto.key = key
            attr_proto.value = value
            proto.attributes.extend(attr_proto)

        for key, value in self.tags.items():
            tag_proto = ProtoTraceTag()
            tag_proto.key = key
            tag_proto.value = value
            proto.tags.extend(tag_proto)
        return proto

    @classmethod
    def from_proto(cls, proto):
        return cls(
            trace_id=proto.trace_id,
            experiment_id=proto.experiment_id,
            start_time=proto.start_time,
            end_time=proto.end_time,
            status=TraceStatus.to_string(proto.status),
            attributes={attr.key: attr.value for attr in proto.attributes},
            tags={tag.key: tag.value for tag in proto.tags},
        )
