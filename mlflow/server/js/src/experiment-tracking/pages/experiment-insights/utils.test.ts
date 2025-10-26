import type { ModelTraceInfo } from '@databricks/web-shared/model-trace-explorer';
import type { KeyValueEntity } from '@mlflow/mlflow/src/common/types';
import {
  INSIGHT_CLUSTER_ID_TAG,
  INSIGHT_PROMPT_TAG,
  InsightClusterNode,
  buildClusterLookup,
  extractTraceSummary,
  getTraceTagValue,
  groupTracesByCluster,
  normalizeInsightClusters,
  toTagValueMap,
} from './utils';

describe('experiment insight utils', () => {
  test('normalizeInsightClusters extracts overview and nodes', () => {
    const raw = {
      overview: 'High level insight',
      prompt: 'What are users asking?',
      clusters: [
        {
          id: 'c1',
          label: 'Billing',
          summary: 'Billing related questions',
          trace_ids: ['t1', 't2'],
          children: [
            {
              id: 'c1-1',
              title: 'Invoices',
              traceIds: ['t3'],
            },
          ],
        },
      ],
    };

    const normalized = normalizeInsightClusters(raw);
    expect(normalized.overview).toBe('High level insight');
    expect(normalized.instruction).toBe('What are users asking?');
    expect(normalized.clusters).toHaveLength(1);
    expect(normalized.clusters[0]).toMatchObject({ id: 'c1', title: 'Billing', summary: 'Billing related questions' });
    expect(normalized.clusters[0].traceIds).toEqual(['t1', 't2']);
    expect(normalized.clusters[0].children[0]).toMatchObject({ id: 'c1-1', title: 'Invoices' });
  });

  test('toTagValueMap converts array to map', () => {
    const tags: KeyValueEntity[] = [
      { key: INSIGHT_PROMPT_TAG, value: 'Prompt here' },
      { key: 'mlflow.other', value: 'value' },
    ];
    const map = toTagValueMap(tags);
    expect(map[INSIGHT_PROMPT_TAG]).toBe('Prompt here');
    expect(map['mlflow.other']).toBe('value');
  });

  test('getTraceTagValue supports array and map structures', () => {
    const arrayTrace = { tags: [{ key: INSIGHT_CLUSTER_ID_TAG, value: 'cluster-1' }] } as ModelTraceInfo;
    const mapTrace = { tags: { [INSIGHT_CLUSTER_ID_TAG]: 'cluster-2' } } as unknown as ModelTraceInfo;

    expect(getTraceTagValue(arrayTrace, INSIGHT_CLUSTER_ID_TAG)).toBe('cluster-1');
    expect(getTraceTagValue(mapTrace, INSIGHT_CLUSTER_ID_TAG)).toBe('cluster-2');
  });

  test('extractTraceSummary prefers assessments', () => {
    const trace = {
      tags: [],
      assessments: [
        {
          assessment_name: 'summary',
          feedback: {
            value: 'Users ask about pricing tiers',
          },
        },
      ],
    } as unknown as ModelTraceInfo;

    expect(extractTraceSummary(trace)).toBe('Users ask about pricing tiers');
  });

  test('extractTraceSummary falls back to tags and metadata', () => {
    const traceWithTag = {
      tags: [{ key: 'summary', value: 'Tag summary' }],
    } as unknown as ModelTraceInfo;
    expect(extractTraceSummary(traceWithTag)).toBe('Tag summary');

    const traceWithMetadata = {
      tags: [],
      request_metadata: [{ key: 'summary', value: 'Metadata summary' }],
    } as unknown as ModelTraceInfo;
    expect(extractTraceSummary(traceWithMetadata)).toBe('Metadata summary');
  });

  test('groupTracesByCluster buckets traces and highlights unclustered items', () => {
    const clusters: InsightClusterNode[] = normalizeInsightClusters({
      clusters: [
        { id: 'c1', label: 'Cluster 1' },
        { id: 'c2', label: 'Cluster 2' },
      ],
    }).clusters;

    const traces: ModelTraceInfo[] = [
      { request_id: 't1', tags: [{ key: INSIGHT_CLUSTER_ID_TAG, value: 'c1' }] } as unknown as ModelTraceInfo,
      { request_id: 't2', tags: [{ key: INSIGHT_CLUSTER_ID_TAG, value: 'missing' }] } as unknown as ModelTraceInfo,
      { request_id: 't3', tags: [] } as unknown as ModelTraceInfo,
    ];

    const { clusterAssignments, unclustered, clusterLookup } = groupTracesByCluster(traces, clusters);
    expect(buildClusterLookup(clusters).size).toBe(clusterLookup.size);
    expect(clusterAssignments.get('c1')).toHaveLength(1);
    expect(unclustered.map((trace) => trace.traceId)).toEqual(['t2', 't3']);
  });
});
