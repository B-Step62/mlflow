import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  ArrowRightIcon,
  Button,
  Card,
  CheckCircleIcon,
  GavelIcon,
  GitCommitIcon,
  PlayIcon,
  SparkleIcon,
  Spinner,
  TableIcon,
  TerminalIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { createTraceLocationForExperiment, useSearchMlflowTraces } from '@databricks/web-shared/genai-traces-table';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAssistant } from '../../../assistant/AssistantContext';
import { Link, useNavigate, useParams } from '../../../common/utils/RoutingUtils';
import { useEndpointsQuery } from '../../../gateway/hooks/useEndpointsQuery';
import { ExperimentPageTabName } from '../../constants';
import { ALL_ISSUE_CATEGORIES } from '../../components/experiment-page/components/traces-v3/IssueDetectionCategories';
import { recordSubmittedIssueDetectionJob } from '../../components/experiment-page/components/traces-v3/IssueDetectionJobNotifications';
import { useInvokeIssueDetection } from '../../components/experiment-page/components/traces-v3/hooks/useInvokeIssueDetection';
import Routes from '../../routes';
import { useHeaderVisibility } from '../experiment-page-tabs/ExperimentPageHeaderVisibilityContext';
import { OverviewChartContainer, useChartXAxisProps, useChartYAxisProps } from './components/OverviewChartComponents';
import {
  FAILURE_ANALYSIS_CLUSTERS,
  FAILURE_ANALYSIS_TOTAL_CONVERSATIONS,
  MOCK_FAILURE_ANALYSIS_RUN_ID,
  RECENT_ACTIVITY,
  TRACE_ACTIVITY_HOURS,
} from './failureAnalysisMock';

type SuggestedAction = {
  title: React.ReactNode;
  description: React.ReactNode;
  icon: React.ReactNode;
  to?: string;
  onClick?: () => void;
};

type SuggestedQuery = {
  componentId: string;
  label: React.ReactNode;
  prompt: string;
  icon?: React.ReactNode;
};

const ANALYSIS_DELAY_MS = 1400;
const COMPACT_TRACE_CHART_HEIGHT = 132;
const OVERVIEW_PANEL_HEIGHT = 260;
const RECENT_TRACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ISSUE_DETECTION_DEFAULT_PROVIDER = 'openai';
const ISSUE_DETECTION_DEFAULT_MODEL = 'gpt-5.4';

type AnalysisState = 'idle' | 'preparing' | 'submitted' | 'complete';

const getRecentTraceTimeRange = () => {
  const endTimeMs = Date.now();
  return {
    startTime: String(endTimeMs - RECENT_TRACE_WINDOW_MS),
    endTime: String(endTimeMs),
  };
};

const getActionRowCss = (theme: ReturnType<typeof useDesignSystemTheme>['theme'], index: number) => ({
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: theme.spacing.md,
  padding: theme.spacing.md,
  border: 0,
  borderTop: index === 0 ? 0 : `1px solid ${theme.colors.border}`,
  backgroundColor: 'transparent',
  color: theme.colors.textPrimary,
  textAlign: 'left' as const,
  cursor: 'pointer',
  ':hover': {
    backgroundColor: theme.colors.actionDefaultBackgroundHover,
    textDecoration: 'none',
  },
});

const SuggestedActionRow = ({ action, index }: { action: SuggestedAction; index: number }) => {
  const { theme } = useDesignSystemTheme();

  const content = (
    <>
      <span
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: theme.spacing.xl,
          height: theme.spacing.xl,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.actionTertiaryBackgroundHover,
          color: theme.colors.actionPrimaryBackgroundDefault,
          flexShrink: 0,
        }}
      >
        {action.icon}
      </span>
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, minWidth: 0 }}>
        <Typography.Text bold ellipsis>
          {action.title}
        </Typography.Text>
        <Typography.Text color="secondary" size="sm" ellipsis>
          {action.description}
        </Typography.Text>
      </div>
    </>
  );

  if (action.to) {
    return (
      <Link componentId="mlflow.genai-overview.suggested-action-link" to={action.to} css={{ textDecoration: 'none' }}>
        <div css={getActionRowCss(theme, index)}>{content}</div>
      </Link>
    );
  }

  return (
    <button
      key={index}
      type="button"
      css={{ ...getActionRowCss(theme, index), font: 'inherit' }}
      onClick={action.onClick}
    >
      {content}
    </button>
  );
};

const TraceActivityChart = ({ hasTraceActivity }: { hasTraceActivity: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const traceActivityData = useMemo(
    () => TRACE_ACTIVITY_HOURS.map((hour) => ({ name: hour.label, count: hasTraceActivity ? hour.count : 0 })),
    [hasTraceActivity],
  );
  return (
    <OverviewChartContainer
      componentId="mlflow.genai-overview.trace-activity-chart"
      css={{ padding: theme.spacing.md }}
    >
      <div css={{ height: COMPACT_TRACE_CHART_HEIGHT, minWidth: 0, userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={traceActivityData} margin={{ top: 4, right: 20, left: 10, bottom: 0 }}>
            <XAxis dataKey="name" {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip
              formatter={(value) => [`${value}`, 'Traces'] as [string, string]}
              cursor={{ fill: theme.colors.actionTertiaryBackgroundHover }}
              wrapperStyle={{ pointerEvents: 'auto' }}
            />
            <Bar dataKey="count" fill={theme.colors.blue400} radius={[4, 4, 0, 0]} barSize={8} maxBarSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </OverviewChartContainer>
  );
};

const RecentActivityPanel = ({ tracesRoute, hasTraceActivity }: { tracesRoute: string; hasTraceActivity: boolean }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <section css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, minWidth: 0 }}>
      <Typography.Title level={3} css={{ margin: 0 }}>
        <FormattedMessage defaultMessage="Recent activity" description="GenAI overview recent activity title" />
      </Typography.Title>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.lg,
          padding: theme.spacing.lg,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.backgroundPrimary,
          boxSizing: 'border-box',
          height: OVERVIEW_PANEL_HEIGHT,
        }}
      >
        {hasTraceActivity ? (
          RECENT_ACTIVITY.map((activityGroup) => (
            <div
              key={activityGroup.id}
              css={{
                display: 'grid',
                gridTemplateColumns: '108px minmax(0, 1fr)',
                gap: theme.spacing.md,
                alignItems: 'start',
              }}
            >
              <Typography.Text color="secondary" size="sm">
                {activityGroup.label}
              </Typography.Text>
              <div
                css={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: theme.spacing.sm,
                  borderLeft: `1px solid ${theme.colors.border}`,
                  paddingLeft: theme.spacing.md,
                  minWidth: 0,
                }}
              >
                {activityGroup.items.map((activity) => (
                  <Link
                    key={activity.id}
                    componentId="mlflow.genai-overview.recent-activity-traces-link"
                    to={tracesRoute}
                    css={{ color: theme.colors.textPrimary, textDecoration: 'none' }}
                  >
                    <div
                      css={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: theme.spacing.md,
                        alignItems: 'center',
                        minWidth: 0,
                        margin: -theme.spacing.xs,
                        padding: theme.spacing.xs,
                        borderRadius: theme.borders.borderRadiusSm,
                        ':hover': {
                          backgroundColor: theme.colors.actionDefaultBackgroundHover,
                        },
                      }}
                    >
                      <div css={{ display: 'flex', gap: theme.spacing.md, alignItems: 'center', minWidth: 0 }}>
                        <TableIcon css={{ color: theme.colors.actionPrimaryBackgroundDefault, flexShrink: 0 }} />
                        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs, minWidth: 0 }}>
                          <Typography.Text bold ellipsis>
                            {activity.title}
                          </Typography.Text>
                          <Typography.Text color="secondary" size="sm" ellipsis>
                            {activity.description}
                          </Typography.Text>
                        </div>
                      </div>
                      <Typography.Text color="secondary" size="sm" css={{ whiteSpace: 'nowrap' }}>
                        {activity.age}
                      </Typography.Text>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div
            css={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
              textAlign: 'center',
            }}
          >
            <Typography.Text bold>
              <FormattedMessage defaultMessage="No recent activity yet" description="GenAI overview empty activity" />
            </Typography.Text>
            <Typography.Text color="secondary">
              <FormattedMessage
                defaultMessage="Trace activity will appear here after traces are logged."
                description="GenAI overview empty activity description"
              />
            </Typography.Text>
          </div>
        )}
      </div>
    </section>
  );
};

const SuggestedActionsPanel = ({ actions }: { actions: SuggestedAction[] }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <section css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, minWidth: 0 }}>
      <Typography.Title level={3} css={{ margin: 0 }}>
        <FormattedMessage defaultMessage="Suggested actions" description="GenAI overview suggested actions title" />
      </Typography.Title>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          padding: theme.spacing.lg,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          backgroundColor: theme.colors.backgroundPrimary,
          boxSizing: 'border-box',
          height: OVERVIEW_PANEL_HEIGHT,
        }}
      >
        {actions.map((action, index) => (
          <SuggestedActionRow key={index} action={action} index={index} />
        ))}
      </div>
    </section>
  );
};

const ExperimentGenAIOverviewPage = () => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const { experimentId } = useParams<{ experimentId: string }>();
  const navigate = useNavigate();
  const { setHeaderHidden } = useHeaderVisibility();
  const { closePanel, openPanel, prefillPrompt } = useAssistant();
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [isIssueDetectionQueued, setIsIssueDetectionQueued] = useState(false);
  const [usesMockAnalysis, setUsesMockAnalysis] = useState(false);
  const [analysisTraceCount, setAnalysisTraceCount] = useState(FAILURE_ANALYSIS_TOTAL_CONVERSATIONS);

  const safeExperimentId = experimentId ?? '';
  const tracesRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Traces);
  const evaluationRunsRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.EvaluationRuns);
  const playgroundRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Playground);
  const analysisRoute = Routes.getIssueDetectionRunDetailsRoute(safeExperimentId, MOCK_FAILURE_ANALYSIS_RUN_ID);
  const analysisIssuesRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Issues);
  const [submittedAnalysisRoute, setSubmittedAnalysisRoute] = useState(analysisRoute);
  const recentTraceTimeRange = useMemo(getRecentTraceTimeRange, []);
  const traceSearchLocations = useMemo(
    () => (safeExperimentId ? [createTraceLocationForExperiment(safeExperimentId)] : []),
    [safeExperimentId],
  );
  const { data: endpoints, isLoading: isLoadingEndpoints } = useEndpointsQuery();
  const {
    data: tracePresence,
    isLoading: isLoadingTracePresence,
    isFetching: isFetchingTracePresence,
  } = useSearchMlflowTraces({
    locations: traceSearchLocations,
    disabled: !safeExperimentId,
    limit: 1,
    enablePagination: false,
  });
  const {
    data: recentTraces,
    isLoading: isLoadingRecentTraces,
    isFetching: isFetchingRecentTraces,
    refetchMlflowTraces,
  } = useSearchMlflowTraces({
    locations: traceSearchLocations,
    timeRange: recentTraceTimeRange,
    disabled: !safeExperimentId,
    enablePagination: false,
  });
  const hasTraceActivity = Boolean(tracePresence?.length);
  const shouldShowTraceActivity = isLoadingTracePresence || isFetchingTracePresence || hasTraceActivity;
  const { mutate: invokeIssueDetection, isLoading: isInvokingIssueDetection } = useInvokeIssueDetection();
  const isAnalysisRunning =
    analysisState === 'preparing' ||
    analysisState === 'submitted' ||
    isIssueDetectionQueued ||
    isInvokingIssueDetection;

  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, [setHeaderHidden]);

  useEffect(() => {
    closePanel();
  }, [closePanel]);

  useEffect(() => {
    if (analysisState !== 'preparing' || !usesMockAnalysis) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAnalysisState('complete');
    }, ANALYSIS_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [analysisState, usesMockAnalysis]);

  const runMockAnalysis = useCallback(() => {
    setUsesMockAnalysis(true);
    setAnalysisTraceCount(FAILURE_ANALYSIS_TOTAL_CONVERSATIONS);
    setSubmittedAnalysisRoute(analysisIssuesRoute);
    setAnalysisState('preparing');
  }, [analysisIssuesRoute]);

  useEffect(() => {
    if (
      !isIssueDetectionQueued ||
      isLoadingEndpoints ||
      isLoadingRecentTraces ||
      isFetchingRecentTraces ||
      isInvokingIssueDetection
    ) {
      return;
    }

    setIsIssueDetectionQueued(false);

    const endpoint = endpoints[0];
    const traceIds = (recentTraces ?? [])
      .map((trace) => trace.trace_id)
      .filter((traceId): traceId is string => Boolean(traceId));

    if (!safeExperimentId || !endpoint || traceIds.length === 0) {
      runMockAnalysis();
      return;
    }

    setUsesMockAnalysis(false);
    setAnalysisTraceCount(traceIds.length);
    setAnalysisState('preparing');
    invokeIssueDetection(
      {
        experimentId: safeExperimentId,
        traceIds,
        categories: ALL_ISSUE_CATEGORIES,
        provider: ISSUE_DETECTION_DEFAULT_PROVIDER,
        model: ISSUE_DETECTION_DEFAULT_MODEL,
        endpoint_name: endpoint.name,
      },
      {
        onSuccess: (response) => {
          const runRoute = Routes.getIssueDetectionRunDetailsRoute(safeExperimentId, response.run_id);
          setSubmittedAnalysisRoute(runRoute);
          setAnalysisState('submitted');
          recordSubmittedIssueDetectionJob({
            experimentId: safeExperimentId,
            jobId: response.job_id,
            runId: response.run_id,
            traceCount: traceIds.length,
          });
        },
        onError: runMockAnalysis,
      },
    );
  }, [
    endpoints,
    invokeIssueDetection,
    isFetchingRecentTraces,
    isInvokingIssueDetection,
    isIssueDetectionQueued,
    isLoadingEndpoints,
    isLoadingRecentTraces,
    recentTraces,
    runMockAnalysis,
    safeExperimentId,
  ]);

  const runAnalysis = () => {
    if (isAnalysisRunning) {
      return;
    }

    setUsesMockAnalysis(false);
    setSubmittedAnalysisRoute(analysisRoute);
    setAnalysisState('preparing');
    refetchMlflowTraces?.();
    setIsIssueDetectionQueued(true);
  };

  const openAssistantWithPrompt = (prompt: string) => {
    openPanel();
    prefillPrompt(prompt);
  };

  const suggestedActions: SuggestedAction[] = shouldShowTraceActivity
    ? [
        {
          title: <FormattedMessage defaultMessage="Detect issues" description="GenAI overview detect issues action" />,
          description: (
            <FormattedMessage
              defaultMessage="Analyze traces from the last 7 days"
              description="GenAI overview detect issues action description"
            />
          ),
          icon: isAnalysisRunning ? <Spinner size="small" /> : <SparkleIcon color="ai" />,
          onClick: runAnalysis,
        },
        {
          title: <FormattedMessage defaultMessage="Setup eval" description="GenAI overview setup eval action" />,
          description: (
            <FormattedMessage
              defaultMessage="Turn trace samples into eval runs"
              description="GenAI overview setup eval action description"
            />
          ),
          icon: <GavelIcon />,
          to: evaluationRunsRoute,
        },
        {
          title: (
            <FormattedMessage defaultMessage="Connect GitHub" description="GenAI overview connect GitHub action" />
          ),
          description: (
            <FormattedMessage
              defaultMessage="Correlate regressions with commits"
              description="GenAI overview connect GitHub action description"
            />
          ),
          icon: <GitCommitIcon />,
        },
      ]
    : [
        {
          title: <FormattedMessage defaultMessage="Setup tracing" description="GenAI overview setup tracing action" />,
          description: (
            <FormattedMessage
              defaultMessage="Instrument your app with MLflow"
              description="GenAI overview setup tracing action description"
            />
          ),
          icon: <TerminalIcon />,
          to: tracesRoute,
        },
        {
          title: <FormattedMessage defaultMessage="Try playground" description="GenAI overview playground action" />,
          description: (
            <FormattedMessage
              defaultMessage="Create traces from prompt experiments"
              description="GenAI overview playground action description"
            />
          ),
          icon: <PlayIcon />,
          to: playgroundRoute,
        },
        {
          title: (
            <FormattedMessage defaultMessage="Connect GitHub" description="GenAI overview connect GitHub action" />
          ),
          description: (
            <FormattedMessage
              defaultMessage="Correlate regressions with commits"
              description="GenAI overview connect GitHub action description"
            />
          ),
          icon: <GitCommitIcon />,
        },
      ];
  const suggestedQueries: SuggestedQuery[] = shouldShowTraceActivity
    ? [
        {
          componentId: 'mlflow.genai-overview.detect-issues-query',
          label: <FormattedMessage defaultMessage="Detect issues" description="GenAI overview suggested query" />,
          prompt: intl.formatMessage({
            defaultMessage: 'Detect issues',
            description: 'GenAI overview suggested query',
          }),
          icon: <SparkleIcon color="ai" />,
        },
        {
          componentId: 'mlflow.genai-overview.setup-eval-query',
          label: <FormattedMessage defaultMessage="Setup eval" description="GenAI overview suggested query" />,
          prompt: intl.formatMessage({
            defaultMessage: 'Setup eval',
            description: 'GenAI overview suggested query',
          }),
          icon: <SparkleIcon color="ai" />,
        },
      ]
    : [
        {
          componentId: 'mlflow.genai-overview.how-get-started',
          label: (
            <FormattedMessage
              defaultMessage="How do I get started with MLflow?"
              description="GenAI overview suggested query"
            />
          ),
          prompt: intl.formatMessage({
            defaultMessage: 'How do I get started with MLflow?',
            description: 'GenAI overview suggested query',
          }),
          icon: <SparkleIcon color="ai" />,
        },
        {
          componentId: 'mlflow.genai-overview.how-trace-agent',
          label: (
            <FormattedMessage defaultMessage="How to trace my agent?" description="GenAI overview suggested query" />
          ),
          prompt: intl.formatMessage({
            defaultMessage: 'How to trace my agent?',
            description: 'GenAI overview suggested query',
          }),
          icon: <SparkleIcon color="ai" />,
        },
      ];

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flex: 1,
        overflowY: 'auto',
        padding: `${theme.spacing.xl}px ${theme.spacing.lg}px`,
      }}
    >
      <div css={{ width: '100%', maxWidth: 1120, display: 'flex', flexDirection: 'column', gap: theme.spacing.xl }}>
        <section
          css={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: theme.spacing.lg,
            paddingTop: theme.spacing.lg,
          }}
        >
          <div
            css={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 18px)',
              gap: theme.spacing.xs,
              color: theme.colors.border,
            }}
            aria-hidden="true"
          >
            {[...Array(6)].map((_, index) => (
              <div
                key={index}
                css={{
                  width: 18,
                  height: 18,
                  borderRadius: theme.borders.borderRadiusMd,
                  backgroundColor: theme.colors.actionDefaultBackgroundHover,
                }}
              />
            ))}
          </div>
          <Typography.Title level={1} css={{ margin: 0, textAlign: 'center' }}>
            <FormattedMessage
              defaultMessage="Let's improve your agent"
              description="GenAI overview main prompt title"
            />
          </Typography.Title>
          <div
            css={{
              width: 'min(100%, 760px)',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.colors.backgroundPrimary,
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(31, 39, 51, 0.06)',
              ':focus-within': {
                borderColor: theme.colors.actionPrimaryBackgroundDefault,
              },
            }}
          >
            <div
              css={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: theme.spacing.md,
                padding: `${theme.spacing.lg}px ${theme.spacing.lg}px ${theme.spacing.md}px`,
              }}
            >
              <span
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: theme.spacing.xl,
                  height: theme.spacing.xl,
                  borderRadius: theme.borders.borderRadiusMd,
                  backgroundColor: theme.colors.actionTertiaryBackgroundHover,
                  color: theme.colors.actionPrimaryBackgroundDefault,
                  flexShrink: 0,
                }}
              >
                <SparkleIcon color="ai" />
              </span>
              <textarea
                aria-label="Ask MLflow about this agent"
                placeholder="Ask MLflow about traces, evaluations, or quality"
                rows={2}
                css={{
                  minWidth: 0,
                  flex: 1,
                  border: 0,
                  outline: 0,
                  resize: 'none',
                  color: theme.colors.textPrimary,
                  backgroundColor: 'transparent',
                  font: 'inherit',
                  fontSize: theme.typography.fontSizeLg,
                  lineHeight: theme.typography.lineHeightLg,
                }}
              />
            </div>
            <div
              css={{
                display: 'flex',
                gap: theme.spacing.sm,
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: `${theme.spacing.sm}px ${theme.spacing.lg}px ${theme.spacing.md}px`,
              }}
            >
              <div
                css={{
                  display: 'flex',
                  gap: theme.spacing.sm,
                  flexWrap: 'wrap',
                  minWidth: 0,
                }}
              >
                {suggestedQueries.map((query) => (
                  <Button
                    key={query.componentId}
                    componentId={query.componentId}
                    size="small"
                    icon={query.icon}
                    onClick={() => openAssistantWithPrompt(query.prompt)}
                  >
                    {query.label}
                  </Button>
                ))}
              </div>
              <Button
                componentId="mlflow.genai-overview.submit-prompt"
                type="primary"
                icon={<ArrowRightIcon />}
                aria-label="Submit prompt"
              />
            </div>
          </div>
        </section>

        {analysisState !== 'idle' && (
          <Card
            componentId="mlflow.genai-overview.analysis-status-card"
            disableHover
            css={{ padding: theme.spacing.lg, width: '100%' }}
          >
            <div
              css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.md, alignItems: 'center' }}
            >
              <div css={{ display: 'flex', gap: theme.spacing.md, alignItems: 'flex-start' }}>
                <div
                  css={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: theme.spacing.xl,
                    height: theme.spacing.xl,
                    borderRadius: theme.borders.borderRadiusMd,
                    backgroundColor: theme.colors.actionDefaultBackgroundHover,
                    color: theme.colors.actionPrimaryBackgroundDefault,
                    flexShrink: 0,
                  }}
                >
                  {analysisState === 'complete' ? <CheckCircleIcon /> : <Spinner size="small" />}
                </div>
                <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                  <Typography.Text bold>
                    {analysisState === 'preparing' ? (
                      <FormattedMessage
                        defaultMessage="Starting issue detection"
                        description="GenAI overview issue detection starting status"
                      />
                    ) : analysisState === 'submitted' ? (
                      <FormattedMessage
                        defaultMessage="Issue detection is running"
                        description="GenAI overview issue detection submitted status"
                      />
                    ) : (
                      <FormattedMessage
                        defaultMessage="Failure analysis completed"
                        description="GenAI overview analysis complete status"
                      />
                    )}
                  </Typography.Text>
                  <Typography.Text color="secondary">
                    {analysisState === 'preparing' ? (
                      <FormattedMessage
                        defaultMessage="MLflow is collecting trace IDs from the last 7 days and starting a background job."
                        description="GenAI overview issue detection starting description"
                      />
                    ) : analysisState === 'submitted' ? (
                      <FormattedMessage
                        defaultMessage="MLflow is analyzing {traces} recent traces. We'll notify you here when it finishes."
                        description="GenAI overview issue detection submitted description"
                        values={{ traces: analysisTraceCount.toLocaleString() }}
                      />
                    ) : (
                      <FormattedMessage
                        defaultMessage="{clusters} candidate clusters found across {traces} recent conversations."
                        description="GenAI overview analysis complete description"
                        values={{
                          clusters: FAILURE_ANALYSIS_CLUSTERS.length,
                          traces: FAILURE_ANALYSIS_TOTAL_CONVERSATIONS.toLocaleString(),
                        }}
                      />
                    )}
                  </Typography.Text>
                </div>
              </div>
              {(analysisState === 'submitted' || analysisState === 'complete') && (
                <Button
                  componentId="mlflow.genai-overview.open-analysis-result"
                  type="primary"
                  endIcon={<ArrowRightIcon />}
                  onClick={() => navigate(submittedAnalysisRoute)}
                >
                  {analysisState === 'submitted' ? (
                    <FormattedMessage
                      defaultMessage="View progress"
                      description="View issue detection progress button"
                    />
                  ) : (
                    <FormattedMessage defaultMessage="View 3 issues" description="Open detected issues button" />
                  )}
                </Button>
              )}
            </div>
          </Card>
        )}

        <TraceActivityChart hasTraceActivity={shouldShowTraceActivity} />

        <section
          css={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: theme.spacing.xl,
            alignItems: 'start',
          }}
        >
          <RecentActivityPanel tracesRoute={tracesRoute} hasTraceActivity={shouldShowTraceActivity} />
          <SuggestedActionsPanel actions={suggestedActions} />
        </section>
      </div>
    </div>
  );
};

export default ExperimentGenAIOverviewPage;
