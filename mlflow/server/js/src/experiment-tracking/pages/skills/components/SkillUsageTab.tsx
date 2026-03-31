import React from 'react';
import { Typography, useDesignSystemTheme, Spinner } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useSkillUsageData } from '../hooks/useSkillUsageData';

export const SkillUsageTab: React.FC<{ skillName: string }> = ({ skillName }) => {
  const { theme } = useDesignSystemTheme();
  const { chartData, totalCount, isLoading, error, hasData } = useSkillUsageData(skillName);

  if (isLoading) {
    return (
      <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
        <Spinner label="Loading usage data" />
      </div>
    );
  }

  if (error) {
    return (
      <div css={{ padding: theme.spacing.lg, color: theme.colors.textSecondary, textAlign: 'center' }}>
        <FormattedMessage
          defaultMessage="Failed to load usage data."
          description="Error message when skill usage data fails to load"
        />
      </div>
    );
  }

  if (!hasData) {
    return (
      <div
        css={{
          border: `1px dashed ${theme.colors.borderDecorative}`,
          borderRadius: theme.borders.borderRadiusSm,
          padding: theme.spacing.lg,
          textAlign: 'center',
          color: theme.colors.textSecondary,
        }}
      >
        <FormattedMessage
          defaultMessage="No usage data yet. Traces will appear here once this skill is invoked."
          description="Empty state message for skill usage tab"
        />
      </div>
    );
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      {/* Usage count header */}
      <div
        css={{
          display: 'flex',
          alignItems: 'baseline',
          gap: theme.spacing.sm,
        }}
      >
        <Typography.Title level={3} css={{ margin: 0 }}>
          {totalCount}
        </Typography.Title>
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="invocations in the last 30 days"
            description="Subtitle for skill usage count"
          />
        </Typography.Text>
      </div>

      {/* Usage over time chart */}
      <div
        css={{
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          padding: theme.spacing.md,
        }}
      >
        <Typography.Text bold css={{ marginBottom: theme.spacing.sm, display: 'block' }}>
          <FormattedMessage defaultMessage="Usage Over Time" description="Title for the skill usage over time chart" />
        </Typography.Text>
        <div css={{ height: 250 }}>
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
              <Bar dataKey="count" fill={theme.colors.blue500} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
