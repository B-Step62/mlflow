import { useMemo } from 'react';
import { useQuery } from '../../../../common/utils/reactQueryHooks';
import { fetchOrFail, getAjaxUrl } from '../../../../common/utils/FetchUtils';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanFilterKey,
  SpanType,
  TIME_BUCKET_DIMENSION_KEY,
  createSpanFilter,
} from '@databricks/web-shared/model-trace-explorer';
import type { QueryTraceMetricsRequest, QueryTraceMetricsResponse } from '@databricks/web-shared/model-trace-explorer';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_SECONDS = 86400;

async function fetchAllExperimentIds(): Promise<string[]> {
  const response = await fetchOrFail(getAjaxUrl('ajax-api/2.0/mlflow/experiments/search'), {
    method: 'GET',
  });
  const data = await response.json();
  return (data.experiments ?? []).map((e: { experiment_id: string }) => e.experiment_id);
}

async function queryTraceMetrics(params: QueryTraceMetricsRequest): Promise<QueryTraceMetricsResponse> {
  const response = await fetchOrFail(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

export interface SkillUsageDataPoint {
  timestamp: string;
  count: number;
}

export interface UseSkillUsageDataResult {
  chartData: SkillUsageDataPoint[];
  totalCount: number;
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
}

export function useSkillUsageData(skillName: string): UseSkillUsageDataResult {
  const endTimeMs = useMemo(() => Date.now(), []);
  const startTimeMs = endTimeMs - THIRTY_DAYS_MS;

  const { data, isLoading, error } = useQuery({
    queryKey: ['skillUsage', skillName, startTimeMs, endTimeMs],
    queryFn: async () => {
      const experimentIds = await fetchAllExperimentIds();
      if (experimentIds.length === 0) return { data_points: [] };

      return queryTraceMetrics({
        experiment_ids: experimentIds,
        view_type: MetricViewType.SPANS,
        metric_name: SpanMetricKey.SPAN_COUNT,
        aggregations: [{ aggregation_type: AggregationType.COUNT }],
        filters: [
          createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL),
          createSpanFilter(SpanFilterKey.NAME, `tool_Skill:${skillName}`),
        ],
        time_interval_seconds: ONE_DAY_SECONDS,
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
      });
    },
    enabled: Boolean(skillName),
    refetchOnWindowFocus: false,
  });

  const { chartData, totalCount } = useMemo(() => {
    const dataPoints = data?.data_points ?? [];
    const dataByTimestamp = new Map<number, number>();
    let total = 0;

    for (const dp of dataPoints) {
      const timeBucket = dp.dimensions?.[TIME_BUCKET_DIMENSION_KEY];
      const count = dp.values?.[AggregationType.COUNT] || 0;
      if (!timeBucket) continue;

      const timestampMs = new Date(timeBucket).getTime();
      dataByTimestamp.set(timestampMs, (dataByTimestamp.get(timestampMs) || 0) + count);
      total += count;
    }

    // Build daily buckets for the 30-day range
    const result: SkillUsageDataPoint[] = [];
    for (let ts = startTimeMs; ts <= endTimeMs; ts += ONE_DAY_SECONDS * 1000) {
      const dayStart = new Date(ts);
      dayStart.setHours(0, 0, 0, 0);
      const dayMs = dayStart.getTime();
      result.push({
        timestamp: dayStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        count: dataByTimestamp.get(dayMs) || 0,
      });
    }

    return { chartData: result, totalCount: total };
  }, [data?.data_points, startTimeMs, endTimeMs]);

  return {
    chartData,
    totalCount,
    isLoading,
    error,
    hasData: totalCount > 0,
  };
}
