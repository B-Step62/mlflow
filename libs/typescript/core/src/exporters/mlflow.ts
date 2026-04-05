import { Trace } from '../core/entities/trace';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import {
  Span as OTelSpan,
  SpanProcessor,
  ReadableSpan as OTelReadableSpan,
  SpanExporter,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import { Context } from '@opentelemetry/api';
import { createAndRegisterMlflowSpan } from '../core/api';
import { getConfiguredTraceMetadata, getConfiguredTraceTags } from '../core/context';
import { InMemoryTraceManager } from '../core/trace_manager';
import { TraceInfo } from '../core/entities/trace_info';
import { createTraceLocationFromExperimentId } from '../core/entities/trace_location';
import { fromOtelStatus, TraceState } from '../core/entities/trace_state';
import {
  SpanAttributeKey,
  TRACE_ID_PREFIX,
  TRACE_SCHEMA_VERSION,
  TraceMetadataKey,
  TraceTagKey,
} from '../core/constants';
import { convertHrTimeToMs } from '../core/utils';
import { getConfig } from '../core/config';
import { MlflowClient } from '../clients';
import { executeOnSpanEndHooks, executeOnSpanStartHooks } from './span_processor_hooks';
import { HeadersProvider } from '../auth';

/**
 * Generate a MLflow-compatible trace ID for the given span.
 * @param span The span to generate the trace ID for
 */
function generateTraceId(span: OTelSpan): string {
  // NB: trace Id is already hex string in Typescript OpenTelemetry SDK
  return TRACE_ID_PREFIX + span.spanContext().traceId;
}

/**
 * Create a ReadableSpan proxy with JSON-decoded attributes for OTLP serialization.
 *
 * The TS SDK JSON-encodes all attribute values via safeJsonStringify before storing
 * in OTel spans. The server's from_otel_proto will JSON-encode them again. To prevent
 * double-encoding, we decode them before building the OTLP protobuf.
 */
function createDecodedSpan(span: OTelReadableSpan): OTelReadableSpan {
  const decoded: Record<string, any> = {};
  for (const [key, value] of Object.entries(span.attributes)) {
    if (typeof value === 'string') {
      try {
        decoded[key] = JSON.parse(value);
      } catch {
        decoded[key] = value;
      }
    } else if (value != null) {
      decoded[key] = value;
    }
  }
  return new Proxy(span, {
    get(target, prop) {
      if (prop === 'attributes') {
        return decoded;
      }
      return (target as any)[prop];
    },
  });
}

/**
 * MLflow span processor that wraps a BatchSpanProcessor for OTLP export.
 *
 * Mirrors the Python BaseMlflowSpanProcessor architecture:
 * - Handles MLflow bookkeeping (trace registration, metadata) in onStart/onEnd
 * - Delegates span export to an internal BatchSpanProcessor
 * - On root span end, exports trace metadata via createTrace
 */
export class MlflowSpanProcessor implements SpanProcessor {
  private _client: MlflowClient;
  private _batchDelegate: BatchSpanProcessor;
  private _pendingExports: Record<string, Promise<void>> = {};

  constructor(client: MlflowClient, headersProvider: HeadersProvider, experimentId: string) {
    this._client = client;
    const exporter = new MlflowSpanExporter(headersProvider, client.getHost(), experimentId);
    this._batchDelegate = new BatchSpanProcessor(exporter);
  }

  /**
   * Called when a {@link Span} is started, if the `span.isRecording()`
   * returns true.
   * @param span the Span that just started.
   */
  onStart(span: OTelSpan, parentContext: Context): void {
    const otelTraceId = span.spanContext().traceId;

    let traceId: string;
    const experimentId = getConfig().experimentId;

    if (!span.parentSpanContext?.spanId) {
      // This is a root span
      traceId = generateTraceId(span);

      // Build trace metadata, merging context-injected values
      const traceMetadata: Record<string, string> = {
        [TraceMetadataKey.SCHEMA_VERSION]: TRACE_SCHEMA_VERSION,
      };
      const ctxMetadata = getConfiguredTraceMetadata();
      if (ctxMetadata) {
        Object.assign(traceMetadata, ctxMetadata);
      }

      // Build trace tags, merging context-injected values
      const tags: Record<string, string> = {
        [TraceTagKey.SPANS_LOCATION]: 'TRACKING_STORE',
      };
      const ctxTags = getConfiguredTraceTags();
      if (ctxTags) {
        Object.assign(tags, ctxTags);
      }

      const trace_info = new TraceInfo({
        traceId: traceId,
        traceLocation: createTraceLocationFromExperimentId(experimentId),
        requestTime: convertHrTimeToMs(span.startTime),
        executionDuration: 0,
        state: TraceState.IN_PROGRESS,
        traceMetadata,
        tags,
        assessments: [],
      });
      InMemoryTraceManager.getInstance().registerTrace(otelTraceId, trace_info);
    } else {
      traceId = InMemoryTraceManager.getInstance().getMlflowTraceIdFromOtelId(otelTraceId) || '';

      if (!traceId) {
        console.warn(`No trace ID found for span ${span.name}. Skipping.`);
        return;
      }
    }

    // Set trace ID to the span
    span.setAttribute(SpanAttributeKey.TRACE_ID, JSON.stringify(traceId));

    createAndRegisterMlflowSpan(span);
    executeOnSpanStartHooks(span);

    this._batchDelegate.onStart(span, parentContext);
  }

  /**
   * Called when a {@link ReadableSpan} is ended, if the `span.isRecording()`
   * returns true.
   * @param span the Span that just ended.
   */
  onEnd(span: OTelReadableSpan): void {
    const traceManager = InMemoryTraceManager.getInstance();

    executeOnSpanEndHooks(span);

    // Delegate to BatchSpanProcessor for OTLP export
    this._batchDelegate.onEnd(span);

    // Only trigger trace metadata export for root span completion
    if (span.parentSpanContext?.spanId) {
      return;
    }

    // Update trace info
    const traceId = traceManager.getMlflowTraceIdFromOtelId(span.spanContext().traceId);
    if (!traceId) {
      console.warn(`No trace ID found for span ${span.name}. Skipping.`);
      return;
    }

    const trace = traceManager.getTrace(traceId);
    if (!trace) {
      console.warn(`No trace found for span ${span.name}. Skipping.`);
      return;
    }

    this.updateTraceInfo(trace.info, span);
    // Token usage aggregation is handled server-side by log_spans

    // Pop trace and export metadata
    const mlflowTrace = traceManager.popTrace(span.spanContext().traceId);
    if (!mlflowTrace) {
      return;
    }
    traceManager.lastActiveTraceId = mlflowTrace.info.traceId;

    const exportPromise = this._client
      .createTrace(mlflowTrace.info)
      .then(() => {})
      .catch((error) => {
        console.error(`Failed to export trace metadata ${mlflowTrace.info.traceId}:`, error);
      });
    this._pendingExports[mlflowTrace.info.traceId] = exportPromise;
  }

  /**
   * Update the trace info with the span end time and status.
   * @param trace The trace to update
   * @param span The span to update the trace with
   */
  updateTraceInfo(traceInfo: TraceInfo, span: OTelReadableSpan): void {
    traceInfo.executionDuration = convertHrTimeToMs(span.endTime) - traceInfo.requestTime;

    // NB: In OpenTelemetry, status code remains UNSET if not explicitly set
    // by the user. However, there is no way to set the status when using
    // `trace` function wrapper. Therefore, we just automatically set the status
    // to OK if it is not ERROR.
    let state = fromOtelStatus(span.status.code);
    if (state === TraceState.STATE_UNSPECIFIED) {
      state = TraceState.OK;
    }
    traceInfo.state = state;
  }

  /**
   * Shuts down the processor. Called when SDK is shut down. This is an
   * opportunity for processor to do any cleanup required.
   */
  async shutdown() {
    await this._batchDelegate.shutdown();
  }

  /**
   * Forces to export all finished spans
   */
  async forceFlush() {
    await this._batchDelegate.forceFlush();
    await Promise.all(Object.values(this._pendingExports));
    this._pendingExports = {};
  }
}

/**
 * SpanExporter that sends spans to MLflow's OTLP endpoint with decoded attributes.
 * Used internally by MlflowSpanProcessor's BatchSpanProcessor delegate.
 */
export class MlflowSpanExporter implements SpanExporter {
  private _headersProvider: HeadersProvider;
  private _host: string;
  private _experimentId: string;

  constructor(headersProvider: HeadersProvider, host: string, experimentId: string) {
    this._headersProvider = headersProvider;
    this._host = host;
    this._experimentId = experimentId;
  }

  export(spans: OTelReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const decodedSpans = spans.map(createDecodedSpan);
    const body = ProtobufTraceSerializer.serializeRequest(decodedSpans);
    if (!body) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    this._headersProvider()
      .then((headers) =>
        fetch(`${this._host}/v1/traces`, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/x-protobuf',
            'x-mlflow-experiment-id': this._experimentId,
          },
          body,
        }),
      )
      .then((response) => {
        if (response.ok) {
          resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
          response
            .text()
            .then((text) => console.error(`OTLP span export failed: ${response.status} ${text}`))
            .catch(() => {});
          resultCallback({ code: ExportResultCode.FAILED });
        }
      })
      .catch((error) => {
        console.error('Failed to log spans via OTLP:', error);
        resultCallback({ code: ExportResultCode.FAILED });
      });
  }

  async shutdown(): Promise<void> {}
}
