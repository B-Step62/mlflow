import { useEffect, useRef, useState } from 'react';
import { Button, Spinner, Typography, useLegacyNotification } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { useNavigate } from '../../../../../common/utils/RoutingUtils';
import { shouldEnableBackgroundIssueDetection } from '../../../../../common/utils/FeatureUtils';
import Routes from '../../../../routes';
import { RunPageTabName } from '../../../../constants';
import { JobStatus, isJobComplete, useFetchJobStatus } from '../../../run-page/hooks/useFetchJobStatus';
import { useActiveIssueDetectionRun } from './hooks/useActiveIssueDetectionRun';

export interface SubmittedIssueDetectionJob {
  jobId: string;
  runId: string;
  traceCount: number;
}

interface TrackedJob {
  jobId: string;
  runId: string;
}

interface IssueDetectionStatusChipProps {
  experimentId?: string;
  /** Job submitted from this session's modal, tracked immediately without waiting for run discovery. */
  submittedJob?: SubmittedIssueDetectionJob | null;
}

/**
 * Background status for issue detection jobs: shows a small progress chip while
 * a job is running (click-through to the run page, where Cancel lives) and
 * raises top-right notifications when a job is started and when it completes.
 */
export const IssueDetectionStatusChip = ({ experimentId, submittedJob }: IssueDetectionStatusChipProps) => {
  const navigate = useNavigate();
  const [notification, notificationContextHolder] = useLegacyNotification();
  const enabled = shouldEnableBackgroundIssueDetection();

  const [trackedJob, setTrackedJob] = useState<TrackedJob | null>(null);
  const notifiedStartJobIdsRef = useRef<Set<string>>(new Set());
  const notifiedCompletionJobIdsRef = useRef<Set<string>>(new Set());

  const { activeRun } = useActiveIssueDetectionRun({ experimentId, enabled: enabled && !trackedJob });

  useEffect(() => {
    if (!enabled || !submittedJob || notifiedStartJobIdsRef.current.has(submittedJob.jobId)) {
      return;
    }
    notifiedStartJobIdsRef.current.add(submittedJob.jobId);
    setTrackedJob({ jobId: submittedJob.jobId, runId: submittedJob.runId });
    const startedKey = `issue-detection-started-${submittedJob.jobId}`;
    notification.info({
      key: startedKey,
      placement: 'topRight',
      duration: 8,
      message: (
        <FormattedMessage
          defaultMessage="Issue detection started"
          description="Notification title shown when an issue detection job is submitted"
        />
      ),
      description: (
        <div>
          <FormattedMessage
            defaultMessage="Analyzing {count, plural, one {1 trace} other {# traces}}. We'll notify you here when it completes."
            description="Notification body shown when an issue detection job is submitted"
            values={{ count: submittedJob.traceCount }}
          />{' '}
          <Typography.Link
            componentId="mlflow.traces.issue-detection.started-toast.view-progress"
            onClick={() => {
              notification.close(startedKey);
              if (experimentId) {
                navigate(Routes.getIssueDetectionRunDetailsRoute(experimentId, submittedJob.runId));
              }
            }}
          >
            <FormattedMessage
              defaultMessage="View progress"
              description="Link to the issue detection run page from the job-started notification"
            />
          </Typography.Link>
        </div>
      ),
    });
  }, [enabled, submittedJob, notification, navigate, experimentId]);

  // Discover already-running jobs (e.g. after a page reload) from the experiment's runs
  useEffect(() => {
    if (enabled && !trackedJob && activeRun?.jobId) {
      setTrackedJob({ jobId: activeRun.jobId, runId: activeRun.runId });
    }
  }, [enabled, trackedJob, activeRun]);

  const { status, status_details, result } = useFetchJobStatus({
    jobId: trackedJob?.jobId,
    enabled: enabled && Boolean(trackedJob),
  });

  useEffect(() => {
    if (!trackedJob || !isJobComplete(status)) {
      return;
    }
    const { jobId, runId } = trackedJob;
    if (!notifiedCompletionJobIdsRef.current.has(jobId)) {
      notifiedCompletionJobIdsRef.current.add(jobId);
      const completedKey = `issue-detection-completed-${jobId}`;
      if (status === JobStatus.SUCCEEDED) {
        const jobResult =
          typeof result === 'object' && result !== null
            ? (result as { issues?: number; total_traces_analyzed?: number })
            : undefined;
        const issueCount = jobResult?.issues ?? 0;
        notification.success({
          key: completedKey,
          placement: 'topRight',
          duration: 12,
          message: (
            <FormattedMessage
              defaultMessage="Issue detection completed"
              description="Notification title shown when an issue detection job finishes successfully"
            />
          ),
          description: (
            <div>
              {/* eslint-disable-next-line formatjs/no-multiple-plurals */}
              <FormattedMessage
                defaultMessage="Found {issueCount, plural, =0 {no issues} one {1 issue} other {# issues}} across {traceCount, plural, one {1 trace} other {# traces}}."
                description="Notification body shown when an issue detection job finishes successfully"
                values={{ issueCount, traceCount: jobResult?.total_traces_analyzed ?? 0 }}
              />{' '}
              <Typography.Link
                componentId="mlflow.traces.issue-detection.completed-toast.view-results"
                onClick={() => {
                  notification.close(completedKey);
                  if (experimentId) {
                    // Low-result runs land on the overview (with its guidance callout) instead of a near-empty issues tab
                    navigate(
                      issueCount <= 1
                        ? Routes.getIssueDetectionRunDetailsRoute(experimentId, runId)
                        : Routes.getIssueDetectionRunDetailsTabRoute(experimentId, runId, RunPageTabName.ISSUES),
                    );
                  }
                }}
              >
                {issueCount <= 1 ? (
                  <FormattedMessage
                    defaultMessage="View details"
                    description="Link to the issue detection run overview from the completion notification"
                  />
                ) : (
                  <FormattedMessage
                    defaultMessage="View issues"
                    description="Link to the detected issues from the completion notification"
                  />
                )}
              </Typography.Link>
            </div>
          ),
        });
      } else if (status === JobStatus.FAILED || status === JobStatus.TIMEOUT) {
        notification.error({
          key: completedKey,
          placement: 'topRight',
          duration: 0,
          message: (
            <FormattedMessage
              defaultMessage="Issue detection failed"
              description="Notification title shown when an issue detection job fails"
            />
          ),
          description: (
            <Typography.Link
              componentId="mlflow.traces.issue-detection.failed-toast.view-details"
              onClick={() => {
                notification.close(completedKey);
                if (experimentId) {
                  navigate(Routes.getIssueDetectionRunDetailsRoute(experimentId, runId));
                }
              }}
            >
              <FormattedMessage
                defaultMessage="View details"
                description="Link to the issue detection run page from the failure notification"
              />
            </Typography.Link>
          ),
        });
      }
    }
    setTrackedJob(null);
  }, [status, trackedJob, result, notification, navigate, experimentId]);

  if (!enabled) {
    return null;
  }

  const isDetecting = Boolean(trackedJob) && Boolean(status) && !isJobComplete(status);

  return (
    <>
      {notificationContextHolder}
      {isDetecting && trackedJob && (
        <Button
          componentId="mlflow.traces.issue-detection.status-chip"
          data-testid="issue-detection-status-chip"
          size="small"
          icon={<Spinner size="small" />}
          onClick={() => {
            if (experimentId) {
              navigate(Routes.getIssueDetectionRunDetailsRoute(experimentId, trackedJob.runId));
            }
          }}
        >
          {status_details?.stage ?? (
            <FormattedMessage
              defaultMessage="Detecting issues…"
              description="Label of the toolbar chip shown while an issue detection job is running"
            />
          )}
        </Button>
      )}
    </>
  );
};
