import { useMemo } from 'react';
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
import { useTraceMetricsQuery } from './useTraceMetricsQuery';
import { formatTimestampForTraceMetrics } from '../utils/chartUtils';
import { useOverviewChartContext } from '../OverviewChartContext';

export interface SkillUsageDataPoint {
  timestamp: string;
  [skillName: string]: string | number;
}

export interface UseSkillUsageChartDataResult {
  chartData: SkillUsageDataPoint[];
  skillNames: string[];
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
}

export function useSkillUsageChartData(): UseSkillUsageChartDataResult {
  const { experimentIds, startTimeMs, endTimeMs, timeIntervalSeconds, timeBuckets } = useOverviewChartContext();
  const toolFilter = useMemo(() => [createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL)], []);

  const { data, isLoading, error } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.SPAN_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    filters: toolFilter,
    dimensions: [SKILL_NAME_DIMENSION],
    timeIntervalSeconds,
  });

  const { chartData, skillNames } = useMemo(() => {
    const dataPoints = data?.data_points ?? [];
    const skillSet = new Set<string>();
    const dataByTimestamp = new Map<number, Map<string, number>>();

    for (const dp of dataPoints) {
      const skillName = dp.dimensions?.[SKILL_NAME_DIMENSION];
      const timeBucket = dp.dimensions?.[TIME_BUCKET_DIMENSION_KEY];
      const count = dp.values?.[AggregationType.COUNT] || 0;

      if (!skillName || !timeBucket) continue;

      skillSet.add(skillName);

      const timestampMs = new Date(timeBucket).getTime();
      let skillCounts = dataByTimestamp.get(timestampMs);
      if (!skillCounts) {
        skillCounts = new Map<string, number>();
        dataByTimestamp.set(timestampMs, skillCounts);
      }
      skillCounts.set(skillName, count);
    }

    const sortedSkillNames = Array.from(skillSet).sort();

    const chartDataResult = timeBuckets.map((timestampMs) => {
      const skillCounts = dataByTimestamp.get(timestampMs);
      const dataPoint: SkillUsageDataPoint = {
        timestamp: formatTimestampForTraceMetrics(timestampMs, timeIntervalSeconds),
      };

      for (const skillName of sortedSkillNames) {
        dataPoint[skillName] = skillCounts?.get(skillName) || 0;
      }

      return dataPoint;
    });

    return {
      chartData: chartDataResult,
      skillNames: sortedSkillNames,
    };
  }, [data?.data_points, timeBuckets, timeIntervalSeconds]);

  return {
    chartData,
    skillNames,
    isLoading,
    error,
    hasData: skillNames.length > 0,
  };
}
