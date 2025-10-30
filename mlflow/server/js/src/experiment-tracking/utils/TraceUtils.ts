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
  const spansLocation = (traceInfo as any)?.tags?.['mlflow.trace.spansLocation'];

  if (spansLocation === 'TRACKING_STORE') {
    try {
      const traceResp = await MlflowService.getExperimentTraceV3(traceId, { allowPartial: true });
      const v3Trace = traceResp?.trace;
      if (v3Trace?.data) {
        return {
          info: v3Trace.trace_info || traceInfo,
          data: v3Trace.data,
        };
      }
      // If V3 response did not contain data for some reason, fall back to artifact route
    } catch {
      // swallow and fall back to artifact route below
    }
  }

  // Artifact fallback (legacy path, or when spans are not in tracking store)
  const traceData = await MlflowService.getExperimentTraceData(traceId);
  return traceData
    ? {
        info: traceInfo,
        data: traceData,
      }
    : undefined;
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
