import React from 'react';
import { Typography, useDesignSystemTheme, TitleSkeleton } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useSkillUsageBreakdownData } from '../hooks/useSkillUsageBreakdownData';

export const SkillUsageBreakdown: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const { breakdown, totalCount, isLoading, error } = useSkillUsageBreakdownData();

  if (error || (!isLoading && breakdown.length === 0)) {
    return null;
  }

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.md,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.borders.borderRadiusMd,
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Total */}
      <div css={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.xs, flexShrink: 0 }}>
        {isLoading ? (
          <TitleSkeleton css={{ width: 40 }} />
        ) : (
          <Typography.Text bold size="lg">
            {totalCount}
          </Typography.Text>
        )}
        <Typography.Text color="secondary" size="sm">
          <FormattedMessage defaultMessage="total" description="Label for total skill invocations count" />
        </Typography.Text>
      </div>

      {/* Separator */}
      <div
        css={{
          width: 1,
          height: 20,
          backgroundColor: theme.colors.borderDecorative,
          flexShrink: 0,
        }}
      />

      {/* Per-skill breakdown */}
      <div css={{ display: 'flex', gap: theme.spacing.sm, overflowX: 'auto', flex: 1 }}>
        {isLoading ? (
          <>
            <TitleSkeleton css={{ width: 80 }} />
            <TitleSkeleton css={{ width: 80 }} />
          </>
        ) : (
          breakdown.map(({ skillName, count }) => (
            <div
              key={skillName}
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: theme.spacing.xs,
                padding: `2px ${theme.spacing.sm}px`,
                backgroundColor: theme.colors.backgroundPrimary,
                borderRadius: theme.borders.borderRadiusSm,
                border: `1px solid ${theme.colors.border}`,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Typography.Text bold size="sm">
                {count}
              </Typography.Text>
              <Typography.Text color="secondary" size="sm">
                {skillName}
              </Typography.Text>
            </div>
          ))
        )}
      </div>

      {/* Time range label */}
      <Typography.Text color="secondary" size="sm" css={{ flexShrink: 0 }}>
        <FormattedMessage defaultMessage="last 30d" description="Time range label for skill usage breakdown" />
      </Typography.Text>
    </div>
  );
};
