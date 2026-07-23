import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { FormattedMessage } from 'react-intl';
import {
  ArrowRightIcon,
  Button,
  Card,
  CheckCircleIcon,
  DatabaseIcon,
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
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAssistant } from '../../../assistant/AssistantContext';
import { Link, useNavigate, useParams } from '../../../common/utils/RoutingUtils';
import { ExperimentPageTabName } from '../../constants';
import Routes from '../../routes';
import { useHeaderVisibility } from '../experiment-page-tabs/ExperimentPageHeaderVisibilityContext';
import {
  OverviewChartContainer,
  useChartXAxisProps,
  useChartYAxisProps,
} from './components/OverviewChartComponents';
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

const ANALYSIS_DELAY_MS = 1400;
const COMPACT_TRACE_CHART_HEIGHT = 132;
const OVERVIEW_PANEL_HEIGHT = 260;

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

const TraceActivityChart = () => {
  const { theme } = useDesignSystemTheme();
  const xAxisProps = useChartXAxisProps();
  const yAxisProps = useChartYAxisProps();
  const traceActivityData = useMemo(
    () => TRACE_ACTIVITY_HOURS.map((hour) => ({ name: hour.label, count: hour.count })),
    [],
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

const RecentActivityPanel = ({ tracesRoute }: { tracesRoute: string }) => {
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
        {RECENT_ACTIVITY.map((activityGroup) => (
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
        ))}
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
  const { experimentId } = useParams<{ experimentId: string }>();
  const navigate = useNavigate();
  const { setHeaderHidden } = useHeaderVisibility();
  const { closePanel } = useAssistant();
  const [analysisState, setAnalysisState] = useState<'idle' | 'running' | 'complete'>('idle');

  const safeExperimentId = experimentId ?? '';
  const tracesRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Traces);
  const datasetsRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Datasets);
  const evaluationRunsRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.EvaluationRuns);
  const playgroundRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.Playground);
  const analysisRoute = Routes.getIssueDetectionRunDetailsRoute(safeExperimentId, MOCK_FAILURE_ANALYSIS_RUN_ID);
  const totalTraceCount = useMemo(() => TRACE_ACTIVITY_HOURS.reduce((total, hour) => total + hour.count, 0), []);
  const hasTraceActivity = totalTraceCount > 0;

  useEffect(() => {
    setHeaderHidden(true);
    return () => setHeaderHidden(false);
  }, [setHeaderHidden]);

  useEffect(() => {
    closePanel();
  }, [closePanel]);

  useEffect(() => {
    if (analysisState !== 'running') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAnalysisState('complete');
    }, ANALYSIS_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [analysisState]);

  const runAnalysis = () => {
    setAnalysisState('running');
  };

  const suggestedActions: SuggestedAction[] = hasTraceActivity
    ? [
        {
          title: <FormattedMessage defaultMessage="Detect issues" description="GenAI overview detect issues action" />,
          description: (
            <FormattedMessage
              defaultMessage="Cluster recent trace failures"
              description="GenAI overview detect issues action description"
            />
          ),
          icon: analysisState === 'running' ? <Spinner size="small" /> : <SparkleIcon color="ai" />,
          onClick: runAnalysis,
        },
        {
          title: (
            <FormattedMessage defaultMessage="Set up evaluation" description="GenAI overview setup eval action" />
          ),
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
          title: <FormattedMessage defaultMessage="Connect GitHub" description="GenAI overview connect GitHub action" />,
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
          title: <FormattedMessage defaultMessage="Log traces" description="GenAI overview log traces action" />,
          description: (
            <FormattedMessage
              defaultMessage="Instrument your app with MLflow"
              description="GenAI overview log traces action description"
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
            <FormattedMessage defaultMessage="Upload a dataset" description="GenAI overview upload dataset action" />
          ),
          description: (
            <FormattedMessage
              defaultMessage="Start an evaluation baseline"
              description="GenAI overview upload dataset action description"
            />
          ),
          icon: <DatabaseIcon />,
          to: datasetsRoute,
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
                <Button
                  componentId="mlflow.genai-overview.what-should-i-do-next"
                  size="small"
                  icon={<SparkleIcon color="ai" />}
                  onClick={runAnalysis}
                  disabled={analysisState === 'running'}
                >
                  <FormattedMessage
                    defaultMessage="What should I do next?"
                    description="GenAI overview suggested query"
                  />
                </Button>
                <Button
                  componentId="mlflow.genai-overview.find-common-failure-modes"
                  size="small"
                  icon={analysisState === 'running' ? <Spinner size="small" /> : <SparkleIcon color="ai" />}
                  onClick={runAnalysis}
                  disabled={analysisState === 'running'}
                >
                  <FormattedMessage
                    defaultMessage="Find common failure modes"
                    description="GenAI overview suggested query"
                  />
                </Button>
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
                  {analysisState === 'running' ? <Spinner size="small" /> : <CheckCircleIcon />}
                </div>
                <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                  <Typography.Text bold>
                    {analysisState === 'running' ? (
                      <FormattedMessage
                        defaultMessage="Analyzing recent traces"
                        description="GenAI overview analysis running status"
                      />
                    ) : (
                      <FormattedMessage
                        defaultMessage="Failure analysis completed"
                        description="GenAI overview analysis complete status"
                      />
                    )}
                  </Typography.Text>
                  <Typography.Text color="secondary">
                    {analysisState === 'running' ? (
                      <FormattedMessage
                        defaultMessage="The page stays usable while MLflow groups likely failure modes in the background."
                        description="GenAI overview analysis running description"
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
              {analysisState === 'complete' && (
                <Button
                  componentId="mlflow.genai-overview.open-analysis-result"
                  type="primary"
                  endIcon={<ArrowRightIcon />}
                  onClick={() => navigate(analysisRoute)}
                >
                  <FormattedMessage defaultMessage="Open analysis" description="Open analysis result button" />
                </Button>
              )}
            </div>
          </Card>
        )}

        <TraceActivityChart />

        <section
          css={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: theme.spacing.xl,
            alignItems: 'start',
          }}
        >
          <RecentActivityPanel tracesRoute={tracesRoute} />
          <SuggestedActionsPanel actions={suggestedActions} />
        </section>
      </div>
    </div>
  );
};

export default ExperimentGenAIOverviewPage;
