import { MlflowService } from '../sdk/MlflowService';
import type { ModelTrace } from '@databricks/web-shared/model-trace-explorer';

/**
 * Fetches trace information and data for a given trace ID.
 *
 * @param traceId - The ID of the trace to fetch
 * @returns Promise resolving to ModelTrace object or undefined if trace cannot be fetched
 */
export async function getTrace(traceId?: string): Promise<ModelTrace | undefined> {
  if (!traceId) {
    return undefined;
  }

  // Always fetch V3 TraceInfo first to decide where spans live
  const traceInfoResponse = await MlflowService.getExperimentTraceInfoV3(traceId);
  const traceInfo = traceInfoResponse?.trace?.trace_info || {};

  // Check spans location tag to decide the source of span data
  // If spans are in the tracking store, use V3 get-trace (allow_partial=true)
  // Otherwise, fall back to artifact route
  const getTagValue = (tags: any, key: string): string | undefined => {
    if (!tags) return undefined;
    if (Array.isArray(tags)) {
      const found = tags.find((t) => t?.key === key);
      return found?.value as string | undefined;
    }
    return (tags as Record<string, string>)[key];
  };
  const spansLocation = getTagValue((traceInfo as any)?.tags, 'mlflow.trace.spansLocation');

  if (spansLocation === 'TRACKING_STORE') {
    try {
      const traceResp = await MlflowService.getExperimentTraceV3(traceId, { allowPartial: true });
      const v3Trace = traceResp?.trace;
      if (v3Trace?.data || v3Trace?.spans) {
        const rawData = v3Trace.data ?? { spans: v3Trace.spans };
        // Deserialize any OpenTelemetry-style spans (attributes/events are arrays with AnyValue)
        const data = {
          ...rawData,
          spans: (rawData as any).spans?.map(deserializeOtelSpanIfNeeded) ?? [],
        } as any;
        return {
          info: v3Trace.trace_info || traceInfo,
          data,
        };
      }
      // If V3 response did not contain data for some reason, fall back to artifact route
    } catch {
      // swallow and fall back to artifact route below
    }
  }
  // Artifact fallback (legacy path, or when spans are not in tracking store, or V3 failed)
  const traceData = await MlflowService.getExperimentTraceData(traceId);
  return traceData
    ? {
        info: traceInfo,
        data: {
          ...traceData,
          spans: (traceData as any).spans?.map(deserializeOtelSpanIfNeeded) ?? (traceData as any).spans,
        } as any,
      }
    : undefined;
}

// Helpers
type OtelAnyValue = {
  string_value?: string | null;
  bool_value?: boolean | null;
  int_value?: number | string | null; // some servers serialize ints as strings
  double_value?: number | null;
  array_value?: { values?: OtelAnyValue[] } | null;
  kvlist_value?: { values?: { key: string; value: OtelAnyValue }[] } | null;
};

function deserializeOtelAnyValue(v: OtelAnyValue): any {
  if (!v || typeof v !== 'object') return v;
  if (v.string_value != null) return v.string_value;
  if (v.bool_value != null) return v.bool_value;
  if (v.int_value != null) return Number(v.int_value);
  if (v.double_value != null) return v.double_value;
  if (v.array_value && Array.isArray(v.array_value.values)) {
    return v.array_value.values.map(deserializeOtelAnyValue);
  }
  if (v.kvlist_value && Array.isArray(v.kvlist_value.values)) {
    const out: Record<string, any> = {};
    v.kvlist_value.values.forEach((e) => {
      out[e.key] = deserializeOtelAnyValue(e.value as OtelAnyValue);
    });
    return out;
  }
  return v;
}

// Converts OTEL JSON span shape (attributes/events arrays) into a map-based shape expected by the explorer.
function deserializeOtelSpanIfNeeded(span: any): any {
  if (!span) return span;
  const out: any = { ...span };
  // attributes: [{key, value: AnyValue}] -> { [key]: value }
  if (Array.isArray(span.attributes)) {
    const attrs: Record<string, any> = {};
    span.attributes.forEach((a: any) => {
      if (a?.key != null) attrs[a.key] = deserializeOtelAnyValue(a.value as OtelAnyValue);
    });
    out.attributes = attrs;
  }
  // events[*].attributes array -> map
  if (Array.isArray(span.events)) {
    out.events = span.events.map((ev: any) => {
      if (!Array.isArray(ev?.attributes)) return ev;
      const evAttrs: Record<string, any> = {};
      ev.attributes.forEach((a: any) => {
        if (a?.key != null) evAttrs[a.key] = deserializeOtelAnyValue(a.value as OtelAnyValue);
      });
      return { ...ev, attributes: evAttrs };
    });
  }
  return out;
}

/**
 * Fetches trace information and data for a given trace ID using the legacy API.
 *
 * @param requestId - The ID of the request to fetch
 * @returns Promise resolving to ModelTrace object or undefined if trace cannot be fetched
 */
export async function getTraceLegacy(requestId?: string): Promise<ModelTrace | undefined> {
  if (!requestId) {
    return undefined;
  }

  const [traceInfo, traceData] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    MlflowService.getExperimentTraceInfo(requestId!).then((response) => response.trace_info || {}),
    // get-trace-artifact is only currently supported in mlflow 2.0 apis
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    MlflowService.getExperimentTraceData(requestId!),
  ]);
  return traceData
    ? {
        info: traceInfo,
        data: traceData,
      }
    : undefined;
}
