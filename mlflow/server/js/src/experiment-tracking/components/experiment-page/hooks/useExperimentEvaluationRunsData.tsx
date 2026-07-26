import { useInfiniteQuery } from '@databricks/web-shared/query-client';
import type { SearchRunsApiResponse } from '@mlflow/mlflow/src/experiment-tracking/types';
import { MlflowService } from '../../../sdk/MlflowService';
import { useMemo } from 'react';
import { EXPERIMENT_PARENT_ID_TAG } from '../utils/experimentPage.common-utils';

const getMissingParentRunIds = (runs: NonNullable<SearchRunsApiResponse['runs']>) => {
  const runUuids = new Set(runs.map((run) => run.info.runUuid));
  const parentRunIds = new Set<string>();

  for (const run of runs) {
    const parentRunId = run.data?.tags?.find((tag) => tag.key === EXPERIMENT_PARENT_ID_TAG)?.value;
    if (parentRunId && !runUuids.has(parentRunId)) {
      parentRunIds.add(parentRunId);
    }
  }

  return Array.from(parentRunIds);
};

const fetchMissingParentRuns = async (response: SearchRunsApiResponse, experimentId: string) => {
  const runs = response.runs ?? [];
  const missingParentRunIds = getMissingParentRunIds(runs);

  if (!missingParentRunIds.length) {
    return response;
  }

  const parentRuns = (
    await Promise.all(
      missingParentRunIds.map(async (parentRunId) => {
        const parentRunResponse = await MlflowService.searchRuns({
          experiment_ids: [experimentId],
          filter: `run_id = '${parentRunId}'`,
          max_results: 1,
        });
        return parentRunResponse.runs?.[0];
      }),
    )
  ).filter((run): run is NonNullable<typeof run> => Boolean(run));

  return {
    ...response,
    runs: [...runs, ...parentRuns],
  };
};

export const useExperimentEvaluationRunsData = ({
  experimentId,
  enabled,
  filter,
}: {
  experimentId: string;
  enabled: boolean;
  filter: string;
}) => {
  const { data, fetchNextPage, hasNextPage, isLoading, isFetching, refetch, error } = useInfiniteQuery<
    SearchRunsApiResponse,
    Error
  >({
    queryKey: ['SEARCH_RUNS', experimentId, filter],
    queryFn: async ({ pageParam = undefined }) => {
      const requestBody = {
        experiment_ids: [experimentId],
        order_by: ['attributes.start_time DESC'],
        run_view_type: 'ACTIVE_ONLY',
        filter,
        max_results: 50,
        page_token: pageParam,
      };

      const response = await MlflowService.searchRuns(requestBody);
      return fetchMissingParentRuns(response, experimentId);
    },
    cacheTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
    getNextPageParam: (lastPage) => lastPage.next_page_token,
  });

  const { evaluationRuns, trainingRuns } = useMemo(() => {
    if (!data?.pages) {
      return { evaluationRuns: [], trainingRuns: [] };
    }
    const runsByUuid = new Map(data.pages.flatMap((page) => page.runs || []).map((run) => [run.info.runUuid, run]));
    const allRuns = Array.from(runsByUuid.values());
    return allRuns.reduce(
      (acc, run) => {
        const isTrainingRun = run.outputs?.modelOutputs?.length ?? 0;

        if (isTrainingRun) {
          acc.trainingRuns.push(run);
        } else {
          acc.evaluationRuns.push(run);
        }

        return acc;
      },
      { evaluationRuns: [] as typeof allRuns, trainingRuns: [] as typeof allRuns },
    );
  }, [data]);

  return {
    data: evaluationRuns,
    trainingRuns,
    hasNextPage,
    fetchNextPage,
    refetch,
    isLoading,
    isFetching,
    error,
  };
};
