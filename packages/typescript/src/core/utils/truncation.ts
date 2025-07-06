import { TraceInfo } from '../entities/trace_info';
import { TraceData } from '../entities/trace_data';
import { TRACE_REQUEST_RESPONSE_PREVIEW_MAX_LENGTH } from '../constants';

/**
 * Set the request and response previews for the trace info by truncating
 * the request and response strings to a fixed length.
 *
 * @param traceInfo TraceInfo object to set previews on
 * @param traceData TraceData object containing spans with request/response data
 */
export function setRequestResponsePreview(traceInfo: TraceInfo, traceData: TraceData): void {
  if (traceData.spans.length === 0) {
    return;
  }

  // Get the first span which should contain the request/response data
  const firstSpan = traceData.spans[0];

  // Extract request from span inputs
  const request = firstSpan.inputs ? JSON.stringify(firstSpan.inputs) : '';

  // Extract response from span outputs
  const response = firstSpan.outputs ? JSON.stringify(firstSpan.outputs) : '';

  // Set request preview with truncation
  if (request) {
    traceInfo.requestPreview = truncateToLength(request, TRACE_REQUEST_RESPONSE_PREVIEW_MAX_LENGTH);
  }

  // Set response preview with truncation
  if (response) {
    traceInfo.responsePreview = truncateToLength(
      response,
      TRACE_REQUEST_RESPONSE_PREVIEW_MAX_LENGTH
    );
  }
}

/**
 * Truncate a string to the specified length, adding "..." if truncated
 *
 * @param str String to truncate
 * @param maxLength Maximum length for the string
 * @returns Truncated string
 */
function truncateToLength(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }

  return str.substring(0, maxLength - 3) + '...';
}
