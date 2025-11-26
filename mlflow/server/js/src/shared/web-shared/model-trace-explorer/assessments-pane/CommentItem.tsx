import { useState } from 'react';

import { useDesignSystemTheme } from '@databricks/design-system';

import { AssessmentItemHeader } from './AssessmentItemHeader';
import { CommentItemContent } from './CommentItemContent';
import type { FeedbackAssessment } from '../ModelTrace.types';

export const CommentItem = ({ feedback }: { feedback: FeedbackAssessment }) => {
  const { theme } = useDesignSystemTheme();
  const [isEditing] = useState(false); // placeholder to keep layout consistent

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
      }}
    >
      <AssessmentItemHeader assessment={feedback} renderConnector={false} />
      {/* comments don't support inline edit yet, but keep structure */}
      {isEditing ? null : <CommentItemContent feedback={feedback} />}
    </div>
  );
};
