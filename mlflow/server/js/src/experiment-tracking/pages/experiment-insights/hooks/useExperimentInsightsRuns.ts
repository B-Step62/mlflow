import { useCallback, useEffect, useState } from 'react';
import { MlflowService } from '../../../sdk/MlflowService';
import { ViewType } from '../../../sdk/MlflowEnums';
import type { RunEntity } from '../../../types';

// Match any run whose runType starts with INSIGHTS (supports INSIGHTS / INSIGHTS_REPORT variants)
const INSIGHT_RUN_FILTER = 'tags.`mlflow.runType` = \'INSIGHTS\'';
const DEFAULT_ORDER_BY = ['attributes.start_time DESC'];
const DEFAULT_MAX_RESULTS = 100;

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
      setRuns(fetchedRuns);
    } catch (err) {
      setError(err as Error);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  return { runs, loading, error, refetch: fetchRuns };
};
