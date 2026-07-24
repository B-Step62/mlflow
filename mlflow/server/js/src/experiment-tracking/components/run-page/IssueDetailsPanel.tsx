import { useState, type ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  CheckCircleIcon,
  CloseIcon,
  CopyIcon,
  Drawer,
  Empty,
  ForkHorizontalIcon,
  InfoPopover,
  Spinner,
  SparkleIcon,
  Tag,
  TableIcon,
  Typography,
  type TagColors,
  useDesignSystemTheme,
} from '@databricks/design-system';
import {
  isV3ModelTraceInfo,
  ModelTraceExplorer,
  ModelTraceExplorerDrawer,
  useGetTracesById,
} from '@databricks/web-shared/model-trace-explorer';

import { useNavigate } from '../../../common/utils/RoutingUtils';
import { ExperimentPageTabName } from '../../constants';
import Routes from '../../routes';
import { type Issue, type IssueSeverity, type IssueStatus } from './hooks/useSearchIssuesQuery';
import { useUpdateIssue } from './hooks/useUpdateIssue';
import Utils from '../../../common/utils/Utils';
import { useAssistant } from '../../../assistant/AssistantContext';
import type { MockEvalSetupRequest } from '../../../assistant/types';
import {
  getEvalLinkedItems,
  getMockEvalDatasetRecords,
  getMockEvalScorers,
  type MockEvalDatasetMode,
} from '../../mockEvalArtifacts';

export type IssueEvalSetupStatus = 'idle' | 'choosing' | 'running' | 'complete';

interface IssueDetailsPanelProps {
  issue: Issue;
  experimentId: string;
  onStatusChange?: (issueId: string, status: IssueStatus) => void;
  evalSetupStatus?: IssueEvalSetupStatus;
  evalSetupDatasetMode?: MockEvalDatasetMode;
  onEvalSetupStatusChange?: (issueId: string, status: IssueEvalSetupStatus) => void;
  onEvalSetupDatasetModeChange?: (issueId: string, mode: MockEvalDatasetMode) => void;
}

type LinkedArtifactDrawer = { type: 'dataset' } | { type: 'scorer'; scorerName: string };

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

export const IssueDetailsPanel = ({
  issue,
  experimentId,
  onStatusChange,
  evalSetupStatus = 'idle',
  evalSetupDatasetMode = 'new',
  onEvalSetupStatusChange,
  onEvalSetupDatasetModeChange,
}: IssueDetailsPanelProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const { startMockEvalSetup, startMockIssueResolution } = useAssistant();
  const { updateIssueAsync, isUpdating } = useUpdateIssue();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [linkedArtifactDrawer, setLinkedArtifactDrawer] = useState<LinkedArtifactDrawer | null>(null);
  const tracesRoute = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Traces);
  const selectedTraceIds = selectedTraceId ? [selectedTraceId] : [];
  const { data: selectedTraces, isLoading: isLoadingSelectedTrace } = useGetTracesById(selectedTraceIds);
  const selectedTrace = selectedTraces?.[0];
  const sourceJobId = issue.source_run_id;
  const dedicatedEvalLinkedItems = getEvalLinkedItems(issue, 'new');
  const goldenEvalLinkedItems = getEvalLinkedItems(issue, 'golden');
  const evalLinkedItems = getEvalLinkedItems(issue, evalSetupDatasetMode);
  const datasetRecords = getMockEvalDatasetRecords(evalLinkedItems.dataset.datasetId) ?? [];
  const scorerDetails = getMockEvalScorers(evalLinkedItems.scorers.map((scorer) => scorer.name));
  const selectedScorer =
    linkedArtifactDrawer?.type === 'scorer'
      ? scorerDetails.find((scorer) => scorer.name === linkedArtifactDrawer.scorerName)
      : undefined;

  const createEvalSetupRequest = (overrides: Partial<MockEvalSetupRequest> = {}): MockEvalSetupRequest => ({
    issueId: issue.issue_id,
    issueName: issue.name,
    sourceJobId,
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

  const setupEvalComplete = evalSetupStatus === 'complete';
  const nextSteps = [
    {
      key: 'setup-eval',
      componentId: 'mlflow.issues.details.setup-eval',
      title: <FormattedMessage defaultMessage="Setup eval" description="Issue detail next step to set up eval" />,
      onClick: handleSetupEval,
      loading: evalSetupStatus === 'running',
      disabled: evalSetupStatus === 'choosing' || setupEvalComplete,
      icon: setupEvalComplete ? (
        <CheckCircleIcon css={{ color: theme.colors.textValidationSuccess }} />
      ) : (
        <SparkleIcon color="ai" />
      ),
    },
    {
      key: 'ask-review',
      componentId: 'mlflow.issues.details.ask-review',
      title: <FormattedMessage defaultMessage="Ask review" description="Issue detail next step to ask review" />,
      onClick: () => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.ReviewQueue)),
      loading: false,
      disabled: false,
      icon: <SparkleIcon color="ai" />,
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

  const handleResolveIssue = () => {
    if (evalSetupStatus === 'complete') {
      handleStatusChange('resolved');
      return;
    }
    startMockIssueResolution(createEvalSetupRequest({ onResolve: () => handleStatusChange('resolved') }));
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
                  onClick: evalArtifactsClickable ? () => setLinkedArtifactDrawer({ type: 'dataset' }) : undefined,
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
                    onClick: evalArtifactsClickable
                      ? () => setLinkedArtifactDrawer({ type: 'scorer', scorerName: scorer.name })
                      : undefined,
                  }),
                )}
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

          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Typography.Text color="secondary" size="sm">
              <FormattedMessage defaultMessage="Example traces" description="Issue details example traces label" />
            </Typography.Text>
            {(issue.example_trace_ids ?? []).map((traceId) => (
              <Button
                key={traceId}
                componentId="mlflow.issues.details.example-trace"
                size="small"
                icon={<ForkHorizontalIcon />}
                onClick={() => setSelectedTraceId(traceId)}
              >
                {traceId}
              </Button>
            ))}
            <Button
              componentId="mlflow.issues.details.view-all-traces"
              type="link"
              onClick={() => navigate(tracesRoute)}
            >
              <FormattedMessage defaultMessage="View all" description="Issue details view all traces link" />
            </Button>
          </div>
        </div>
      </div>

      <Drawer.Root open={linkedArtifactDrawer !== null} onOpenChange={(open) => !open && setLinkedArtifactDrawer(null)}>
        <Drawer.Content
          componentId="mlflow.issues.details.linked-artifact-drawer"
          width="560px"
          title={
            <Typography.Title level={3} withoutMargins>
              {linkedArtifactDrawer?.type === 'scorer' ? selectedScorer?.name : evalLinkedItems.dataset.name}
            </Typography.Title>
          }
        >
          {linkedArtifactDrawer?.type === 'dataset' ? (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <Tag componentId="mlflow.issues.details.dataset-drawer-type" color="charcoal">
                  {evalSetupDatasetMode === 'golden' ? (
                    <FormattedMessage defaultMessage="Golden dataset" description="Golden dataset drawer type label" />
                  ) : (
                    <FormattedMessage defaultMessage="Dataset" description="Dataset drawer type label" />
                  )}
                </Tag>
                <Typography.Text color="secondary" size="sm">
                  {evalSetupDatasetMode === 'golden' ? (
                    <FormattedMessage
                      defaultMessage="{count} new issue records"
                      description="Golden dataset drawer added records label"
                      values={{ count: evalLinkedItems.dataset.traceCount }}
                    />
                  ) : (
                    <FormattedMessage
                      defaultMessage="{count} issue records"
                      description="Dataset drawer records label"
                      values={{ count: evalLinkedItems.dataset.traceCount }}
                    />
                  )}
                </Typography.Text>
              </div>
              <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                {datasetRecords.map((record) => (
                  <div
                    key={record.dataset_record_id}
                    css={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: theme.spacing.xs,
                      padding: theme.spacing.md,
                      border: `1px solid ${theme.colors.border}`,
                      borderRadius: theme.borders.borderRadiusMd,
                      backgroundColor: theme.colors.backgroundPrimary,
                    }}
                  >
                    <Typography.Text bold>{record.inputs['question']}</Typography.Text>
                    <Typography.Text color="secondary" size="sm">
                      {record.inputs['retrieved_evidence']}
                    </Typography.Text>
                    <div
                      css={{
                        marginTop: theme.spacing.xs,
                        padding: theme.spacing.sm,
                        borderRadius: theme.borders.borderRadiusSm,
                        backgroundColor: theme.colors.backgroundSecondary,
                      }}
                    >
                      <Typography.Text size="sm">{record.expectations?.['expected_response']}</Typography.Text>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <Tag componentId="mlflow.issues.details.scorer-drawer-type" color="purple">
                  <FormattedMessage defaultMessage="LLM judge" description="Scorer drawer type label" />
                </Tag>
                {selectedScorer?.type === 'llm' && selectedScorer.model && (
                  <Typography.Text color="secondary" size="sm">
                    {selectedScorer.model}
                  </Typography.Text>
                )}
              </div>
              {selectedScorer?.type === 'llm' && (
                <>
                  <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                    <Typography.Text bold>
                      <FormattedMessage defaultMessage="Guidelines" description="Scorer drawer guidelines heading" />
                    </Typography.Text>
                    <ul css={{ margin: 0, paddingLeft: theme.spacing.lg }}>
                      {(selectedScorer.guidelines ?? []).map((guideline) => (
                        <li key={guideline} css={{ marginBottom: theme.spacing.xs }}>
                          <Typography.Text>{guideline}</Typography.Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selectedScorer.filterString && (
                    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
                      <Typography.Text bold>
                        <FormattedMessage defaultMessage="Filter" description="Scorer drawer filter heading" />
                      </Typography.Text>
                      <Typography.Text code>{selectedScorer.filterString}</Typography.Text>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Root>

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
