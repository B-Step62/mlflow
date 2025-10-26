import { useCallback, useEffect, useState } from 'react';
import { MlflowService } from '../../../sdk/MlflowService';
import { ViewType } from '../../../sdk/MlflowEnums';
import type { RunEntity } from '../../../types';
import {
  INSIGHT_FILTERS_TAG,
  INSIGHT_OVERVIEW_TAG,
  INSIGHT_PROMPT_TAG,
  INSIGHT_TRACE_COUNT_TAG,
} from '../utils';

const INSIGHT_RUN_FILTER = "tags.mlflow.insights.prompt LIKE '%'";
const DEFAULT_ORDER_BY = ['attributes.start_time DESC'];
const DEFAULT_MAX_RESULTS = 100;
const HARDCODED_INSIGHT_RUN_UUID = '7a88cfaaa5e04014a45967d3ae3dad53';

const createHardcodedInsightRun = (experimentId: string): RunEntity => {
  const startTimeMs = new Date('2025-03-01T19:52:06Z').getTime();
  const endTimeMs = startTimeMs + 5 * 60 * 1000;
  return {
    info: {
      artifactUri: '',
      endTime: endTimeMs,
      experimentId,
      lifecycleStage: 'active',
      runUuid: HARDCODED_INSIGHT_RUN_UUID,
      runName: 'Question Topic Analysis',
      startTime: startTimeMs,
      status: 'FINISHED',
    },
    data: {
      params: [],
      metrics: [],
      tags: [
        {
          key: INSIGHT_OVERVIEW_TAG,
          value: 'Identified common user questions about billing and platform...',
        },
        {
          key: INSIGHT_TRACE_COUNT_TAG,
          value: '231',
        },
        {
          key: INSIGHT_FILTERS_TAG,
          value: JSON.stringify(['Production logs']),
        },
      ],
    },
  };
};

const ensureHardcodedInsightRun = (runs: RunEntity[], experimentId: string) => {
  if (experimentId !== '1') {
    return runs;
  }
  if (runs.some((run) => run.info.runUuid === HARDCODED_INSIGHT_RUN_UUID)) {
    return runs;
  }
  return [createHardcodedInsightRun(experimentId), ...runs];
};

type UseExperimentInsightsRunsArgs = {
  experimentId: string;
};

type UseExperimentInsightsRunsState = {
  runs: RunEntity[];
  loading: boolean;
  error?: Error;
  refetch: () => Promise<void>;
};

export const useExperimentInsightsRuns = ({ experimentId }: UseExperimentInsightsRunsArgs): UseExperimentInsightsRunsState => {
  const [runs, setRuns] = useState<RunEntity[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error>();

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = (await MlflowService.searchRuns({
        experiment_ids: [experimentId],
        filter: INSIGHT_RUN_FILTER,
        run_view_type: ViewType.ALL,
        order_by: DEFAULT_ORDER_BY,
        max_results: DEFAULT_MAX_RESULTS,
      })) as { runs?: RunEntity[] };
      const fetchedRuns = response.runs ?? [];
      setRuns(ensureHardcodedInsightRun(fetchedRuns, experimentId));
    } catch (err) {
      setError(err as Error);
      setRuns(ensureHardcodedInsightRun([], experimentId));
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return { runs, loading, error, refetch: fetchRuns };
};
