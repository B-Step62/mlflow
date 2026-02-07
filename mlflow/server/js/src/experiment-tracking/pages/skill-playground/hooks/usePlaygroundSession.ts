import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@mlflow/mlflow/src/common/utils/reactQueryHooks';
import { createSession, updatePanelConfig, deleteSession, toBackendSkills, toFrontendSkills } from '../api';
import type { SessionResponse } from '../api';
import type { PanelConfig, PanelId } from '../types';

const sessionFromResponse = (resp: SessionResponse): { configA: PanelConfig; configB: PanelConfig } => ({
  configA: {
    panelId: 'a',
    name: 'Panel A',
    skills: toFrontendSkills(resp.config_a.skills),
    allowedTools: resp.config_a.allowed_tools,
    model: resp.config_a.model,
  },
  configB: {
    panelId: 'b',
    name: 'Panel B',
    skills: toFrontendSkills(resp.config_b.skills),
    allowedTools: resp.config_b.allowed_tools,
    model: resp.config_b.model,
  },
});

export const usePlaygroundSession = (experimentId: string) => {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionResponse | null>(null);
  const createdRef = useRef(false);

  // Create session once on mount
  const createMutation = useMutation<SessionResponse, Error, string>({
    mutationFn: (expId: string) => createSession(expId),
    onSuccess: (data) => {
      setSessionId(data.session_id);
      setSessionData(data);
    },
  });

  useEffect(() => {
    if (!createdRef.current) {
      createdRef.current = true;
      createMutation.mutate(experimentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentId]);

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        deleteSession(sessionId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Mutation for updating panel config
  const updateMutation = useMutation<SessionResponse, Error, { panelId: PanelId; config: PanelConfig }>({
    mutationFn: ({ panelId, config }) =>
      updatePanelConfig(sessionId!, panelId, {
        skills: toBackendSkills(config.skills),
        allowed_tools: config.allowedTools,
        model: config.model,
      }),
    onSuccess: (data) => {
      setSessionData(data);
    },
  });

  const savePanelConfig = useCallback(
    (panelId: PanelId, config: PanelConfig) => {
      if (!sessionId) return;
      updateMutation.mutate({ panelId, config });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const session = useMemo(() => (sessionData ? sessionFromResponse(sessionData) : null), [sessionData]);

  return {
    sessionId,
    session,
    isLoading: createMutation.isLoading,
    error: createMutation.error ?? null,
    savePanelConfig,
    isSaving: updateMutation.isLoading,
  };
};
