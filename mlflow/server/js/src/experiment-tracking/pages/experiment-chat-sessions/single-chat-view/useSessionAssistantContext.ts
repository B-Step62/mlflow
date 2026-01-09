import { useRegisterAssistantContext } from '@mlflow/mlflow/src/shared/web-shared/assistant';

/**
 * Hook that registers session-related context with the assistant.
 * Should be called in ExperimentSingleChatSessionPageImpl.
 *
 * @param experimentId - The current experiment ID
 * @param sessionId - The current session ID
 * @param traceId - The currently opened trace ID (from drawer)
 */
export const useSessionAssistantContext = (
  experimentId: string,
  sessionId: string,
  traceId: string | undefined,
) => {
  // Register context values with the assistant
  useRegisterAssistantContext('experimentId', experimentId);
  useRegisterAssistantContext('sessionId', sessionId);
  useRegisterAssistantContext('traceId', traceId);
};
