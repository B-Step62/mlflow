import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  ArrowRightIcon,
  Button,
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
import { Link, useParams } from '../../../common/utils/RoutingUtils';
import { ExperimentPageTabName } from '../../constants';
import { recordSubmittedIssueDetectionJob } from '../../components/experiment-page/components/traces-v3/IssueDetectionJobNotifications';
import Routes from '../../routes';
import { MlflowService } from '../../sdk/MlflowService';
import { useHeaderVisibility } from '../experiment-page-tabs/ExperimentPageHeaderVisibilityContext';
import { useChartXAxisProps, useChartYAxisProps } from './components/OverviewChartComponents';
import { MOCK_FAILURE_ANALYSIS_RUN_ID, RECENT_ACTIVITY, TRACE_ACTIVITY_DAYS } from './failureAnalysisMock';

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
  prompt?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
};

const COMPACT_TRACE_CHART_HEIGHT = 132;
const OVERVIEW_PANEL_HEIGHT = 260;
const RECENT_TRACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_TRACE_QUERY_LIMIT = 1000;
const DEMO_ISSUE_DETECTION_RUN_ID_TAG = 'mlflow.issueCujDemo.issueDetectionRunId';
const MOCK_ISSUE_DETECTION_JOB_ID = 'mock-issue-cuj-common-failure-modes';
const MOCK_ISSUE_DETECTION_TRACE_COUNT = 205;
const MOCK_ISSUE_DETECTION_ISSUE_COUNT = 5;
const MOCK_ISSUE_DETECTION_COMPLETION_DELAY_MS = 10000;

type RecentTraceInfo = {
  request_time?: string;
  timestamp_ms?: number | string;
};

type TraceActivityPoint = {
  name: string;
  count: number;
};

const getRecentTraceTimeRange = () => {
  const endTimeMs = Date.now();
  return {
    startTime: String(endTimeMs - RECENT_TRACE_WINDOW_MS),
    endTime: String(endTimeMs),
  };
};

const getTraceTimestampMs = (trace: RecentTraceInfo): number | undefined => {
  if (trace.request_time) {
    const requestTimeMs = Date.parse(trace.request_time);
    if (!Number.isNaN(requestTimeMs)) {
      return requestTimeMs;
    }
  }
  if (trace.timestamp_ms !== undefined) {
    const timestampMs = Number(trace.timestamp_ms);
    if (!Number.isNaN(timestampMs)) {
      return timestampMs;
    }
  }
  return undefined;
};

const getRecentTraceActivityData = (
  traces: RecentTraceInfo[] | undefined,
  timeRange: { startTime: string; endTime: string },
): TraceActivityPoint[] => {
  const labels = TRACE_ACTIVITY_DAYS.map((day) => day.label);
  const counts = labels.map(() => 0);
  if (!traces?.length) {
    return labels.map((name, index) => ({ name, count: counts[index] }));
  }

  const startTimeMs = Number(timeRange.startTime);
  const endTimeMs = Number(timeRange.endTime);
  const bucketMs = RECENT_TRACE_WINDOW_MS / labels.length;

  traces.forEach((trace) => {
    const timestampMs = getTraceTimestampMs(trace);
    const bucketIndex =
      timestampMs === undefined
        ? labels.length - 1
        : Math.max(
            0,
            Math.min(labels.length - 1, Math.floor((timestampMs - startTimeMs) / bucketMs)),
          );

    if (timestampMs === undefined || (timestampMs >= startTimeMs && timestampMs <= endTimeMs)) {
      counts[bucketIndex] += 1;
    }
  });

  return labels.map((name, index) => ({ name, count: counts[index] }));
};

const getExperimentTagValue = (
  experiment: { tags?: Array<{ key?: string; value?: string }> | Record<string, string> } | undefined,
  tagKey: string,
): string | undefined => {
  const tags = experiment?.tags;
  if (Array.isArray(tags)) {
    return tags.find((tag) => tag.key === tagKey)?.value;
  }
  return tags?.[tagKey];
};

const getDemoIssueDetectionRunId = async (experimentId: string): Promise<string> => {
  try {
    const response = await MlflowService.getExperiment({ experiment_id: experimentId });
    return getExperimentTagValue(response.experiment, DEMO_ISSUE_DETECTION_RUN_ID_TAG) ?? MOCK_FAILURE_ANALYSIS_RUN_ID;
  } catch {
    return MOCK_FAILURE_ANALYSIS_RUN_ID;
  }
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

const TraceActivityChart = ({
  traceActivityData,
  dashboardRoute,
}: {
  traceActivityData: TraceActivityPoint[];
  dashboardRoute: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  return (
    <section
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.lg,
        padding: `${theme.spacing.md}px 0`,
      }}
    >
      <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.md, alignItems: 'flex-start' }}>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 0 }}>
          <Typography.Text color="secondary">
            <FormattedMessage
              defaultMessage="Traces in the last 7 days"
              description="Summary heading for trace activity over the last 7 days"
            />
          </Typography.Text>
        </div>
        <Link
          componentId="mlflow.genai-overview.trace-activity.open-dashboard"
          to={dashboardRoute}
          css={{
            color: theme.colors.actionPrimaryBackgroundDefault,
            flexShrink: 0,
            textDecoration: 'none',
            ':hover': { textDecoration: 'underline' },
          }}
        >
          <FormattedMessage
            defaultMessage="Open Dashboard"
            description="Link from overview trace activity chart to the dashboard"
          />
        </Link>
      </div>
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
    </section>
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
  const { setHeaderHidden } = useHeaderVisibility();
  const { closePanel, openPanel, prefillPrompt, startMockIssueDetection } = useAssistant();
  const [isIssueDetectionQueued, setIsIssueDetectionQueued] = useState(false);

  const safeExperimentId = experimentId ?? '';
  const tracesRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Traces);
  const dashboardRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Dashboard);
  const evaluationRunsRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.EvaluationRuns);
  const playgroundRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Playground);
  const recentTraceTimeRange = useMemo(getRecentTraceTimeRange, []);
  const traceSearchLocations = useMemo(
    () => (safeExperimentId ? [createTraceLocationForExperiment(safeExperimentId)] : []),
    [safeExperimentId],
  );
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
    limit: RECENT_TRACE_QUERY_LIMIT,
    enablePagination: false,
  });
  const traceActivityData = useMemo(
    () => getRecentTraceActivityData(recentTraces, recentTraceTimeRange),
    [recentTraces, recentTraceTimeRange],
  );
  const hasTraceActivity = Boolean(tracePresence?.length);
  const shouldShowTraceActivity = isLoadingTracePresence || isFetchingTracePresence || hasTraceActivity;
  const isAnalysisRunning = isIssueDetectionQueued;

  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, [setHeaderHidden]);

  useEffect(() => {
    closePanel();
  }, [closePanel]);

  const runAnalysis = () => {
    if (isAnalysisRunning || !safeExperimentId || isLoadingRecentTraces || isFetchingRecentTraces) {
      return;
    }

    refetchMlflowTraces?.();
    setIsIssueDetectionQueued(true);
    const traceCount = hasTraceActivity ? MOCK_ISSUE_DETECTION_TRACE_COUNT : (recentTraces?.length ?? 0);
    void getDemoIssueDetectionRunId(safeExperimentId).then((runId) => {
      const jobId = `${MOCK_ISSUE_DETECTION_JOB_ID}-${safeExperimentId}`;
      recordSubmittedIssueDetectionJob({
        experimentId: safeExperimentId,
        jobId,
        runId,
        traceCount,
        mockResult: {
          issues: MOCK_ISSUE_DETECTION_ISSUE_COUNT,
          totalTracesAnalyzed: traceCount,
          completionDelayMs: MOCK_ISSUE_DETECTION_COMPLETION_DELAY_MS,
        },
      });
      startMockIssueDetection({
        experimentId: safeExperimentId,
        jobId,
        runId,
        traceCount,
        issueCount: MOCK_ISSUE_DETECTION_ISSUE_COUNT,
        completionDelayMs: MOCK_ISSUE_DETECTION_COMPLETION_DELAY_MS,
        onComplete: () => setIsIssueDetectionQueued(false),
      });
      window.setTimeout(() => setIsIssueDetectionQueued(false), MOCK_ISSUE_DETECTION_COMPLETION_DELAY_MS);
    });
  };

  const openAssistantWithPrompt = (prompt: string) => {
    openPanel();
    prefillPrompt(prompt);
  };

  const suggestedActions: SuggestedAction[] = shouldShowTraceActivity
    ? [
        {
          title: (
            <FormattedMessage
              defaultMessage="Find common failure modes"
              description="GenAI overview detect issues action"
            />
          ),
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
          label: (
            <FormattedMessage defaultMessage="Find common failure modes" description="GenAI overview suggested query" />
          ),
          icon: isAnalysisRunning ? <Spinner size="small" /> : <SparkleIcon color="ai" />,
          onClick: runAnalysis,
          disabled: isAnalysisRunning,
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
                    disabled={query.disabled}
                    onClick={() => {
                      if (query.onClick) {
                        query.onClick();
                        return;
                      }
                      if (query.prompt) {
                        openAssistantWithPrompt(query.prompt);
                      }
                    }}
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

        <TraceActivityChart traceActivityData={traceActivityData} dashboardRoute={dashboardRoute} />

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
