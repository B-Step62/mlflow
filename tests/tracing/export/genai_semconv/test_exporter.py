import json
from unittest.mock import MagicMock, patch

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.trace import SpanContext, SpanKind, TraceFlags
from opentelemetry.trace.status import Status, StatusCode

from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.export.genai_semconv.exporter import GenAiSemconvSpanExporter


def _make_span(name="test_span", attributes=None, kind=SpanKind.INTERNAL):
    context = SpanContext(
        trace_id=0x000000000000000000000000DEADBEEF,
        span_id=0x00000000DEADBEF0,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    return ReadableSpan(
        name=name,
        context=context,
        kind=kind,
        attributes=attributes or {},
        start_time=1000000000,
        end_time=2000000000,
        status=Status(StatusCode.OK),
    )


class TestGenAiSemconvSpanExporter:
    def test_translates_and_delegates(self):
        inner = MagicMock()
        inner.export.return_value = SpanExportResult.SUCCESS
        exporter = GenAiSemconvSpanExporter(inner)

        span = _make_span(
            attributes={
                SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
                SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
                SpanAttributeKey.MODEL_PROVIDER: json.dumps("openai"),
            }
        )
        result = exporter.export([span])

        assert result == SpanExportResult.SUCCESS
        inner.export.assert_called_once()
        exported_spans = inner.export.call_args[0][0]
        assert len(exported_spans) == 1
        assert exported_spans[0].attributes["gen_ai.operation.name"] == "chat"
        assert exported_spans[0].attributes["gen_ai.request.model"] == "gpt-4o"
        assert not any(k.startswith("mlflow.") for k in exported_spans[0].attributes)

    def test_fallback_on_translation_error(self):
        inner = MagicMock()
        inner.export.return_value = SpanExportResult.SUCCESS
        exporter = GenAiSemconvSpanExporter(inner)

        span = _make_span(attributes={"key": "value"})

        with patch(
            "mlflow.tracing.export.genai_semconv.exporter.translate_span_to_genai",
            side_effect=RuntimeError("translation failed"),
        ):
            result = exporter.export([span])

        assert result == SpanExportResult.SUCCESS
        # Should fall back to exporting original spans
        inner.export.assert_called_once()
        exported_spans = inner.export.call_args[0][0]
        assert exported_spans[0] is span

    @patch("mlflow.tracing.export.genai_semconv.exporter.MLFLOW_GENAI_SEMCONV_CAPTURE_CONTENT")
    def test_capture_content_false(self, mock_env_var):
        mock_env_var.get.return_value = False
        inner = MagicMock()
        inner.export.return_value = SpanExportResult.SUCCESS
        exporter = GenAiSemconvSpanExporter(inner)

        span = _make_span(
            attributes={
                SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
                SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
                SpanAttributeKey.MESSAGE_FORMAT: json.dumps("openai"),
                SpanAttributeKey.INPUTS: json.dumps(
                    {"messages": [{"role": "user", "content": "secret data"}]}
                ),
            }
        )
        result = exporter.export([span])

        assert result == SpanExportResult.SUCCESS
        exported_spans = inner.export.call_args[0][0]
        assert "gen_ai.input.messages" not in exported_spans[0].attributes

    def test_shutdown_delegates(self):
        inner = MagicMock()
        exporter = GenAiSemconvSpanExporter(inner)
        exporter.shutdown()
        inner.shutdown.assert_called_once()

    def test_force_flush_delegates(self):
        inner = MagicMock()
        inner.force_flush.return_value = True
        exporter = GenAiSemconvSpanExporter(inner)
        assert exporter.force_flush(5000) is True
        inner.force_flush.assert_called_once_with(5000)

    def test_multiple_spans(self):
        inner = MagicMock()
        inner.export.return_value = SpanExportResult.SUCCESS
        exporter = GenAiSemconvSpanExporter(inner)

        spans = [
            _make_span(
                name="span1",
                attributes={
                    SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
                    SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
                },
            ),
            _make_span(
                name="span2",
                attributes={
                    SpanAttributeKey.SPAN_TYPE: json.dumps("EMBEDDING"),
                    SpanAttributeKey.MODEL: json.dumps("text-embedding-3-small"),
                },
            ),
            _make_span(
                name="span3",
                attributes={SpanAttributeKey.SPAN_TYPE: json.dumps("CHAIN")},
            ),
        ]
        result = exporter.export(spans)

        assert result == SpanExportResult.SUCCESS
        exported_spans = inner.export.call_args[0][0]
        assert len(exported_spans) == 3
        assert exported_spans[0].name == "chat gpt-4o"
        assert exported_spans[1].name == "embeddings text-embedding-3-small"
        # CHAIN has no mapping, passes through
        assert exported_spans[2].name == "span3"

    def test_span_kind_translation(self):
        inner = MagicMock()
        inner.export.return_value = SpanExportResult.SUCCESS
        exporter = GenAiSemconvSpanExporter(inner)

        span = _make_span(
            attributes={
                SpanAttributeKey.SPAN_TYPE: json.dumps("CHAT_MODEL"),
                SpanAttributeKey.MODEL: json.dumps("gpt-4o"),
            },
            kind=SpanKind.INTERNAL,
        )
        exporter.export([span])

        exported_spans = inner.export.call_args[0][0]
        assert exported_spans[0].kind == SpanKind.CLIENT
