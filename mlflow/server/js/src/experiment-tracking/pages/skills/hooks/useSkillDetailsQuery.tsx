import { useQuery } from '@tanstack/react-query';
import { RegisteredSkillsApi } from '../api';

export const useSkillDetailsQuery = (skillName: string) => {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['skills', 'details', skillName],
    queryFn: () => RegisteredSkillsApi.getSkillDetails(skillName),
    enabled: Boolean(skillName),
  });

  return {
    skill: data?.skill,
    versions: data?.versions ?? [],
    error,
    isLoading,
    refetch,
  };
};
