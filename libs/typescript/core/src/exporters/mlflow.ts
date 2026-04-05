import { Trace } from '../core/entities/trace';
import { ExportResult } from '@opentelemetry/core';
import {
  Span as OTelSpan,
  SpanProcessor,
  ReadableSpan as OTelReadableSpan,
  SpanExporter,
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
import { convertHrTimeToMs, aggregateUsageFromSpans } from '../core/utils';
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

export class MlflowSpanProcessor implements SpanProcessor {
  private _exporter: MlflowSpanExporter;

  constructor(exporter: MlflowSpanExporter) {
    this._exporter = exporter;
  }

  /**
   * Called when a {@link Span} is started, if the `span.isRecording()`
   * returns true.
   * @param span the Span that just started.
   */
  onStart(span: OTelSpan, _parentContext: Context): void {
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
  }

  /**
   * Called when a {@link ReadableSpan} is ended, if the `span.isRecording()`
   * returns true.
   * @param span the Span that just ended.
   */
  onEnd(span: OTelReadableSpan): void {
    const traceManager = InMemoryTraceManager.getInstance();

    executeOnSpanEndHooks(span);

    // Log each span incrementally via OTLP as it ends
    this._exporter.logSpan(span);

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
    // Aggregate token usage from all spans and add to trace metadata
    const allSpans = Array.from(trace.spanDict.values());
    const aggregatedUsage = aggregateUsageFromSpans(allSpans);
    if (aggregatedUsage) {
      trace.info.traceMetadata[TraceMetadataKey.TOKEN_USAGE] = JSON.stringify(aggregatedUsage);
    }

    this._exporter.export([span], (_) => {});
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

  async shutdown() {
    await this._exporter.shutdown();
  }

  async forceFlush() {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this._exporter.forceFlush!();
  }
}

export class MlflowSpanExporter implements SpanExporter {
  private _client: MlflowClient;
  private _headersProvider: HeadersProvider;
  private _host: string;
  private _experimentId: string;
  private _pendingExports: Record<string, Promise<void>> = {}; // traceId -> export promise
  private _spanBuffer: OTelReadableSpan[] = [];
  private _pendingSpanFlush: Promise<void> | null = null;

  constructor(client: MlflowClient, headersProvider: HeadersProvider, experimentId: string) {
    this._client = client;
    this._headersProvider = headersProvider;
    this._host = client.getHost();
    this._experimentId = experimentId;
  }

  /**
   * Buffer a span for batched OTLP export.
   * Called by MlflowSpanProcessor.onEnd for every span.
   */
  logSpan(span: OTelReadableSpan): void {
    this._spanBuffer.push(span);
  }

  /**
   * Flush all buffered spans to the OTLP endpoint in a single request.
   */
  private async flushSpanBuffer(): Promise<void> {
    if (this._spanBuffer.length === 0) {
      return;
    }

    const spans = this._spanBuffer;
    this._spanBuffer = [];

    const decodedSpans = spans.map(createDecodedSpan);
    const body = ProtobufTraceSerializer.serializeRequest(decodedSpans);
    if (!body) {
      return;
    }

    const headers = await this._headersProvider();
    const response = await fetch(`${this._host}/v1/traces`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-protobuf',
        'x-mlflow-experiment-id': this._experimentId,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`OTLP span export failed: ${response.status} ${text}`);
    }
  }

  export(spans: OTelReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      // Only export root spans
      if (span.parentSpanContext?.spanId) {
        continue;
      }

      const traceManager = InMemoryTraceManager.getInstance();
      const trace = traceManager.popTrace(span.spanContext().traceId);
      if (!trace) {
        console.warn(`No trace found for span ${span.name}. Skipping.`);
        continue;
      }

      // Set the last active trace ID
      traceManager.lastActiveTraceId = trace.info.traceId;

      // Flush buffered spans then export trace metadata
      const exportPromise = this.flushSpanBuffer()
        .then(async () => { await this._client.createTrace(trace.info); })
        .catch((error) => {
          console.error(`Failed to export trace ${trace.info.traceId}:`, error);
        })
        .finally(() => {
          // Remove the promise from the pending exports
          delete this._pendingExports[trace.info.traceId];
        });
      this._pendingExports[trace.info.traceId] = exportPromise;
    }
  }

  async forceFlush(): Promise<void> {
    // Flush any remaining buffered spans
    await this.flushSpanBuffer();
    // Wait for all pending trace metadata exports
    await Promise.all(Object.values(this._pendingExports));
    this._pendingExports = {};
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }
}
