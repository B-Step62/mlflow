import React, { useState } from 'react';
import {
  useDesignSystemTheme,
  ParagraphSkeleton,
  PlusIcon,
  CodeIcon,
  Spacer,
  SparkleIcon,
  SplitButton,
  DropdownMenu,
  Typography,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { useNavigate } from '../../../common/utils/RoutingUtils';
import ScorerCardContainer from './ScorerCardContainer';
import ScorerModalRenderer from './ScorerModalRenderer';
import ScorerEmptyStateRenderer from './ScorerEmptyStateRenderer';
import { useGetScheduledScorers } from './hooks/useGetScheduledScorers';
import {
  SCORER_CREATE_FORM_INTENT,
  SCORER_FORM_MODE,
  type ScorerCreateFormIntent,
  type ScorerEvaluationScope,
} from './constants';
import type { ScorerFormData } from './utils/scorerTransformUtils';
import { getMockEvalScorers } from '../../mockEvalArtifacts';
import Routes from '../../routes';
import { LLM_TEMPLATE } from './types';
import type { BuiltInJudgeCatalogItem } from './ScorerEmptyStateRenderer';

interface ExperimentScorersContentContainerProps {
  experimentId: string;
  mockScorerNames?: string[];
  selectedScorerName?: string | null;
}

interface ScorerModalConfig {
  initialScorerType: ScorerFormData['scorerType'];
  initialLLMTemplate?: LLM_TEMPLATE;
  initialScorerName?: string;
  initialScope?: ScorerEvaluationScope;
  createFormIntent: ScorerCreateFormIntent;
  initialBuiltinJudgeLabel?: string;
}

const ExperimentScorersContentContainer: React.FC<ExperimentScorersContentContainerProps> = ({
  experimentId,
  mockScorerNames,
  selectedScorerName,
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const navigate = useNavigate();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [modalConfig, setModalConfig] = useState<ScorerModalConfig>({
    initialScorerType: 'llm',
    initialLLMTemplate: LLM_TEMPLATE.CUSTOM,
    createFormIntent: SCORER_CREATE_FORM_INTENT.CREATE,
  });
  const shouldUseMockScorers = Boolean(mockScorerNames?.length);
  const scheduledScorersResult = useGetScheduledScorers(experimentId, { enabled: !shouldUseMockScorers });
  const scorers = shouldUseMockScorers
    ? getMockEvalScorers(mockScorerNames ?? []).sort((a, b) =>
        a.name === selectedScorerName ? -1 : b.name === selectedScorerName ? 1 : 0,
      )
    : scheduledScorersResult.data?.scheduledScorers || [];
  const isLoading = shouldUseMockScorers ? false : scheduledScorersResult.isLoading;
  const isError = shouldUseMockScorers ? false : scheduledScorersResult.isError;
  const error = scheduledScorersResult.error;
  const firstLLMScorer = scorers.find((scorer) => scorer.type === 'llm');

  const handleNewLLMScorerClick = () => {
    setModalConfig({
      initialScorerType: 'llm',
      initialLLMTemplate: LLM_TEMPLATE.CUSTOM,
      initialScorerName: '',
      createFormIntent: SCORER_CREATE_FORM_INTENT.CREATE,
    });
    setIsModalVisible(true);
  };

  const handleNewCustomCodeScorerClick = () => {
    setModalConfig({
      initialScorerType: 'custom-code',
      createFormIntent: SCORER_CREATE_FORM_INTENT.CREATE,
    });
    setIsModalVisible(true);
  };

  const handleUseBuiltInJudgeClick = (judge: BuiltInJudgeCatalogItem) => {
    setModalConfig({
      initialScorerType: 'llm',
      initialLLMTemplate: judge.template,
      initialScorerName: judge.defaultName,
      initialScope: judge.scope,
      createFormIntent: SCORER_CREATE_FORM_INTENT.USE_BUILT_IN,
      initialBuiltinJudgeLabel: judge.label,
    });
    setIsModalVisible(true);
  };

  // If no scorers exist and we're not currently showing the modal, show empty state
  const shouldShowEmptyState = scorers.length === 0 && !isModalVisible && !isLoading;

  const closeModal = () => {
    setIsModalVisible(false);
  };

  // Handle error state - throw error to be caught by PanelBoundary
  if (isError && error) {
    throw error;
  }

  // Handle loading state
  if (isLoading) {
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

  // Show empty state when there are no scorers
  if (shouldShowEmptyState) {
    return (
      <ScorerEmptyStateRenderer
        onUseBuiltInJudgeClick={handleUseBuiltInJudgeClick}
        onAddLLMScorerClick={handleNewLLMScorerClick}
        onAddCustomCodeScorerClick={handleNewCustomCodeScorerClick}
      />
    );
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
      {firstLLMScorer && (
        <div css={{ padding: `${theme.spacing.sm}px ${theme.spacing.sm}px 0` }}>
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              width: '100%',
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              backgroundColor: theme.isDarkMode ? theme.colors.blue800 : theme.colors.blue100,
            }}
          >
            <SparkleIcon color="ai" css={{ flexShrink: 0 }} />
            <span>
              <FormattedMessage
                defaultMessage="Low quality judge or false positive? Use {alignJudgeLink}."
                description="Info banner message suggesting judge alignment"
                values={{
                  alignJudgeLink: (
                    <Typography.Link
                      componentId="mlflow.experiment-scorers.alignment-info-banner-link"
                      onClick={() => navigate(Routes.getExperimentPageTabScorerAlignmentRoute(experimentId))}
                    >
                      <FormattedMessage defaultMessage="Align judge" description="Link to open judge alignment" />
                    </Typography.Link>
                  ),
                }}
              />
            </span>
          </div>
        </div>
      )}

      {/* Header with New judge split button */}
      <div
        css={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: theme.spacing.sm,
        }}
      >
        <SplitButton
          type="primary"
          icon={<PlusIcon />}
          componentId="mlflow.experiment-scorers.new-scorer-button"
          onClick={handleNewLLMScorerClick}
          menu={
            <DropdownMenu.Content>
              <DropdownMenu.Item
                componentId="mlflow.experiment-scorers.new-custom-code-scorer-menu-item"
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
      </div>
      <Spacer size="sm" />
      {/* Content area */}
      <div
        css={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm,
            width: '100%',
          }}
        >
          {scorers.map((scorer) => (
            <ScorerCardContainer
              key={scorer.name}
              scorer={scorer}
              experimentId={experimentId}
              defaultExpanded={scorer.name === selectedScorerName}
            />
          ))}
        </div>
      </div>
      {/* New Scorer Modal */}
      <ScorerModalRenderer
        visible={isModalVisible}
        onClose={closeModal}
        experimentId={experimentId}
        mode={SCORER_FORM_MODE.CREATE}
        initialScorerType={modalConfig.initialScorerType}
        initialLLMTemplate={modalConfig.initialLLMTemplate}
        initialScorerName={modalConfig.initialScorerName}
        initialScope={modalConfig.initialScope}
        createFormIntent={modalConfig.createFormIntent}
        initialBuiltinJudgeLabel={modalConfig.initialBuiltinJudgeLabel}
      />
    </div>
  );
};

export default ExperimentScorersContentContainer;
