import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getArtifactChunkedText, getArtifactLocationUrl } from '../../../../common/utils/ArtifactUtils';
import {
  INSIGHT_CLUSTER_ARTIFACT_PATH,
  normalizeInsightClusters,
  type NormalizedClusters,
} from '../utils';

export const useInsightClusterDetails = (runUuid?: string) => {
  const enabled = Boolean(runUuid);
  const query = useQuery({
    queryKey: ['insight-cluster-details', runUuid],
    enabled,
    queryFn: async () => {
      const location = getArtifactLocationUrl(INSIGHT_CLUSTER_ARTIFACT_PATH, runUuid!);
      const text = await getArtifactChunkedText(location);
      return text;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const parsed: NormalizedClusters | undefined = useMemo(() => {
    if (!query.data) {
      return undefined;
    }
    try {
      const json = JSON.parse(query.data);
      return normalizeInsightClusters(json);
    } catch {
      return undefined;
    }
  }, [query.data]);

  return {
    raw: query.data,
    data: parsed,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
};

