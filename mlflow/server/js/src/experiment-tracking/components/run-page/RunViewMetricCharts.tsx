import { TableSkeleton, ToggleButton, useDesignSystemTheme, Accordion, PlusIcon, Button } from '@databricks/design-system';
import { compact, mapValues, values } from 'lodash';
import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { useSelector } from 'react-redux';
import { ReduxState } from '../../../redux-types';
import type { MetricEntitiesByName, RunInfoEntity } from '../../types';
import { KeyValueEntity } from '../../../common/types';

import { RunsChartsTooltipWrapper } from '../runs-charts/hooks/useRunsChartsTooltip';
import { RunViewChartTooltipBody } from './RunViewChartTooltipBody';
import { RunsChartType, RunsChartsCardConfig } from '../runs-charts/runs-charts.types';
import type { RunsChartsRunData } from '../runs-charts/components/RunsCharts.common';
import { RunsChartsLineChartXAxisType } from '../runs-charts/components/RunsCharts.common';
import type { ExperimentRunsChartsUIConfiguration } from '../experiment-page/models/ExperimentPageUIState';
import { RunsChartsSectionAccordion } from '../runs-charts/components/sections/RunsChartsSectionAccordion';
import { RunsChartsConfigureModal } from '../runs-charts/components/RunsChartsConfigureModal';
import MetricChartsAccordion, { METRIC_CHART_SECTION_HEADER_SIZE } from '../MetricChartsAccordion';
import {
  RunsChartsUIConfigurationContextProvider,
  useConfirmChartCardConfigurationFn,
  useInsertRunsChartsFn,
  useRemoveRunsChartFn,
  useReorderRunsChartsFn,
} from '../runs-charts/hooks/useRunsChartsUIConfiguration';
import {
  LOG_IMAGE_TAG_INDICATOR,
  MLFLOW_MODEL_METRIC_NAME,
  MLFLOW_SYSTEM_METRIC_NAME,
  MLFLOW_SYSTEM_METRIC_PREFIX,
} from '../../constants';
import LocalStorageUtils from '../../../common/utils/LocalStorageUtils';
import { RunsChartsFullScreenModal } from '../runs-charts/components/RunsChartsFullScreenModal';
import { useIsTabActive } from '../../../common/hooks/useIsTabActive';
import { shouldEnableRunDetailsPageAutoRefresh } from '../../../common/utils/FeatureUtils';
import { usePopulateImagesByRunUuid } from '../experiment-page/hooks/usePopulateImagesByRunUuid';
import type { UseGetRunQueryResponseRunInfo } from './hooks/useGetRunQuery';
import { RunsChartsGlobalChartSettingsDropdown } from '../runs-charts/components/RunsChartsGlobalChartSettingsDropdown';
import { RunsChartsDraggableCardsGridContextProvider } from '../runs-charts/components/RunsChartsDraggableCardsGridContext';
import { RunsChartsFilterInput } from '../runs-charts/components/RunsChartsFilterInput';
import { CustomChartGenerator } from '../custom-charts/CustomChartGenerator';
import { useCustomChartGeneration } from './hooks/useCustomChartGeneration';
import { LazyPlot } from '../LazyPlot';

interface RunViewMetricChartsProps {
  metricKeys: string[];
  runInfo: RunInfoEntity | UseGetRunQueryResponseRunInfo;
  /**
   * Whether to display model or system metrics. This affects labels and tooltips.
   */
  mode: 'model' | 'system';

  latestMetrics?: MetricEntitiesByName;
  tags?: Record<string, KeyValueEntity>;
  params?: Record<string, KeyValueEntity>;
}

// Dynamic chart renderer that executes generated React code
const ChartRenderer = ({ chartCode, runId, experimentId }: { 
  chartCode: string; 
  runId?: string; 
  experimentId?: string; 
}) => {
  const { theme } = useDesignSystemTheme();
  const [ChartComponent, setChartComponent] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const executeChartCode = () => {
      try {
        setError(null);

        // Strip import and export statements since we provide dependencies directly
        const codeWithoutImports = chartCode
          .replace(/import\s+.*?from\s+['"].*?['"];?/g, '') // Remove import statements
          .replace(/export\s+/g, ''); // Remove export keywords
        
        // Create a safe execution context with necessary imports
        const executeCode = new Function(
          'React',
          'useState', 
          'useEffect',
          'LazyPlot',
          'useDesignSystemTheme',
          `
          ${codeWithoutImports}
          
          // Return the GeneratedChart component
          return GeneratedChart;
          `
        );

        // Execute the code with required dependencies
        const GeneratedChartComponent = executeCode(
          React,
          useState,
          useEffect,
          LazyPlot,
          useDesignSystemTheme
        );

        // Create a wrapper component that passes run context
        const WrappedComponent = () => (
          <div css={{ 
            width: '100%', 
            height: '400px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            overflow: 'hidden',
            backgroundColor: theme.colors.backgroundPrimary
          }}>
            <GeneratedChartComponent runId={runId} experimentId={experimentId} />
          </div>
        );

        setChartComponent(() => WrappedComponent);
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to execute chart code';
        setError(errorMessage);
        console.error('Chart execution error:', err);
      }
    };

    if (chartCode) {
      executeChartCode();
    }
  }, [chartCode, runId, experimentId, theme]);

  if (error) {
    return (
      <div css={{
        width: '100%',
        height: '400px',
        border: `1px solid ${theme.colors.borderDanger}`,
        borderRadius: theme.borders.borderRadiusMd,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.backgroundDanger,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center'
      }}>
        <div>
          <div css={{ fontSize: '24px', marginBottom: theme.spacing.sm }}>⚠️</div>
          <div css={{ color: theme.colors.textValidationDanger, fontWeight: 'bold' }}>
            Chart Execution Error
          </div>
          <div css={{ color: theme.colors.textValidationDanger, fontSize: theme.typography.fontSizeSm, marginTop: theme.spacing.xs }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!ChartComponent) {
    return (
      <div css={{
        width: '100%',
        height: '400px',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.backgroundSecondary
      }}>
        <div css={{ textAlign: 'center', color: theme.colors.textSecondary }}>
          <div css={{ fontSize: '24px', marginBottom: theme.spacing.sm }}>📊</div>
          <div>Loading chart...</div>
        </div>
      </div>
    );
  }

  return <ChartComponent />;
};

/**
 * Component displaying metric charts for a single run
 */
const RunViewMetricChartsImpl = ({
  runInfo,
  metricKeys,
  mode,
  chartUIState,
  updateChartsUIState,
  latestMetrics = {},
  params = {},
  tags = {},
}: RunViewMetricChartsProps & {
  chartUIState: ExperimentRunsChartsUIConfiguration;
  updateChartsUIState: (
    stateSetter: (state: ExperimentRunsChartsUIConfiguration) => ExperimentRunsChartsUIConfiguration,
  ) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [search, setSearch] = useState('');
  const { formatMessage } = useIntl();
  
  // Custom charts state
  const [customChartsExpanded, setCustomChartsExpanded] = useState(true);
  const [customCharts, setCustomCharts] = useState<{ id: string; code: string }[]>([]);
  
  // Custom chart generation state
  const { 
    isGenerating, 
    chartCode, 
    error: chartError, 
    progress,
    generateCustomChart, 
    reset: resetChart 
  } = useCustomChartGeneration();

  const { compareRunCharts, compareRunSections, chartsSearchFilter } = chartUIState;

  // For the draggable grid layout, we filter visible cards on this level
  const visibleChartCards = useMemo(() => {
    return compareRunCharts?.filter((chart) => !chart.deleted) ?? [];
  }, [compareRunCharts]);

  const [fullScreenChart, setFullScreenChart] = useState<
    | {
        config: RunsChartsCardConfig;
        title: string | ReactNode;
        subtitle: ReactNode;
      }
    | undefined
  >(undefined);

  const metricsForRun = useSelector(({ entities }: ReduxState) => {
    return mapValues(entities.sampledMetricsByRunUuid[runInfo.runUuid ?? ''], (metricsByRange) => {
      return compact(
        values(metricsByRange)
          .map(({ metricsHistory }) => metricsHistory)
          .flat(),
      );
    });
  });

  const tooltipContextValue = useMemo(() => ({ runInfo, metricsForRun }), [runInfo, metricsForRun]);

  const { imagesByRunUuid } = useSelector((state: ReduxState) => ({
    imagesByRunUuid: state.entities.imagesByRunUuid,
  }));

  const [configuredCardConfig, setConfiguredCardConfig] = useState<RunsChartsCardConfig | null>(null);

  const reorderCharts = useReorderRunsChartsFn();

  const addNewChartCard = (metricSectionId: string) => (type: RunsChartType) =>
    setConfiguredCardConfig(RunsChartsCardConfig.getEmptyChartCardByType(type, false, undefined, metricSectionId));

  const insertCharts = useInsertRunsChartsFn();

  const startEditChart = (chartCard: RunsChartsCardConfig) => setConfiguredCardConfig(chartCard);

  const removeChart = useRemoveRunsChartFn();

  const confirmChartCardConfiguration = useConfirmChartCardConfigurationFn();

  const submitForm = (configuredCard: Partial<RunsChartsCardConfig>) => {
    confirmChartCardConfiguration(configuredCard);

    // Hide the modal
    setConfiguredCardConfig(null);
  };

  // Create a single run data object to be used in charts
  const chartData: RunsChartsRunData[] = useMemo(
    () => [
      {
        displayName: runInfo.runName ?? '',
        metrics: latestMetrics,
        params,
        tags,
        images: imagesByRunUuid[runInfo.runUuid ?? ''] || {},
        metricHistory: {},
        uuid: runInfo.runUuid ?? '',
        color: theme.colors.primary,
        runInfo,
      },
    ],
    [runInfo, latestMetrics, params, tags, imagesByRunUuid, theme],
  );

  useEffect(() => {
    if ((!compareRunSections || !compareRunCharts) && chartData.length > 0) {
      const { resultChartSet, resultSectionSet } = RunsChartsCardConfig.getBaseChartAndSectionConfigs({
        runsData: chartData,
        enabledSectionNames: [mode === 'model' ? MLFLOW_MODEL_METRIC_NAME : MLFLOW_SYSTEM_METRIC_NAME],
        // Filter only model or system metrics
        filterMetricNames: (name) => {
          const isSystemMetric = name.startsWith(MLFLOW_SYSTEM_METRIC_PREFIX);
          return mode === 'model' ? !isSystemMetric : isSystemMetric;
        },
      });

      updateChartsUIState((current) => ({
        ...current,
        compareRunCharts: resultChartSet,
        compareRunSections: resultSectionSet,
      }));
    }
  }, [compareRunCharts, compareRunSections, chartData, mode, updateChartsUIState]);

  /**
   * Update charts with the latest metrics if new are found
   */
  useEffect(() => {
    updateChartsUIState((current) => {
      if (!current.compareRunCharts || !current.compareRunSections) {
        return current;
      }
      const { resultChartSet, resultSectionSet, isResultUpdated } = RunsChartsCardConfig.updateChartAndSectionConfigs({
        compareRunCharts: current.compareRunCharts,
        compareRunSections: current.compareRunSections,
        runsData: chartData,
        isAccordionReordered: current.isAccordionReordered,
        // Filter only model or system metrics
        filterMetricNames: (name) => {
          const isSystemMetric = name.startsWith(MLFLOW_SYSTEM_METRIC_PREFIX);
          return mode === 'model' ? !isSystemMetric : isSystemMetric;
        },
      });

      if (!isResultUpdated) {
        return current;
      }
      return {
        ...current,
        compareRunCharts: resultChartSet,
        compareRunSections: resultSectionSet,
      };
    });
  }, [chartData, updateChartsUIState, mode]);

  const isTabActive = useIsTabActive();
  const autoRefreshEnabled = chartUIState.autoRefreshEnabled && shouldEnableRunDetailsPageAutoRefresh() && isTabActive;

  // Determine if run contains images logged by `mlflow.log_image()`
  const containsLoggedImages = Boolean(tags[LOG_IMAGE_TAG_INDICATOR]);

  usePopulateImagesByRunUuid({
    runUuids: [runInfo.runUuid ?? ''],
    runUuidsIsActive: [runInfo.status === 'RUNNING'],
    autoRefreshEnabled,
    enabled: containsLoggedImages,
  });

  return (
    <div
      css={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          paddingBottom: theme.spacing.md,
          display: 'flex',
          gap: theme.spacing.sm,
          flex: '0 0 auto',
        }}
      >
        <RunsChartsFilterInput chartsSearchFilter={chartsSearchFilter} />
        {shouldEnableRunDetailsPageAutoRefresh() && (
          <ToggleButton
            componentId="codegen_mlflow_app_src_experiment-tracking_components_run-page_runviewmetricchartsv2.tsx_244"
            pressed={chartUIState.autoRefreshEnabled}
            onPressedChange={(pressed) => {
              updateChartsUIState((current) => ({ ...current, autoRefreshEnabled: pressed }));
            }}
          >
            {formatMessage({
              defaultMessage: 'Auto-refresh',
              description: 'Run page > Charts tab > Auto-refresh toggle button',
            })}
          </ToggleButton>
        )}
        <RunsChartsGlobalChartSettingsDropdown
          metricKeyList={metricKeys}
          globalLineChartConfig={chartUIState.globalLineChartConfig}
          updateUIState={updateChartsUIState}
        />
      </div>
      <div
        css={{
          flex: 1,
          overflow: 'auto',
        }}
      >
        <RunsChartsTooltipWrapper contextData={tooltipContextValue} component={RunViewChartTooltipBody}>
          <RunsChartsDraggableCardsGridContextProvider visibleChartCards={visibleChartCards}>
            <RunsChartsSectionAccordion
              compareRunSections={compareRunSections}
              compareRunCharts={visibleChartCards}
              reorderCharts={reorderCharts}
              insertCharts={insertCharts}
              chartData={chartData}
              startEditChart={startEditChart}
              removeChart={removeChart}
              addNewChartCard={addNewChartCard}
              search={chartsSearchFilter ?? ''}
              supportedChartTypes={[RunsChartType.LINE, RunsChartType.BAR, RunsChartType.IMAGE]}
              setFullScreenChart={setFullScreenChart}
              autoRefreshEnabled={autoRefreshEnabled}
              globalLineChartConfig={chartUIState.globalLineChartConfig}
              groupBy={null}
            />
          </RunsChartsDraggableCardsGridContextProvider>
        </RunsChartsTooltipWrapper>
      </div>
      
      {/* Custom Charts Section */}
      <div css={{ 
        borderTop: `1px solid ${theme.colors.border}`, 
        paddingTop: theme.spacing.md,
        marginTop: theme.spacing.md 
      }}>
        <MetricChartsAccordion
          activeKey={customChartsExpanded ? 'custom-charts' : undefined}
          onActiveKeyChange={(key) => setCustomChartsExpanded(key === 'custom-charts' || (Array.isArray(key) && key.includes('custom-charts')))}
        >
          <Accordion.Panel
            key="custom-charts"
            header={
              <div
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  padding: `${theme.spacing.xs}px 0px`,
                  height: `${METRIC_CHART_SECTION_HEADER_SIZE}px`,
                }}
              >
                <div
                  css={{
                    minWidth: 0,
                    maxWidth: '40%',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    css={{
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                      overflow: 'clip',
                      paddingLeft: theme.spacing.xs,
                      whiteSpace: 'pre',
                      fontSize: theme.typography.fontSizeBase,
                      fontWeight: theme.typography.typographyBoldFontWeight,
                      color: theme.colors.textPrimary,
                    }}
                  >
                    Custom Charts
                  </div>
                  <div
                    css={{
                      padding: theme.spacing.xs,
                      position: 'relative',
                      color: theme.colors.textSecondary,
                    }}
                  >
                    ({customCharts.length})
                  </div>
                </div>
                <div
                  css={{
                    position: 'absolute',
                    top: '50%',
                    right: '0',
                    transform: 'translate(0, -50%)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <div
                    css={{
                      alignSelf: 'flex-end',
                      marginLeft: theme.spacing.xs,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CustomChartGenerator
                      runId={runInfo.runUuid}
                      experimentId={runInfo.experimentId}
                      onGenerate={generateCustomChart}
                      isGenerating={isGenerating}
                      chartCode={chartCode}
                      error={chartError}
                      progress={progress}
                      onAddChart={() => {
                        setCustomCharts(prev => [...prev, { id: Date.now().toString(), code: chartCode || '' }]);
                        resetChart();
                      }}
                      onResetChart={resetChart}
                    />
                  </div>
                </div>
              </div>
            }
          >
            <div css={{ padding: `0 0 ${theme.spacing.md}px 0` }}>
              <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
                {/* Display existing custom charts */}
                {customCharts.length > 0 && (
                  <div css={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
                    gap: theme.spacing.md,
                    marginTop: theme.spacing.md
                  }}>
                    {customCharts.map((chart) => (
                      <div
                        key={chart.id}
                        css={{
                          border: `1px solid ${theme.colors.border}`,
                          borderRadius: theme.borders.borderRadiusMd,
                          padding: theme.spacing.md,
                          backgroundColor: theme.colors.backgroundSecondary,
                        }}
                      >
                        <div css={{ 
                          fontSize: theme.typography.fontSizeSm,
                          fontWeight: theme.typography.typographyBoldFontWeight,
                          color: theme.colors.textSecondary,
                          marginBottom: theme.spacing.sm
                        }}>
                          Custom Chart {chart.id}
                        </div>
                        <ChartRenderer 
                          chartCode={chart.code} 
                          runId={runInfo.runUuid} 
                          experimentId={runInfo.experimentId} 
                        />
                        <div css={{ 
                          display: 'flex', 
                          justifyContent: 'flex-end', 
                          marginTop: theme.spacing.sm,
                          gap: theme.spacing.sm
                        }}>
                          <Button
                            componentId="mlflow.custom-charts.remove-chart"
                            onClick={() => {
                              setCustomCharts(prev => prev.filter(c => c.id !== chart.id));
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Accordion.Panel>
        </MetricChartsAccordion>
      </div>
      
      {configuredCardConfig && (
        <RunsChartsConfigureModal
          chartRunData={chartData}
          metricKeyList={metricKeys}
          paramKeyList={[]}
          config={configuredCardConfig}
          onSubmit={submitForm}
          onCancel={() => setConfiguredCardConfig(null)}
          groupBy={null}
          supportedChartTypes={[RunsChartType.LINE, RunsChartType.BAR, RunsChartType.IMAGE]}
          globalLineChartConfig={chartUIState.globalLineChartConfig}
        />
      )}
      <RunsChartsFullScreenModal
        fullScreenChart={fullScreenChart}
        onCancel={() => setFullScreenChart(undefined)}
        chartData={chartData}
        tooltipContextValue={tooltipContextValue}
        tooltipComponent={RunViewChartTooltipBody}
        autoRefreshEnabled={autoRefreshEnabled}
        groupBy={null}
      />
    </div>
  );
};

export const RunViewMetricCharts = (props: RunViewMetricChartsProps) => {
  const persistenceIdentifier = `${props.runInfo.runUuid}-${props.mode}`;

  const localStore = useMemo(
    () => LocalStorageUtils.getStoreForComponent('RunPage', persistenceIdentifier),
    [persistenceIdentifier],
  );

  const [chartUIState, updateChartsUIState] = useState<ExperimentRunsChartsUIConfiguration>(() => {
    const defaultChartState: ExperimentRunsChartsUIConfiguration = {
      isAccordionReordered: false,
      compareRunCharts: undefined,
      compareRunSections: undefined,
      // Auto-refresh is enabled by default only if the flag is set
      autoRefreshEnabled: shouldEnableRunDetailsPageAutoRefresh(),
      globalLineChartConfig: {
        xAxisKey: RunsChartsLineChartXAxisType.STEP,
        lineSmoothness: 0,
        selectedXAxisMetricKey: '',
      },
    };
    try {
      const persistedChartState = localStore.getItem('chartUIState');

      if (!persistedChartState) {
        return defaultChartState;
      }
      return JSON.parse(persistedChartState);
    } catch {
      return defaultChartState;
    }
  });

  useEffect(() => {
    localStore.setItem('chartUIState', JSON.stringify(chartUIState));
  }, [chartUIState, localStore]);

  return (
    <RunsChartsUIConfigurationContextProvider updateChartsUIState={updateChartsUIState}>
      <RunViewMetricChartsImpl {...props} chartUIState={chartUIState} updateChartsUIState={updateChartsUIState} />
    </RunsChartsUIConfigurationContextProvider>
  );
};

const RunViewMetricChartsSkeleton = ({ className }: { className?: string }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '200px',
        gap: theme.spacing.md,
      }}
      className={className}
    >
      {new Array(6).fill(null).map((_, index) => (
        <TableSkeleton key={index} lines={5} seed={index.toString()} />
      ))}
    </div>
  );
};
