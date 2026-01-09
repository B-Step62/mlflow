import { useMemo } from 'react';

import { useRegisterAssistantContext } from '@mlflow/mlflow/src/shared/web-shared/assistant';
import { useGenAiTraceTableRowSelection } from '@mlflow/mlflow/src/shared/web-shared/genai-traces-table/hooks/useGenAiTraceTableRowSelection';

/**
 * Hook that registers session-related context with the assistant for the sessions list page.
 * Should be called inside GenAiTraceTableRowSelectionProvider to access shared row selection state.
 *
 * @param experimentId - The current experiment ID
 */
export const useSessionsAssistantContext = (experimentId: string) => {
  // Get selected sessions (from table)
  const { rowSelection } = useGenAiTraceTableRowSelection();

  // Extract selected session IDs from row selection state
  const selectedSessionIds = useMemo(() => {
    const ids = Object.keys(rowSelection).filter((id) => rowSelection[id]);
    return ids.length > 0 ? ids : undefined;
  }, [rowSelection]);

  // Register context values with the assistant
  useRegisterAssistantContext('experimentId', experimentId);
  useRegisterAssistantContext('selectedSessionIds', selectedSessionIds);
};
