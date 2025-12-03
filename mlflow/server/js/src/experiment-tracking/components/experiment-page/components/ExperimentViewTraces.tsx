import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';
import { InsightQueryBanner } from '../../../pages/experiment-insights/components/InsightQueryBanner';
import { TracesView } from '../../traces/TracesView';
import {
  shouldEnableTracesV3View,
  isExperimentEvalResultsMonitoringUIEnabled,
} from '../../../../common/utils/FeatureUtils';
import { TracesV3View } from './traces-v3/TracesV3View';
import { useGetExperimentQuery } from '../../../hooks/useExperimentQuery';
import { TraceInsightsLaunchModal, type JobStatus } from './TraceInsightsLaunchModal';
import { MlflowService } from '../../../sdk/MlflowService';

export const ExperimentViewTraces = ({ experimentIds }: { experimentIds: string[] }) => {
  const { theme } = useDesignSystemTheme();
  const [insightPrompt, setInsightPrompt] = useState('');
  const [insightModalVisible, setInsightModalVisible] = useState(true);
  const [jobId, setJobId] = useState<string>();
  const [jobStatus, setJobStatus] = useState<JobStatus>();
  const [jobError, setJobError] = useState<string>();
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const pollingIntervalRef = useRef<number>();

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = undefined;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const statusToProgress = useCallback((status?: JobStatus) => {
    switch (status) {
      case 'PENDING':
        return 25;
      case 'RUNNING':
        return 65;
      case 'SUCCEEDED':
      case 'FAILED':
      case 'TIMEOUT':
        return 100;
      default:
        return 0;
    }
  }, []);

  const jobProgress = useMemo(() => statusToProgress(jobStatus), [jobStatus, statusToProgress]);

  // TODO(ML-INSIGHTS): Replace with selected trace ids from the table once wired
  const traceIdsForInsights = useMemo(() => [
    // Replace this with the actual trace ID from the table
    'tr-8646cc97c0a1507455c44b764100185a',
    'tr-628ce66cfc19dae63fa9603efaae437b',
    'tr-60d8a70c16d21295bf8c98f9a83a1529',
    'tr-9abe184b2daaaa0030dbc2b17c637092',
    'tr-8de9e17417f98947f6564c017e917a5c',
    'tr-ad4d258aea53d15f9628d2e3193744bf',
    'tr-fde15a5c8baf51a49facee8eb1dfcd31',
    'tr-e1ea391223a6c0e7807ea3577ef0d9f0',
    'tr-40ea6e25070b9e7fff44387dfa440096',
    'tr-57cc2cab50c109838ad65fd27bc3ba86',
  ], []);

  const handleInsightSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setInsightPrompt(trimmed);
    setInsightModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => setInsightModalVisible(false), []);

  const handleAnalyze = useCallback(
    async ({ prompt, model }: { prompt: string; model: string }) => {
      if (!traceIdsForInsights.length) {
        setJobError('No trace IDs available for analysis.');
        return;
      }

      setJobError(undefined);
      setIsSubmittingJob(true);
      setJobStatus('PENDING');

      try {
        const submitResponse = (await MlflowService.submitJob({
          name: 'generate-insight-report',
          params: {
            trace_ids: traceIdsForInsights,
            user_question: prompt,
            model,
          },
        })) as { job_id: string; status: JobStatus };

        setJobId(submitResponse.job_id);
        setJobStatus(submitResponse.status);
        setInsightModalVisible(true);

        stopPolling();
        pollingIntervalRef.current = window.setInterval(async () => {
          try {
            const job = (await MlflowService.getJob(submitResponse.job_id)) as { status: JobStatus };
            setJobStatus(job.status);
            if (job.status === 'SUCCEEDED' || job.status === 'FAILED' || job.status === 'TIMEOUT') {
              stopPolling();
            }
          } catch (error) {
            setJobError((error as Error).message);
            stopPolling();
          }
        }, 2000);
      } catch (error) {
        setJobError((error as Error).message);
        setJobStatus(undefined);
      } finally {
        setIsSubmittingJob(false);
      }
    },
    [stopPolling, traceIdsForInsights],
  );

  return (
    <div
      css={{
        minHeight: 225, // This is the exact height for displaying a minimum five rows and table header
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <InsightQueryBanner
        placeholder={'What Insight do you want to find from your traces? E.g. "What kind of questions are users asking?"'}
        ariaLabel="Create a new Insight"
        size="compact"
        onSubmit={handleInsightSubmit}
      />
      <TracesComponent experimentIds={experimentIds} />
      <TraceInsightsLaunchModal
        visible={insightModalVisible}
        initialPrompt={insightPrompt}
        onCancel={handleCloseModal}
        onAnalyze={handleAnalyze}
        jobId={jobId}
        jobStatus={jobStatus}
        jobProgress={jobProgress}
        jobError={jobError}
        submitting={isSubmittingJob}
      />
    </div>
  );
};

const TracesComponent = ({ experimentIds }: { experimentIds: string[] }) => {
  // A cache-only query to get the loading state
  const { loading: isLoadingExperiment } = useGetExperimentQuery({
    experimentId: experimentIds[0],
    options: {
      fetchPolicy: 'cache-only',
    },
  });

  if (shouldEnableTracesV3View() || isExperimentEvalResultsMonitoringUIEnabled()) {
    return <TracesV3View experimentIds={experimentIds} isLoadingExperiment={isLoadingExperiment} />;
  }
  return <TracesView experimentIds={experimentIds} />;
};
