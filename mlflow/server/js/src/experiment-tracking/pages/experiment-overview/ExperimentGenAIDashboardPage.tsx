import { useEffect, useMemo, useState, type ReactNode } from 'react';
import invariant from 'invariant';
import { useParams } from '../../../common/utils/RoutingUtils';
import {
  Alert,
  Button,
  ChartLineIcon,
  ChevronDownIcon,
  ClockIcon,
  DropdownMenu,
  GavelIcon,
  Input,
  PlusIcon,
  RangePicker,
  RefreshIcon,
  SearchIcon,
  Tabs,
  Tag,
  Tooltip,
  TerminalIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';
import { useIsFileStore } from '../../hooks/useServerInfo';
import { ExperimentViewTracesStatusLabels } from '@databricks/web-shared/genai-traces-table';
import {
  useMonitoringFilters,
  getAbsoluteStartEndTime,
  DEFAULT_START_TIME_LABEL,
  type START_TIME_LABEL,
} from '../../hooks/useMonitoringFilters';
import { MonitoringConfigProvider, useMonitoringConfig } from '../../hooks/useMonitoringConfig';
import { useGetExperimentQuery } from '../../hooks/useExperimentQuery';
import { LazyTraceRequestsChart } from './components/LazyTraceRequestsChart';
import { LazyTraceLatencyChart } from './components/LazyTraceLatencyChart';
import { LazyTraceErrorsChart } from './components/LazyTraceErrorsChart';
import { LazyTraceTokenUsageChart } from './components/LazyTraceTokenUsageChart';
import { LazyTraceTokenStatsChart } from './components/LazyTraceTokenStatsChart';
import { LazyTraceCostBreakdownChart } from './components/LazyTraceCostBreakdownChart';
import { LazyTraceCostOverTimeChart } from './components/LazyTraceCostOverTimeChart';
import { AssessmentChartsSection } from './components/AssessmentChartsSection';
import { ToolCallStatistics } from './components/ToolCallStatistics';
import { ToolCallChartsSection } from './components/ToolCallChartsSection';
import { LazyToolUsageChart } from './components/LazyToolUsageChart';
import { LazyToolLatencyChart } from './components/LazyToolLatencyChart';
import { LazyToolPerformanceSummary } from './components/LazyToolPerformanceSummary';
import { TabContentContainer, ChartGrid } from './components/OverviewLayoutComponents';
import { TIME_UNIT_SECONDS, TimeUnit, calculateDefaultTimeUnit, isTimeUnitValid } from './utils/timeUtils';
import { generateTimeBuckets } from './utils/chartUtils';
import { OverviewChartProvider } from './OverviewChartContext';
import { useOverviewTab, OverviewTab } from './hooks/useOverviewTab';
import { getNamedDateFilters } from '../../components/experiment-page/components/traces-v3/utils/dateUtils';
import { MetricsFilter } from '../../../common/components/MetricsFilter';
import {
  translateToMetricsFilters,
  translateToTracesPageFilters,
  TRACE_STATE_VALUES,
  type MetricFilter,
  type MetricFilterColumnOption,
} from '../../../common/components/MetricsFilter.utils';

const DEMO_START_TIME_TAG = 'mlflow.demo.start_time_ms';
const DEMO_END_TIME_TAG = 'mlflow.demo.end_time_ms';

type DashboardSelectorOption = {
  value: OverviewTab;
  title: string;
  description: string;
  icon: ReactNode;
};

const DashboardSelector = ({
  activeTab,
  onChange,
}: {
  activeTab: OverviewTab;
  onChange: (tab: OverviewTab) => void;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const [searchQuery, setSearchQuery] = useState('');

  const dashboardOptions = useMemo<DashboardSelectorOption[]>(
    () => [
      {
        value: OverviewTab.Usage,
        title: intl.formatMessage({
          defaultMessage: 'Project overview',
          description: 'Dashboard selector option for the project overview dashboard',
        }),
        description: intl.formatMessage({
          defaultMessage: 'Usage, errors, latency, cost, and trace volume.',
          description: 'Dashboard selector description for the project overview dashboard',
        }),
        icon: <ChartLineIcon css={{ color: theme.colors.actionPrimaryBackgroundDefault }} />,
      },
      {
        value: OverviewTab.Quality,
        title: intl.formatMessage({
          defaultMessage: 'Eval & Quality',
          description: 'Dashboard selector option for the eval and quality dashboard',
        }),
        description: intl.formatMessage({
          defaultMessage: 'Evaluation scores, judge results, and quality trends.',
          description: 'Dashboard selector description for the eval and quality dashboard',
        }),
        icon: <GavelIcon css={{ color: theme.colors.actionPrimaryBackgroundDefault }} />,
      },
      {
        value: OverviewTab.ToolCalls,
        title: intl.formatMessage({
          defaultMessage: 'Tools / Skills / MCP',
          description: 'Dashboard selector option for the tools, skills, and MCP dashboard',
        }),
        description: intl.formatMessage({
          defaultMessage: 'Tool calls, skill usage, failures, and latency breakdowns.',
          description: 'Dashboard selector description for the tools, skills, and MCP dashboard',
        }),
        icon: <TerminalIcon css={{ color: theme.colors.actionPrimaryBackgroundDefault }} />,
      },
    ],
    [intl, theme.colors.actionPrimaryBackgroundDefault],
  );

  const selectedOption = dashboardOptions.find(({ value }) => value === activeTab) ?? dashboardOptions[0];
  const filteredOptions = dashboardOptions.filter((option) =>
    option.title.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()),
  );

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          componentId="mlflow.experiment.dashboard.selector.trigger"
          icon={selectedOption.icon}
          endIcon={<ChevronDownIcon />}
          aria-label={intl.formatMessage({
            defaultMessage: 'Select dashboard',
            description: 'Aria label for the dashboard selector',
          })}
          css={{
            paddingLeft: theme.spacing.sm,
            paddingRight: theme.spacing.sm,
            maxWidth: '100%',
          }}
        >
          {selectedOption.title}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" css={{ width: 400, padding: theme.spacing.sm }}>
        <div css={{ padding: `${theme.spacing.xs}px ${theme.spacing.xs}px ${theme.spacing.sm}px` }}>
          <Input
            componentId="mlflow.experiment.dashboard.selector.search"
            prefix={<SearchIcon />}
            allowClear
            value={searchQuery}
            placeholder={intl.formatMessage({
              defaultMessage: 'Search dashboards',
              description: 'Placeholder for the dashboard selector search input',
            })}
            aria-label={intl.formatMessage({
              defaultMessage: 'Search dashboards',
              description: 'Aria label for the dashboard selector search input',
            })}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <DropdownMenu.RadioGroup
          componentId="mlflow.experiment.dashboard.selector.group"
          value={activeTab}
          onValueChange={(value) => onChange(value as OverviewTab)}
        >
          {filteredOptions.map((option) => (
            <DropdownMenu.RadioItem
              key={option.value}
              value={option.value}
              css={{
                minHeight: 76,
                alignItems: 'flex-start',
                paddingTop: theme.spacing.sm,
                paddingBottom: theme.spacing.sm,
                gap: theme.spacing.sm,
              }}
            >
              <DropdownMenu.ItemIndicator />
              <span
                css={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: theme.spacing.lg,
                  height: theme.spacing.lg,
                  color: theme.colors.textSecondary,
                  flexShrink: 0,
                }}
              >
                {option.icon}
              </span>
              <span css={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
                  <Typography.Text bold ellipsis>
                    {option.title}
                  </Typography.Text>
                  <Tag
                    componentId="mlflow.experiment.dashboard.selector.built-in-tag"
                    css={{
                      backgroundColor: theme.isDarkMode ? theme.colors.blue800 : theme.colors.blue100,
                      borderColor: theme.isDarkMode ? theme.colors.blue700 : theme.colors.blue200,
                      color: theme.isDarkMode ? theme.colors.blue100 : theme.colors.blue700,
                    }}
                  >
                    <FormattedMessage defaultMessage="Built-in" description="Built-in dashboard tag label" />
                  </Tag>
                </span>
                <Typography.Text color="secondary" size="sm" ellipsis>
                  {option.description}
                </Typography.Text>
              </span>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          componentId="mlflow.experiment.dashboard.selector.add-new"
          css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, padding: theme.spacing.sm }}
        >
          <PlusIcon />
          <FormattedMessage defaultMessage="Add new" description="Add new dashboard menu item" />
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

const formatDateShort = (date?: string) => {
  if (!date) {
    return '';
  }
  return new Date(date).toLocaleDateString(navigator.language, {
    month: 'short',
    day: 'numeric',
  });
};

const getFallbackStartTime = (dateNow: Date) => {
  const fallbackStart = new Date(dateNow);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 7);
  return fallbackStart.toISOString();
};

const DashboardTimeRangeSelector = ({
  monitoringFilters,
  setMonitoringFilters,
  startTime,
  endTime,
  selectedTimeUnit,
  effectiveTimeUnit,
  defaultTimeUnit,
  onTimeUnitChange,
  onTimeUnitClear,
  startTimeMs,
  endTimeMs,
  dateNow,
}: {
  monitoringFilters: ReturnType<typeof useMonitoringFilters>[0];
  setMonitoringFilters: ReturnType<typeof useMonitoringFilters>[1];
  startTime?: string;
  endTime?: string;
  selectedTimeUnit: TimeUnit | null;
  effectiveTimeUnit: TimeUnit;
  defaultTimeUnit: TimeUnit;
  onTimeUnitChange: (timeUnit: TimeUnit) => void;
  onTimeUnitClear: () => void;
  startTimeMs?: number;
  endTimeMs?: number;
  dateNow: Date;
}) => {
  const intl = useIntl();
  const { theme } = useDesignSystemTheme();
  const currentStartTimeLabel = monitoringFilters.startTimeLabel ?? DEFAULT_START_TIME_LABEL;

  const namedDateFilters = useMemo(
    () => getNamedDateFilters(intl).filter((namedDateFilter) => namedDateFilter.key !== 'ALL'),
    [intl],
  );

  const timeUnitOptions = useMemo(
    () =>
      [
        {
          value: TimeUnit.Second,
          label: intl.formatMessage({ defaultMessage: 'Second', description: 'Time unit: second' }),
        },
        {
          value: TimeUnit.Minute,
          label: intl.formatMessage({ defaultMessage: 'Minute', description: 'Time unit: minute' }),
        },
        {
          value: TimeUnit.Hour,
          label: intl.formatMessage({ defaultMessage: 'Hour', description: 'Time unit: hour' }),
        },
        {
          value: TimeUnit.Day,
          label: intl.formatMessage({ defaultMessage: 'Day', description: 'Time unit: day' }),
        },
        {
          value: TimeUnit.Month,
          label: intl.formatMessage({ defaultMessage: 'Month', description: 'Time unit: month' }),
        },
        {
          value: TimeUnit.Year,
          label: intl.formatMessage({ defaultMessage: 'Year', description: 'Time unit: year' }),
        },
      ].filter((option) => isTimeUnitValid(startTimeMs, endTimeMs, option.value)),
    [endTimeMs, intl, startTimeMs],
  );

  const selectedDateFilterLabel =
    namedDateFilters.find((namedDateFilter) => namedDateFilter.key === currentStartTimeLabel)?.label ??
    namedDateFilters.find((namedDateFilter) => namedDateFilter.key === DEFAULT_START_TIME_LABEL)?.label;
  const selectedTimeUnitLabel = timeUnitOptions.find((option) => option.value === effectiveTimeUnit)?.label;
  const triggerTimeRangeLabel =
    currentStartTimeLabel === 'CUSTOM'
      ? `${formatDateShort(startTime)} - ${formatDateShort(endTime ?? dateNow.toISOString())}`
      : selectedDateFilterLabel;

  const handleTimeRangeChange = (startTimeLabel: START_TIME_LABEL) => {
    if (startTimeLabel === 'CUSTOM') {
      setMonitoringFilters({
        ...monitoringFilters,
        startTimeLabel,
        startTime: startTime ?? getFallbackStartTime(dateNow),
        endTime: endTime ?? dateNow.toISOString(),
      });
      return;
    }
    setMonitoringFilters({
      ...monitoringFilters,
      startTimeLabel,
    });
  };

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          componentId="mlflow.experiment.dashboard.time-range-selector.trigger"
          icon={<ClockIcon />}
          endIcon={<ChevronDownIcon />}
          css={{ whiteSpace: 'nowrap' }}
        >
          {triggerTimeRangeLabel} / {selectedTimeUnitLabel}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" css={{ width: 420 }}>
        <DropdownMenu.Label>
          <FormattedMessage defaultMessage="Time" description="Label for the time range select dropdown" />
        </DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          componentId="mlflow.experiment.dashboard.time-range-selector.range"
          value={currentStartTimeLabel}
          onValueChange={(value) => handleTimeRangeChange(value as START_TIME_LABEL)}
        >
          {namedDateFilters.map((namedDateFilter) => (
            <DropdownMenu.RadioItem key={namedDateFilter.key} value={namedDateFilter.key}>
              <DropdownMenu.ItemIndicator />
              {namedDateFilter.label}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        {currentStartTimeLabel === 'CUSTOM' && (
          <div
            css={{
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <RangePicker
              id="dashboard-date-picker-range"
              includeTime
              selected={{
                from: new Date(startTime ?? getFallbackStartTime(dateNow)),
                to: endTime ? new Date(endTime) : dateNow,
              }}
              onChange={(e) => {
                const date = e.target.value;
                setMonitoringFilters({
                  ...monitoringFilters,
                  startTimeLabel: 'CUSTOM',
                  startTime: date?.from ? date.from.toISOString() : undefined,
                  endTime: date?.to ? date.to.toISOString() : undefined,
                });
              }}
              startDatePickerProps={{
                componentId: 'mlflow.experiment.dashboard.start-date-picker',
                datePickerProps: {
                  disabled: {
                    after: dateNow,
                  },
                },
                value: startTime ? new Date(startTime) : undefined,
              }}
              endDatePickerProps={{
                componentId: 'mlflow.experiment.dashboard.end-date-picker',
                datePickerProps: {
                  disabled: {
                    after: dateNow,
                  },
                },
                value: endTime ? new Date(endTime) : undefined,
              }}
            />
          </div>
        )}
        <DropdownMenu.Separator />
        <DropdownMenu.Label>
          <FormattedMessage
            defaultMessage="Group by"
            description="Experiment page > group by runs control > trigger button label > empty"
          />
        </DropdownMenu.Label>
        <DropdownMenu.RadioGroup
          componentId="mlflow.experiment.dashboard.time-range-selector.time-unit"
          value={effectiveTimeUnit}
          onValueChange={(value) => onTimeUnitChange(value as TimeUnit)}
        >
          {timeUnitOptions.map((option) => (
            <DropdownMenu.RadioItem key={option.value} value={option.value}>
              <DropdownMenu.ItemIndicator />
              {option.label}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
        {selectedTimeUnit !== null && selectedTimeUnit !== defaultTimeUnit && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              componentId="mlflow.experiment.dashboard.time-range-selector.clear"
              onClick={onTimeUnitClear}
            >
              <FormattedMessage defaultMessage="Clear" description="Text for the clear button in a form field" />
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

const ExperimentGenAIDashboardPageImpl = () => {
  const intl = useIntl();
  const { experimentId } = useParams();
  const { theme } = useDesignSystemTheme();
  const [activeTab, setActiveTab] = useOverviewTab();
  const [selectedTimeUnit, setSelectedTimeUnit] = useState<TimeUnit | null>(null);
  const isFileStore = useIsFileStore();

  // all features should be enabled in OSS
  const enableAllCharts = true;

  invariant(experimentId, 'Experiment ID must be defined');

  // Fetch experiment data to check for demo time tags
  const { data: experiment } = useGetExperimentQuery({ experimentId });

  // Get the current time range from monitoring filters
  const [monitoringFilters, setMonitoringFilters] = useMonitoringFilters();
  const monitoringConfig = useMonitoringConfig();

  // Initialize with demo time range if this is a demo experiment
  useEffect(() => {
    if (!experiment || monitoringFilters.startTimeLabel !== DEFAULT_START_TIME_LABEL) {
      return;
    }

    // Check if this is a demo experiment by looking for demo version tags
    const hasDemoVersionTag = experiment.tags?.some((tag) => tag.key?.startsWith('mlflow.demo.version.'));

    if (hasDemoVersionTag) {
      const startTimeTag = experiment.tags?.find((tag) => tag.key === DEMO_START_TIME_TAG);
      const endTimeTag = experiment.tags?.find((tag) => tag.key === DEMO_END_TIME_TAG);

      if (startTimeTag?.value && endTimeTag?.value) {
        const startTime = new Date(parseInt(startTimeTag.value, 10)).toISOString();
        const endTime = new Date(parseInt(endTimeTag.value, 10)).toISOString();

        setMonitoringFilters(
          {
            startTimeLabel: 'CUSTOM',
            startTime,
            endTime,
          },
          true,
        );
      }
    }
  }, [experiment, monitoringFilters.startTimeLabel, setMonitoringFilters]);

  // 'ALL' is excluded from the date selector on this page since charts require
  // start_time_ms and end_time_ms. If the user navigates here with ?startTimeLabel=ALL,
  // reset to the default time range.
  useEffect(() => {
    if (monitoringFilters.startTimeLabel === 'ALL') {
      setMonitoringFilters({ startTimeLabel: DEFAULT_START_TIME_LABEL }, true);
    }
  }, [monitoringFilters.startTimeLabel, setMonitoringFilters]);

  // Use getAbsoluteStartEndTime to properly compute time range from labels
  const { startTime, endTime } = useMemo(
    () => getAbsoluteStartEndTime(monitoringConfig.dateNow, monitoringFilters),
    [monitoringConfig.dateNow, monitoringFilters],
  );

  // Convert ISO strings to milliseconds for the API
  const startTimeMs = startTime ? new Date(startTime).getTime() : undefined;
  const endTimeMs = endTime ? new Date(endTime).getTime() : undefined;

  // Calculate the default time unit for the current time range
  const defaultTimeUnit = calculateDefaultTimeUnit(startTimeMs, endTimeMs);

  // Auto-clear if selected time unit becomes invalid due to time range change
  useEffect(() => {
    if (selectedTimeUnit && !isTimeUnitValid(startTimeMs, endTimeMs, selectedTimeUnit)) {
      setSelectedTimeUnit(null);
    }
  }, [startTimeMs, endTimeMs, selectedTimeUnit]);

  // Use selected if valid, otherwise fall back to default
  const effectiveTimeUnit = selectedTimeUnit ?? defaultTimeUnit;

  // Use the effective time unit for time interval
  const timeIntervalSeconds = TIME_UNIT_SECONDS[effectiveTimeUnit];

  // Generate all time buckets once for all charts
  const timeBuckets = useMemo(
    () => generateTimeBuckets(startTimeMs, endTimeMs, timeIntervalSeconds),
    [startTimeMs, endTimeMs, timeIntervalSeconds],
  );

  // User-driven filter rows captured by MetricsFilter. The MetricsFilter UI is only rendered on
  // the Usage tab, so we scope both the chart-query filters (metrics-API DSL) and the navigation
  // filters (Traces page URL format) to that tab; charts on Quality and Tool calls tabs are
  // unaffected even though they share the same OverviewChartProvider.
  const [metricFilters, setMetricFilters] = useState<MetricFilter[]>([]);
  const isUsageTab = activeTab === OverviewTab.Usage;
  const chartFilters = useMemo(
    () => (isUsageTab ? translateToMetricsFilters(metricFilters) : undefined),
    [isUsageTab, metricFilters],
  );
  const tracesNavigationFilters = useMemo(
    () => (isUsageTab ? translateToTracesPageFilters(metricFilters) : undefined),
    [isUsageTab, metricFilters],
  );
  const metricsFilterColumnOptions = useMemo<MetricFilterColumnOption[]>(
    () => [
      {
        value: 'user',
        label: intl.formatMessage({
          defaultMessage: 'User',
          description: 'Usage overview > metrics filter > user column option label',
        }),
      },
      {
        value: 'session',
        label: intl.formatMessage({
          defaultMessage: 'Session',
          description: 'Usage overview > metrics filter > session column option label',
        }),
      },
      {
        value: 'state',
        label: intl.formatMessage({
          defaultMessage: 'State',
          description: 'Usage overview > metrics filter > state column option label',
        }),
        valueOptions: TRACE_STATE_VALUES.map((value) => ({
          value,
          label: intl.formatMessage(ExperimentViewTracesStatusLabels[value]),
        })),
      },
      {
        value: 'git_branch',
        label: intl.formatMessage({
          defaultMessage: 'Git branch',
          description: 'Usage overview > metrics filter > git branch column option label',
        }),
      },
      {
        value: 'git_commit',
        label: intl.formatMessage({
          defaultMessage: 'Git commit',
          description: 'Usage overview > metrics filter > git commit column option label',
        }),
      },
    ],
    [intl],
  );

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      {isFileStore && (
        <Alert
          componentId="mlflow.experiment.overview.filestore-warning"
          type="warning"
          css={{ marginBottom: theme.spacing.sm }}
          message={
            <FormattedMessage
              defaultMessage="The Overview tab requires a SQL-based tracking store for full functionality, file-based backend is not supported."
              description="Warning banner shown on the Overview tab when using FileStore backend"
            />
          }
        />
      )}
      <Tabs.Root
        componentId="mlflow.experiment.overview.tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as OverviewTab)}
        valueHasNoPii
        css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
            flexWrap: 'wrap',
          }}
        >
          <DashboardSelector activeTab={activeTab} onChange={setActiveTab} />
          <div css={{ flex: 1, minWidth: theme.spacing.md }} />
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: theme.spacing.sm,
              flexWrap: 'wrap',
            }}
          >
            <Tooltip componentId="mlflow.experiment.dashboard.refresh-button.tooltip" content="Refresh dashboard">
              <Button
                componentId="mlflow.experiment.dashboard.refresh-button"
                icon={<RefreshIcon />}
                onClick={() => {
                  monitoringConfig.refresh();
                }}
                css={{ flexShrink: 0 }}
                aria-label="Refresh dashboard"
              />
            </Tooltip>
            {activeTab === OverviewTab.Usage && (
              <MetricsFilter
                filters={metricFilters}
                setFilters={setMetricFilters}
                columnOptions={metricsFilterColumnOptions}
              />
            )}
            <DashboardTimeRangeSelector
              monitoringFilters={monitoringFilters}
              setMonitoringFilters={setMonitoringFilters}
              startTime={startTime}
              endTime={endTime}
              selectedTimeUnit={selectedTimeUnit}
              effectiveTimeUnit={effectiveTimeUnit}
              defaultTimeUnit={defaultTimeUnit}
              onTimeUnitChange={setSelectedTimeUnit}
              onTimeUnitClear={() => setSelectedTimeUnit(null)}
              startTimeMs={startTimeMs}
              endTimeMs={endTimeMs}
              dateNow={monitoringConfig.dateNow}
            />
          </div>
        </div>

        <OverviewChartProvider
          experimentIds={[experimentId]}
          startTimeMs={startTimeMs}
          endTimeMs={endTimeMs}
          timeIntervalSeconds={timeIntervalSeconds}
          timeBuckets={timeBuckets}
          filters={chartFilters}
          tracesNavigationFilters={tracesNavigationFilters}
        >
          <Tabs.Content value={OverviewTab.Usage} css={{ flex: 1, overflowY: 'auto' }}>
            <TabContentContainer>
              {/* Requests chart - full width */}
              <LazyTraceRequestsChart />

              {/* Latency and Errors charts - side by side (latency requires UC) */}
              <ChartGrid>
                {enableAllCharts && <LazyTraceLatencyChart />}
                <LazyTraceErrorsChart enableTraceNavigation={enableAllCharts} />
              </ChartGrid>

              {/* Token Usage and Token Stats charts - side by side (requires UC) */}
              {enableAllCharts && (
                <ChartGrid>
                  <LazyTraceTokenUsageChart />
                  <LazyTraceTokenStatsChart />
                </ChartGrid>
              )}

              {/* Cost Breakdown and Cost Over Time charts - side by side (requires UC) */}
              {enableAllCharts && (
                <ChartGrid>
                  <LazyTraceCostBreakdownChart />
                  <LazyTraceCostOverTimeChart />
                </ChartGrid>
              )}
            </TabContentContainer>
          </Tabs.Content>

          <Tabs.Content value={OverviewTab.Quality} css={{ flex: 1, overflowY: 'auto' }}>
            <TabContentContainer>
              {/* Assessment charts - dynamically rendered based on available assessments */}
              <AssessmentChartsSection enableTraceNavigation={enableAllCharts} />
            </TabContentContainer>
          </Tabs.Content>

          <Tabs.Content value={OverviewTab.ToolCalls} css={{ flex: 1, overflowY: 'auto' }}>
            <TabContentContainer>
              {enableAllCharts ? (
                <>
                  {/* Tool call statistics */}
                  <ToolCallStatistics />

                  {/* Tool performance summary */}
                  <LazyToolPerformanceSummary />

                  {/* Tool usage and latency charts - side by side */}
                  <ChartGrid>
                    <LazyToolUsageChart />
                    <LazyToolLatencyChart />
                  </ChartGrid>

                  {/* Tool error rate charts - dynamically rendered based on available tools */}
                  <ToolCallChartsSection />
                </>
              ) : (
                <Typography.Text color="secondary">
                  <FormattedMessage
                    defaultMessage="Tool call metrics require Unity Catalog trace storage."
                    description="Message shown on Tool Calls tab when experiment uses MySQL trace storage"
                  />
                </Typography.Text>
              )}
            </TabContentContainer>
          </Tabs.Content>
        </OverviewChartProvider>
      </Tabs.Root>
    </div>
  );
};

// Wrap in MonitoringConfigProvider so refresh button updates are received
const ExperimentGenAIDashboardPage = () => (
  <MonitoringConfigProvider>
    <ExperimentGenAIDashboardPageImpl />
  </MonitoringConfigProvider>
);

export default ExperimentGenAIDashboardPage;
