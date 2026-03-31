import React from 'react';
import { Typography, useDesignSystemTheme, Spinner } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAllSkillsUsageData } from '../hooks/useAllSkillsUsageData';

const CHART_COLORS = ['#2272B4', '#C15F18', '#1A7C40', '#8B3FC0', '#C4343A', '#6B7280'];

export const SkillUsageBreakdown: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const { chartData, skillNames, totalCount, isLoading, error, hasData } = useAllSkillsUsageData();

  if (error) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        css={{
          display: 'flex',
          justifyContent: 'center',
          padding: theme.spacing.md,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          flexShrink: 0,
        }}
      >
        <Spinner label="Loading usage data" />
      </div>
    );
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
          alignItems: 'baseline',
          marginBottom: theme.spacing.sm,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <Typography.Text bold>
            <FormattedMessage
              defaultMessage="Usage Over Time"
              description="Title for the skill usage over time chart on skills list page"
            />
          </Typography.Text>
          {hasData && (
            <Typography.Text color="secondary" size="sm">
              {totalCount}{' '}
              <FormattedMessage
                defaultMessage="invocations"
                description="Label for total skill invocations in breakdown"
              />
            </Typography.Text>
          )}
        </div>
        <Typography.Text color="secondary" size="sm">
          <FormattedMessage defaultMessage="last 30 days" description="Time range label for skill usage breakdown" />
        </Typography.Text>
      </div>

      <div css={{ height: 150 }}>
        {hasData ? (
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
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.colors.textSecondary,
            }}
          >
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
