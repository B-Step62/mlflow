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
  private _exporter: SpanExporter;

  constructor(exporter: SpanExporter) {
    this._exporter = exporter;
  }

  onStart(span: OTelSpan, _parentContext: Context): void {
    const otelTraceId = span.spanContext().traceId;

    let traceId: string;
    const experimentId = getConfig().experimentId;

    if (!span.parentSpanContext?.spanId) {
      traceId = generateTraceId(span);

      const traceMetadata: Record<string, string> = {
        [TraceMetadataKey.SCHEMA_VERSION]: TRACE_SCHEMA_VERSION,
      };
      const ctxMetadata = getConfiguredTraceMetadata();
      if (ctxMetadata) {
        Object.assign(traceMetadata, ctxMetadata);
      }

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

    span.setAttribute(SpanAttributeKey.TRACE_ID, JSON.stringify(traceId));

    createAndRegisterMlflowSpan(span);
    executeOnSpanStartHooks(span);
  }

  onEnd(span: OTelReadableSpan): void {
    const traceManager = InMemoryTraceManager.getInstance();

    executeOnSpanEndHooks(span);

    // Store the OTel ReadableSpan for OTLP export (for ALL spans, not just root)
    const traceId = traceManager.getMlflowTraceIdFromOtelId(span.spanContext().traceId);
    if (traceId) {
      traceManager.registerOtelSpan(traceId, span);
    }

    // Only trigger trace export for root span completion
    if (span.parentSpanContext?.spanId) {
      return;
    }

    if (!traceId) {
      console.warn(`No trace ID found for span ${span.name}. Skipping.`);
      return;
    }

    const trace = InMemoryTraceManager.getInstance().getTrace(traceId);
    if (!trace) {
      console.warn(`No trace found for span ${span.name}. Skipping.`);
      return;
    }

    this.updateTraceInfo(trace.info, span);
    const allSpans = Array.from(trace.spanDict.values());
    const aggregatedUsage = aggregateUsageFromSpans(allSpans);
    if (aggregatedUsage) {
      trace.info.traceMetadata[TraceMetadataKey.TOKEN_USAGE] = JSON.stringify(aggregatedUsage);
    }

    this._exporter.export([span], (_) => {});
  }

  updateTraceInfo(traceInfo: TraceInfo, span: OTelReadableSpan): void {
    traceInfo.executionDuration = convertHrTimeToMs(span.endTime) - traceInfo.requestTime;

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
  private _pendingExports: Record<string, Promise<void>> = {};

  constructor(client: MlflowClient, headersProvider: HeadersProvider, experimentId: string) {
    this._client = client;
    this._headersProvider = headersProvider;
    this._host = client.getHost();
    this._experimentId = experimentId;
  }

  export(spans: OTelReadableSpan[], _resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      if (span.parentSpanContext?.spanId) {
        continue;
      }

      const traceManager = InMemoryTraceManager.getInstance();
      const result = traceManager.popTrace(span.spanContext().traceId);
      if (!result) {
        console.warn(`No trace found for span ${span.name}. Skipping.`);
        continue;
      }

      traceManager.lastActiveTraceId = result.trace.info.traceId;

      const exportPromise = this.exportTraceToBackend(result.trace, result.otelSpans).catch(
        (error) => {
          console.error(`Failed to export trace ${result.trace.info.traceId}:`, error);
        },
      );
      this._pendingExports[result.trace.info.traceId] = exportPromise;
    }
  }

  /**
   * Export a complete trace to the MLflow backend.
   * Step 1: Log spans via OTLP protobuf (triggers server-side cost computation)
   * Step 2: Create trace metadata via StartTraceV3 endpoint
   */
  private async exportTraceToBackend(
    trace: Trace,
    otelSpans: OTelReadableSpan[],
  ): Promise<void> {
    try {
      if (otelSpans.length > 0) {
        await this.logSpansViaOtlp(otelSpans);
      }
      await this._client.createTrace(trace.info);
    } catch (error) {
      console.error(`Failed to export trace ${trace.info.traceId}:`, error);
      throw error;
    } finally {
      delete this._pendingExports[trace.info.traceId];
    }
  }

  /**
   * Serialize spans to OTLP protobuf and POST to /v1/traces.
   */
  private async logSpansViaOtlp(otelSpans: OTelReadableSpan[]): Promise<void> {
    const decodedSpans = otelSpans.map(createDecodedSpan);
    const body = ProtobufTraceSerializer.serializeRequest(decodedSpans);
    if (!body) {
      return;
    }

    const headers = await this._headersProvider();
    const url = `${this._host}/v1/traces`;

    const response = await fetch(url, {
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
      console.error(`OTLP export failed: ${response.status} ${text}`);
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.all(Object.values(this._pendingExports));
    this._pendingExports = {};
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }
}
