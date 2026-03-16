import { useQuery, useMutation, useQueryClient } from '@databricks/web-shared/query-client';
import { fetchAPI, getAjaxUrl } from '@mlflow/mlflow/src/common/utils/FetchUtils';
import { useMemo } from 'react';
import { parseJSONSafe } from '@mlflow/mlflow/src/common/utils/TagUtils';
import type { EvaluationDatasetRecord } from '../../../pages/experiment-evaluation-datasets/types';
import type { EvaluationDataset } from '../../../pages/experiment-evaluation-datasets/types';

const DATASET_RECORDS_QUERY_KEY = 'SCENARIOS_DATASET_RECORDS';
const DATASET_METADATA_QUERY_KEY = 'SCENARIOS_DATASET_METADATA';

type GetDatasetRecordsResponse = {
  records: string;
  next_page_token?: string;
};

type GetDatasetResponse = {
  dataset: EvaluationDataset;
};

type UpsertDatasetRecordsResponse = {
  insertedCount: number;
  updatedCount: number;
};

type DeleteDatasetRecordsResponse = {
  deleted_count: number;
};

type SetDatasetTagsResponse = {
  dataset: EvaluationDataset;
};

type GenerateScenariosResponse = {
  generated_count: number;
};

export const useGetDatasetRecordsQuery = ({ datasetId, enabled = true }: { datasetId: string; enabled?: boolean }) => {
  const { data, isLoading, refetch, error } = useQuery<GetDatasetRecordsResponse, Error>({
    queryKey: [DATASET_RECORDS_QUERY_KEY, datasetId],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      queryParams.set('dataset_id', datasetId);
      queryParams.set('max_results', '1000');

      return (await fetchAPI(
        getAjaxUrl(`ajax-api/3.0/mlflow/datasets/${datasetId}/records?${queryParams.toString()}`),
      )) as GetDatasetRecordsResponse;
    },
    cacheTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && Boolean(datasetId),
  });

  const records = useMemo(
    () => (data?.records ? (parseJSONSafe(data.records) as EvaluationDatasetRecord[]) : []),
    [data],
  );

  return { records, isLoading, refetch, error };
};

export const useGetDatasetQuery = ({ datasetId, enabled = true }: { datasetId: string; enabled?: boolean }) => {
  const { data, isLoading, refetch, error } = useQuery<GetDatasetResponse, Error>({
    queryKey: [DATASET_METADATA_QUERY_KEY, datasetId],
    queryFn: async () => {
      return (await fetchAPI(getAjaxUrl(`ajax-api/3.0/mlflow/datasets/${datasetId}`))) as GetDatasetResponse;
    },
    cacheTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && Boolean(datasetId),
  });

  return { dataset: data?.dataset, isLoading, refetch, error };
};

export const useUpsertDatasetRecords = ({ datasetId }: { datasetId: string }) => {
  const queryClient = useQueryClient();

  const { mutateAsync, isLoading } = useMutation<UpsertDatasetRecordsResponse, Error, Record<string, any>[]>({
    mutationFn: async (records) => {
      // Ensure inputs is an object (not a JSON string) before serializing
      const serializedRecords = records.map((r) => {
        const inputs = r['inputs'];
        return {
          ...r,
          inputs: typeof inputs === 'string' ? JSON.parse(inputs) : inputs,
        };
      });

      return (await fetchAPI(getAjaxUrl(`ajax-api/3.0/mlflow/datasets/${datasetId}/records`), {
        method: 'POST',
        body: {
          dataset_id: datasetId,
          records: JSON.stringify(serializedRecords),
        },
      })) as UpsertDatasetRecordsResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries([DATASET_RECORDS_QUERY_KEY, datasetId]);
    },
  });

  return { upsertRecords: mutateAsync, isLoading };
};

export const useDeleteDatasetRecords = ({ datasetId }: { datasetId: string }) => {
  const queryClient = useQueryClient();

  const { mutateAsync, isLoading } = useMutation<DeleteDatasetRecordsResponse, Error, string[]>({
    mutationFn: async (recordIds) => {
      return (await fetchAPI(getAjaxUrl(`ajax-api/3.0/mlflow/datasets/${datasetId}/records`), {
        method: 'DELETE',
        body: {
          dataset_id: datasetId,
          dataset_record_ids: recordIds,
        },
      })) as DeleteDatasetRecordsResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries([DATASET_RECORDS_QUERY_KEY, datasetId]);
    },
  });

  return { deleteRecords: mutateAsync, isLoading };
};

export const useSetDatasetTags = ({ datasetId }: { datasetId: string }) => {
  const queryClient = useQueryClient();

  const { mutateAsync, isLoading } = useMutation<SetDatasetTagsResponse, Error, Record<string, string>>({
    mutationFn: async (tags) => {
      return (await fetchAPI(getAjaxUrl(`ajax-api/3.0/mlflow/datasets/${datasetId}/tags`), {
        method: 'PATCH',
        body: {
          dataset_id: datasetId,
          tags: JSON.stringify(tags),
        },
      })) as SetDatasetTagsResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries([DATASET_METADATA_QUERY_KEY, datasetId]);
    },
  });

  return { setTags: mutateAsync, isLoading };
};

export const useGenerateScenarios = ({ datasetId }: { datasetId: string }) => {
  const queryClient = useQueryClient();

  const { mutateAsync, isLoading } = useMutation<
    GenerateScenariosResponse,
    Error,
    { agentDescription: string; model: string; testingGuidance: string }
  >({
    mutationFn: async ({ agentDescription, model, testingGuidance }) => {
      return (await fetchAPI(getAjaxUrl('ajax-api/3.0/mlflow/genai/generate-scenarios'), {
        method: 'POST',
        body: {
          dataset_id: datasetId,
          agent_description: agentDescription,
          model: model,
          testing_guidance: testingGuidance,
        },
      })) as GenerateScenariosResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries([DATASET_RECORDS_QUERY_KEY, datasetId]);
    },
  });

  return { generateScenarios: mutateAsync, isGenerating: isLoading };
};
