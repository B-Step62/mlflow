import { useQuery } from '@mlflow/mlflow/src/common/utils/reactQueryHooks';
import { listCommits } from '../api';
import type { CommitInfo } from '../api';

type CommitListQueryKey = ['playground_commits', string];

export const useCommitList = (repo: string) => {
  const queryResult = useQuery<CommitInfo[], Error, CommitInfo[], CommitListQueryKey>(['playground_commits', repo], {
    queryFn: () => listCommits(repo),
    enabled: !!repo,
    retry: false,
  });

  return {
    commits: queryResult.data ?? [],
    isLoading: queryResult.isLoading,
    error: queryResult.error ?? null,
  };
};
