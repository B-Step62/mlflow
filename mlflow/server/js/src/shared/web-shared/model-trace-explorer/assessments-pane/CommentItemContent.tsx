import { Typography, useDesignSystemTheme, ThumbsDownIcon, ThumbsUpIcon } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { FeedbackAssessment } from '../ModelTrace.types';

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

export const CommentItemContent = ({ feedback }: { feedback: FeedbackAssessment }) => {
  const { theme } = useDesignSystemTheme();

  const selectionRationale = parseSelectionRationale(feedback.rationale);

  const hasTarget = !!selectionRationale?.target;
  const hasComment = !!selectionRationale?.comment && selectionRationale.comment.trim().length > 0;
  const isPositive = feedback.feedback.value === true;
  const RatingIcon = isPositive ? ThumbsUpIcon : ThumbsDownIcon;

  if (!selectionRationale) {
    return null;
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      {hasTarget && (
        <div
          css={{
            borderRadius: theme.borders.borderRadiusSm,
            backgroundColor: theme.colors.backgroundSecondary,
            padding: theme.spacing.sm,
            paddingLeft: theme.spacing.md,
            borderLeft: `3px solid ${theme.colors.border}`,
            color: theme.colors.textPrimary,
            fontStyle: 'italic',
            fontSize: theme.typography.fontSizeSm,
          }}
        >
          {selectionRationale.target}
        </div>
      )}

      {hasComment && (
        <div css={{ display: 'flex', gap: theme.spacing.md, alignItems: 'flex-start' }}>
          <span
            css={{
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              margin: 'auto 0',
            }}
          >
            <RatingIcon size={18} css={{ color: isPositive ? theme.colors.green300 : '#dd8877' }} />
          </span>
          <Typography.Text size="md" css={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {selectionRationale.comment}
          </Typography.Text>
        </div>
      )}
    </div>
  );
};
