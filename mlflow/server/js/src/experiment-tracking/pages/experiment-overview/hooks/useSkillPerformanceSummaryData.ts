import { useMemo } from 'react';
import {
  MetricViewType,
  AggregationType,
  SpanMetricKey,
  SpanFilterKey,
  SpanType,
  SpanStatus,
  SpanDimensionKey,
  SKILL_NAME_DIMENSION,
  createSpanFilter,
} from '@databricks/web-shared/model-trace-explorer';
import { useTraceMetricsQuery } from './useTraceMetricsQuery';
import { useOverviewChartContext } from '../OverviewChartContext';

export interface SkillPerformanceData {
  skillName: string;
  totalCalls: number;
  successRate: number;
  avgLatency: number;
}

export interface UseSkillPerformanceSummaryDataResult {
  skillsData: SkillPerformanceData[];
  isLoading: boolean;
  error: unknown;
  hasData: boolean;
}

export function useSkillPerformanceSummaryData(): UseSkillPerformanceSummaryDataResult {
  const { experimentIds, startTimeMs, endTimeMs } = useOverviewChartContext();
  const toolFilter = useMemo(() => [createSpanFilter(SpanFilterKey.TYPE, SpanType.TOOL)], []);

  const {
    data: countData,
    isLoading: isLoadingCounts,
    error: countsError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.SPAN_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    filters: toolFilter,
    dimensions: [SKILL_NAME_DIMENSION, SpanDimensionKey.SPAN_STATUS],
  });

  const {
    data: latencyData,
    isLoading: isLoadingLatency,
    error: latencyError,
  } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.SPANS,
    metricName: SpanMetricKey.LATENCY,
    aggregations: [{ aggregation_type: AggregationType.AVG }],
    filters: toolFilter,
    dimensions: [SKILL_NAME_DIMENSION],
  });

  const skillsData = useMemo(() => {
    const skillCountsMap = new Map<string, { total: number; success: number }>();
    const skillLatencyMap = new Map<string, number>();

    if (countData?.data_points) {
      for (const dp of countData.data_points) {
        const skillName = dp.dimensions?.[SKILL_NAME_DIMENSION];
        const status = dp.dimensions?.[SpanDimensionKey.SPAN_STATUS];
        const count = dp.values?.[AggregationType.COUNT] || 0;

        if (!skillName) continue;

        const existing = skillCountsMap.get(skillName) || { total: 0, success: 0 };
        existing.total += count;
        if (status === SpanStatus.OK) {
          existing.success += count;
        }
        skillCountsMap.set(skillName, existing);
      }
    }

    if (latencyData?.data_points) {
      for (const dp of latencyData.data_points) {
        const skillName = dp.dimensions?.[SKILL_NAME_DIMENSION];
        const avgLatency = dp.values?.[AggregationType.AVG];

        if (skillName && avgLatency !== undefined) {
          skillLatencyMap.set(skillName, avgLatency);
        }
      }
    }

    const result: SkillPerformanceData[] = [];
    for (const [skillName, counts] of skillCountsMap.entries()) {
      const successRate = counts.total > 0 ? (counts.success / counts.total) * 100 : 0;
      result.push({
        skillName,
        totalCalls: counts.total,
        successRate,
        avgLatency: skillLatencyMap.get(skillName) || 0,
      });
    }

    result.sort((a, b) => b.totalCalls - a.totalCalls);
    return result;
  }, [countData?.data_points, latencyData?.data_points]);

  const isLoading = isLoadingCounts || isLoadingLatency;
  const error = countsError || latencyError;

  return {
    skillsData,
    isLoading,
    error,
    hasData: skillsData.length > 0,
  };
}
