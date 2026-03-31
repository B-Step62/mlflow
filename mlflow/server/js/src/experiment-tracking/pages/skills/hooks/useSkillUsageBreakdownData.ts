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
  createSpanFilter,
} from '@databricks/web-shared/model-trace-explorer';
import type { QueryTraceMetricsRequest, QueryTraceMetricsResponse } from '@databricks/web-shared/model-trace-explorer';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function queryTraceMetrics(params: QueryTraceMetricsRequest): Promise<QueryTraceMetricsResponse> {
  const response = await fetchOrFail(getAjaxUrl('ajax-api/3.0/mlflow/traces/metrics'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

export interface SkillUsageBreakdown {
  skillName: string;
  count: number;
}

export interface UseSkillUsageBreakdownDataResult {
  breakdown: SkillUsageBreakdown[];
  totalCount: number;
  isLoading: boolean;
  error: unknown;
}

export function useSkillUsageBreakdownData(): UseSkillUsageBreakdownDataResult {
  const endTimeMs = useMemo(() => Date.now(), []);
  const startTimeMs = endTimeMs - THIRTY_DAYS_MS;

  const { data, isLoading, error } = useQuery({
    queryKey: ['skillUsageBreakdown', startTimeMs, endTimeMs],
    queryFn: async () =>
      queryTraceMetrics({
        experiment_ids: [],
        view_type: MetricViewType.SPANS,
        metric_name: SpanMetricKey.SPAN_COUNT,
        aggregations: [{ aggregation_type: AggregationType.COUNT }],
        filters: [createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL)],
        dimensions: [SKILL_NAME_DIMENSION],
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
      }),
    refetchOnWindowFocus: false,
  });

  const { breakdown, totalCount } = useMemo(() => {
    const dataPoints = data?.data_points ?? [];
    const skillPrefix = 'tool_Skill:';
    const result: SkillUsageBreakdown[] = [];
    let total = 0;

    for (const dp of dataPoints) {
      const skillName = dp.dimensions?.[SKILL_NAME_DIMENSION];
      const count = dp.values?.[AggregationType.COUNT] || 0;
      if (!skillName) continue;
      result.push({ skillName, count });
      total += count;
    }

    result.sort((a, b) => b.count - a.count);
    return { breakdown: result, totalCount: total };
  }, [data?.data_points]);

  return { breakdown, totalCount, isLoading, error };
}
