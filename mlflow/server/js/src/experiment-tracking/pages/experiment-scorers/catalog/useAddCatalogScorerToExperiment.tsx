import { useCallback } from 'react';
import { useCreateScheduledScorerMutation } from '../hooks/useCreateScheduledScorer';
import type { LLMScorer, LLMTemplate } from '../types';
import type { CatalogEntry } from './types';

export const useAddCatalogScorerToExperiment = ({
  experimentId,
  onOpenCreateModal,
}: {
  experimentId: string;
  onOpenCreateModal: () => void;
}) => {
  const createMutation = useCreateScheduledScorerMutation();

  const addScorerToExperiment = useCallback(
    (entry: CatalogEntry, { activate }: { activate?: boolean } = {}) => {
      if (!entry.canAddToExperiment || !entry.llmTemplate) {
        return;
      }

      // Scorers requiring config (e.g., Guidelines) need to open the create form
      if (entry.requiresConfig) {
        onOpenCreateModal();
        return;
      }

      // Simple scorers can be registered directly with defaults
      const scorer: LLMScorer = {
        name: entry.name,
        type: 'llm',
        llmTemplate: entry.llmTemplate as LLMTemplate,
        sampleRate: activate ? 100 : 0,
        isSessionLevelScorer: entry.isSessionLevel,
      };

      createMutation.mutate({ experimentId, scheduledScorer: scorer });
    },
    [experimentId, createMutation, onOpenCreateModal],
  );

  return {
    addScorerToExperiment,
    isLoading: createMutation.isLoading,
  };
};
