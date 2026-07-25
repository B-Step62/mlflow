import { useState, type ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  ChartLineIcon,
  CheckCircleIcon,
  Checkbox,
  CloseIcon,
  CopyIcon,
  Empty,
  InfoPopover,
  Modal,
  Spinner,
  SparkleIcon,
  Tag,
  TableIcon,
  Typography,
  type TagColors,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { useLocalStorage } from '@databricks/web-shared/hooks';
import {
  isV3ModelTraceInfo,
  ModelTraceExplorer,
  ModelTraceExplorerDrawer,
  useGetTracesById,
} from '@databricks/web-shared/model-trace-explorer';

import { useNavigate } from '../../../common/utils/RoutingUtils';
import { prefixRouteWithWorkspace } from '../../../workspaces/utils/WorkspaceUtils';
import { SELECTED_RUN_UUID_QUERY_PARAM } from '../evaluations/hooks/useSelectedRunUuid';
import {
  ExperimentPageTabName,
  MLFLOW_RUN_TYPE_TAG,
  MLFLOW_RUN_TYPE_VALUE_EVALUATION,
  MLFLOW_RUN_TYPE_VALUE_GENAI_EVALUATE,
} from '../../constants';
import Routes from '../../routes';
import { MlflowService } from '../../sdk/MlflowService';
import { type Issue, type IssueSeverity, type IssueStatus } from './hooks/useSearchIssuesQuery';
import { useUpdateIssue } from './hooks/useUpdateIssue';
import Utils from '../../../common/utils/Utils';
import { useAssistant } from '../../../assistant/AssistantContext';
import type { MockEvalSetupRequest, MockProductionMonitoringRequest } from '../../../assistant/types';
import { getEvalLinkedItems, type MockEvalDatasetMode } from '../../mockEvalArtifacts';

export type IssueEvalSetupStatus = 'idle' | 'choosing' | 'running' | 'complete';
export type IssueProductionMonitoringStatus = 'idle' | 'running' | 'complete';

interface IssueDetailsPanelProps {
  issue: Issue;
  experimentId: string;
  onStatusChange?: (issueId: string, status: IssueStatus) => void;
  evalSetupStatus?: IssueEvalSetupStatus;
  evalSetupDatasetMode?: MockEvalDatasetMode;
  productionMonitoringStatus?: IssueProductionMonitoringStatus;
  onEvalSetupStatusChange?: (issueId: string, status: IssueEvalSetupStatus) => void;
  onEvalSetupDatasetModeChange?: (issueId: string, mode: MockEvalDatasetMode) => void;
  onProductionMonitoringStatusChange?: (issueId: string, status: IssueProductionMonitoringStatus) => void;
}

const EVALUATION_RUN_TYPE_VALUES = [MLFLOW_RUN_TYPE_VALUE_GENAI_EVALUATE, MLFLOW_RUN_TYPE_VALUE_EVALUATION];
const DEFAULT_PRODUCTION_MONITORING_SAMPLING_RATIO = 0.05;
const RESOLVE_WITHOUT_EVAL_NUDGE_STORAGE_KEY = 'mlflow.issues.resolve_without_eval_nudge_dismissed';
const RESOLVE_WITHOUT_MONITORING_NUDGE_STORAGE_KEY = 'mlflow.issues.resolve_without_monitoring_nudge_dismissed';

const openRouteInNewTab = (route: string) => {
  const newWindow = window.open(`/#${prefixRouteWithWorkspace(route)}`, '_blank', 'noopener,noreferrer');
  if (newWindow) {
    newWindow.opener = null;
  }
};

const getIssueSeverityTagColor = (severity: IssueSeverity): TagColors => {
  if (severity === 'high') {
    return 'coral';
  }
  if (severity === 'medium') {
    return 'lemon';
  }
  return 'charcoal';
};

const renderIssueSeverityLabel = (severity: IssueSeverity) => {
  if (severity === 'not_an_issue') {
    return <FormattedMessage defaultMessage="Not an issue" description="Not an issue severity label" />;
  }
  if (severity === 'high') {
    return <FormattedMessage defaultMessage="High" description="Issue detail high severity label" />;
  }
  if (severity === 'medium') {
    return <FormattedMessage defaultMessage="Medium" description="Issue detail medium severity label" />;
  }
  return <FormattedMessage defaultMessage="Low" description="Issue detail low severity label" />;
};

const getLatestEvaluationRunId = async (experimentId: string): Promise<string | undefined> => {
  for (const runType of EVALUATION_RUN_TYPE_VALUES) {
    try {
      const response = await MlflowService.searchRuns({
        experiment_ids: [experimentId],
        order_by: ['attributes.start_time DESC'],
        run_view_type: 'ACTIVE_ONLY',
        filter: `tags.\`${MLFLOW_RUN_TYPE_TAG}\` = '${runType}'`,
        max_results: 1,
      });
      const info = response.runs?.[0]?.info as
        | ({ runUuid?: string; run_uuid?: string; run_id?: string } & Record<string, unknown>)
        | undefined;
      const runId = info?.runUuid ?? info?.run_uuid ?? info?.run_id;
      if (runId) {
        return runId;
      }
    } catch {
      // Try the next known evaluation run type.
    }
  }
  return undefined;
};

export const IssueDetailsPanel = ({
  issue,
  experimentId,
  onStatusChange,
  evalSetupStatus = 'idle',
  evalSetupDatasetMode = 'new',
  productionMonitoringStatus = 'idle',
  onEvalSetupStatusChange,
  onEvalSetupDatasetModeChange,
  onProductionMonitoringStatusChange,
}: IssueDetailsPanelProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const { startMockEvalSetup, startMockProductionMonitoring } = useAssistant();
  const { updateIssueAsync, isUpdating } = useUpdateIssue();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [isResolveWithoutEvalModalOpen, setIsResolveWithoutEvalModalOpen] = useState(false);
  const [doNotShowResolveWithoutEvalNudge, setDoNotShowResolveWithoutEvalNudge] = useState(false);
  const [isResolveWithoutMonitoringModalOpen, setIsResolveWithoutMonitoringModalOpen] = useState(false);
  const [doNotShowResolveWithoutMonitoringNudge, setDoNotShowResolveWithoutMonitoringNudge] = useState(false);
  const [isResolveWithoutEvalNudgeDismissed, setIsResolveWithoutEvalNudgeDismissed] = useLocalStorage({
    initialValue: false,
    key: RESOLVE_WITHOUT_EVAL_NUDGE_STORAGE_KEY,
    version: 1,
  });
  const [isResolveWithoutMonitoringNudgeDismissed, setIsResolveWithoutMonitoringNudgeDismissed] = useLocalStorage({
    initialValue: false,
    key: RESOLVE_WITHOUT_MONITORING_NUDGE_STORAGE_KEY,
    version: 1,
  });
  const tracesRoute = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Traces);
  const selectedTraceIds = selectedTraceId ? [selectedTraceId] : [];
  const { data: selectedTraces, isLoading: isLoadingSelectedTrace } = useGetTracesById(selectedTraceIds);
  const selectedTrace = selectedTraces?.[0];
  const sourceJobId = issue.source_run_id;
  const dedicatedEvalLinkedItems = getEvalLinkedItems(issue, 'new');
  const goldenEvalLinkedItems = getEvalLinkedItems(issue, 'golden');
  const evalLinkedItems = getEvalLinkedItems(issue, evalSetupDatasetMode);

  const createEvalSetupRequest = (overrides: Partial<MockEvalSetupRequest> = {}): MockEvalSetupRequest => ({
    issueId: issue.issue_id,
    issueName: issue.name,
    sourceJobId,
    experimentId,
    traceCount: dedicatedEvalLinkedItems.dataset.traceCount,
    traceIds: issue.example_trace_ids,
    datasetName: dedicatedEvalLinkedItems.dataset.name,
    scorerNames: dedicatedEvalLinkedItems.scorers.map((scorer) => scorer.name),
    goldenDatasetName: goldenEvalLinkedItems.dataset.name,
    goldenDatasetRecordCount: goldenEvalLinkedItems.dataset.existingRecordCount,
    onStart: () => onEvalSetupStatusChange?.(issue.issue_id, 'choosing'),
    onChoice: (mode: MockEvalDatasetMode) => {
      onEvalSetupDatasetModeChange?.(issue.issue_id, mode);
      onEvalSetupStatusChange?.(issue.issue_id, 'running');
    },
    onComplete: (mode: MockEvalDatasetMode) => {
      onEvalSetupDatasetModeChange?.(issue.issue_id, mode);
      onEvalSetupStatusChange?.(issue.issue_id, 'complete');
    },
    ...overrides,
  });

  const handleSetupEval = () => {
    if (evalSetupStatus === 'choosing' || evalSetupStatus === 'running' || evalSetupStatus === 'complete') {
      return;
    }
    startMockEvalSetup(createEvalSetupRequest());
  };

  const handleViewEvaluationRuns = async () => {
    const route = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.EvaluationRuns);
    const latestEvaluationRunId = await getLatestEvaluationRunId(experimentId);
    if (latestEvaluationRunId) {
      const searchParams = new URLSearchParams({ [SELECTED_RUN_UUID_QUERY_PARAM]: latestEvaluationRunId });
      openRouteInNewTab(`${route}?${searchParams.toString()}`);
      return;
    }
    openRouteInNewTab(route);
  };

  const handleViewDataset = () => {
    openRouteInNewTab(Routes.getExperimentPageDatasetDetailRoute(experimentId, evalLinkedItems.dataset.datasetId));
  };

  const handleViewScorer = (scorerName: string) => {
    const route = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Judges);
    const searchParams = new URLSearchParams({
      mockScorers: evalLinkedItems.scorers.map((scorer) => scorer.name).join(','),
      selectedScorer: scorerName,
    });
    openRouteInNewTab(`${route}?${searchParams.toString()}`);
  };

  const createProductionMonitoringRequest = (
    overrides: Partial<MockProductionMonitoringRequest> = {},
  ): MockProductionMonitoringRequest => ({
    issueId: issue.issue_id,
    issueName: issue.name,
    sourceJobId,
    experimentId,
    datasetName: evalLinkedItems.dataset.name,
    scorerNames: evalLinkedItems.scorers.map((scorer) => scorer.name),
    samplingRatio: DEFAULT_PRODUCTION_MONITORING_SAMPLING_RATIO,
    onStart: () => onProductionMonitoringStatusChange?.(issue.issue_id, 'running'),
    onComplete: () => onProductionMonitoringStatusChange?.(issue.issue_id, 'complete'),
    ...overrides,
  });

  const handleMonitorInProduction = () => {
    if (productionMonitoringStatus === 'running' || productionMonitoringStatus === 'complete') {
      return;
    }
    startMockProductionMonitoring(createProductionMonitoringRequest());
  };

  const persistResolveWithoutEvalNudgePreference = () => {
    if (!doNotShowResolveWithoutEvalNudge) {
      return;
    }
    setIsResolveWithoutEvalNudgeDismissed(true);
  };

  const persistResolveWithoutMonitoringNudgePreference = () => {
    if (!doNotShowResolveWithoutMonitoringNudge) {
      return;
    }
    setIsResolveWithoutMonitoringNudgeDismissed(true);
  };

  const closeResolveWithoutEvalModal = () => {
    persistResolveWithoutEvalNudgePreference();
    setIsResolveWithoutEvalModalOpen(false);
  };

  const closeResolveWithoutMonitoringModal = () => {
    persistResolveWithoutMonitoringNudgePreference();
    setIsResolveWithoutMonitoringModalOpen(false);
  };

  const handleSetupEvalFromResolveModal = () => {
    persistResolveWithoutEvalNudgePreference();
    setIsResolveWithoutEvalModalOpen(false);
    handleSetupEval();
  };

  const handleMonitorInProductionFromResolveModal = () => {
    persistResolveWithoutMonitoringNudgePreference();
    setIsResolveWithoutMonitoringModalOpen(false);
    startMockProductionMonitoring(
      createProductionMonitoringRequest({
        onComplete: () => {
          onProductionMonitoringStatusChange?.(issue.issue_id, 'complete');
          handleStatusChange('resolved');
        },
      }),
    );
  };

  const setupEvalComplete = evalSetupStatus === 'complete';
  const productionMonitoringComplete = productionMonitoringStatus === 'complete';
  const nextSteps = [
    {
      key: 'setup-eval',
      componentId: 'mlflow.issues.details.setup-eval',
      title: setupEvalComplete ? (
        <FormattedMessage defaultMessage="Eval created" description="Issue detail next step after eval is created" />
      ) : (
        <FormattedMessage defaultMessage="Setup eval" description="Issue detail next step to set up eval" />
      ),
      onClick: setupEvalComplete ? undefined : handleSetupEval,
      loading: evalSetupStatus === 'running',
      disabled: evalSetupStatus === 'choosing',
      icon: setupEvalComplete ? (
        <CheckCircleIcon css={{ color: theme.colors.textValidationSuccess }} />
      ) : (
        <SparkleIcon color="ai" />
      ),
      success: setupEvalComplete,
    },
    ...(setupEvalComplete
      ? [
          {
            key: 'monitor-production',
            componentId: 'mlflow.issues.details.monitor-production',
            title: productionMonitoringComplete ? (
              <FormattedMessage
                defaultMessage="Monitoring enabled"
                description="Issue detail next step after production monitoring is enabled"
              />
            ) : (
              <FormattedMessage
                defaultMessage="Monitor in production"
                description="Issue detail next step to monitor the issue in production"
              />
            ),
            onClick: productionMonitoringComplete ? undefined : handleMonitorInProduction,
            loading: productionMonitoringStatus === 'running',
            disabled: false,
            icon: productionMonitoringComplete ? (
              <CheckCircleIcon css={{ color: theme.colors.textValidationSuccess }} />
            ) : (
              <SparkleIcon color="ai" />
            ),
            success: productionMonitoringComplete,
          },
        ]
      : []),
    {
      key: 'ask-review',
      componentId: 'mlflow.issues.details.ask-review',
      title: <FormattedMessage defaultMessage="Ask review" description="Issue detail next step to ask review" />,
      onClick: () => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.ReviewQueue)),
      loading: false,
      disabled: false,
      icon: <SparkleIcon color="ai" />,
      success: false,
    },
  ];

  const handleStatusChange = (status: IssueStatus) => {
    if (onStatusChange) {
      onStatusChange(issue.issue_id, status);
      return;
    }
    updateIssueAsync({ issueId: issue.issue_id, status }).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Utils.displayGlobalErrorNotification(
        intl.formatMessage(
          {
            defaultMessage: 'Failed to update issue status: {error}',
            description: 'Error message when issue status update fails',
          },
          { error: errorMessage },
        ),
      );
    });
  };

  const handleResolveWithoutEvalFromModal = () => {
    persistResolveWithoutEvalNudgePreference();
    setIsResolveWithoutEvalModalOpen(false);
    handleStatusChange('resolved');
  };

  const handleResolveWithoutMonitoringFromModal = () => {
    persistResolveWithoutMonitoringNudgePreference();
    setIsResolveWithoutMonitoringModalOpen(false);
    handleStatusChange('resolved');
  };

  const handleResolveIssue = () => {
    if (evalSetupStatus === 'complete') {
      if (productionMonitoringStatus === 'idle') {
        if (isResolveWithoutMonitoringNudgeDismissed) {
          handleStatusChange('resolved');
          return;
        }
        setDoNotShowResolveWithoutMonitoringNudge(false);
        setIsResolveWithoutMonitoringModalOpen(true);
        return;
      }
      handleStatusChange('resolved');
      return;
    }
    if (isResolveWithoutEvalNudgeDismissed) {
      handleStatusChange('resolved');
      return;
    }
    setDoNotShowResolveWithoutEvalNudge(false);
    setIsResolveWithoutEvalModalOpen(true);
  };

  const evalArtifactsVisible = evalSetupStatus !== 'idle';
  const evalArtifactsClickable = evalSetupStatus === 'complete';
  const severityTag = issue.severity ? (
    <Tag componentId="mlflow.issues.details.severity" color={getIssueSeverityTagColor(issue.severity)}>
      {renderIssueSeverityLabel(issue.severity)}
    </Tag>
  ) : null;
  const evalArtifactActionLabel =
    evalSetupStatus === 'complete' ? (
      <FormattedMessage defaultMessage="View" description="View linked eval artifact action" />
    ) : evalSetupStatus === 'running' ? (
      <FormattedMessage defaultMessage="Creating" description="Creating eval artifact status label" />
    ) : (
      <FormattedMessage defaultMessage="Pending" description="Pending eval artifact status label" />
    );
  const datasetDisplayName =
    evalSetupStatus === 'choosing' ? (
      <FormattedMessage defaultMessage="Dataset target" description="Pending generated eval dataset row title" />
    ) : (
      evalLinkedItems.dataset.name
    );

  const renderArtifactRow = ({
    key,
    icon,
    title,
    metadata,
    onClick,
  }: {
    key: string;
    icon: ReactNode;
    title: ReactNode;
    metadata: ReactNode;
    onClick?: () => void;
  }) => {
    const clickable = Boolean(onClick);
    return (
      <div
        key={key}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
        css={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: theme.spacing.md,
          alignItems: 'center',
          padding: `${theme.spacing.sm}px 0`,
          borderBottom: `1px solid ${theme.colors.border}`,
          cursor: clickable ? 'pointer' : 'default',
          ':hover': clickable
            ? {
                backgroundColor: theme.colors.actionDefaultBackgroundHover,
              }
            : undefined,
        }}
      >
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, minWidth: 0 }}>
          {icon}
          <div css={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography.Text bold css={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </Typography.Text>
            <Typography.Text color="secondary" size="sm">
              {metadata}
            </Typography.Text>
          </div>
        </div>
        <Typography.Text
          size="sm"
          css={{
            color: clickable ? theme.colors.actionPrimaryTextDefault : theme.colors.textSecondary,
            fontWeight: clickable ? theme.typography.typographyBoldFontWeight : undefined,
          }}
        >
          {evalArtifactActionLabel}
        </Typography.Text>
      </div>
    );
  };

  return (
    <>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.md,
            padding: theme.spacing.xl,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.md, flexWrap: 'wrap' }}>
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
                minWidth: 0,
                flex: '1 1 280px',
              }}
            >
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
                <Typography.Title level={2} css={{ margin: 0, lineHeight: 1.25 }}>
                  {issue.name}
                </Typography.Title>
                <InfoPopover
                  iconTitle={intl.formatMessage({
                    defaultMessage: 'Issue details',
                    description: 'Issue details metadata popover title',
                  })}
                >
                  <div
                    css={{
                      minWidth: 260,
                      display: 'grid',
                      gridTemplateColumns: '96px minmax(0, 1fr)',
                      gap: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                      alignItems: 'center',
                    }}
                  >
                    {severityTag && (
                      <>
                        <Typography.Text color="secondary" size="sm">
                          <FormattedMessage defaultMessage="Severity" description="Issue severity metadata label" />
                        </Typography.Text>
                        <div>{severityTag}</div>
                      </>
                    )}
                    {sourceJobId && (
                      <>
                        <Typography.Text color="secondary" size="sm">
                          <FormattedMessage defaultMessage="Run ID" description="Issue run ID metadata label" />
                        </Typography.Text>
                        <Typography.Text css={{ wordBreak: 'break-all' }}>{sourceJobId}</Typography.Text>
                      </>
                    )}
                    {issue.trace_count !== undefined && (
                      <>
                        <Typography.Text color="secondary" size="sm">
                          <FormattedMessage defaultMessage="Traces" description="Issue trace count metadata label" />
                        </Typography.Text>
                        <Typography.Text>
                          <FormattedMessage
                            defaultMessage="{count} impacted {count, plural, one {trace} other {traces}}"
                            description="Issue details impacted traces metadata"
                            values={{ count: issue.trace_count }}
                          />
                        </Typography.Text>
                      </>
                    )}
                    <Typography.Text color="secondary" size="sm">
                      <FormattedMessage defaultMessage="Issue ID" description="Label for issue ID in popover" />
                    </Typography.Text>
                    <div css={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <Typography.Text css={{ wordBreak: 'break-all' }}>{issue.issue_id}</Typography.Text>{' '}
                      <Typography.Text
                        size="md"
                        dangerouslySetAntdProps={{
                          copyable: {
                            text: issue.issue_id,
                            icon: <CopyIcon />,
                            tooltips: [
                              intl.formatMessage({
                                defaultMessage: 'Copy issue ID',
                                description: 'Tooltip to copy issue ID',
                              }),
                              intl.formatMessage({
                                defaultMessage: 'Issue ID copied',
                                description: 'Tooltip after issue ID was copied',
                              }),
                            ],
                          },
                        }}
                      />
                    </div>
                  </div>
                </InfoPopover>
              </div>
            </div>
            <div
              css={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: theme.spacing.sm,
                flexShrink: 0,
                marginLeft: 'auto',
              }}
            >
              <Button
                componentId="mlflow.issues.details.reject"
                type="tertiary"
                icon={<CloseIcon />}
                onClick={() => handleStatusChange('rejected')}
                loading={isUpdating}
              >
                <FormattedMessage defaultMessage="Dismiss" description="Button to dismiss issue" />
              </Button>
              <Button
                componentId="mlflow.issues.details.resolve"
                type="primary"
                icon={<CheckCircleIcon />}
                onClick={handleResolveIssue}
                loading={isUpdating}
              >
                <FormattedMessage defaultMessage="Mark as resolved" description="Button to resolve issue" />
              </Button>
            </div>
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage defaultMessage="Next steps" description="Issue details next steps inline label" />
            </Typography.Text>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              {nextSteps.map((step) => (
                <Button
                  key={step.key}
                  componentId={step.componentId}
                  size="small"
                  icon={step.icon}
                  onClick={step.onClick}
                  loading={step.loading}
                  disabled={step.disabled}
                  css={
                    step.success
                      ? {
                          borderColor: theme.colors.textValidationSuccess,
                          color: theme.colors.textValidationSuccess,
                          ':hover': {
                            borderColor: theme.colors.textValidationSuccess,
                            color: theme.colors.textValidationSuccess,
                          },
                        }
                      : undefined
                  }
                >
                  {step.title}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.lg,
            padding: theme.spacing.xl,
          }}
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Title level={4} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Overview" description="Issue details overview heading" />
            </Typography.Title>
            <Typography.Text>{issue.description}</Typography.Text>
          </div>

          {evalArtifactsVisible && (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              <Typography.Title level={4} css={{ margin: 0 }}>
                {evalSetupStatus === 'complete' ? (
                  <FormattedMessage
                    defaultMessage="Linked items"
                    description="Issue details linked eval items heading"
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="Generated eval artifacts"
                    description="Issue details generated eval artifacts heading"
                  />
                )}
              </Typography.Title>
              {evalSetupStatus === 'choosing' && (
                <Typography.Text color="secondary" size="sm">
                  <FormattedMessage
                    defaultMessage="Assistant is waiting for a dataset target. Draft judges are ready to create."
                    description="Issue detail generated eval artifacts waiting text"
                  />
                </Typography.Text>
              )}
              {evalSetupStatus === 'running' && (
                <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Spinner size="small" />
                  <Typography.Text color="secondary" size="sm">
                    <FormattedMessage
                      defaultMessage="Assistant is creating the dataset and judges."
                      description="Issue detail linked items pending text"
                    />
                  </Typography.Text>
                </div>
              )}
              <div css={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${theme.colors.border}` }}>
                {renderArtifactRow({
                  key: 'dataset',
                  icon: <TableIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />,
                  title: datasetDisplayName,
                  metadata:
                    evalSetupStatus === 'choosing' ? (
                      <FormattedMessage
                        defaultMessage="Choose existing golden or new dataset in Assistant"
                        description="Issue detail pending dataset metadata"
                      />
                    ) : evalSetupDatasetMode === 'golden' ? (
                      <FormattedMessage
                        defaultMessage="Golden dataset · {count} added records"
                        description="Issue detail linked golden dataset metadata"
                        values={{ count: evalLinkedItems.dataset.traceCount }}
                      />
                    ) : (
                      <FormattedMessage
                        defaultMessage="Dataset · {count} traces"
                        description="Issue detail linked dataset metadata"
                        values={{ count: evalLinkedItems.dataset.traceCount }}
                      />
                    ),
                  onClick: evalArtifactsClickable ? handleViewDataset : undefined,
                })}
                {evalLinkedItems.scorers.map((scorer) =>
                  renderArtifactRow({
                    key: scorer.name,
                    icon: <SparkleIcon color="ai" css={{ flexShrink: 0 }} />,
                    title: scorer.name,
                    metadata:
                      evalSetupStatus === 'complete' ? (
                        scorer.type
                      ) : (
                        <FormattedMessage defaultMessage="Draft LLM judge" description="Draft generated judge label" />
                      ),
                    onClick: evalArtifactsClickable ? () => handleViewScorer(scorer.name) : undefined,
                  }),
                )}
                {setupEvalComplete &&
                  renderArtifactRow({
                    key: 'evaluation-runs',
                    icon: <ChartLineIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />,
                    title: (
                      <FormattedMessage
                        defaultMessage="Evaluation runs"
                        description="Issue detail linked evaluation runs row title"
                      />
                    ),
                    metadata: (
                      <FormattedMessage
                        defaultMessage="Runs using the linked dataset and judges"
                        description="Issue detail linked evaluation runs metadata"
                      />
                    ),
                    onClick: () => {
                      void handleViewEvaluationRuns();
                    },
                  })}
              </div>
            </div>
          )}

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Title level={4} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Evidence" description="Issue details evidence heading" />
            </Typography.Title>
            <ul css={{ margin: 0, paddingLeft: theme.spacing.lg }}>
              {(issue.example_trace_ids ?? []).map((traceId) => (
                <li key={traceId} css={{ marginBottom: theme.spacing.xs }}>
                  <Button
                    componentId="mlflow.issues.details.evidence-trace-link"
                    type="link"
                    onClick={() => setSelectedTraceId(traceId)}
                    css={{ padding: 0, height: 'auto' }}
                  >
                    {traceId}
                  </Button>{' '}
                  <Typography.Text color="secondary">
                    <FormattedMessage
                      defaultMessage="representative trace for this failure mode"
                      description="Issue evidence trace description"
                    />
                  </Typography.Text>
                </li>
              ))}
            </ul>
            <Button
              componentId="mlflow.issues.details.view-all-traces"
              type="link"
              onClick={() => navigate(tracesRoute)}
              css={{ alignSelf: 'flex-start', padding: 0, height: 'auto' }}
            >
              <FormattedMessage defaultMessage="View all traces" description="Issue details view all traces link" />
            </Button>
          </div>

          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Title level={4} css={{ margin: 0 }}>
              <FormattedMessage defaultMessage="Proposed fix" description="Issue details proposed fix heading" />
            </Typography.Title>
            <Typography.Text>
              {issue.recommendation ?? (
                <FormattedMessage
                  defaultMessage="Inspect representative traces, add a regression dataset, and add an evaluator that checks this failure mode."
                  description="Fallback issue recommendation"
                />
              )}
            </Typography.Text>
          </div>
        </div>
      </div>

      <Modal
        componentId="mlflow.issues.details.resolve-without-eval-modal"
        visible={isResolveWithoutEvalModalOpen}
        title={
          <FormattedMessage
            defaultMessage="Create eval before resolving?"
            description="Title for modal warning before resolving an issue without eval"
          />
        }
        onCancel={closeResolveWithoutEvalModal}
        footer={
          <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
            <Button
              componentId="mlflow.issues.details.resolve-without-eval-modal.resolve"
              onClick={handleResolveWithoutEvalFromModal}
            >
              <FormattedMessage
                defaultMessage="Resolve without eval"
                description="Button to resolve an issue without creating eval"
              />
            </Button>
            <Button
              componentId="mlflow.issues.details.resolve-without-eval-modal.setup-eval"
              type="primary"
              icon={<SparkleIcon color="ai" />}
              onClick={handleSetupEvalFromResolveModal}
            >
              <FormattedMessage defaultMessage="Setup eval" description="Button to set up eval from resolve modal" />
            </Button>
          </div>
        }
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="This issue does not have an eval yet."
              description="Resolve without eval modal intro text"
            />
          </Typography.Text>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="Set one up to turn the impacted traces into a regression dataset and add judges for this failure mode."
              description="Resolve without eval modal explanation text"
            />
          </Typography.Text>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="What you will get"
                description="Resolve modal generated items heading"
              />
            </Typography.Text>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <TableIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
              <Typography.Text>
                <FormattedMessage
                  defaultMessage="Regression dataset"
                  description="Resolve without eval modal dataset item"
                />
              </Typography.Text>
            </div>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <SparkleIcon color="ai" css={{ flexShrink: 0 }} />
              <Typography.Text>
                <FormattedMessage
                  defaultMessage="{count} LLM judges"
                  description="Resolve without eval modal scorer item"
                  values={{ count: dedicatedEvalLinkedItems.scorers.length }}
                />
              </Typography.Text>
            </div>
          </div>
          <Checkbox
            componentId="mlflow.issues.details.resolve-without-eval-modal.do-not-show"
            isChecked={doNotShowResolveWithoutEvalNudge}
            onChange={setDoNotShowResolveWithoutEvalNudge}
          >
            <FormattedMessage
              defaultMessage="Do not show this message again"
              description="Resolve without eval modal dismiss preference checkbox"
            />
          </Checkbox>
        </div>
      </Modal>

      <Modal
        componentId="mlflow.issues.details.resolve-without-monitoring-modal"
        visible={isResolveWithoutMonitoringModalOpen}
        title={
          <FormattedMessage
            defaultMessage="Set up production monitoring before resolving?"
            description="Title for modal warning before resolving an issue without production monitoring"
          />
        }
        onCancel={closeResolveWithoutMonitoringModal}
        footer={
          <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
            <Button
              componentId="mlflow.issues.details.resolve-without-monitoring-modal.resolve"
              onClick={handleResolveWithoutMonitoringFromModal}
            >
              <FormattedMessage
                defaultMessage="Resolve without monitoring"
                description="Button to resolve an issue without setting up production monitoring"
              />
            </Button>
            <Button
              componentId="mlflow.issues.details.resolve-without-monitoring-modal.setup-monitoring"
              type="primary"
              icon={<SparkleIcon color="ai" />}
              onClick={handleMonitorInProductionFromResolveModal}
            >
              <FormattedMessage
                defaultMessage="Monitor in production"
                description="Button to set up production monitoring from resolve modal"
              />
            </Button>
          </div>
        }
      >
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="This issue has an eval, but production monitoring is not enabled yet."
              description="Resolve without monitoring modal intro text"
            />
          </Typography.Text>
          <Typography.Text>
            <FormattedMessage
              defaultMessage="Turn the linked judges into an online monitor so this failure mode is tracked on sampled production traces."
              description="Resolve without monitoring modal explanation text"
            />
          </Typography.Text>
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            <Typography.Text bold>
              <FormattedMessage
                defaultMessage="What you will get"
                description="Resolve modal generated items heading"
              />
            </Typography.Text>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <SparkleIcon color="ai" css={{ flexShrink: 0 }} />
              <Typography.Text>
                <FormattedMessage
                  defaultMessage="Automatic LLM judge execution on sampled traces"
                  description="Resolve without monitoring modal automatic judge execution item"
                />
              </Typography.Text>
            </div>
            <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
              <ChartLineIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
              <Typography.Text>
                <FormattedMessage
                  defaultMessage="Dashboard for viewing trends"
                  description="Resolve without monitoring modal dashboard item"
                />
              </Typography.Text>
            </div>
          </div>
          <Checkbox
            componentId="mlflow.issues.details.resolve-without-monitoring-modal.do-not-show"
            isChecked={doNotShowResolveWithoutMonitoringNudge}
            onChange={setDoNotShowResolveWithoutMonitoringNudge}
          >
            <FormattedMessage
              defaultMessage="Do not show this message again"
              description="Resolve without monitoring modal dismiss preference checkbox"
            />
          </Checkbox>
        </div>
      </Modal>

      {selectedTraceId && (
        <ModelTraceExplorerDrawer
          handleClose={() => setSelectedTraceId(null)}
          selectPreviousEval={() => undefined}
          selectNextEval={() => undefined}
          isPreviousAvailable={false}
          isNextAvailable={false}
          renderModalTitle={() => selectedTraceId}
          isLoading={isLoadingSelectedTrace}
          experimentId={experimentId}
          traceInfo={selectedTrace?.info && isV3ModelTraceInfo(selectedTrace.info) ? selectedTrace.info : undefined}
        >
          {isLoadingSelectedTrace ? (
            <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spinner />
            </div>
          ) : selectedTrace ? (
            <div
              css={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                marginLeft: -theme.spacing.lg,
                marginRight: -theme.spacing.lg,
                marginBottom: -theme.spacing.lg,
              }}
            >
              <ModelTraceExplorer modelTrace={selectedTrace} />
            </div>
          ) : (
            <Empty
              description={null}
              title={
                <FormattedMessage
                  defaultMessage="No trace data recorded"
                  description="Empty state in issue trace drawer when trace has no data"
                />
              }
            />
          )}
        </ModelTraceExplorerDrawer>
      )}
    </>
  );
};
