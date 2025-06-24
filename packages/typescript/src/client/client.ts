import { TraceInfo } from '../core/entities/trace_info';
import { Trace } from '../core/entities/trace';
import { getConfig, MLflowTracingConfig } from '../core/config';
import {
  GetTraceInfoV3,
  StartTraceV3
} from './spec';
import { getRequestHeaders, makeRequest } from './utils';
import { ArtifactsClient, getArtifactsClient } from './artifacts';
import { TraceData } from '../core/entities/trace_data';

/**
 * Databricks client for MLflow tracing operations - implements the full
 * MLflow tracing REST API for Databricks backend
 */
export class MlflowClient {
  /** Databricks workspace host URL */
  private host: string;
  /** Personal access token */
  private token?: string;
  /** Client implementation to upload/download trace data artifacts */
  private artifactsClient: ArtifactsClient;


  constructor(options?: { config?: MLflowTracingConfig }) {
    const config = options?.config || getConfig();

    // The host is guaranteed to be set by the init() function
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.host = config.host!;
    this.token = config.token;
    this.artifactsClient = getArtifactsClient(config);
  }



  // === TRACE LIFECYCLE METHODS ===
  /**
   * Create a new TraceInfo record in the backend store.
   * Corresponding to the Python SDK's start_trace_v3() method.
   *
   * Note: the backend API is named as "Start" due to unfortunate miscommunication.
   * The API is indeed called at the "end" of a trace, not the "start".
   */
  async createTrace(trace: Trace): Promise<TraceInfo> {
    const url = StartTraceV3.getEndpoint(this.host);
    const payload: StartTraceV3.Request = { trace: { trace_info: trace.info.toJson() } };
    const response = await makeRequest<StartTraceV3.Response>('POST', url, getRequestHeaders(this.token), payload);
    return TraceInfo.fromJson(response.trace.trace_info);
  }

  // === TRACE RETRIEVAL METHODS ===

  /**
   * Get a single trace by ID
   * Fetches both trace info and trace data from backend
   * Corresponds to Python: client.get_trace()
   */
  async getTrace(traceId: string): Promise<Trace> {
    const traceInfo = await this.getTraceInfo(traceId);
    const traceData = await this.artifactsClient.downloadTraceData(traceInfo);
    return new Trace(traceInfo, traceData);
  }

  /**
   * Get trace info using V3 API
   * Endpoint: GET /api/3.0/mlflow/traces/{trace_id}
   */
  async getTraceInfo(traceId: string): Promise<TraceInfo> {
    const url = GetTraceInfoV3.getEndpoint(this.host, traceId);
    const response = await makeRequest<GetTraceInfoV3.Response>('GET', url, getRequestHeaders(this.token));

    // The V3 API returns a Trace object with trace_info field
    if (response.trace?.trace_info) {
      return TraceInfo.fromJson(response.trace.trace_info);
    }

    throw new Error('Invalid response format: missing trace_info');
  }

  /**
   * Upload trace data to the artifact store.
   */
  async uploadTraceData(traceInfo: TraceInfo, traceData: TraceData): Promise<void> {
    await this.artifactsClient.uploadTraceData(traceInfo, traceData);
  }
}
