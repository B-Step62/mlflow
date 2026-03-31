import { useQuery } from '@tanstack/react-query';
import { RegisteredSkillsApi } from '../api';

export const useSkillsListQuery = ({ searchFilter }: { searchFilter?: string } = {}) => {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['skills', 'list', searchFilter],
    queryFn: () => RegisteredSkillsApi.listRegisteredSkills(searchFilter),
  });

  return {
    data: data ?? [],
    error,
    isLoading,
    refetch,
  };
};
