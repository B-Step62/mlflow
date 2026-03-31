import { useMemo } from 'react';
import { useQuery } from '../../../../common/utils/reactQueryHooks';
import { fetchOrFail, getAjaxUrl } from '../../../../common/utils/FetchUtils';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanFilterKey,
  SpanType,
  SKILL_NAME_DIMENSION,
  TIME_BUCKET_DIMENSION_KEY,
  createSpanFilter,
} from '@databricks/web-shared/model-trace-explorer';
import type { QueryTraceMetricsRequest, QueryTraceMetricsResponse } from '@databricks/web-shared/model-trace-explorer';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_SECONDS = 86400;

async function queryTraceMetrics(params: QueryTraceMetricsRequest): Promise<QueryTraceMetricsResponse> {
  const response = await fetchOrFail(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

export interface AllSkillsUsageDataPoint {
  timestamp: string;
  [skillName: string]: string | number;
}

export interface UseAllSkillsUsageDataResult {
  chartData: AllSkillsUsageDataPoint[];
  skillNames: string[];
  totalCount: number;
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
}

export function useAllSkillsUsageData(): UseAllSkillsUsageDataResult {
  const endTimeMs = useMemo(() => Date.now(), []);
  const startTimeMs = endTimeMs - THIRTY_DAYS_MS;

  const { data, isLoading, error } = useQuery({
    queryKey: ['allSkillsUsage', startTimeMs, endTimeMs],
    queryFn: async () =>
      queryTraceMetrics({
        experiment_ids: [],
        view_type: MetricViewType.SPANS,
        metric_name: SpanMetricKey.SPAN_COUNT,
        aggregations: [{ aggregation_type: AggregationType.COUNT }],
        filters: [createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL)],
        dimensions: [SKILL_NAME_DIMENSION],
        time_interval_seconds: ONE_DAY_SECONDS,
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
      }),
    refetchOnWindowFocus: false,
  });

  const { chartData, skillNames, totalCount } = useMemo(() => {
    const dataPoints = data?.data_points ?? [];
    const skillSet = new Set<string>();
    const dataByTimestamp = new Map<number, Map<string, number>>();
    let total = 0;

    for (const dp of dataPoints) {
      const skillName = dp.dimensions?.[SKILL_NAME_DIMENSION];
      const timeBucket = dp.dimensions?.[TIME_BUCKET_DIMENSION_KEY];
      const count = dp.values?.[AggregationType.COUNT] || 0;
      if (!skillName || !timeBucket) continue;

      skillSet.add(skillName);
      total += count;

      const timestampMs = new Date(timeBucket).getTime();
      let skillCounts = dataByTimestamp.get(timestampMs);
      if (!skillCounts) {
        skillCounts = new Map<string, number>();
        dataByTimestamp.set(timestampMs, skillCounts);
      }
      skillCounts.set(skillName, (skillCounts.get(skillName) || 0) + count);
    }

    const sortedSkillNames = Array.from(skillSet).sort();

    // Build daily UTC-aligned buckets
    const utcDayMs = ONE_DAY_SECONDS * 1000;
    const firstBucket = Math.floor(startTimeMs / utcDayMs) * utcDayMs;
    const result: AllSkillsUsageDataPoint[] = [];
    for (let ts = firstBucket; ts <= endTimeMs; ts += utcDayMs) {
      const date = new Date(ts);
      const skillCounts = dataByTimestamp.get(ts);
      const point: AllSkillsUsageDataPoint = {
        timestamp: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
      for (const name of sortedSkillNames) {
        point[name] = skillCounts?.get(name) || 0;
      }
      result.push(point);
    }

    return { chartData: result, skillNames: sortedSkillNames, totalCount: total };
  }, [data?.data_points, startTimeMs, endTimeMs]);

  return {
    chartData,
    skillNames,
    totalCount,
    isLoading,
    error,
    hasData: skillNames.length > 0,
  };
}
