import React from 'react';
import { Modal } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { isRunningScorersEnabled } from '../../../common/utils/FeatureUtils';
import ScorerFormCreateContainer from './ScorerFormCreateContainer';
import ScorerFormEditContainer from './ScorerFormEditContainer';
import type { ScorerCreateFormIntent, ScorerEvaluationScope } from './constants';
import { SCORER_CREATE_FORM_INTENT, SCORER_FORM_MODE, type ScorerFormMode } from './constants';
import type { ScheduledScorer } from './types';
import type { LLM_TEMPLATE } from './types';
import type { ScorerFormData } from './utils/scorerTransformUtils';

interface ScorerModalRendererProps {
  experimentId: string;
  visible: boolean;
  onClose: () => void;
  mode: ScorerFormMode;
  existingScorer?: ScheduledScorer;
  initialScorerType?: ScorerFormData['scorerType'];
  initialLLMTemplate?: LLM_TEMPLATE;
  initialScorerName?: string;
  initialScope?: ScorerEvaluationScope;
  initialItemId?: string;
  createFormIntent?: ScorerCreateFormIntent;
  initialBuiltinJudgeLabel?: string;
}

const ScorerModalRenderer: React.FC<ScorerModalRendererProps> = ({
  experimentId,
  visible,
  onClose,
  mode,
  existingScorer,
  initialScorerType,
  initialLLMTemplate,
  initialScorerName,
  initialScope,
  initialItemId,
  createFormIntent = SCORER_CREATE_FORM_INTENT.CREATE,
  initialBuiltinJudgeLabel,
}) => {
  const isRunningScorersFeatureEnabled = isRunningScorersEnabled();

  return (
    <Modal
      componentId="codegen_no_dynamic_mlflow_web_js_src_experiment_tracking_pages_experiment_scorers_scorermodalrenderer_29"
      title={
        mode === SCORER_FORM_MODE.EDIT ? (
          <FormattedMessage defaultMessage="Edit judge" description="Title for edit judge modal" />
        ) : createFormIntent === SCORER_CREATE_FORM_INTENT.USE_BUILT_IN && initialBuiltinJudgeLabel ? (
          <FormattedMessage
            defaultMessage="Use {judgeName}"
            description="Title for using a built-in judge from the catalog"
            values={{ judgeName: initialBuiltinJudgeLabel }}
          />
        ) : initialScorerType === 'custom-code' ? (
          <FormattedMessage
            defaultMessage="Create custom code judge"
            description="Title for new custom code judge modal"
          />
        ) : (
          <FormattedMessage defaultMessage="Create LLM judge" description="Title for new LLM judge modal" />
        )
      }
      visible={visible}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      {...(initialScorerType !== 'custom-code' && {
        size: 'wide' as const,
        css: {
          width: '100% !important',
        },
      })}
      {...(isRunningScorersFeatureEnabled &&
        initialScorerType !== 'custom-code' && {
          verticalSizing: 'maxed_out' as const,
          dangerouslySetAntdProps: {
            bodyStyle: {
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            },
          },
        })}
    >
      {mode === SCORER_FORM_MODE.EDIT && existingScorer ? (
        <ScorerFormEditContainer experimentId={experimentId} onClose={onClose} existingScorer={existingScorer} />
      ) : (
        <ScorerFormCreateContainer
          experimentId={experimentId}
          onClose={onClose}
          initialScorerType={initialScorerType}
          initialLLMTemplate={initialLLMTemplate}
          initialScorerName={initialScorerName}
          initialScope={initialScope}
          initialItemId={initialItemId}
          createFormIntent={createFormIntent}
        />
      )}
    </Modal>
  );
};

export default ScorerModalRenderer;
