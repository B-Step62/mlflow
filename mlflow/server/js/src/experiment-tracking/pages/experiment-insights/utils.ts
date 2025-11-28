import type { KeyValueEntity } from '@mlflow/mlflow/src/common/types';
import type { ModelTraceInfo } from '@databricks/web-shared/model-trace-explorer';

export const INSIGHT_PROMPT_TAG = 'mlflow.insights.prompt';
export const INSIGHT_OVERVIEW_TAG = 'mlflow.insights.overview';
export const INSIGHT_CLUSTER_ID_TAG = 'mlflow.insights.cluster_id';
export const INSIGHT_TRACE_COUNT_TAG = 'mlflow.insights.trace_count';
export const INSIGHT_FILTERS_TAG = 'mlflow.insights.filters';
export const INSIGHT_CLUSTER_ARTIFACT_PATH = 'mlflow_insights_cluster_details.json';
export const INSIGHT_REPORT_ARTIFACT_PATH = 'insight_report.json';
export const INSIGHT_RUN_TYPE_TAG = 'mlflow.runType';
export const INSIGHT_RUN_TYPE_VALUE = 'INSIGHTS';
export const INSIGHT_SUMMARY_ASSESSMENT_NAME = 'summary';

export type InsightClusterNode = {
  id: string;
  title: string;
  summary?: string;
  traceIds: string[];
  children: InsightClusterNode[];
  metadata?: Record<string, any>;
};

export type NormalizedClusters = {
  overview?: string;
  instruction?: string;
  clusters: InsightClusterNode[];
};

export type InsightTrace = {
  traceId: string;
  summary?: string;
  clusterId?: string;
  timestampMs?: number;
  trace: ModelTraceInfo;
};

const stringCandidates = (values: any[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const arrayOfStringsCandidate = (values: any[]): string[] => {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
  }
  return [];
};

const guessChildrenArray = (node: any): any[] => {
  if (!node || typeof node !== 'object') {
    return [];
  }
  if (Array.isArray(node.children)) {
    return node.children;
  }
  if (Array.isArray(node.child_clusters)) {
    return node.child_clusters;
  }
  if (Array.isArray(node.childClusters)) {
    return node.childClusters;
  }
  if (Array.isArray(node.subclusters)) {
    return node.subclusters;
  }
  if (Array.isArray(node.subClusters)) {
    return node.subClusters;
  }
  if (Array.isArray(node.clusters)) {
    return node.clusters;
  }
  return [];
};

const normalizeClusterNode = (node: any, fallbackId: string): InsightClusterNode => {
  const id = String(
    node?.id ?? node?.cluster_id ?? node?.clusterId ?? node?.name ?? node?.label ?? node?.title ?? fallbackId,
  );
  const title = String(
    node?.label ?? node?.title ?? node?.name ?? node?.summary_title ?? node?.cluster_label ?? `Cluster ${fallbackId}`,
  );
  const summary = stringCandidates([
    node?.summary,
    node?.description,
    node?.overview,
    node?.insight_summary,
    node?.cluster_summary,
  ]);
  const traceIds = arrayOfStringsCandidate([node?.trace_ids, node?.traceIds, node?.traces, node?.request_ids]);
  const children = guessChildrenArray(node).map((child, index) => normalizeClusterNode(child, `${id}-${index + 1}`));

  return {
    id,
    title,
    summary,
    traceIds,
    children,
    metadata: typeof node === 'object' && node ? node : undefined,
  };
};

const findClusterArray = (raw: any): any[] => {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  const candidates = [raw.clusters, raw.cluster_tree, raw.clusterTree, raw.children, raw.nodes];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
};

export const normalizeInsightClusters = (raw: any): NormalizedClusters => {
  const overview = stringCandidates([raw?.overview, raw?.summary, raw?.insight_overview]);
  const instruction = stringCandidates([raw?.instruction, raw?.prompt]);
  const clusterArray = findClusterArray(raw);
  const clusters = clusterArray.map((node: any, index: number) => normalizeClusterNode(node, `cluster-${index + 1}`));
  return {
    overview,
    instruction,
    clusters,
  };
};

export const toTagValueMap = (tags: KeyValueEntity[] = []): Record<string, string> => {
  return tags.reduce<Record<string, string>>((acc, { key, value }) => {
    acc[key] = value;
    return acc;
  }, {});
};

export const parseInsightFiltersTag = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
    if (typeof parsed === 'string' && parsed.trim().length > 0) {
      return [parsed.trim()];
    }
  } catch {
    // fall through to string parsing
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const getTraceTagValue = (trace: ModelTraceInfo, tagName: string): string | undefined => {
  if (Array.isArray(trace.tags)) {
    return trace.tags.find((tag) => tag.key === tagName)?.value;
  }
  return trace.tags?.[tagName];
};

const getAssessmentValue = (assessment: any): string | undefined => {
  const feedbackValue = assessment?.feedback?.value;
  if (typeof feedbackValue === 'string' && feedbackValue.trim().length > 0) {
    return feedbackValue;
  }
  if (Array.isArray(feedbackValue)) {
    return feedbackValue.map((item) => String(item)).join(', ');
  }
  const expectationValue = assessment?.expectation?.value ?? assessment?.expectation?.serialized_value?.value;
  if (typeof expectationValue === 'string' && expectationValue.trim().length > 0) {
    return expectationValue;
  }
  return undefined;
};

export const extractTraceSummary = (trace: ModelTraceInfo | (ModelTraceInfo & { assessments?: any[] })): string | undefined => {
  const assessments = (trace as any)?.assessments ?? (trace as any)?.info?.assessments;
  if (Array.isArray(assessments)) {
    for (const assessment of assessments) {
      if (
        typeof assessment === 'object' &&
        assessment &&
        (assessment.assessment_name === INSIGHT_SUMMARY_ASSESSMENT_NAME || assessment.assessment_name === 'insight.summary')
      ) {
        const value = getAssessmentValue(assessment);
        if (value) {
          return value;
        }
      }
    }
  }
  const tagSummary = getTraceTagValue(trace, 'summary') ?? getTraceTagValue(trace, 'insight.summary');
  if (tagSummary && tagSummary.trim().length > 0) {
    return tagSummary;
  }
  const metadataSummary = trace.request_metadata?.find(({ key }) => key === 'summary' || key === 'insight.summary')?.value;
  if (metadataSummary && metadataSummary.trim().length > 0) {
    return metadataSummary;
  }
  return undefined;
};

export const flattenClusterNodes = (nodes: InsightClusterNode[]): InsightClusterNode[] => {
  const flat: InsightClusterNode[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const current = stack.shift();
    if (!current) {
      continue;
    }
    flat.push(current);
    if (current.children?.length) {
      stack.unshift(...current.children);
    }
  }
  return flat;
};

export const buildClusterLookup = (nodes: InsightClusterNode[]): Map<string, InsightClusterNode> => {
  const map = new Map<string, InsightClusterNode>();
  flattenClusterNodes(nodes).forEach((node) => {
    map.set(node.id, node);
  });
  return map;
};

export const groupTracesByCluster = (
  traces: ModelTraceInfo[],
  clusters: InsightClusterNode[],
  clusterIdTag = INSIGHT_CLUSTER_ID_TAG,
) => {
  const clusterLookup = buildClusterLookup(clusters);
  const clusterAssignments = new Map<string, InsightTrace[]>();
  const unclustered: InsightTrace[] = [];

  traces.forEach((trace) => {
    const traceId = trace.request_id;
    if (!traceId) {
      return;
    }
    const clusterId = getTraceTagValue(trace, clusterIdTag);
    const summary = extractTraceSummary(trace);
    const entry: InsightTrace = {
      traceId,
      clusterId,
      summary,
      timestampMs: trace.timestamp_ms,
      trace,
    };
    if (clusterId && clusterLookup.has(clusterId)) {
      const bucket = clusterAssignments.get(clusterId) ?? [];
      bucket.push(entry);
      clusterAssignments.set(clusterId, bucket);
    } else {
      unclustered.push(entry);
    }
  });

  return {
    clusterAssignments,
    clusterLookup,
    unclustered,
  };
};
