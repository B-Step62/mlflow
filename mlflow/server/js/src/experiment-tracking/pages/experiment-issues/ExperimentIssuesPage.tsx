import type React from 'react';
import { useMemo, useState } from 'react';
import {
  Button,
  PlusIcon,
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

const AnalysisPlaceholderTab = ({ label }: { label: string }) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 360,
        border: `1px dashed ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <Typography.Text color="secondary">{label}</Typography.Text>
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
          <AnalysisPlaceholderTab label="Topic classification prototype coming next." />
        </Tabs.Content>
        <Tabs.Content value="custom" css={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: theme.spacing.md }}>
          <AnalysisPlaceholderTab label="Custom SQL-like analysis prototype coming next." />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default ExperimentIssuesPage;
