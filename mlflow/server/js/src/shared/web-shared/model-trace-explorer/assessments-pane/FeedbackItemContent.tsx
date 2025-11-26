import { isNil } from 'lodash';
import { useState } from 'react';

import { Tooltip, Typography, useDesignSystemTheme, ThumbsDownIcon, ThumbsUpIcon } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';
import { GenAIMarkdownRenderer } from '@databricks/web-shared/genai-markdown-renderer';

import { AssessmentDisplayValue } from './AssessmentDisplayValue';
import { FeedbackErrorItem } from './FeedbackErrorItem';
import { FeedbackHistoryModal } from './FeedbackHistoryModal';
import { SpanNameDetailViewLink } from './SpanNameDetailViewLink';
import type { FeedbackAssessment } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';

type SelectionRationale = {
  jsonPath?: string;
  target?: string;
  comment?: string;
};

const parseSelectionRationale = (rationale?: string): SelectionRationale | null => {
  if (!rationale) {
    return null;
  }

  try {
    const parsed = JSON.parse(rationale);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    return {
      jsonPath: typeof parsed.jsonPath === 'string' ? parsed.jsonPath : undefined,
      target: typeof parsed.target === 'string' ? parsed.target : undefined,
      comment: typeof parsed.comment === 'string' ? parsed.comment : undefined,
    };
  } catch (e) {
    return null;
  }
};

export const FeedbackItemContent = ({ feedback }: { feedback: FeedbackAssessment }) => {
  const [isHistoryModalVisible, setIsHistoryModalVisible] = useState(false);
  const { theme } = useDesignSystemTheme();
  const { nodeMap, activeView } = useModelTraceExplorerViewState();

  const value = feedback.feedback.value;

  const isSelectionFeedback =
    feedback.assessment_name === 'comment' || feedback.metadata?.['feedback_type'] === 'comment';
  const selectionRationale = isSelectionFeedback ? parseSelectionRationale(feedback.rationale) : null;

  const associatedSpan = feedback.span_id ? nodeMap[feedback.span_id] : null;
  // the summary view displays all assessments regardless of span, so
  // we need some way to indicate which span an assessment is associated with.
  const showAssociatedSpan = activeView === 'summary' && associatedSpan;

  const judgeCost = feedback.metadata?.['mlflow.assessment.judgeCost'];

  const formattedCost = (() => {
    if (judgeCost === null) {
      return undefined;
    }

    const numericCost = Number(judgeCost);
    if (!Number.isFinite(numericCost)) {
      return undefined;
    }

    const decimalMatch = String(judgeCost).match(/\.(\d+)/);
    const truncatedDecimals = Math.min(Math.max(decimalMatch ? decimalMatch[1].length : 0, 2), 6);

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: truncatedDecimals,
      maximumFractionDigits: truncatedDecimals,
    }).format(numericCost);
  })();
  const shouldShowCostSection = Boolean(formattedCost);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm, marginLeft: theme.spacing.lg }}>
      {!isNil(feedback.feedback.error) && <FeedbackErrorItem error={feedback.feedback.error} />}
      {showAssociatedSpan && (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.xs,
          }}
        >
          <Typography.Text size="sm" color="secondary">
            <FormattedMessage defaultMessage="Span" description="Label for the associated span of an assessment" />
          </Typography.Text>
          <SpanNameDetailViewLink node={associatedSpan} />
        </div>
      )}
      {isNil(feedback.feedback.error) && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <Typography.Text size="sm" color="secondary">
            {isSelectionFeedback ? (
              <FormattedMessage defaultMessage="Rating" description="Label for the value of a comment assessment" />
            ) : (
              <FormattedMessage defaultMessage="Feedback" description="Label for the value of an feedback assessment" />
            )}
          </Typography.Text>
          <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
            {isSelectionFeedback ? (
              value === true ? <ThumbsUpIcon /> : <ThumbsDownIcon />
            ) : (
              <AssessmentDisplayValue jsonValue={JSON.stringify(value)} />
            )}
            {feedback.overriddenAssessment && (
              <>
                <span onClick={() => setIsHistoryModalVisible(true)}>
                  <Typography.Text
                    css={{
                      '&:hover': {
                        textDecoration: 'underline',
                        cursor: 'pointer',
                      },
                    }}
                    color="secondary"
                  >
                    <FormattedMessage
                      defaultMessage="(edited)"
                      description="Link text in an edited assessment that allows the user to click to see the previous value"
                    />
                  </Typography.Text>
                </span>
                <FeedbackHistoryModal
                  isModalVisible={isHistoryModalVisible}
                  setIsModalVisible={setIsHistoryModalVisible}
                  feedback={feedback}
                />
              </>
            )}
          </div>
        </div>
      )}
      {selectionRationale ? (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          {selectionRationale.target && (
            <div
              css={{
                position: 'relative',
                border: `1px solid ${theme.colors.border}`,
                borderLeft: `4px solid ${theme.colors.primary}`,
                borderRadius: theme.borders.borderRadiusSm,
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.sm,
                paddingLeft: theme.spacing.md,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span
                aria-hidden
                css={{
                  position: 'absolute',
                  left: theme.spacing.xs,
                  top: theme.spacing.xs,
                  color: theme.colors.textSecondary,
                  fontSize: theme.typography.fontSizeSm,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
              </span>
              <Typography.Text size="sm" css={{ fontStyle: 'italic' }}>
                {selectionRationale.target}
              </Typography.Text>
            </div>
          )}
          {selectionRationale.comment && selectionRationale.comment.trim().length > 0 && (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs / 2 }}>
              <Typography.Text size="sm" color="secondary">
                <FormattedMessage defaultMessage="Comment" description="Label for selection feedback comment" />
              </Typography.Text>
              <Typography.Text size="sm" css={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {selectionRationale.comment}
              </Typography.Text>
            </div>
          )}
        </div>
      ) : (
        feedback.rationale && (
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text size="sm" color="secondary">
              <FormattedMessage
                defaultMessage="Rationale"
                description="Label for the rationale of an expectation assessment"
              />
            </Typography.Text>
            <div css={{ '& > div:last-of-type': { marginBottom: 0 } }}>
              <GenAIMarkdownRenderer>{feedback.rationale}</GenAIMarkdownRenderer>
            </div>
          </div>
        )
      )}
      {shouldShowCostSection && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <Typography.Text size="sm" color="secondary">
            <FormattedMessage
              defaultMessage="Cost"
              description="Label for the cost metadata associated with a judge feedback"
            />
          </Typography.Text>
          <Typography.Text style={{ color: theme.colors.textSecondary }}>{formattedCost}</Typography.Text>
        </div>
      )}
    </div>
  );
};
