import { useMemo } from 'react';

import { Button, PlusIcon, useDesignSystemTheme } from '@databricks/design-system';

import { CommentItem } from './CommentItem';
import type { FeedbackAssessment } from '../ModelTrace.types';

export const CommentGroup = ({ comments }: { comments: FeedbackAssessment[] }) => {
  const { theme } = useDesignSystemTheme();

  const sorted = useMemo(
    () =>
      [...comments].sort((a, b) => new Date(b.create_time).getTime() - new Date(a.create_time).getTime()),
    [comments],
  );

  const handleAddClick = () => {
    const el = document.getElementById('add-comment-form');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.md,
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((feedback, index) => (
          <div
            key={feedback.assessment_id}
            css={{
              borderTop: index === 0 ? 'none' : `1px solid ${theme.colors.border}`,
              padding: theme.spacing.md,
            }}
          >
            <CommentItem feedback={feedback} />
          </div>
        ))}
      </div>
    </div>
  );
};
