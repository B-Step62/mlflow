import React, { useState } from 'react';
import ScorerModalRenderer from './ScorerModalRenderer';
import { useGetScheduledScorers } from './hooks/useGetScheduledScorers';
import { SCORER_FORM_MODE } from './constants';
import type { ScorerFormData } from './utils/scorerTransformUtils';
import UnifiedJudgesContainer from './catalog/UnifiedJudgesContainer';

interface ExperimentScorersContentContainerProps {
  experimentId: string;
}

const ExperimentScorersContentContainer: React.FC<ExperimentScorersContentContainerProps> = ({ experimentId }) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [initialScorerType, setInitialScorerType] = useState<ScorerFormData['scorerType']>('llm');

  const scheduledScorersResult = useGetScheduledScorers(experimentId);
  const scorers = scheduledScorersResult.data?.scheduledScorers || [];

  const handleNewLLMScorerClick = () => {
    setInitialScorerType('llm');
    setIsModalVisible(true);
  };

  const handleNewCustomCodeScorerClick = () => {
    setInitialScorerType('custom-code');
    setIsModalVisible(true);
  };

  const closeModal = () => {
    setIsModalVisible(false);
  };

  // Handle error state - throw error to be caught by PanelBoundary
  if (scheduledScorersResult.isError && scheduledScorersResult.error) {
    throw scheduledScorersResult.error;
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <UnifiedJudgesContainer
        scorers={scorers}
        isLoadingScorers={scheduledScorersResult.isLoading}
        experimentId={experimentId}
        onOpenCreateModal={handleNewLLMScorerClick}
        onOpenCreateCustomCodeModal={handleNewCustomCodeScorerClick}
      />

      {/* New Scorer Modal */}
      <ScorerModalRenderer
        visible={isModalVisible}
        onClose={closeModal}
        experimentId={experimentId}
        mode={SCORER_FORM_MODE.CREATE}
        initialScorerType={initialScorerType}
      />
    </div>
  );
};

export default ExperimentScorersContentContainer;
