import type React from 'react';
import { useMemo, useState } from 'react';
import {
  Button,
  Input,
  PlusIcon,
  SparkleIcon,
  Tabs,
  Typography,
  useDesignSystemTheme,
  useLegacyNotification,
} from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

import { useParams } from '../../../common/utils/RoutingUtils';
import { RunViewIssuesContent } from '../../components/run-page/RunViewIssuesTab';
import type { IssueEvalSetupStatus } from '../../components/run-page/IssueDetailsPanel';
import type { Issue, IssueStatus } from '../../components/run-page/hooks/useSearchIssuesQuery';
import { MOCK_FAILURE_ANALYSIS_ISSUES } from '../experiment-overview/failureAnalysisMock';
import type { MockEvalDatasetMode } from '../../mockEvalArtifacts';

const MOCK_EXISTING_ISSUES: Issue[] = [
  {
    issue_id: 'iss-existing-tool-timeout',
    experiment_id: '0',
    name: 'Search tool timeout causes incomplete answers',
    description:
      'The assistant sometimes returns a partial answer when the search tool times out instead of retrying or asking the user to narrow the request.',
    severity: 'medium',
    status: 'pending',
    source_run_id: 'job_91c24a8d',
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 18, 15, 30, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 18, 15, 30, 0),
    categories: ['execution', 'adherence'],
    trace_count: 9,
  },
  {
    issue_id: 'iss-existing-unsafe-financial-advice',
    experiment_id: '0',
    name: 'Financial advice missing required caveat',
    description:
      'Responses to investment questions occasionally omit the required caveat that answers are informational and not financial advice.',
    severity: 'low',
    status: 'pending',
    source_run_id: 'job_5b8e112f',
    created_by: 'MLflow',
    created_timestamp: Date.UTC(2026, 6, 15, 10, 0, 0),
    last_updated_timestamp: Date.UTC(2026, 6, 15, 10, 0, 0),
    categories: ['safety', 'adherence'],
    trace_count: 5,
  },
];

type AnalysisTab = 'failure-patterns' | 'topics' | 'custom';

const MOCK_TOPICS = [
  {
    id: 'pricing',
    label: 'Evaluate and select pricing plans',
    percent: '12.8%',
    color: '#4466ff',
    points: [
      { x: 22, y: 63 },
      { x: 23, y: 62 },
      { x: 24, y: 61 },
      { x: 24, y: 65 },
      { x: 25, y: 60 },
    ],
  },
  {
    id: 'upgrade',
    label: 'Upgrade to higher-tier plans',
    percent: '8.7%',
    color: '#f28b20',
    points: [
      { x: 78, y: 41 },
      { x: 79, y: 42 },
      { x: 80, y: 41 },
    ],
  },
  {
    id: 'refunds',
    label: 'Resolve billing errors and refunds',
    percent: '8.7%',
    color: '#8f5cf7',
    points: [
      { x: 39, y: 54 },
      { x: 40, y: 53 },
      { x: 40, y: 55 },
    ],
  },
  {
    id: 'security',
    label: 'Assess vendor security compliance',
    percent: '8.5%',
    color: '#d83bd2',
    points: [
      { x: 66, y: 68 },
      { x: 67, y: 70 },
    ],
  },
  {
    id: 'permissions',
    label: 'Understand role permissions',
    percent: '7.4%',
    color: '#16b9ae',
    points: [
      { x: 35, y: 50 },
      { x: 36, y: 50 },
    ],
  },
  {
    id: 'api',
    label: 'Implement advanced API features',
    percent: '6.9%',
    color: '#e3c400',
    points: [
      { x: 37, y: 64 },
      { x: 38, y: 64 },
      { x: 41, y: 64 },
    ],
  },
  {
    id: 'billing',
    label: 'Investigate unexpected billing increases',
    percent: '4.8%',
    color: '#21c7d9',
    points: [
      { x: 19, y: 73 },
      { x: 20, y: 72 },
      { x: 20, y: 74 },
    ],
  },
  {
    id: 'embedding',
    label: 'Fix embedding dimension mismatches',
    percent: '4.8%',
    color: '#72cf25',
    points: [
      { x: 52, y: 75 },
      { x: 53, y: 74 },
    ],
  },
  {
    id: 'gdpr',
    label: 'Understand GDPR response timeframes',
    percent: '4.6%',
    color: '#1918c9',
    points: [
      { x: 59, y: 58 },
      { x: 60, y: 58 },
      { x: 60, y: 59 },
    ],
  },
  {
    id: 'tone',
    label: 'Achieve consistent bot response tone',
    percent: '4.1%',
    color: '#b53a00',
    points: [
      { x: 23, y: 83 },
      { x: 24, y: 84 },
      { x: 25, y: 84 },
    ],
  },
  {
    id: 'crm',
    label: 'Automate CRM workflows with Zapier',
    percent: '4.1%',
    color: '#7113d4',
    points: [
      { x: 50, y: 91 },
      { x: 51, y: 92 },
      { x: 52, y: 92 },
    ],
  },
  {
    id: 'credentials',
    label: 'Secure accounts after credential exposure',
    percent: '3.9%',
    color: '#b600b8',
    points: [
      { x: 88, y: 62 },
      { x: 89, y: 62 },
    ],
  },
];

const CUSTOM_ANALYSIS_ROWS = [
  { tool: 'activityPlanningTool', calls: '231', p95: '4.8s', failures: '7.2%' },
  { tool: 'weatherLookup', calls: '120', p95: '3.1s', failures: '11.0%' },
  { tool: 'agent.stream', calls: '390', p95: '1.4s', failures: '2.1%' },
  { tool: 'policyRetriever', calls: '84', p95: '2.2s', failures: '4.8%' },
];

const truncateSourceJobId = (sourceRunId?: string) => {
  if (!sourceRunId) {
    return '';
  }
  const displayId = sourceRunId.replace(/^job_/, '');
  return displayId.length > 8 ? `${displayId.slice(0, 7)}...` : displayId;
};

const getIssueEntityCounts = (issues: Issue[]) =>
  issues.reduce<Record<string, number>>((counts, issue) => {
    const entity = issue.name.includes('agent.stream') ? 'agent.stream' : 'activityPlanningTool';
    counts[entity] = (counts[entity] ?? 0) + 1;
    return counts;
  }, {});

const WidgetShell = ({
  title,
  componentId,
  onPromote,
  children,
}: {
  title: string;
  componentId: string;
  onPromote: (title: string) => void;
  children: React.ReactNode;
}) => {
  const { theme } = useDesignSystemTheme();

  return (
    <section
      css={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 220,
        minWidth: 0,
        padding: theme.spacing.md,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundPrimary,
        boxSizing: 'border-box',
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        <Typography.Title level={4} css={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <Button
          componentId={componentId}
          size="small"
          type="tertiary"
          icon={<PlusIcon />}
          onClick={() => onPromote(title)}
        >
          <FormattedMessage
            defaultMessage="Dashboard"
            description="Button label to promote an analysis widget to a dashboard"
          />
        </Button>
      </div>
      {children}
    </section>
  );
};

const IssuesFoundWidget = ({ issues, onPromote }: { issues: Issue[]; onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();
  const entityCounts = useMemo(() => getIssueEntityCounts(issues), [issues]);
  const totalIssues = issues.length;
  const activityPlanningCount = entityCounts.activityPlanningTool ?? 0;
  const agentStreamCount = entityCounts['agent.stream'] ?? 0;
  const activityPlanningPercent = totalIssues ? Math.round((activityPlanningCount / totalIssues) * 100) : 0;
  const activityPlanningColor = theme.colors.blue500;
  const agentStreamColor = theme.colors.yellow500;

  return (
    <WidgetShell
      title="Issues Found"
      componentId="mlflow.experiment-analysis.failure-patterns.promote-issues-found"
      onPromote={onPromote}
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(128px, 180px) minmax(0, 1fr)',
          gap: theme.spacing.lg,
          alignItems: 'center',
          flex: 1,
        }}
      >
        <div
          css={{
            justifySelf: 'center',
            width: 128,
            height: 128,
            borderRadius: '50%',
            background: `conic-gradient(${activityPlanningColor} 0 ${activityPlanningPercent}%, ${agentStreamColor} ${activityPlanningPercent}% 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `inset 0 0 0 1px ${theme.colors.border}`,
          }}
        >
          <div
            css={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              backgroundColor: theme.colors.backgroundPrimary,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${theme.colors.border}`,
            }}
          >
            <Typography.Text bold size="lg">
              {totalIssues}
            </Typography.Text>
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage defaultMessage="issues" description="Issues found donut center label" />
            </Typography.Text>
          </div>
        </div>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 0 }}>
          <div
            css={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 56px',
              gap: theme.spacing.sm,
              paddingBottom: theme.spacing.xs,
              borderBottom: `1px solid ${theme.colors.border}`,
            }}
          >
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage defaultMessage="Entity" description="Issue entity table header" />
            </Typography.Text>
            <Typography.Text color="secondary" size="sm" css={{ textAlign: 'right' }}>
              <FormattedMessage defaultMessage="Count" description="Issue count table header" />
            </Typography.Text>
          </div>
          {[
            { entity: 'activityPlanningTool', count: activityPlanningCount, color: activityPlanningColor },
            { entity: 'agent.stream', count: agentStreamCount, color: agentStreamColor },
          ].map(({ entity, count, color }) => (
            <div
              key={entity}
              css={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) 56px',
                gap: theme.spacing.sm,
                alignItems: 'center',
              }}
            >
              <Typography.Text ellipsis>
                <span
                  css={{
                    display: 'inline-block',
                    width: 9,
                    height: 9,
                    borderRadius: theme.borders.borderRadiusSm,
                    backgroundColor: color,
                    marginRight: theme.spacing.sm,
                  }}
                />
                {entity}
              </Typography.Text>
              <Typography.Text css={{ textAlign: 'right' }}>{count}</Typography.Text>
            </div>
          ))}
        </div>
      </div>
    </WidgetShell>
  );
};

const IssuesOverTimeWidget = ({ onPromote }: { onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <WidgetShell
      title="Issues Over Time"
      componentId="mlflow.experiment-analysis.failure-patterns.promote-issues-over-time"
      onPromote={onPromote}
    >
      <div
        css={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '32px minmax(0, 1fr)',
          gridTemplateRows: '1fr 28px',
          columnGap: theme.spacing.sm,
          color: theme.colors.textSecondary,
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingBottom: 4,
          }}
        >
          {[4, 2, 0].map((tick) => (
            <Typography.Text key={tick} color="secondary" size="sm">
              {tick}
            </Typography.Text>
          ))}
        </div>
        <div
          css={{
            position: 'relative',
            borderBottom: `1px solid ${theme.colors.border}`,
            backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px)`,
            backgroundSize: '100% 33%',
          }}
        >
          <div
            css={{
              position: 'absolute',
              left: '54%',
              bottom: 0,
              width: 34,
              height: '54%',
              backgroundColor: theme.colors.blue500,
              borderRadius: `${theme.borders.borderRadiusSm} ${theme.borders.borderRadiusSm} 0 0`,
            }}
          />
          <div
            css={{
              position: 'absolute',
              left: '54%',
              bottom: '54%',
              width: 34,
              height: '28%',
              backgroundColor: theme.colors.yellow500,
              borderRadius: `${theme.borders.borderRadiusSm} ${theme.borders.borderRadiusSm} 0 0`,
            }}
          />
        </div>
        <div />
        <div css={{ position: 'relative' }}>
          <Typography.Text
            color="secondary"
            size="sm"
            css={{ position: 'absolute', left: 'calc(54% - 10px)', top: theme.spacing.xs }}
          >
            Jun 29
          </Typography.Text>
        </div>
      </div>
    </WidgetShell>
  );
};

const TopicsTab = ({ onPromote }: { onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();
  const selectedTopic = MOCK_TOPICS[0];

  return (
    <section
      css={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 680,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundPrimary,
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, minWidth: 0 }}>
          <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
            <Button
              componentId="mlflow.experiment-analysis.topics.all-topics"
              size="small"
              type="tertiary"
              css={{ flexShrink: 0 }}
            >
              <FormattedMessage defaultMessage="All topics" description="Topics analysis back button" />
            </Button>
            <Typography.Title level={3} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Task" description="Topic facet name in analysis topics tab" />
            </Typography.Title>
          </div>
          <Typography.Text color="secondary">
            <FormattedMessage defaultMessage="User intent or goal" description="Topic facet description" />
          </Typography.Text>
          <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
            <Button componentId="mlflow.experiment-analysis.topics.scatterplot" size="small" type="primary">
              <FormattedMessage defaultMessage="Scatterplot" description="Topics scatterplot view mode" />
            </Button>
            <Button componentId="mlflow.experiment-analysis.topics.list" size="small" type="tertiary">
              <FormattedMessage defaultMessage="List" description="Topics list view mode" />
            </Button>
          </div>
        </div>
        <div css={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              height: 32,
              padding: `0 ${theme.spacing.sm}px`,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.colors.backgroundSecondary,
            }}
          >
            <span
              css={{
                width: 28,
                height: 16,
                borderRadius: 999,
                backgroundColor: theme.colors.green500,
                position: 'relative',
              }}
            >
              <span
                css={{
                  position: 'absolute',
                  right: 2,
                  top: 2,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: theme.colors.white,
                }}
              />
            </span>
            <Typography.Text>
              <FormattedMessage defaultMessage="Active" description="Topics automation active status" />
            </Typography.Text>
          </div>
          <Button componentId="mlflow.experiment-analysis.topics.latest" size="small" type="tertiary">
            <FormattedMessage defaultMessage="Latest May 17" description="Topics latest generation selector" />
          </Button>
          <Button
            componentId="mlflow.experiment-analysis.topics.promote-map"
            size="small"
            type="tertiary"
            icon={<PlusIcon />}
            onClick={() => onPromote('Topic scatterplot')}
          >
            <FormattedMessage defaultMessage="Dashboard" description="Promote topic scatterplot button label" />
          </Button>
        </div>
      </div>
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: '276px minmax(420px, 1fr) 300px',
          flex: 1,
          minHeight: 0,
        }}
      >
        <aside
          css={{
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${theme.colors.border}`,
            overflow: 'auto',
          }}
        >
          <div css={{ padding: theme.spacing.md, borderBottom: `1px solid ${theme.colors.border}` }}>
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="{count} Topics"
                description="Count of topics in analysis topic sidebar"
                values={{ count: MOCK_TOPICS.length + 6 }}
              />
            </Typography.Text>
          </div>
          <div css={{ display: 'flex', flexDirection: 'column' }}>
            {MOCK_TOPICS.map((topic) => (
              <div
                key={topic.id}
                css={{
                  display: 'grid',
                  gridTemplateColumns: '12px minmax(0, 1fr) 14px',
                  gap: theme.spacing.sm,
                  padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                  alignItems: 'start',
                  backgroundColor:
                    topic.id === selectedTopic.id ? theme.colors.actionDefaultBackgroundHover : 'transparent',
                }}
              >
                <span
                  css={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    marginTop: 4,
                    backgroundColor: topic.color,
                  }}
                />
                <div css={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <Typography.Text color="secondary" size="sm">
                    {topic.percent}
                  </Typography.Text>
                  <Typography.Text css={{ lineHeight: 1.35 }}>{topic.label}</Typography.Text>
                </div>
                <Typography.Text color="secondary">ok</Typography.Text>
              </div>
            ))}
          </div>
        </aside>
        <div
          css={{
            position: 'relative',
            minHeight: 0,
            overflow: 'hidden',
            backgroundColor: theme.colors.backgroundPrimary,
            backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.border} 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        >
          <div
            css={{
              position: 'absolute',
              right: theme.spacing.md,
              top: theme.spacing.md,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.colors.backgroundPrimary,
            }}
          >
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage defaultMessage="3D view" description="Topics 3D view toggle label" />
            </Typography.Text>
          </div>
          {MOCK_TOPICS.flatMap((topic) =>
            topic.points.map((point, index) => (
              <span
                key={`${topic.id}-${index}`}
                css={{
                  position: 'absolute',
                  left: `${point.x}%`,
                  top: `${point.y}%`,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: topic.color,
                  border: `2px solid ${theme.colors.backgroundPrimary}`,
                  boxShadow: `0 0 0 1px ${topic.color}66`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )),
          )}
          <div
            css={{
              position: 'absolute',
              left: '26%',
              top: '12%',
              width: 430,
              maxWidth: '52%',
              padding: theme.spacing.md,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.colors.backgroundPrimary,
              boxShadow: theme.shadows.lg,
            }}
          >
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="Select models for legal document summarization"
                description="Topics scatterplot hover card title"
              />
            </Typography.Text>
            <div
              css={{
                marginTop: theme.spacing.sm,
                paddingTop: theme.spacing.sm,
                borderTop: `1px solid ${theme.colors.border}`,
              }}
            >
              <Typography.Text color="secondary">
                <FormattedMessage
                  defaultMessage="User wants to select an appropriate model for summarizing long legal documents with a focus on maintaining accuracy and acceptable speed."
                  description="Topics scatterplot hover card body"
                />
              </Typography.Text>
            </div>
            <Typography.Text color="secondary" size="sm" css={{ marginTop: theme.spacing.sm, display: 'block' }}>
              2fe4c816
            </Typography.Text>
          </div>
        </div>
        <aside
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            borderLeft: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.backgroundSecondary,
            overflow: 'auto',
          }}
        >
          <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.sm }}>
            <Typography.Title level={4} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Topics automation" description="Topics automation side panel title" />
            </Typography.Title>
            <Button componentId="mlflow.experiment-analysis.topics.regenerate" size="small" type="tertiary">
              <FormattedMessage defaultMessage="Re-generate topics" description="Regenerate topics button" />
            </Button>
          </div>
          <Typography.Text color="secondary">
            <FormattedMessage
              defaultMessage="Topics generation is an automated daily process. When enough traces are processed, topics will be generated daily."
              description="Topics automation explanatory copy"
            />
          </Typography.Text>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text bold>
              <FormattedMessage defaultMessage="Status" description="Topics automation status heading" />
            </Typography.Text>
            <Typography.Text>
              <strong>idle</strong> May 17 12:56 AM
            </Typography.Text>
            <Typography.Text color="secondary">
              <FormattedMessage
                defaultMessage="Idle until the next run time. Recompute topics to start a new generation cycle now."
                description="Topics automation idle description"
              />
            </Typography.Text>
          </div>
          {['Active facets', 'Facet coverage in the last 90 days', 'Last error'].map((item) => (
            <div
              key={item}
              css={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: theme.spacing.sm,
                borderRadius: theme.borders.borderRadiusMd,
                backgroundColor: theme.colors.backgroundPrimary,
                border: `1px solid ${theme.colors.border}`,
              }}
            >
              <Typography.Text>{item}</Typography.Text>
              <Typography.Text color="secondary">&gt;</Typography.Text>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
};

const CustomAnalysisChartWidget = ({ onPromote }: { onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <WidgetShell
      title="P95 latency by tool"
      componentId="mlflow.experiment-analysis.custom.promote-latency-chart"
      onPromote={onPromote}
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: '40px minmax(0, 1fr)',
          gridTemplateRows: '1fr 28px',
          gap: theme.spacing.sm,
          minHeight: 220,
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            color: theme.colors.textSecondary,
          }}
        >
          {['5s', '3s', '1s'].map((tick) => (
            <Typography.Text key={tick} size="sm" color="secondary">
              {tick}
            </Typography.Text>
          ))}
        </div>
        <div
          css={{
            position: 'relative',
            borderLeft: `1px solid ${theme.colors.border}`,
            borderBottom: `1px solid ${theme.colors.border}`,
            backgroundImage: `linear-gradient(${theme.colors.border} 1px, transparent 1px)`,
            backgroundSize: '100% 33%',
          }}
        >
          <svg
            viewBox="0 0 420 190"
            preserveAspectRatio="none"
            css={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            <polyline
              points="0,130 52,118 104,56 156,96 208,42 260,76 312,64 364,122 420,104"
              fill="none"
              stroke={theme.colors.blue500}
              strokeWidth="3"
            />
            <polyline
              points="0,154 52,148 104,132 156,142 208,118 260,126 312,110 364,134 420,126"
              fill="none"
              stroke={theme.colors.green500}
              strokeWidth="3"
            />
          </svg>
        </div>
        <div />
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            color: theme.colors.textSecondary,
          }}
        >
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label) => (
            <Typography.Text key={label} size="sm" color="secondary">
              {label}
            </Typography.Text>
          ))}
        </div>
      </div>
    </WidgetShell>
  );
};

const CustomAnalysisTableWidget = ({ onPromote }: { onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <WidgetShell
      title="Tool summary"
      componentId="mlflow.experiment-analysis.custom.promote-tool-summary"
      onPromote={onPromote}
    >
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(160px, 1fr) 80px 80px 96px',
          alignItems: 'center',
          rowGap: theme.spacing.sm,
          columnGap: theme.spacing.md,
          minHeight: 220,
        }}
      >
        {['Tool', 'Calls', 'P95', 'Failure rate'].map((header) => (
          <Typography.Text key={header} color="secondary" size="sm" bold>
            {header}
          </Typography.Text>
        ))}
        {CUSTOM_ANALYSIS_ROWS.map((row) => (
          <div key={row.tool} css={{ display: 'contents' }}>
            <Typography.Text ellipsis>{row.tool}</Typography.Text>
            <Typography.Text>{row.calls}</Typography.Text>
            <Typography.Text>{row.p95}</Typography.Text>
            <Typography.Text>{row.failures}</Typography.Text>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
};

const CustomAnalysisTab = ({ onPromote }: { onPromote: (title: string) => void }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      <section
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)',
          gap: theme.spacing.md,
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.md,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            backgroundColor: theme.colors.backgroundPrimary,
          }}
        >
          <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.sm }}>
            <Typography.Title level={4} css={{ margin: 0 }}>
              <FormattedMessage
                defaultMessage="Ask a question about traces"
                description="Custom analysis prompt panel title"
              />
            </Typography.Title>
            <Button
              componentId="mlflow.experiment-analysis.custom.run"
              type="primary"
              icon={<SparkleIcon color="ai" />}
            >
              <FormattedMessage defaultMessage="Run analysis" description="Run custom trace analysis button" />
            </Button>
          </div>
          <Input.TextArea
            componentId="mlflow.experiment-analysis.custom.prompt"
            readOnly
            rows={4}
            value="Show high-latency tool calls grouped by tool and render p95 latency over time."
          />
        </div>
        <div
          css={{
            padding: theme.spacing.md,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            backgroundColor: theme.colors.backgroundPrimary,
            minWidth: 0,
          }}
        >
          <Typography.Title level={4} css={{ marginTop: 0 }}>
            <FormattedMessage defaultMessage="Generated analysis" description="Generated custom analysis panel title" />
          </Typography.Title>
          <pre
            css={{
              margin: 0,
              padding: theme.spacing.md,
              borderRadius: theme.borders.borderRadiusMd,
              border: `1px solid ${theme.colors.border}`,
              backgroundColor: theme.colors.backgroundSecondary,
              color: theme.colors.textPrimary,
              overflow: 'auto',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >{`SELECT tool_name,
       date_trunc('hour', timestamp) AS hour,
       count(*) AS calls,
       p95(latency_ms) AS p95_latency,
       avg(error IS NOT NULL) AS failure_rate
FROM traces
WHERE timestamp >= now() - interval '7 days'
GROUP BY tool_name, hour
ORDER BY p95_latency DESC`}</pre>
        </div>
      </section>
      <section
        css={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: theme.spacing.md,
        }}
      >
        <CustomAnalysisChartWidget onPromote={onPromote} />
        <CustomAnalysisTableWidget onPromote={onPromote} />
      </section>
    </div>
  );
};

const ExperimentIssuesPage = () => {
  const { theme } = useDesignSystemTheme();
  const { experimentId } = useParams<{ experimentId: string }>();
  const [notification, notificationContextHolder] = useLegacyNotification();
  const [activeTab, setActiveTab] = useState<AnalysisTab>('failure-patterns');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, IssueStatus>>({});
  const [evalSetupStatuses, setEvalSetupStatuses] = useState<Record<string, IssueEvalSetupStatus>>({});
  const [evalSetupDatasetModes, setEvalSetupDatasetModes] = useState<Record<string, MockEvalDatasetMode>>({});
  const safeExperimentId = experimentId ?? '';

  const baseIssues = useMemo<Issue[]>(
    () => [
      ...MOCK_FAILURE_ANALYSIS_ISSUES.map(
        ({
          issue_id,
          experiment_id,
          name,
          description,
          severity,
          status,
          source_run_id,
          created_by,
          created_timestamp,
          last_updated_timestamp,
          categories,
          trace_count,
          recommendation,
          example_trace_ids,
        }) => ({
          issue_id,
          experiment_id: safeExperimentId || experiment_id,
          name,
          description,
          severity,
          status,
          source_run_id,
          created_by,
          created_timestamp,
          last_updated_timestamp,
          categories: [...categories],
          trace_count,
          recommendation,
          example_trace_ids: [...example_trace_ids],
        }),
      ),
      ...MOCK_EXISTING_ISSUES.map((issue) => ({
        ...issue,
        experiment_id: safeExperimentId || issue.experiment_id,
        categories: issue.categories ? [...issue.categories] : undefined,
      })),
    ],
    [safeExperimentId],
  );

  const issues = useMemo(
    () =>
      baseIssues.map((issue) => ({
        ...issue,
        status: statusOverrides[issue.issue_id] ?? issue.status,
      })),
    [baseIssues, statusOverrides],
  );

  const handlePromoteWidget = (title: string) => {
    notification.success({
      placement: 'topRight',
      message: (
        <FormattedMessage
          defaultMessage="Widget promoted"
          description="Notification title after promoting an analysis widget to dashboard"
        />
      ),
      description: (
        <FormattedMessage
          defaultMessage="{title} was added to the Dashboard prototype."
          description="Notification description after promoting an analysis widget to dashboard"
          values={{ title }}
        />
      ),
    });
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        padding: theme.spacing.md,
        gap: theme.spacing.md,
      }}
    >
      {notificationContextHolder}
      <Tabs.Root
        componentId="mlflow.experiment-analysis.tabs"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AnalysisTab)}
        valueHasNoPii
        css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Tabs.List>
          <Tabs.Trigger value="failure-patterns">
            <FormattedMessage defaultMessage="Failure patterns" description="Analysis tab label for failure patterns" />
          </Tabs.Trigger>
          <Tabs.Trigger value="topics">
            <FormattedMessage defaultMessage="Topics" description="Analysis tab label for topics" />
          </Tabs.Trigger>
          <Tabs.Trigger value="custom">
            <FormattedMessage defaultMessage="Custom" description="Analysis tab label for custom analysis" />
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="failure-patterns" css={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md, minHeight: 0 }}>
            <div
              css={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: theme.spacing.md,
              }}
            >
              <IssuesFoundWidget issues={issues} onPromote={handlePromoteWidget} />
              <IssuesOverTimeWidget onPromote={handlePromoteWidget} />
            </div>
            <Typography.Title level={3} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Detected Issues" description="Detected issues section title" />
            </Typography.Title>
            <div
              css={{
                flex: 1,
                minHeight: 520,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusMd,
                overflow: 'hidden',
              }}
            >
              <RunViewIssuesContent
                issues={issues}
                experimentId={safeExperimentId}
                hideIssueActions
                compactCards
                defaultSelectFirstIssue
                detailsPanel="details"
                getIssueSourceLabel={(issue) => truncateSourceJobId(issue.source_run_id)}
                getIssueSourceTagColor={() => 'charcoal'}
                onIssueStatusChange={(issueId, status) =>
                  setStatusOverrides((current) => ({
                    ...current,
                    [issueId]: status,
                  }))
                }
                getIssueEvalSetupStatus={(issue) => evalSetupStatuses[issue.issue_id] ?? 'idle'}
                onIssueEvalSetupStatusChange={(issueId, status) =>
                  setEvalSetupStatuses((current) => ({
                    ...current,
                    [issueId]: status,
                  }))
                }
                getIssueEvalSetupDatasetMode={(issue) => evalSetupDatasetModes[issue.issue_id] ?? 'new'}
                onIssueEvalSetupDatasetModeChange={(issueId, mode) =>
                  setEvalSetupDatasetModes((current) => ({
                    ...current,
                    [issueId]: mode,
                  }))
                }
              />
            </div>
          </div>
        </Tabs.Content>
        <Tabs.Content value="topics" css={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: theme.spacing.md }}>
          <TopicsTab onPromote={handlePromoteWidget} />
        </Tabs.Content>
        <Tabs.Content value="custom" css={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: theme.spacing.md }}>
          <CustomAnalysisTab onPromote={handlePromoteWidget} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default ExperimentIssuesPage;
