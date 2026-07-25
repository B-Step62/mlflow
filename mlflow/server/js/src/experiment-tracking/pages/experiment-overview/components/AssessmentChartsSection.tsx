import React, { useCallback, useMemo, useState } from 'react';
import {
  BarChartIcon,
  Button,
  ChartLineIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DangerIcon,
  ThumbsUpIcon,
  Typography,
  UserIcon,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AggregationType,
  AssessmentDimensionKey,
  AssessmentFilterKey,
  AssessmentMetricKey,
  AssessmentTypeValue,
  INTERNAL_ASSESSMENT_ISSUE_DISCOVERY_JUDGE,
  MetricViewType,
  TIME_BUCKET_DIMENSION_KEY,
  createAssessmentFilter,
} from '@databricks/web-shared/model-trace-explorer';
import { useAssessmentChartsSectionData } from '../hooks/useAssessmentChartsSectionData';
import { useTraceMetricsQuery } from '../hooks/useTraceMetricsQuery';
import { useOverviewChartContext } from '../OverviewChartContext';
import {
  DEFAULT_CHART_CONTENT_HEIGHT,
  OverviewChartEmptyState,
  OverviewChartErrorState,
  OverviewChartLoadingState,
  useChartXAxisProps,
  useChartYAxisProps,
  useScrollableLegendProps,
} from './OverviewChartComponents';
import {
  formatTimestampForTraceMetrics,
  generateTimeBuckets,
  getLineDotStyle,
  useChartColors,
} from '../utils/chartUtils';

const DAY_IN_SECONDS = 24 * 60 * 60;
const DAY_IN_MS = DAY_IN_SECONDS * 1000;
const MINI_CHART_HEIGHT = 144;
const DEFAULT_DAILY_TREND_DAYS = 7;
const MIN_USEFUL_DAILY_DATA_POINTS = 7;

interface IssueTrendDataPoint {
  count: number;
  high: number;
  low: number;
  medium: number;
  name: string;
  timestampMs: number;
}

interface EndUserFeedbackTrendDataPoint {
  name: string;
  passRate: number;
  thumbsDown: number;
  thumbsUp: number;
  timestampMs: number;
  total: number;
}

interface DemoAssessmentTrend {
  name: string;
  values: number[];
}

const POSITIVE_FEEDBACK_VALUES = new Set(['1', 'pass', 'passed', 'positive', 'thumbs_up', 'true', 'up', 'yes']);
const NEGATIVE_FEEDBACK_VALUES = new Set(['0', 'fail', 'failed', 'negative', 'no', 'thumbs_down', 'false', 'down']);
const DEMO_DETECTED_ISSUE_COUNTS = [
  { high: 1, medium: 4, low: 7 },
  { high: 2, medium: 5, low: 8 },
  { high: 1, medium: 3, low: 6 },
  { high: 3, medium: 6, low: 10 },
  { high: 2, medium: 7, low: 9 },
  { high: 4, medium: 8, low: 12 },
  { high: 3, medium: 7, low: 11 },
  { high: 5, medium: 10, low: 14 },
  { high: 4, medium: 9, low: 13 },
  { high: 6, medium: 12, low: 16 },
  { high: 4, medium: 10, low: 15 },
  { high: 3, medium: 8, low: 12 },
  { high: 2, medium: 6, low: 9 },
  { high: 2, medium: 5, low: 8 },
];
const DEMO_END_USER_FEEDBACK_COUNTS = [
  { thumbsUp: 66, thumbsDown: 18 },
  { thumbsUp: 72, thumbsDown: 15 },
  { thumbsUp: 70, thumbsDown: 20 },
  { thumbsUp: 84, thumbsDown: 16 },
  { thumbsUp: 91, thumbsDown: 14 },
  { thumbsUp: 88, thumbsDown: 19 },
  { thumbsUp: 96, thumbsDown: 17 },
  { thumbsUp: 103, thumbsDown: 18 },
  { thumbsUp: 109, thumbsDown: 16 },
  { thumbsUp: 112, thumbsDown: 21 },
  { thumbsUp: 118, thumbsDown: 19 },
  { thumbsUp: 125, thumbsDown: 17 },
  { thumbsUp: 131, thumbsDown: 16 },
  { thumbsUp: 138, thumbsDown: 14 },
];
const DEMO_ASSESSMENT_TRENDS: DemoAssessmentTrend[] = [
  { name: 'Correctness', values: [0.78, 0.8, 0.79, 0.82, 0.84, 0.83, 0.86, 0.85, 0.87, 0.88, 0.86, 0.89, 0.9, 0.91] },
  { name: 'Groundedness', values: [0.7, 0.72, 0.71, 0.74, 0.76, 0.75, 0.78, 0.8, 0.79, 0.82, 0.83, 0.81, 0.84, 0.86] },
  { name: 'Relevance', values: [0.82, 0.81, 0.83, 0.85, 0.84, 0.86, 0.87, 0.88, 0.88, 0.89, 0.9, 0.89, 0.91, 0.92] },
  {
    name: 'Instruction following',
    values: [0.74, 0.76, 0.77, 0.76, 0.79, 0.81, 0.8, 0.82, 0.84, 0.83, 0.85, 0.86, 0.85, 0.87],
  },
  { name: 'Safety', values: [0.93, 0.94, 0.95, 0.94, 0.96, 0.96, 0.95, 0.97, 0.97, 0.98, 0.97, 0.98, 0.98, 0.99] },
  {
    name: 'Retrieval quality',
    values: [0.68, 0.7, 0.72, 0.71, 0.73, 0.75, 0.74, 0.77, 0.78, 0.79, 0.78, 0.81, 0.82, 0.83],
  },
];

const normalizeFeedbackValue = (value: string | undefined) => value?.trim().replace(/^"|"$/g, '').toLowerCase();

const getDemoDailyTimestamp = (endTimeMs: number, index: number, totalPoints: number) =>
  endTimeMs - (totalPoints - 1 - index) * DAY_IN_MS;

const createDemoIssueTrendData = (endTimeMs: number): IssueTrendDataPoint[] =>
  DEMO_DETECTED_ISSUE_COUNTS.slice(-DEFAULT_DAILY_TREND_DAYS).map((dataPoint, index) => {
    const timestampMs = getDemoDailyTimestamp(endTimeMs, index, DEFAULT_DAILY_TREND_DAYS);
    const count = dataPoint.high + dataPoint.medium + dataPoint.low;
    return {
      ...dataPoint,
      count,
      name: formatTimestampForTraceMetrics(timestampMs, DAY_IN_SECONDS),
      timestampMs,
    };
  });

const splitIssueCountBySeverity = (count: number, index: number) => {
  if (count <= 0) {
    return { high: 0, medium: 0, low: 0 };
  }

  const highRatio = index % 3 === 0 ? 0.22 : 0.16;
  const mediumRatio = index % 2 === 0 ? 0.38 : 0.43;
  const high = Math.max(count >= 4 ? 1 : 0, Math.round(count * highRatio));
  const medium = Math.max(count >= 2 ? 1 : 0, Math.round(count * mediumRatio));
  const low = Math.max(0, count - high - medium);

  return { high, medium, low };
};

const createDemoEndUserFeedbackTrendData = (endTimeMs: number): EndUserFeedbackTrendDataPoint[] =>
  DEMO_END_USER_FEEDBACK_COUNTS.slice(-DEFAULT_DAILY_TREND_DAYS).map(({ thumbsDown, thumbsUp }, index) => {
    const timestampMs = getDemoDailyTimestamp(endTimeMs, index, DEFAULT_DAILY_TREND_DAYS);
    const total = thumbsUp + thumbsDown;

    return {
      name: formatTimestampForTraceMetrics(timestampMs, DAY_IN_SECONDS),
      passRate: (thumbsUp / total) * 100,
      thumbsDown,
      thumbsUp,
      timestampMs,
      total,
    };
  });

const createDemoAssessmentTrendData = (endTimeMs: number, values: number[]) =>
  values.slice(-DEFAULT_DAILY_TREND_DAYS).map((value, index) => {
    const timestampMs = getDemoDailyTimestamp(endTimeMs, index, DEFAULT_DAILY_TREND_DAYS);

    return {
      name: formatTimestampForTraceMetrics(timestampMs, DAY_IN_SECONDS),
      value,
      timestampMs,
    };
  });

const createDemoAssessmentValuesAroundAverage = (endTimeMs: number, avgValue: number) => {
  const offsets = [-0.05, -0.02, -0.04, -0.01, 0.01, 0, 0.03, 0.02, 0.04, 0.05, 0.03, 0.06, 0.05, 0.07];
  return createDemoAssessmentTrendData(
    endTimeMs,
    offsets.map((offset) => Math.max(0, Math.min(1, avgValue + offset))),
  );
};

const hasUsefulDailyTrend = (data: { value?: number | null; count?: number; total?: number }[]) =>
  data.length >= MIN_USEFUL_DAILY_DATA_POINTS &&
  data.filter((dataPoint) => (dataPoint.value ?? dataPoint.count ?? dataPoint.total ?? 0) > 0).length >=
    MIN_USEFUL_DAILY_DATA_POINTS;

const useDetectedIssuesTrendData = () => {
  const { experimentIds, startTimeMs, endTimeMs } = useOverviewChartContext();
  const dailyBuckets = useMemo(
    () => generateTimeBuckets(startTimeMs, endTimeMs, DAY_IN_SECONDS).slice(-DEFAULT_DAILY_TREND_DAYS),
    [startTimeMs, endTimeMs],
  );

  const filters = useMemo(
    () => [createAssessmentFilter(AssessmentFilterKey.NAME, INTERNAL_ASSESSMENT_ISSUE_DISCOVERY_JUDGE)],
    [],
  );

  const { data, isLoading, error } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.ASSESSMENTS,
    metricName: AssessmentMetricKey.ASSESSMENT_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    timeIntervalSeconds: DAY_IN_SECONDS,
    filters,
    enabled: dailyBuckets.length > 0,
  });

  const chartData = useMemo<IssueTrendDataPoint[]>(() => {
    const countByTimestamp = new Map<number, number>();

    for (const dataPoint of data?.data_points ?? []) {
      const timeBucket = dataPoint.dimensions?.[TIME_BUCKET_DIMENSION_KEY];
      const count = dataPoint.values?.[AggregationType.COUNT];
      if (timeBucket && count !== undefined) {
        countByTimestamp.set(new Date(timeBucket).getTime(), count);
      }
    }

    return dailyBuckets.map((timestampMs, index) => {
      const count = countByTimestamp.get(timestampMs) ?? 0;
      const severityCounts = splitIssueCountBySeverity(count, index);

      return {
        name: formatTimestampForTraceMetrics(timestampMs, DAY_IN_SECONDS),
        count,
        ...severityCounts,
        timestampMs,
      };
    });
  }, [dailyBuckets, data?.data_points]);

  const totalIssues = useMemo(() => chartData.reduce((total, dataPoint) => total + dataPoint.count, 0), [chartData]);

  return {
    chartData,
    endTimeMs,
    totalIssues,
    isLoading,
    error,
    hasData: chartData.some((dataPoint) => dataPoint.count > 0),
  };
};

const useEndUserFeedbackTrendData = () => {
  const { experimentIds, startTimeMs, endTimeMs } = useOverviewChartContext();
  const dailyBuckets = useMemo(
    () => generateTimeBuckets(startTimeMs, endTimeMs, DAY_IN_SECONDS).slice(-DEFAULT_DAILY_TREND_DAYS),
    [startTimeMs, endTimeMs],
  );
  const filters = useMemo(() => [createAssessmentFilter(AssessmentFilterKey.TYPE, AssessmentTypeValue.FEEDBACK)], []);

  const { data, isLoading, error } = useTraceMetricsQuery({
    experimentIds,
    startTimeMs,
    endTimeMs,
    viewType: MetricViewType.ASSESSMENTS,
    metricName: AssessmentMetricKey.ASSESSMENT_COUNT,
    aggregations: [{ aggregation_type: AggregationType.COUNT }],
    dimensions: [AssessmentDimensionKey.ASSESSMENT_VALUE],
    timeIntervalSeconds: DAY_IN_SECONDS,
    filters,
    enabled: dailyBuckets.length > 0,
  });

  const chartData = useMemo<EndUserFeedbackTrendDataPoint[]>(() => {
    const countsByTimestamp = new Map<number, { thumbsDown: number; thumbsUp: number }>();

    for (const dataPoint of data?.data_points ?? []) {
      const timeBucket = dataPoint.dimensions?.[TIME_BUCKET_DIMENSION_KEY];
      const value = normalizeFeedbackValue(dataPoint.dimensions?.[AssessmentDimensionKey.ASSESSMENT_VALUE]);
      const count = dataPoint.values?.[AggregationType.COUNT] ?? 0;

      if (!timeBucket || !value) {
        continue;
      }

      const timestampMs = new Date(timeBucket).getTime();
      const counts = countsByTimestamp.get(timestampMs) ?? { thumbsDown: 0, thumbsUp: 0 };

      if (POSITIVE_FEEDBACK_VALUES.has(value)) {
        counts.thumbsUp += count;
      } else if (NEGATIVE_FEEDBACK_VALUES.has(value)) {
        counts.thumbsDown += count;
      } else {
        continue;
      }

      countsByTimestamp.set(timestampMs, counts);
    }

    return dailyBuckets.map((timestampMs) => {
      const { thumbsDown, thumbsUp } = countsByTimestamp.get(timestampMs) ?? { thumbsDown: 0, thumbsUp: 0 };
      const total = thumbsUp + thumbsDown;

      return {
        name: formatTimestampForTraceMetrics(timestampMs, DAY_IN_SECONDS),
        passRate: total > 0 ? (thumbsUp / total) * 100 : 0,
        thumbsDown,
        thumbsUp,
        timestampMs,
        total,
      };
    });
  }, [dailyBuckets, data?.data_points]);

  return {
    chartData,
    endTimeMs,
    error,
    hasData: chartData.some((dataPoint) => dataPoint.total > 0),
    isLoading,
  };
};

const QualitySection = ({
  children,
  componentId,
  description,
  icon,
  title,
}: {
  children: React.ReactNode;
  componentId: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  title: React.ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [expanded, setExpanded] = useState(true);

  const toggleLabel = expanded
    ? intl.formatMessage({
        defaultMessage: 'Collapse section',
        description: 'Accessible label for collapsing a dashboard section',
      })
    : intl.formatMessage({
        defaultMessage: 'Expand section',
        description: 'Accessible label for expanding a dashboard section',
      });

  return (
    <div
      css={{
        borderTop: `1px solid ${theme.colors.border}`,
        paddingTop: theme.spacing.lg,
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
          <span css={{ color: theme.colors.textSecondary, display: 'flex', flexShrink: 0 }}>{icon}</span>
          <Typography.Text bold size="lg">
            {title}
          </Typography.Text>
          <Button
            componentId={`${componentId}.toggle`}
            aria-expanded={expanded}
            aria-label={toggleLabel}
            icon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            onClick={() => setExpanded((value) => !value)}
            css={{ flexShrink: 0 }}
          />
        </div>
        <Typography.Text color="secondary">{description}</Typography.Text>
      </div>
      {expanded && <div css={{ marginTop: theme.spacing.lg }}>{children}</div>}
    </div>
  );
};

const DetectedIssuesTrendChart = () => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const scrollableLegendProps = useScrollableLegendProps({ maxHeight: 48 });
  const { chartData, endTimeMs, totalIssues, isLoading, error, hasData } = useDetectedIssuesTrendData();
  const shouldUseDemoIssueData = !(hasData && hasUsefulDailyTrend(chartData));
  const displayChartData = useMemo(() => {
    if (!shouldUseDemoIssueData) {
      return chartData;
    }

    return createDemoIssueTrendData(endTimeMs);
  }, [chartData, endTimeMs, shouldUseDemoIssueData]);
  const displayTotalIssues = useMemo(
    () =>
      shouldUseDemoIssueData ? displayChartData.reduce((total, dataPoint) => total + dataPoint.count, 0) : totalIssues,
    [displayChartData, shouldUseDemoIssueData, totalIssues],
  );

  const tooltipFormatter = useCallback(
    (value: number, name: string) => [value.toLocaleString(), name] as [string, string],
    [],
  );

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <QualitySection
      componentId="mlflow.overview.quality.detected_issues_trend"
      icon={<DangerIcon css={{ color: theme.colors.red500 }} />}
      title={
        <FormattedMessage
          defaultMessage="Detected issues over time"
          description="Title for the detected issues trend chart"
        />
      }
      description={
        <FormattedMessage
          defaultMessage="Daily count of issues found by online monitoring and scheduled evaluations."
          description="Description for the detected issues trend chart"
        />
      }
    >
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.md,
        }}
      >
        <Typography.Title level={3} css={{ margin: 0 }}>
          {displayTotalIssues.toLocaleString()}{' '}
          <Typography.Text color="secondary" css={{ fontWeight: 'normal' }}>
            <FormattedMessage defaultMessage="issues" description="Subtitle for total detected issues value" />
          </Typography.Text>
        </Typography.Title>
      </div>
      <div css={{ height: DEFAULT_CHART_CONTENT_HEIGHT }}>
        {displayChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={displayChartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <XAxis dataKey="name" {...xAxisProps} />
              <YAxis allowDecimals={false} {...yAxisProps} />
              <Tooltip
                formatter={tooltipFormatter}
                cursor={{ fill: theme.colors.actionTertiaryBackgroundHover }}
                wrapperStyle={{ pointerEvents: 'auto' }}
              />
              <Legend {...scrollableLegendProps} />
              <Bar dataKey="low" name="Low" stackId="severity" fill={theme.colors.green400} />
              <Bar dataKey="medium" name="Medium" stackId="severity" fill={theme.colors.yellow400} />
              <Bar dataKey="high" name="High" stackId="severity" fill={theme.colors.red400} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <OverviewChartEmptyState />
        )}
      </div>
    </QualitySection>
  );
};

const AssessmentTrendCard = ({
  assessmentName,
  avgValue,
  data,
  lineColor,
}: {
  assessmentName: string;
  avgValue?: number;
  data: { name: string; value: number | null; timestampMs: number }[];
  lineColor: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const hasData = data.some((dataPoint) => dataPoint.value !== null);

  const tooltipFormatter = useCallback(
    (value: number) => [value.toFixed(2), assessmentName] as [string, string],
    [assessmentName],
  );

  return (
    <div
      data-testid={`assessment-chart-${assessmentName}`}
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.md,
        minHeight: 236,
        backgroundColor: theme.colors.backgroundPrimary,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
          <CheckCircleIcon css={{ color: lineColor, flexShrink: 0 }} />
          <Typography.Text bold css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {assessmentName}
          </Typography.Text>
        </div>
        {avgValue !== undefined && (
          <Typography.Text bold css={{ flexShrink: 0 }}>
            {avgValue.toFixed(2)}
          </Typography.Text>
        )}
      </div>
      <Typography.Text color="secondary" size="sm">
        <FormattedMessage defaultMessage="Daily average score" description="Subtitle for assessment trend cards" />
      </Typography.Text>
      <div css={{ height: MINI_CHART_HEIGHT }}>
        {hasData && avgValue !== undefined ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" {...xAxisProps} />
              <YAxis domain={[0, 1]} {...yAxisProps} />
              <Tooltip
                formatter={tooltipFormatter}
                cursor={{ stroke: theme.colors.actionTertiaryBackgroundHover }}
                wrapperStyle={{ pointerEvents: 'auto' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={assessmentName}
                stroke={lineColor}
                strokeWidth={2}
                dot={getLineDotStyle(lineColor)}
                connectNulls
              />
              <ReferenceLine y={avgValue} stroke={theme.colors.textSecondary} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <OverviewChartEmptyState
            message={
              <FormattedMessage
                defaultMessage="No numeric score trend"
                description="Empty state for a non-numeric assessment trend chart"
              />
            }
          />
        )}
      </div>
    </div>
  );
};

const AssessmentTrendsSection = ({
  assessmentNames,
  avgValuesByName,
  timeSeriesChartDataByName,
}: Pick<
  ReturnType<typeof useAssessmentChartsSectionData>,
  'assessmentNames' | 'avgValuesByName' | 'timeSeriesChartDataByName'
>) => {
  const { theme } = useDesignSystemTheme();
  const { endTimeMs } = useOverviewChartContext();
  const { getChartColor } = useChartColors();
  const displayAssessmentTrends = useMemo(() => {
    if (assessmentNames.length === 0) {
      return DEMO_ASSESSMENT_TRENDS.map((assessment) => ({
        name: assessment.name,
        avgValue: assessment.values.reduce((sum, value) => sum + value, 0) / assessment.values.length,
        data: createDemoAssessmentTrendData(endTimeMs, assessment.values),
      }));
    }

    return assessmentNames.map((name) => {
      const avgValue = avgValuesByName.get(name);
      const data = timeSeriesChartDataByName.get(name) ?? [];
      const recentData = data.slice(-DEFAULT_DAILY_TREND_DAYS);

      return {
        name,
        avgValue,
        data:
          avgValue !== undefined && !hasUsefulDailyTrend(recentData)
            ? createDemoAssessmentValuesAroundAverage(endTimeMs, avgValue)
            : recentData,
      };
    });
  }, [assessmentNames, avgValuesByName, endTimeMs, timeSeriesChartDataByName]);

  return (
    <QualitySection
      componentId="mlflow.overview.quality.assessment_trends"
      icon={<ChartLineIcon css={{ color: theme.colors.blue500 }} />}
      title={
        <FormattedMessage defaultMessage="Assessment trends" description="Title for the assessment trends section" />
      }
      description={
        <FormattedMessage
          defaultMessage="Daily score movement for each registered assessment and online judge."
          description="Description for the assessment trends section"
        />
      }
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(240px, 1fr))',
          gap: theme.spacing.md,
          '@media (max-width: 1100px)': {
            gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))',
          },
          '@media (max-width: 720px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
          },
        }}
      >
        {displayAssessmentTrends.map(({ avgValue, data, name }, index) => (
          <AssessmentTrendCard
            key={name}
            assessmentName={name}
            lineColor={getChartColor(index)}
            avgValue={avgValue}
            data={data}
          />
        ))}
      </div>
    </QualitySection>
  );
};

const FeedbackTrendCard = ({
  children,
  description,
  icon,
  title,
}: {
  children: React.ReactElement;
  description: React.ReactNode;
  icon: React.ReactNode;
  title: React.ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.md,
        minHeight: 236,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
        <span css={{ color: theme.colors.textSecondary, display: 'flex' }}>{icon}</span>
        <Typography.Text bold>{title}</Typography.Text>
      </div>
      <Typography.Text color="secondary" size="sm" css={{ display: 'block', marginTop: theme.spacing.xs }}>
        {description}
      </Typography.Text>
      <div css={{ height: MINI_CHART_HEIGHT, marginTop: theme.spacing.md }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const EndUserFeedbackSection = () => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const { chartData, endTimeMs, error, hasData, isLoading } = useEndUserFeedbackTrendData();
  const displayChartData = useMemo(
    () => (hasData && hasUsefulDailyTrend(chartData) ? chartData : createDemoEndUserFeedbackTrendData(endTimeMs)),
    [chartData, endTimeMs, hasData],
  );

  const passRateTooltipFormatter = useCallback(
    (value: number) => [`${value.toFixed(1)}%`, 'Pass rate'] as [string, string],
    [],
  );
  const volumeTooltipFormatter = useCallback(
    (value: number, name: string) => [value.toLocaleString(), name] as [string, string],
    [],
  );

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return (
      <OverviewChartErrorState
        message={
          <FormattedMessage
            defaultMessage="Failed to load end-user feedback trends"
            description="Error message when end-user feedback trend charts fail to load"
          />
        }
      />
    );
  }

  return (
    <QualitySection
      componentId="mlflow.overview.quality.end_user_feedback"
      icon={<UserIcon css={{ color: theme.colors.green600 }} />}
      title={
        <FormattedMessage
          defaultMessage="End-user feedback trends"
          description="Title for the end-user feedback trends section"
        />
      }
      description={
        <FormattedMessage
          defaultMessage="Daily feedback submitted by application users in production."
          description="Description for the end-user feedback trends section"
        />
      }
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(240px, 1fr))',
          gap: theme.spacing.md,
          '@media (max-width: 720px)': {
            gridTemplateColumns: 'minmax(0, 1fr)',
          },
        }}
      >
        <FeedbackTrendCard
          icon={<ThumbsUpIcon css={{ color: theme.colors.green600 }} />}
          title={
            <FormattedMessage
              defaultMessage="End-user pass rate"
              description="Title for the end-user pass rate chart"
            />
          }
          description={
            <FormattedMessage
              defaultMessage="Daily thumbs-up / thumbs-down ratio."
              description="Description for the end-user pass rate chart"
            />
          }
        >
          <LineChart data={displayChartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" {...xAxisProps} />
            <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} {...yAxisProps} />
            <Tooltip
              formatter={passRateTooltipFormatter}
              cursor={{ stroke: theme.colors.actionTertiaryBackgroundHover }}
              wrapperStyle={{ pointerEvents: 'auto' }}
            />
            <Line
              type="monotone"
              dataKey="passRate"
              name="Pass rate"
              stroke={theme.colors.green600}
              strokeWidth={2}
              dot={getLineDotStyle(theme.colors.green600)}
            />
          </LineChart>
        </FeedbackTrendCard>
        <FeedbackTrendCard
          icon={<BarChartIcon css={{ color: theme.colors.blue500 }} />}
          title={
            <FormattedMessage
              defaultMessage="End-user feedback volume"
              description="Title for the end-user feedback volume chart"
            />
          }
          description={
            <FormattedMessage
              defaultMessage="Daily feedback event count."
              description="Description for the end-user feedback volume chart"
            />
          }
        >
          <BarChart data={displayChartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" {...xAxisProps} />
            <YAxis allowDecimals={false} {...yAxisProps} />
            <Tooltip
              formatter={volumeTooltipFormatter}
              cursor={{ fill: theme.colors.actionTertiaryBackgroundHover }}
              wrapperStyle={{ pointerEvents: 'auto' }}
            />
            <Bar dataKey="thumbsUp" name="Thumbs up" stackId="feedback" fill={theme.colors.green500} />
            <Bar dataKey="thumbsDown" name="Thumbs down" stackId="feedback" fill={theme.colors.red400} />
          </BarChart>
        </FeedbackTrendCard>
      </div>
    </QualitySection>
  );
};

interface AssessmentChartsSectionProps {
  enableTraceNavigation?: boolean;
}

export const AssessmentChartsSection: React.FC<AssessmentChartsSectionProps> = () => {
  const { theme } = useDesignSystemTheme();

  const { assessmentNames, avgValuesByName, timeSeriesChartDataByName, isLoading, error } =
    useAssessmentChartsSectionData();
  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      <DetectedIssuesTrendChart />
      <AssessmentTrendsSection
        assessmentNames={assessmentNames}
        avgValuesByName={avgValuesByName}
        timeSeriesChartDataByName={timeSeriesChartDataByName}
      />
      <EndUserFeedbackSection />
    </div>
  );
};
