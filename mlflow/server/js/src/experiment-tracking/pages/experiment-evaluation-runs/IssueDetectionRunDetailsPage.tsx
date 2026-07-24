import { useCallback, useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import {
  Button,
  Empty,
  ForkHorizontalIcon,
  Spinner,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import {
  isV3ModelTraceInfo,
  ModelTraceExplorer,
  ModelTraceExplorerDrawer,
  useGetTracesById,
} from '@databricks/web-shared/model-trace-explorer';
import { Link, useNavigate, useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { RunPage } from '../../components/run-page/RunPage';
import { RunViewModeSwitch } from '../../components/run-page/RunViewModeSwitch';
import { useRunViewActiveTab } from '../../components/run-page/useRunViewActiveTab';
import { RunViewIssuesContent } from '../../components/run-page/RunViewIssuesTab';
import type { IssueEvalSetupStatus } from '../../components/run-page/IssueDetailsPanel';
import type { Issue, IssueStatus } from '../../components/run-page/hooks/useSearchIssuesQuery';
import type { MockEvalDatasetMode } from '../../mockEvalArtifacts';
import {
  ExperimentPageTabName,
  RunPageTabName,
  MLFLOW_ISSUE_DETECTION_JOB_ID_TAG,
  MLFLOW_ISSUE_DETECTION_RESULT_ISSUES_TAG,
  MLFLOW_ISSUE_DETECTION_RESULT_SUMMARY_TAG,
  MLFLOW_ISSUE_DETECTION_RESULT_TOTAL_TRACES_TAG,
} from '../../constants';
import Routes from '../../routes';
import { getPreservedQueryString } from '../experiment-page-tabs/side-nav/utils';
import { useGetExperimentQuery } from '../../hooks/useExperimentQuery';
import { IssueDetectionRunOverview } from '../../components/run-page/overview/IssueDetectionRunOverview';
import type { KeyValueEntity } from '../../../common/types';
import type { RunInfoEntity } from '../../types';
import {
  FAILURE_ANALYSIS_CLUSTERS,
  FAILURE_ANALYSIS_SUMMARY,
  FAILURE_ANALYSIS_TOTAL_CONVERSATIONS,
  MOCK_FAILURE_ANALYSIS_RUN_ID,
  MOCK_FAILURE_ANALYSIS_ISSUES,
} from '../experiment-overview/failureAnalysisMock';

const createMockIssueDetectionTags = (): Record<string, KeyValueEntity> => ({
  [MLFLOW_ISSUE_DETECTION_RESULT_ISSUES_TAG]: {
    key: MLFLOW_ISSUE_DETECTION_RESULT_ISSUES_TAG,
    value: String(FAILURE_ANALYSIS_CLUSTERS.length),
  },
  [MLFLOW_ISSUE_DETECTION_RESULT_TOTAL_TRACES_TAG]: {
    key: MLFLOW_ISSUE_DETECTION_RESULT_TOTAL_TRACES_TAG,
    value: String(FAILURE_ANALYSIS_TOTAL_CONVERSATIONS),
  },
  [MLFLOW_ISSUE_DETECTION_RESULT_SUMMARY_TAG]: {
    key: MLFLOW_ISSUE_DETECTION_RESULT_SUMMARY_TAG,
    value: FAILURE_ANALYSIS_SUMMARY,
  },
  categories: {
    key: 'categories',
    value: 'Correctness, Retrieval, Tool usage',
  },
  model: {
    key: 'model',
    value: 'Mock analyzer',
  },
  'mlflow.user': {
    key: 'mlflow.user',
    value: 'MLflow',
  },
});

const truncateSourceJobId = (sourceRunId?: string) => {
  if (!sourceRunId) {
    return '';
  }
  const displayId = sourceRunId.replace(/^job_/, '');
  return displayId.length > 8 ? `${displayId.slice(0, 7)}...` : displayId;
};

const MockIssueDetectionIssuesTab = ({ experimentId }: { experimentId: string }) => {
  const { theme } = useDesignSystemTheme();
  const [statusOverrides, setStatusOverrides] = useState<Record<string, IssueStatus>>({});
  const [evalSetupStatuses, setEvalSetupStatuses] = useState<Record<string, IssueEvalSetupStatus>>({});
  const [evalSetupDatasetModes, setEvalSetupDatasetModes] = useState<Record<string, MockEvalDatasetMode>>({});
  const issues = useMemo<Issue[]>(
    () =>
      MOCK_FAILURE_ANALYSIS_ISSUES.map(
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
          experiment_id: experimentId || experiment_id,
          name,
          description,
          severity,
          status: statusOverrides[issue_id] ?? status,
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
    [experimentId, statusOverrides],
  );

  return (
    <div
      css={{
        minHeight: 520,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
      }}
    >
      <RunViewIssuesContent
        issues={issues}
        experimentId={experimentId}
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
  );
};

const MockIssueDetectionTracesTab = ({ experimentId }: { experimentId: string }) => {
  const { theme } = useDesignSystemTheme();
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const selectedTraceIds = selectedTraceId ? [selectedTraceId] : [];
  const { data: selectedTraces, isLoading: isLoadingSelectedTrace } = useGetTracesById(selectedTraceIds);
  const selectedTrace = selectedTraces?.[0];
  const traces = MOCK_FAILURE_ANALYSIS_ISSUES.flatMap((issue) =>
    issue.example_trace_ids.map((traceId) => ({
      traceId,
      issueName: issue.name,
    })),
  );

  return (
    <>
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.md,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusMd,
          padding: theme.spacing.lg,
        }}
      >
        <Typography.Title level={4} css={{ margin: 0 }}>
          <FormattedMessage defaultMessage="Linked traces" description="Mock issue detection linked traces title" />
        </Typography.Title>
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          {traces.map(({ traceId, issueName }) => (
            <button
              key={traceId}
              type="button"
              onClick={() => setSelectedTraceId(traceId)}
              css={{
                display: 'grid',
                gridTemplateColumns: 'minmax(140px, 220px) minmax(0, 1fr)',
                alignItems: 'center',
                gap: theme.spacing.md,
                width: '100%',
                padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.borders.borderRadiusSm,
                background: theme.colors.backgroundPrimary,
                color: theme.colors.textPrimary,
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                ':hover': {
                  backgroundColor: theme.colors.actionDefaultBackgroundHover,
                },
                ':focus-visible': {
                  outline: `2px solid ${theme.colors.actionPrimaryBackgroundDefault}`,
                  outlineOffset: 1,
                },
              }}
            >
              <span css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, minWidth: 0 }}>
                <ForkHorizontalIcon css={{ color: theme.colors.textSecondary, flexShrink: 0 }} />
                <Typography.Text bold css={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {traceId}
                </Typography.Text>
              </span>
              <Typography.Text color="secondary" css={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {issueName}
              </Typography.Text>
            </button>
          ))}
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
                  description="Empty state in issue detection trace drawer when trace has no data"
                />
              }
            />
          )}
        </ModelTraceExplorerDrawer>
      )}
    </>
  );
};

const MockIssueDetectionRunDetailsPage = ({ experimentId, runUuid }: { experimentId: string; runUuid: string }) => {
  const { theme } = useDesignSystemTheme();
  const navigate = useNavigate();
  const activeTab = useRunViewActiveTab();
  const now = Date.now();
  const runInfo: RunInfoEntity = {
    artifactUri: '',
    endTime: now,
    experimentId,
    lifecycleStage: 'active',
    runName: 'Find common failure modes',
    runUuid,
    startTime: now - 86 * 1000,
    status: 'FINISHED',
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.lg,
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: theme.spacing.lg,
      }}
    >
      <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.md, alignItems: 'center' }}>
        <div>
          <Typography.Title level={3} css={{ marginTop: 0, marginBottom: theme.spacing.xs }}>
            <FormattedMessage
              defaultMessage="Failure analysis result"
              description="Mock issue detection result page title"
            />
          </Typography.Title>
          <Typography.Text color="secondary">
            <FormattedMessage
              defaultMessage="Issue detection run generated from recent traces."
              description="Mock issue detection result page subtitle"
            />
          </Typography.Text>
        </div>
        <Button
          componentId="mlflow.issue-detection.mock-result.back-to-overview-button"
          onClick={() => navigate(Routes.getExperimentPageTabRoute(experimentId, ExperimentPageTabName.Overview))}
        >
          <FormattedMessage defaultMessage="Back to Overview" description="Back to overview button" />
        </Button>
      </div>
      <RunViewModeSwitch
        getBaseRoute={Routes.getIssueDetectionRunDetailsRoute}
        getTabRoute={Routes.getIssueDetectionRunDetailsTabRoute}
        visibleTabs={[RunPageTabName.OVERVIEW, RunPageTabName.ISSUES, RunPageTabName.TRACES]}
      />
      {activeTab === RunPageTabName.ISSUES ? (
        <MockIssueDetectionIssuesTab experimentId={experimentId} />
      ) : activeTab === RunPageTabName.TRACES ? (
        <MockIssueDetectionTracesTab experimentId={experimentId} />
      ) : (
        <IssueDetectionRunOverview
          runInfo={runInfo}
          tags={createMockIssueDetectionTags()}
          issuesOverride={FAILURE_ANALYSIS_CLUSTERS.length}
        />
      )}
    </div>
  );
};

/**
 * Thin wrapper around RunPage for issue detection run details.
 * Customizes breadcrumbs and tab navigation to stay within /evaluation-runs/ routes.
 */
export const IssueDetectionRunDetailsPage = () => {
  const { experimentId, runUuid } = useParams<{ experimentId: string; runUuid: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const safeExperimentId = experimentId as string;
  const timeRangeSearch = useMemo(() => getPreservedQueryString(searchParams.toString()), [searchParams]);

  // Fetch experiment data for breadcrumb
  const { data: experiment } = useGetExperimentQuery({ experimentId: safeExperimentId });

  // Helper to append time-range search params to a route
  const withSearchParams = useCallback(
    (route: string) => (timeRangeSearch ? `${route}${timeRangeSearch}` : route),
    [timeRangeSearch],
  );

  const customBreadcrumbs = useMemo(() => {
    const experimentName = experiment?.name ?? safeExperimentId;
    const evalRunsRoute = Routes.getExperimentPageTabRoute(safeExperimentId, ExperimentPageTabName.EvaluationRuns);
    return [
      <Link
        componentId="mlflow.experiment_tracking.issue_detection.breadcrumb_experiments_link"
        key="experiments"
        to={Routes.experimentsObservatoryRoute}
      >
        <FormattedMessage
          defaultMessage="Experiments"
          description="Issue detection run details > Breadcrumb > Experiments"
        />
      </Link>,
      <Link
        componentId="mlflow.experiment_tracking.issue_detection.breadcrumb_experiment_link"
        key="experiment"
        to={Routes.getExperimentPageRoute(safeExperimentId)}
      >
        {experimentName}
      </Link>,
      <Link
        componentId="mlflow.experiment_tracking.issue_detection.breadcrumb_evaluation_runs_link"
        key="evaluation-runs"
        to={{ pathname: evalRunsRoute, search: timeRangeSearch }}
      >
        <FormattedMessage
          defaultMessage="Evaluation runs"
          description="Issue detection run details > Breadcrumb > Evaluation runs"
        />
      </Link>,
    ];
  }, [experiment?.name, safeExperimentId, timeRangeSearch]);

  const handleDeleteSuccess = useCallback(
    (expId: string) => {
      navigate(withSearchParams(Routes.getExperimentPageTabRoute(expId, ExperimentPageTabName.EvaluationRuns)));
    },
    [navigate, withSearchParams],
  );

  if (runUuid === MOCK_FAILURE_ANALYSIS_RUN_ID) {
    return <MockIssueDetectionRunDetailsPage experimentId={safeExperimentId} runUuid={runUuid} />;
  }

  return (
    <RunPage
      customBreadcrumbs={customBreadcrumbs}
      tabSwitchProps={{
        getBaseRoute: Routes.getIssueDetectionRunDetailsRoute,
        getTabRoute: Routes.getIssueDetectionRunDetailsTabRoute,
        visibleTabs: [RunPageTabName.OVERVIEW, RunPageTabName.ISSUES, RunPageTabName.TRACES],
      }}
      onDeleteSuccess={handleDeleteSuccess}
      hideTracesCompareSelector
      renderCustomOverview={({ runInfo, tags, onRunDataUpdated }) => (
        <IssueDetectionRunOverview
          runInfo={runInfo}
          tags={tags}
          jobId={tags[MLFLOW_ISSUE_DETECTION_JOB_ID_TAG]?.value}
          onRunDataUpdated={onRunDataUpdated}
        />
      )}
    />
  );
};

export default IssueDetectionRunDetailsPage;
