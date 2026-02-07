import { useQuery } from '@mlflow/mlflow/src/common/utils/reactQueryHooks';
import { listSkills } from '../api';
import type { SkillInfo } from '../api';

type SkillListQueryKey = ['playground_skills', string, string];

export const useSkillList = (repo: string, ref: string) => {
  const queryResult = useQuery<SkillInfo[], Error, SkillInfo[], SkillListQueryKey>(['playground_skills', repo, ref], {
    queryFn: () => listSkills(repo, ref),
    enabled: !!repo && !!ref,
    retry: false,
  });

  return {
    skills: queryResult.data ?? [],
    isLoading: queryResult.isLoading,
    error: queryResult.error ?? null,
  };
};
