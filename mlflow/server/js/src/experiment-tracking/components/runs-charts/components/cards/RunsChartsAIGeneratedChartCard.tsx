import React, { useEffect, useState } from 'react';
import { useDesignSystemTheme } from '@databricks/design-system';
import type { RunsChartsAIGeneratedCardConfig } from '../../runs-charts.types';
import { RunsChartsRunData } from '../RunsCharts.common';
import type {
  RunsChartCardFullScreenProps,
  RunsChartCardReorderProps,
  RunsChartCardSizeProps,
  RunsChartCardVisibilityProps,
} from './ChartCard.common';
import { RunsChartCardWrapper } from './ChartCard.common';
import { LazyPlot } from '../../../LazyPlot';

export interface RunsChartsAIGeneratedChartCardProps
  extends RunsChartCardFullScreenProps,
    RunsChartCardReorderProps,
    RunsChartCardVisibilityProps,
    RunsChartCardSizeProps {
  config: RunsChartsAIGeneratedCardConfig;
  chartRunData: RunsChartsRunData[];
  onDelete: () => void;
  onEdit: () => void;
}

const ChartRenderer = ({ 
  chartCode, 
  runId, 
  experimentId 
}: { 
  chartCode: string; 
  runId?: string; 
  experimentId?: string; 
}) => {
  const [chartComponent, setChartComponent] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useDesignSystemTheme();

  useEffect(() => {
    if (!chartCode.trim()) {
      setError('No chart code available');
      return;
    }

    try {
      // Strip import/export statements since they're not supported in dynamic execution
      const codeWithoutImports = chartCode
        .replace(/import\s+.*?from\s+['"].*?['"];?/g, '') // Remove import statements
        .replace(/export\s+/g, ''); // Remove export keywords

      // Execute the code in a safe context with required dependencies
      const executeCode = new Function(
        'React', 'useState', 'useEffect', 'LazyPlot', 'useDesignSystemTheme',
        `${codeWithoutImports}\nreturn GeneratedChart;`
      );

      const GeneratedChart = executeCode(
        React,
        useState,
        useEffect,
        LazyPlot,
        useDesignSystemTheme
      );

      setChartComponent(() => GeneratedChart);
      setError(null);
    } catch (err) {
      console.error('Error executing chart code:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    }
  }, [chartCode]);

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          border: `1px solid ${theme.colors.borderDanger}`,
          borderRadius: theme.borders.borderRadiusMd,
          color: theme.colors.textValidationDanger,
          backgroundColor: theme.colors.backgroundDanger,
          padding: theme.spacing.md,
          flexDirection: 'column',
          gap: theme.spacing.sm,
        }}
      >
        <div style={{ fontSize: '24px' }}>⚠️</div>
        <div style={{ fontWeight: theme.typography.typographyBoldFontWeight }}>
          Chart Execution Error
        </div>
        <div style={{ fontSize: theme.typography.fontSizeSm, textAlign: 'center' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!chartComponent) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
        }}
      >
        Loading chart...
      </div>
    );
  }

  const ChartComponent = chartComponent;
  
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ChartComponent runId={runId} experimentId={experimentId} />
    </div>
  );
};

export const RunsChartsAIGeneratedChartCard = (props: RunsChartsAIGeneratedChartCardProps) => {
  const { config, chartRunData, onDelete, onEdit, setFullScreenChart, fullScreen, ...restProps } = props;
  
  // Get the first run's ID for the chart
  const runId = chartRunData[0]?.uuid;
  const experimentId = chartRunData[0]?.runInfo?.experimentId;

  const toggleFullScreenChart = () => {
    setFullScreenChart?.({
      config,
      title: config.displayName || 'AI Generated Chart',
      subtitle: 'Generated with MLflow AI Engine',
    });
  };

  const chartBody = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: fullScreen ? '100%' : '100%',
        overflow: 'hidden',
      }}
    >
      <ChartRenderer 
        chartCode={config.chartCode} 
        runId={runId}
        experimentId={experimentId}
      />
    </div>
  );

  if (fullScreen) {
    return chartBody;
  }

  return (
    <RunsChartCardWrapper
      title={config.displayName || 'AI Generated Chart'}
      subtitle="Generated with MLflow AI Engine"
      onDelete={onDelete}
      onEdit={onEdit}
      toggleFullScreenChart={toggleFullScreenChart}
      {...restProps}
    >
      {chartBody}
    </RunsChartCardWrapper>
  );
};