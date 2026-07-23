import { useCallback, useMemo } from 'react';
import { FormattedMessage } from 'react-intl';
import { Button, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { Link, useNavigate, useParams, useSearchParams } from '../../../common/utils/RoutingUtils';
import { RunPage } from '../../components/run-page/RunPage';
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

const MockIssueDetectionRunDetailsPage = ({ experimentId, runUuid }: { experimentId: string; runUuid: string }) => {
  const { theme } = useDesignSystemTheme();
  const navigate = useNavigate();
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
              defaultMessage="Mock issue detection run generated from recent traces."
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
      <IssueDetectionRunOverview
        runInfo={runInfo}
        tags={createMockIssueDetectionTags()}
        issuesOverride={FAILURE_ANALYSIS_CLUSTERS.length}
      />
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

  if (runUuid === MOCK_FAILURE_ANALYSIS_RUN_ID) {
    return <MockIssueDetectionRunDetailsPage experimentId={safeExperimentId} runUuid={runUuid} />;
  }

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
