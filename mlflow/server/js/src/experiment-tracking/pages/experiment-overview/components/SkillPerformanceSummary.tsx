import React, { useMemo } from 'react';
import { WrenchIcon, Typography } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';
import { useSkillPerformanceSummaryData } from '../hooks/useSkillPerformanceSummaryData';
import {
  OverviewChartLoadingState,
  OverviewChartErrorState,
  OverviewChartEmptyState,
  OverviewChartHeader,
  OverviewChartContainer,
} from './OverviewChartComponents';
import { formatCount, formatLatency, useChartColors } from '../utils/chartUtils';
import { useSortState, useSummaryTableStyles, SortableHeader, LinkableNameCell } from './SummaryTableComponents';

type SortColumn = 'skillName' | 'totalCalls' | 'successRate' | 'avgLatency';

export const SkillPerformanceSummary: React.FC = () => {
  const { getChartColor } = useChartColors();
  const { sortColumn, sortDirection, handleSort } = useSortState<SortColumn>('totalCalls');
  const { headerRowStyle, bodyRowStyle, cellStyle } = useSummaryTableStyles('minmax(80px, 2fr) 1fr 1fr 1fr');

  const { skillsData, isLoading, error, hasData } = useSkillPerformanceSummaryData();

  const sortedSkillsData = useMemo(() => {
    if (!skillsData.length) return skillsData;

    return [...skillsData].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'skillName':
          comparison = a.skillName.localeCompare(b.skillName);
          break;
        case 'totalCalls':
          comparison = a.totalCalls - b.totalCalls;
          break;
        case 'successRate':
          comparison = a.successRate - b.successRate;
          break;
        case 'avgLatency':
          comparison = a.avgLatency - b.avgLatency;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [skillsData, sortColumn, sortDirection]);

  if (isLoading) {
    return <OverviewChartLoadingState />;
  }

  if (error) {
    return <OverviewChartErrorState />;
  }

  return (
    <OverviewChartContainer componentId="mlflow.charts.skill_performance_summary">
      <OverviewChartHeader
        icon={<WrenchIcon />}
        title={
          <FormattedMessage
            defaultMessage="Skill Performance Summary"
            description="Title for the skill performance summary section"
          />
        }
      />

      {hasData ? (
        <div css={{ display: 'flex', flexDirection: 'column' }}>
          <div css={headerRowStyle}>
            <SortableHeader
              column="skillName"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
            >
              <FormattedMessage defaultMessage="Skill" description="Column header for skill name" />
            </SortableHeader>
            <SortableHeader
              column="totalCalls"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Calls" description="Column header for call count" />
            </SortableHeader>
            <SortableHeader
              column="successRate"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Success" description="Column header for success rate" />
            </SortableHeader>
            <SortableHeader
              column="avgLatency"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              centered
            >
              <FormattedMessage defaultMessage="Latency (AVG)" description="Column header for average latency" />
            </SortableHeader>
          </div>

          <div css={{ maxHeight: 200, overflowY: 'auto' }}>
            {sortedSkillsData.map((skill, index) => {
              const originalIndex = skillsData.findIndex((s) => s.skillName === skill.skillName);
              const colorIndex = originalIndex === -1 ? index : originalIndex;
              return (
                <div key={skill.skillName} css={bodyRowStyle}>
                  <LinkableNameCell
                    name={skill.skillName}
                    color={getChartColor(colorIndex)}
                    scrollToElementId={`skill-chart-${skill.skillName}`}
                  />
                  <Typography.Text css={cellStyle}>{formatCount(skill.totalCalls)}</Typography.Text>
                  <Typography.Text css={cellStyle}>{skill.successRate.toFixed(2)}%</Typography.Text>
                  <Typography.Text css={cellStyle}>{formatLatency(skill.avgLatency)}</Typography.Text>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <OverviewChartEmptyState />
      )}
    </OverviewChartContainer>
  );
};
