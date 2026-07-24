import { Typography, useDesignSystemTheme } from '@databricks/design-system';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { FormattedMessage } from 'react-intl';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCostUSD } from '@databricks/web-shared/model-trace-explorer';
import type { RunEntity } from '../../types';
import { useGetExperimentRunColor } from '../../components/experiment-page/hooks/useExperimentRunColor';
import { useExperimentEvaluationRunsRowVisibility } from './hooks/useExperimentEvaluationRunsRowVisibility';
import { formatCount } from '../experiment-overview/utils/chartUtils';

const SUMMARY_CHART_STRIP_HEIGHT = 232;
const SUMMARY_CHART_CARD_MIN_WIDTH = 300;
const SUMMARY_CHART_CARD_MAX_WIDTH = 520;
const SUMMARY_CHART_CARD_HEIGHT = 208;
const SUMMARY_CHART_CONTENT_HEIGHT = 138;

const getMetricSortRank = (metricKey: string) => {
  if (/latency|duration|execution.*time|elapsed/i.test(metricKey)) {
    return 0;
  }
  if (/cost|price/i.test(metricKey)) {
    return 1;
  }
  if (/token/i.test(metricKey)) {
    return 2;
  }
  return 3;
};

const getSelectedRunMetricKeys = (runs: RunEntity[]) => {
  const metricKeys = new Set<string>();
  for (const run of runs) {
    for (const metric of run.data.metrics ?? []) {
      metricKeys.add(metric.key);
    }
  }
  return Array.from(metricKeys).sort((a, b) => {
    const rankDifference = getMetricSortRank(a) - getMetricSortRank(b);
    return rankDifference === 0 ? a.localeCompare(b) : rankDifference;
  });
};

type SummaryChartDatum = {
  runUuid: string;
  name: string;
  fullName: string;
  value: number;
  color: string;
};

const getMetricValue = (run: RunEntity, metricKey: string) => {
  const metric = run.data.metrics?.find(({ key }) => key === metricKey);
  const value = Number(metric?.value);
  return Number.isFinite(value) ? value : undefined;
};

const getChartCardWidth = (runCount: number) =>
  Math.min(SUMMARY_CHART_CARD_MAX_WIDTH, Math.max(SUMMARY_CHART_CARD_MIN_WIDTH, 72 * runCount));

const truncateRunName = (value: string) => (value.length > 12 ? `${value.slice(0, 11)}...` : value);
const getValueAxisWidth = (metricKey: string) =>
  /latency|duration|execution.*time|elapsed/i.test(metricKey) ? 68 : 44;

const getLatencySeconds = (metricKey: string, value: number) => {
  if (/(\b|_)(ms|msec|millis|milliseconds?)\b/i.test(metricKey)) {
    return value / 1000;
  }
  if (/(\b|_)(s|sec|seconds?)\b/i.test(metricKey)) {
    return value;
  }
  return value >= 100 ? value / 1000 : value;
};

const formatLatencyMetricValue = (metricKey: string, value: number) => {
  const seconds = getLatencySeconds(metricKey, value);
  return `${seconds < 10 ? seconds.toFixed(3) : seconds.toFixed(2)} sec`;
};

const formatMetricValue = (metricKey: string, value: number) => {
  if (/latency|duration|execution.*time|elapsed/i.test(metricKey)) {
    return formatLatencyMetricValue(metricKey, value);
  }
  if (/cost|price/i.test(metricKey)) {
    return formatCostUSD(value);
  }
  if (/token/i.test(metricKey)) {
    return formatCount(Math.round(value));
  }
  if (Math.abs(value) >= 1000) {
    return formatCount(value);
  }
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
};

const SummaryChartTooltip = ({
  active,
  payload,
  label,
  metricKey,
}: {
  active?: boolean;
  payload?: Array<{ payload: SummaryChartDatum }>;
  label?: string;
  metricKey: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const datum = payload?.[0]?.payload;

  if (!active || !datum) {
    return null;
  }

  return (
    <div
      css={{
        backgroundColor: `${theme.colors.backgroundPrimary}E6`,
        backdropFilter: 'blur(2px)',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        boxShadow: theme.shadows.lg,
        padding: theme.spacing.sm,
        fontSize: theme.typography.fontSizeSm,
        maxWidth: 260,
      }}
    >
      <Typography.Text bold>{datum.fullName || label}</Typography.Text>
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
        <span
          css={{
            width: theme.spacing.sm,
            height: theme.spacing.sm,
            borderRadius: '50%',
            backgroundColor: datum.color,
            flexShrink: 0,
          }}
        />
        <Typography.Text color="secondary">{metricKey}</Typography.Text>
        <Typography.Text>{formatMetricValue(metricKey, datum.value)}</Typography.Text>
      </div>
    </div>
  );
};

export const ExperimentEvaluationRunsSummaryCharts = ({
  runs,
  selectedRunUuids,
}: {
  runs: RunEntity[];
  selectedRunUuids: string[];
}) => {
  const getRunColor = useGetExperimentRunColor();
  const { isRowHidden } = useExperimentEvaluationRunsRowVisibility();

  const selectedRuns = useMemo(
    () => runs.filter((run) => selectedRunUuids.includes(run.info.runUuid)),
    [runs, selectedRunUuids],
  );
  const selectedRunMetricKeys = useMemo(() => getSelectedRunMetricKeys(selectedRuns), [selectedRuns]);
  const visibleSelectedRuns = useMemo(
    () => selectedRuns.filter((run, index) => !isRowHidden(run.info.runUuid, index, run.info.status)),
    [isRowHidden, selectedRuns],
  );

  if (selectedRuns.length === 0) {
    return (
      <SummaryChartFrame>
        <SummaryChartEmptyState>
          <FormattedMessage
            defaultMessage="Please select runs to view chart"
            description="Placeholder shown in evaluation runs charts when no runs are selected"
          />
        </SummaryChartEmptyState>
      </SummaryChartFrame>
    );
  }

  if (selectedRunMetricKeys.length === 0) {
    return (
      <SummaryChartFrame>
        <SummaryChartEmptyState>
          <FormattedMessage
            defaultMessage="Selected runs do not have chart metrics"
            description="Placeholder shown in evaluation runs charts when selected runs do not have metrics"
          />
        </SummaryChartEmptyState>
      </SummaryChartFrame>
    );
  }

  return (
    <SummaryChartFrame>
      {selectedRunMetricKeys.map((metricKey) => (
        <SummaryChartCard key={metricKey} metricKey={metricKey} runs={visibleSelectedRuns} getRunColor={getRunColor} />
      ))}
    </SummaryChartFrame>
  );
};

const SummaryChartFrame = ({ children }: { children: ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <section
      css={{
        height: SUMMARY_CHART_STRIP_HEIGHT,
        minHeight: SUMMARY_CHART_STRIP_HEIGHT,
        maxHeight: SUMMARY_CHART_STRIP_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        gap: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
      }}
      aria-label="Evaluation run charts"
    >
      {children}
    </section>
  );
};

const SummaryChartCard = ({
  metricKey,
  runs,
  getRunColor,
}: {
  metricKey: string;
  runs: RunEntity[];
  getRunColor: (runUuid: string) => string;
}) => {
  const { theme } = useDesignSystemTheme();
  const chartData = useMemo(
    () =>
      runs
        .map((run): SummaryChartDatum | undefined => {
          const value = getMetricValue(run, metricKey);
          if (value === undefined) {
            return undefined;
          }
          const fullName = run.info.runName || run.info.runUuid;
          return {
            runUuid: run.info.runUuid,
            name: truncateRunName(fullName),
            fullName,
            value,
            color: getRunColor(run.info.runUuid),
          };
        })
        .filter((datum): datum is SummaryChartDatum => Boolean(datum)),
    [getRunColor, metricKey, runs],
  );

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div
      css={{
        flex: `0 0 ${getChartCardWidth(chartData.length)}px`,
        height: SUMMARY_CHART_CARD_HEIGHT,
        minHeight: SUMMARY_CHART_CARD_HEIGHT,
        maxHeight: SUMMARY_CHART_CARD_HEIGHT,
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        overflow: 'hidden',
        backgroundColor: theme.colors.backgroundPrimary,
        padding: theme.spacing.md,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
      }}
    >
      <Typography.Title
        level={4}
        withoutMargins
        title={metricKey}
        css={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: theme.typography.fontSizeBase,
          lineHeight: theme.typography.lineHeightBase,
        }}
      >
        {metricKey}
      </Typography.Title>
      <div
        css={{ height: SUMMARY_CHART_CONTENT_HEIGHT, minHeight: 0, overflow: 'hidden', marginTop: theme.spacing.sm }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: theme.colors.textSecondary }}
              tickLine={false}
              axisLine={{ stroke: theme.colors.border }}
              interval={0}
              height={24}
            />
            <YAxis
              tick={{ fontSize: 10, fill: theme.colors.textSecondary }}
              tickFormatter={(value) => formatMetricValue(metricKey, Number(value))}
              tickLine={false}
              axisLine={{ stroke: theme.colors.border }}
              width={getValueAxisWidth(metricKey)}
            />
            <Tooltip
              content={<SummaryChartTooltip metricKey={metricKey} />}
              cursor={{ fill: theme.colors.actionTertiaryBackgroundHover }}
              wrapperStyle={{ pointerEvents: 'auto' }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((datum) => (
                <Cell key={datum.runUuid} fill={datum.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SummaryChartEmptyState = ({ children }: { children: ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        flex: '1 0 100%',
        minWidth: 360,
        height: SUMMARY_CHART_CARD_HEIGHT,
        minHeight: SUMMARY_CHART_CARD_HEIGHT,
        maxHeight: SUMMARY_CHART_CARD_HEIGHT,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.lg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.general.borderRadiusBase,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <div
        aria-hidden="true"
        css={{
          width: 96,
          height: 72,
          display: 'flex',
          alignItems: 'flex-end',
          gap: theme.spacing.xs,
          padding: theme.spacing.sm,
          borderLeft: `1px solid ${theme.colors.border}`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        {[34, 58, 44, 70].map((height, index) => (
          <div
            key={index}
            css={{
              width: 14,
              height,
              borderRadius: `${theme.borders.borderRadiusSm} ${theme.borders.borderRadiusSm} 0 0`,
              backgroundColor: theme.colors.actionDefaultBackgroundPress,
            }}
          />
        ))}
      </div>
      <Typography.Text color="secondary">{children}</Typography.Text>
    </div>
  );
};
