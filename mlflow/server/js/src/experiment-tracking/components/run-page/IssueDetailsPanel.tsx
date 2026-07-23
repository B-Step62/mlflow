import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  Button,
  CheckCircleIcon,
  CloseIcon,
  CopyIcon,
  Empty,
  ForkHorizontalIcon,
  InfoPopover,
  Spinner,
  SparkleIcon,
  Tag,
  Typography,
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
import { type Issue, type IssueStatus } from './hooks/useSearchIssuesQuery';
import { useUpdateIssue } from './hooks/useUpdateIssue';
import Utils from '../../../common/utils/Utils';

interface IssueDetailsPanelProps {
  issue: Issue;
  experimentId: string;
  onStatusChange?: (issueId: string, status: IssueStatus) => void;
}

export const IssueDetailsPanel = ({ issue, experimentId, onStatusChange }: IssueDetailsPanelProps) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const { updateIssueAsync, isUpdating } = useUpdateIssue();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const tracesRoute = Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Traces);
  const selectedTraceIds = selectedTraceId ? [selectedTraceId] : [];
  const { data: selectedTraces, isLoading: isLoadingSelectedTrace } = useGetTracesById(selectedTraceIds);
  const selectedTrace = selectedTraces?.[0];
  const sourceJobId = issue.source_run_id;

  const nextSteps = [
    {
      key: 'setup-eval',
      title: <FormattedMessage defaultMessage="Setup eval" description="Issue detail next step to set up eval" />,
      onClick: () => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.EvaluationRuns)),
    },
    {
      key: 'ask-review',
      title: <FormattedMessage defaultMessage="Ask review" description="Issue detail next step to ask review" />,
      onClick: () => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.ReviewQueue)),
    },
    {
      key: 'create-dataset',
      title: (
        <FormattedMessage defaultMessage="Create dataset" description="Issue detail next step to create dataset" />
      ),
      onClick: () => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Datasets)),
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
              <Typography.Title level={2} css={{ margin: 0, lineHeight: 1.25 }}>
                {issue.name}
              </Typography.Title>
              <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                {issue.severity && (
                  <Tag
                    componentId="mlflow.issues.details.severity"
                    color={
                      issue.severity === 'high'
                        ? 'coral'
                        : issue.severity === 'medium'
                        ? 'lemon'
                        : 'charcoal'
                    }
                  >
                    {issue.severity === 'not_an_issue' ? (
                      <FormattedMessage defaultMessage="Not an issue" description="Not an issue severity label" />
                    ) : issue.severity === 'high' ? (
                      <FormattedMessage defaultMessage="High" description="Issue detail high severity label" />
                    ) : issue.severity === 'medium' ? (
                      <FormattedMessage defaultMessage="Medium" description="Issue detail medium severity label" />
                    ) : issue.severity === 'low' ? (
                      <FormattedMessage defaultMessage="Low" description="Issue detail low severity label" />
                    ) : (
                      issue.severity
                    )}
                  </Tag>
                )}
                {sourceJobId && (
                  <Typography.Text color="secondary" size="sm">
                    <FormattedMessage
                      defaultMessage="Source job: {sourceJobLabel}"
                      description="Issue detail source job metadata"
                      values={{ sourceJobLabel: sourceJobId }}
                    />
                  </Typography.Text>
                )}
                {issue.trace_count !== undefined && (
                  <Typography.Text color="secondary" size="sm">
                    <FormattedMessage
                      defaultMessage="{count} impacted {count, plural, one {trace} other {traces}}"
                      description="Issue details impacted traces metadata"
                      values={{ count: issue.trace_count }}
                    />
                  </Typography.Text>
                )}
                <InfoPopover
                  iconTitle={intl.formatMessage({
                    defaultMessage: 'Issue ID',
                    description: 'Issue details issue ID popover title',
                  })}
                >
                  <div css={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                    <FormattedMessage defaultMessage="Issue ID" description="Label for issue ID in popover" />
                    {': '}
                    {issue.issue_id}{' '}
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
                icon={<CloseIcon />}
                onClick={() => handleStatusChange('rejected')}
                loading={isUpdating}
              >
                <FormattedMessage defaultMessage="Reject" description="Button to reject issue" />
              </Button>
              <Button
                componentId="mlflow.issues.details.resolve"
                type="primary"
                icon={<CheckCircleIcon />}
                onClick={() => handleStatusChange('resolved')}
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
                  componentId={`mlflow.issues.details.${step.key}`}
                  size="small"
                  icon={<SparkleIcon color="ai" />}
                  onClick={step.onClick}
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
