import React, { useState } from 'react';
import {
  useDesignSystemTheme,
  ParagraphSkeleton,
  PlusIcon,
  CodeIcon,
  Spacer,
  SplitButton,
  DropdownMenu,
  Tabs,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import ScorerCardContainer from './ScorerCardContainer';
import ScorerModalRenderer from './ScorerModalRenderer';
import ScorerEmptyStateRenderer from './ScorerEmptyStateRenderer';
import { useGetScheduledScorers } from './hooks/useGetScheduledScorers';
import { COMPONENT_ID_PREFIX, SCORER_FORM_MODE, SCORER_SUB_TAB, type ScorerSubTab } from './constants';
import type { ScorerFormData } from './utils/scorerTransformUtils';
import JudgeCatalogContainer from './catalog/JudgeCatalogContainer';

interface ExperimentScorersContentContainerProps {
  experimentId: string;
}

const ExperimentScorersContentContainer: React.FC<ExperimentScorersContentContainerProps> = ({ experimentId }) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [initialScorerType, setInitialScorerType] = useState<ScorerFormData['scorerType']>('llm');
  const [activeSubTab, setActiveSubTab] = useState<ScorerSubTab>(SCORER_SUB_TAB.MY_JUDGES);

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

  const shouldShowEmptyState = scorers.length === 0 && !isModalVisible && !scheduledScorersResult.isLoading;

  const closeModal = () => {
    setIsModalVisible(false);
  };

  // Handle error state - throw error to be caught by PanelBoundary
  if (scheduledScorersResult.isError && scheduledScorersResult.error) {
    throw scheduledScorersResult.error;
  }

  const renderMyJudgesContent = () => {
    if (scheduledScorersResult.isLoading) {
      return (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
          }}
        >
          {[...Array(3).keys()].map((i) => (
            <ParagraphSkeleton
              label={intl.formatMessage({
                defaultMessage: 'Loading judges...',
                description: 'Loading message while fetching experiment judges',
              })}
              key={i}
              seed={`scorer-${i}`}
            />
          ))}
        </div>
      );
    }

    if (shouldShowEmptyState) {
      return (
        <ScorerEmptyStateRenderer
          onAddLLMScorerClick={handleNewLLMScorerClick}
          onAddCustomCodeScorerClick={handleNewCustomCodeScorerClick}
        />
      );
    }

    return (
      <>
        <Spacer size="sm" />
        <div css={{ display: 'flex', flexDirection: 'column' }}>
          <div
            css={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
              width: '100%',
            }}
          >
            {scorers.map((scorer) => (
              <ScorerCardContainer key={scorer.name} scorer={scorer} experimentId={experimentId} />
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <Tabs.Root
        componentId={`${COMPONENT_ID_PREFIX}.sub-tabs`}
        value={activeSubTab}
        onValueChange={(value) => setActiveSubTab(value as ScorerSubTab)}
        valueHasNoPii
        css={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `0 ${theme.spacing.sm}px`,
          }}
        >
          <Tabs.List>
            <Tabs.Trigger value={SCORER_SUB_TAB.MY_JUDGES}>
              <FormattedMessage defaultMessage="My Judges" description="Tab label for experiment's registered judges" />
            </Tabs.Trigger>
            <Tabs.Trigger value={SCORER_SUB_TAB.CATALOG}>
              <FormattedMessage defaultMessage="Catalog" description="Tab label for browsable judge catalog" />
            </Tabs.Trigger>
          </Tabs.List>
          {activeSubTab === SCORER_SUB_TAB.MY_JUDGES && !shouldShowEmptyState && !scheduledScorersResult.isLoading && (
            <SplitButton
              type="primary"
              icon={<PlusIcon />}
              componentId={`${COMPONENT_ID_PREFIX}.new-scorer-button`}
              onClick={handleNewLLMScorerClick}
              menu={
                <DropdownMenu.Content>
                  <DropdownMenu.Item
                    componentId={`${COMPONENT_ID_PREFIX}.new-custom-code-scorer-menu-item`}
                    onClick={handleNewCustomCodeScorerClick}
                    css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}
                  >
                    <CodeIcon />
                    <FormattedMessage
                      defaultMessage="Custom code judge"
                      description="Menu item text to create a new custom code judge"
                    />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              }
            >
              <FormattedMessage defaultMessage="New LLM judge" description="Button text to create a new LLM judge" />
            </SplitButton>
          )}
        </div>

        <Tabs.Content value={SCORER_SUB_TAB.MY_JUDGES} css={{ flex: 1, overflowY: 'auto' }}>
          {renderMyJudgesContent()}
        </Tabs.Content>

        <Tabs.Content value={SCORER_SUB_TAB.CATALOG} css={{ flex: 1, overflowY: 'auto' }}>
          <JudgeCatalogContainer experimentId={experimentId} onOpenCreateModal={handleNewLLMScorerClick} />
        </Tabs.Content>
      </Tabs.Root>

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
