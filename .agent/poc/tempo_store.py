"""
MLflow tracking store: SqlAlchemyStore + Tempo for trace reads.

Inherits SqlAlchemyStore so everything works (experiments, runs, assessments,
tags, gateway, model registry). Only overrides trace read/write methods:

- get_trace, get_trace_info, search_traces: read spans from Tempo,
  merge assessments/tags from SQL
- start_trace, end_trace, log_spans: raise NotImplementedError
  (ingest goes App -> OTel SDK -> OTLP -> Tempo directly)
"""

import json
import logging
import os

import requests
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.trace import StatusCode as OTelStatusCode

from mlflow.entities.span import Span
from mlflow.entities.trace import Trace
from mlflow.entities.trace_data import TraceData
from mlflow.entities.trace_info import TraceInfo
from mlflow.entities.trace_location import (
    MlflowExperimentLocation,
    TraceLocation,
    TraceLocationType,
)
from mlflow.entities.trace_state import TraceState
from mlflow.store.tracking.sqlalchemy_store import SqlAlchemyStore

_logger = logging.getLogger(__name__)


class TempoTrackingStore(SqlAlchemyStore):
    """
    SqlAlchemyStore subclass that reads trace/span data from Grafana Tempo.
    Everything else (experiments, runs, assessments, tags, gateway) is inherited.
    """

    def __init__(self, db_uri: str, artifact_uri: str | None = None):
        self._tempo_endpoint = os.environ.get(
            "MLFLOW_TRACE_STORE_URL", "http://localhost:3200"
        )
        super().__init__(db_uri, artifact_uri or "/dev/null")

    # --- Trace reads: Tempo is the source of truth for spans ---

    def get_trace(self, trace_id: str, *, allow_partial: bool = False) -> Trace:
        otel_id = trace_id.removeprefix("tr-")
        spans = self._fetch_spans(otel_id)
        info = self._build_trace_info(trace_id, spans)
        info.assessments = self._load_assessments_from_sql(trace_id)
        info.tags = self._load_tags_from_sql(trace_id)
        return Trace(info=info, data=TraceData(spans=spans))

    def get_trace_info(self, trace_id: str) -> TraceInfo:
        otel_id = trace_id.removeprefix("tr-")
        spans = self._fetch_spans(otel_id)
        info = self._build_trace_info(trace_id, spans)
        info.assessments = self._load_assessments_from_sql(trace_id)
        info.tags = self._load_tags_from_sql(trace_id)
        return info

    def search_traces(
        self,
        experiment_ids=None,
        filter_string=None,
        max_results=100,
        order_by=None,
        page_token=None,
        model_id=None,
        locations=None,
        **kwargs,
    ):
        params = {"limit": max_results}
        resp = requests.get(
            f"{self._tempo_endpoint}/api/search",
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        trace_infos = []
        for result in data.get("traces", []):
            tempo_trace_id = result.get("traceID", "")
            mlflow_trace_id = f"tr-{tempo_trace_id}"
            start_time_epoch = result.get("startTimeUnixNano")
            request_time_ms = int(start_time_epoch) // 1_000_000 if start_time_epoch else 0

            info = TraceInfo(
                trace_id=mlflow_trace_id,
                trace_location=TraceLocation(
                    type=TraceLocationType.MLFLOW_EXPERIMENT,
                    mlflow_experiment=MlflowExperimentLocation(experiment_id="0"),
                ),
                request_time=request_time_ms,
                state=TraceState.OK,
                execution_duration=int(result.get("durationMs", 0)),
            )

            try:
                spans = self._fetch_spans(tempo_trace_id)
                root = next((s for s in spans if s.parent_id is None), None)
                if root:
                    info.request_preview = self._truncate(
                        self._get_span_io(root, "inputs"), 1000
                    )
                    info.response_preview = self._truncate(
                        self._get_span_io(root, "outputs"), 1000
                    )
            except Exception:
                _logger.debug("Could not fetch previews for %s", tempo_trace_id)

            trace_infos.append(info)

        return trace_infos, None

    # --- Trace writes: blocked, ingest goes directly to Tempo ---

    def start_trace(self, trace_info):
        raise NotImplementedError("Ingest goes directly to Tempo via OTel SDK")

    def end_trace(self, trace_id, **kwargs):
        raise NotImplementedError("Ingest goes directly to Tempo via OTel SDK")

    def log_spans(self, location, spans, tracking_uri=None):
        raise NotImplementedError("Ingest goes directly to Tempo via OTel SDK")

    # --- Internal: Tempo fetch ---

    def _fetch_spans(self, otel_trace_id: str) -> list[Span]:
        resp = requests.get(
            f"{self._tempo_endpoint}/api/traces/{otel_trace_id}",
            headers={"Accept": "application/protobuf"},
            timeout=10,
        )
        resp.raise_for_status()

        request = ExportTraceServiceRequest()
        request.ParseFromString(resp.content)

        mlflow_spans = []
        for resource_spans in request.resource_spans:
            resource = resource_spans.resource
            for scope_spans in resource_spans.scope_spans:
                for otel_span in scope_spans.spans:
                    mlflow_span = Span.from_otel_proto(otel_span, resource=resource)
                    mlflow_spans.append(mlflow_span)
        return mlflow_spans

    def _build_trace_info(self, trace_id: str, spans: list[Span]) -> TraceInfo:
        root = next((s for s in spans if s.parent_id is None), None)
        if root is None:
            root = spans[0]

        status = root._span.status
        if status.status_code == OTelStatusCode.ERROR:
            state = TraceState.ERROR
        elif status.status_code == OTelStatusCode.OK:
            state = TraceState.OK
        else:
            state = TraceState.STATE_UNSPECIFIED

        start_ns = root._span.start_time
        end_ns = root._span.end_time

        return TraceInfo(
            trace_id=trace_id if trace_id.startswith("tr-") else f"tr-{trace_id}",
            trace_location=TraceLocation(
                type=TraceLocationType.MLFLOW_EXPERIMENT,
                mlflow_experiment=MlflowExperimentLocation(experiment_id="0"),
            ),
            request_time=start_ns // 1_000_000,
            state=state,
            request_preview=self._truncate(self._get_span_io(root, "inputs"), 1000),
            response_preview=self._truncate(self._get_span_io(root, "outputs"), 1000),
            execution_duration=(end_ns - start_ns) // 1_000_000,
        )

    # --- Internal: SQL reads for assessments/tags ---

    def _load_assessments_from_sql(self, trace_id: str):
        try:
            return super()._get_assessments_for_trace(trace_id)
        except Exception:
            return []

    def _load_tags_from_sql(self, trace_id: str) -> dict[str, str]:
        try:
            return super()._get_trace_tags(trace_id)
        except Exception:
            return {}

    @staticmethod
    def _get_span_io(span: Span, which: str) -> str | None:
        val = span.inputs if which == "inputs" else span.outputs
        if val is None:
            return None
        if isinstance(val, str):
            return val
        return json.dumps(val)

    @staticmethod
    def _truncate(s: str | None, max_len: int) -> str | None:
        if s is None or len(s) <= max_len:
            return s
        return s[:max_len]
