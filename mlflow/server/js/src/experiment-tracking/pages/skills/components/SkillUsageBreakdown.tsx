import React, { useState } from 'react';
import {
  Typography,
  useDesignSystemTheme,
  Spinner,
  SegmentedControlButton,
  SegmentedControlGroup,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAllSkillsUsageData, type TimeRangeOption } from '../hooks/useAllSkillsUsageData';

const CHART_COLORS = ['#2272B4', '#C15F18', '#1A7C40', '#8B3FC0', '#C4343A', '#6B7280'];

const TIME_RANGE_LABELS: Record<TimeRangeOption, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
};

export const SkillUsageBreakdown: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('30d');
  const { chartData, skillNames, totalCount, isLoading, error, hasData } = useAllSkillsUsageData(timeRange);

  if (error) {
    return null;
  }

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.md,
        flexShrink: 0,
      }}
    >
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.sm,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <Typography.Text bold>
            <FormattedMessage
              defaultMessage="Skill Usage"
              description="Title for the skill usage over time chart on skills list page"
            />
          </Typography.Text>
          {!isLoading && hasData && (
            <Typography.Text color="secondary" size="sm">
              {totalCount}{' '}
              <FormattedMessage
                defaultMessage="invocations"
                description="Label for total skill invocations in breakdown"
              />
            </Typography.Text>
          )}
        </div>
        <SegmentedControlGroup
          componentId="mlflow.skills.usage.time_range"
          name="skill-usage-time-range"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRangeOption)}
        >
          {Object.entries(TIME_RANGE_LABELS).map(([value, label]) => (
            <SegmentedControlButton key={value} value={value}>
              {label}
            </SegmentedControlButton>
          ))}
        </SegmentedControlGroup>
      </div>

      <div css={{ height: 150 }}>
        {isLoading ? (
          <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Spinner label="Loading usage data" />
          </div>
        ) : hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11, fill: theme.colors.textSecondary }}
                tickLine={false}
                axisLine={{ stroke: theme.colors.borderDecorative }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: theme.colors.textSecondary }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.colors.backgroundPrimary,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.borders.borderRadiusMd,
                  fontSize: 12,
                }}
              />
              {skillNames.map((name, index) => (
                <Bar
                  key={name}
                  dataKey={name}
                  stackId="skills"
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                  radius={index === skillNames.length - 1 ? [2, 2, 0, 0] : undefined}
                />
              ))}
              {skillNames.length > 1 && <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage
                defaultMessage="No skill usage recorded yet."
                description="Empty state for skill usage breakdown"
              />
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
};
