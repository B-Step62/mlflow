import React, { useCallback } from 'react';
import { ChartLineIcon, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useSkillUsageChartData } from '../hooks/useSkillUsageChartData';
import { useItemSelection } from '../hooks/useItemSelection';
import {
  OverviewChartLoadingState,
  OverviewChartErrorState,
  OverviewChartEmptyState,
  OverviewChartHeader,
  OverviewChartContainer,
  ScrollableTooltip,
  useChartXAxisProps,
  useChartYAxisProps,
  useScrollableLegendProps,
} from './OverviewChartComponents';
import { ItemSelector } from './ItemSelector';
import { formatCount, useLegendHighlight, useChartColors } from '../utils/chartUtils';

export const SkillUsageChart: React.FC = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const scrollableLegendProps = useScrollableLegendProps();
  const { getOpacity, handleLegendMouseEnter, handleLegendMouseLeave } = useLegendHighlight();
  const { getChartColor } = useChartColors();

  const { chartData, skillNames, isLoading, error, hasData } = useSkillUsageChartData();

  const { displayedItems, isAllSelected, selectorLabel, handleSelectAllToggle, handleItemToggle } = useItemSelection(
    skillNames,
    {
      allSelected: intl.formatMessage({
        defaultMessage: 'All skills',
        description: 'Label for skill selector when all skills are selected',
      }),
      noneSelected: intl.formatMessage({
        defaultMessage: 'No skills selected',
        description: 'Label for skill selector when no skills are selected',
      }),
    },
  );

  const tooltipFormatter = useCallback(
    (value: number, name: string) => [formatCount(value), name] as [string, string],
    [],
  );

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <OverviewChartContainer componentId="mlflow.charts.skill_usage">
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <OverviewChartHeader
          icon={<ChartLineIcon />}
          title={
            <FormattedMessage defaultMessage="Skill Usage Over Time" description="Title for the skill usage chart" />
          }
        />
        {hasData && (
          <ItemSelector
            componentId="mlflow.charts.skill_usage.skill_selector"
            itemNames={skillNames}
            displayedItems={displayedItems}
            isAllSelected={isAllSelected}
            selectorLabel={selectorLabel}
            onSelectAllToggle={handleSelectAllToggle}
            onItemToggle={handleItemToggle}
          />
        )}
      </div>

      <div css={{ height: 300, marginTop: theme.spacing.sm }}>
        {hasData && displayedItems.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <XAxis dataKey="timestamp" {...xAxisProps} />
              <YAxis {...yAxisProps} />
              <Tooltip
                content={<ScrollableTooltip formatter={tooltipFormatter} />}
                cursor={{ fill: theme.colors.actionTertiaryBackgroundHover }}
              />
              {displayedItems.map((skillName) => {
                const originalIndex = skillNames.indexOf(skillName);
                return (
                  <Bar
                    key={skillName}
                    dataKey={skillName}
                    stackId="skills"
                    fill={getChartColor(originalIndex)}
                    fillOpacity={getOpacity(skillName)}
                  />
                );
              })}
              <Legend
                verticalAlign="bottom"
                iconType="square"
                onMouseEnter={handleLegendMouseEnter}
                onMouseLeave={handleLegendMouseLeave}
                {...scrollableLegendProps}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <OverviewChartEmptyState />
        )}
      </div>
    </OverviewChartContainer>
  );
};
