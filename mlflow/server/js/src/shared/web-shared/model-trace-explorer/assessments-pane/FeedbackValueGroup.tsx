import { useState } from 'react';

import { Button, ChevronDownIcon, ChevronRightIcon, useDesignSystemTheme } from '@databricks/design-system';

import { AssessmentDisplayValue } from './AssessmentDisplayValue';

import { FeedbackItem } from './FeedbackItem';
import { FeedbackValueGroupSourceCounts } from './FeedbackValueGroupSourceCounts';
import type { FeedbackAssessment } from '../ModelTrace.types';

export const FeedbackValueGroup = ({
  jsonValue,
  feedbacks,
  forceExpanded = false,
  itemRenderer,
}: {
  jsonValue: string;
  feedbacks: FeedbackAssessment[];
  forceExpanded?: boolean;
  itemRenderer?: (props: { feedback: FeedbackAssessment }) => JSX.Element;
}) => {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(forceExpanded);

  const isSelectionFeedbackGroup = feedbacks.some(
    (feedback) => feedback.assessment_name === 'comment' || feedback.metadata?.['feedback_type'] === 'comment',
  );

  const ItemComponent = itemRenderer ?? FeedbackItem;

  return (
    <div css={{ display: 'flex', flexDirection: 'column' }}>
      <div css={{ display: 'flex', gap: theme.spacing.xs, alignItems: 'center' }}>
        {!forceExpanded && (
          <Button
            componentId="shared.model-trace-explorer.toggle-assessment-expanded"
            css={{ flexShrink: 0 }}
            size="small"
            icon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            onClick={() => setExpanded(!expanded)}
          />
        )}
        {!isSelectionFeedbackGroup && <AssessmentDisplayValue jsonValue={jsonValue} />}
        <FeedbackValueGroupSourceCounts feedbacks={feedbacks} />
      </div>
      {expanded && (
        <div
          css={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {feedbacks.map((feedback) =>
            // don't display assessments that have been overridden
            feedback?.valid === false ? null : <ItemComponent feedback={feedback} key={feedback.assessment_id} />,
          )}
        </div>
      )}
    </div>
  );
};
