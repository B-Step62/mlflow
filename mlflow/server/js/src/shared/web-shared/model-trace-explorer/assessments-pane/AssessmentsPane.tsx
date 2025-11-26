import { isNil, partition } from 'lodash';
import { useMemo, useState } from 'react';

import { Button, CloseIcon, Tooltip, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { AssessmentCreateForm } from './AssessmentCreateForm';
import { ASSESSMENT_PANE_MIN_WIDTH } from './AssessmentsPane.utils';
import { ExpectationItem } from './ExpectationItem';
import { FeedbackGroup } from './FeedbackGroup';
import { TextSelectionFeedback } from './TextSelectionFeedback';
import type { Assessment, FeedbackAssessment } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { CommentGroup } from './CommentGroup';

const CommentBubbleIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-hidden
  >
    <path
      d="M21 12c0 4.418-4.03 8-9 8-1.1 0-2.15-.17-3.11-.48L4 21l1.5-3.6A8.4 8.4 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

type GroupedFeedbacksByValue = { [value: string]: FeedbackAssessment[] };

type GroupedFeedbacks = [assessmentName: string, feedbacks: GroupedFeedbacksByValue][];

const groupFeedbacks = (feedbacks: FeedbackAssessment[]): GroupedFeedbacks => {
  const aggregated: Record<string, GroupedFeedbacksByValue> = {};
  feedbacks.forEach((feedback) => {
    if (feedback.valid === false) {
      return;
    }

    let value = null;
    if (feedback.feedback.value !== '') {
      value = JSON.stringify(feedback.feedback.value);
    }

    const { assessment_name } = feedback;
    if (!aggregated[assessment_name]) {
      aggregated[assessment_name] = {};
    }

    const group = aggregated[assessment_name];
    if (!isNil(value)) {
      if (!group[value]) {
        group[value] = [];
      }
      group[value].push(feedback);
    }
  });

  return Object.entries(aggregated).toSorted(([leftName], [rightName]) => leftName.localeCompare(rightName));
};

export const AssessmentsPane = ({
  assessments,
  traceId,
  activeSpanId,
}: {
  assessments: Assessment[];
  traceId: string;
  activeSpanId?: string;
}) => {
  const { theme } = useDesignSystemTheme();
  const { setAssessmentsPaneExpanded } = useModelTraceExplorerViewState();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [feedbacks, expectations] = useMemo(
    () => partition(assessments, (assessment) => 'feedback' in assessment),
    [assessments],
  );
  const isCommentFeedback = (feedback: FeedbackAssessment) =>
    feedback.assessment_name === 'comment' || feedback.metadata?.['feedback_type'] === 'comment';

  const [commentFeedbacks, otherFeedbacks] = useMemo(
    () => partition(feedbacks, isCommentFeedback),
    [feedbacks],
  );

  const groupedFeedbacks = useMemo(() => groupFeedbacks(otherFeedbacks), [otherFeedbacks]);
  const groupedCommentFeedbacks = useMemo(() => groupFeedbacks(commentFeedbacks), [commentFeedbacks]);
  const sortedExpectations = expectations.toSorted((left, right) =>
    left.assessment_name.localeCompare(right.assessment_name),
  );

  return (
    <div
      data-testid="assessments-pane"
      css={{
        display: 'flex',
        flexDirection: 'column',
        padding: theme.spacing.sm,
        paddingTop: theme.spacing.xs,
        height: '100%',
        borderLeft: `1px solid ${theme.colors.border}`,
        overflowY: 'scroll',
        minWidth: ASSESSMENT_PANE_MIN_WIDTH,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between' }}>
        <Typography.Text css={{ marginBottom: theme.spacing.sm }} bold>
          <FormattedMessage defaultMessage="Assessments" description="Label for the assessments pane" />
        </Typography.Text>
        {setAssessmentsPaneExpanded && (
          <Tooltip
            componentId="shared.model-trace-explorer.close-assessments-pane-tooltip"
            content={
              <FormattedMessage
                defaultMessage="Hide assessments"
                description="Tooltip for a button that closes the assessments pane"
              />
            }
          >
            <Button
              data-testid="close-assessments-pane-button"
              componentId="shared.model-trace-explorer.close-assessments-pane"
              size="small"
              icon={<CloseIcon />}
            onClick={() => setAssessmentsPaneExpanded(false)}
          />
        </Tooltip>
        )}
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
        {groupedFeedbacks.map(([name, valuesMap]) => (
          <FeedbackGroup
            key={name}
            name={name}
            valuesMap={valuesMap}
            traceId={traceId}
            activeSpanId={activeSpanId}
          />
        ))}
        {sortedExpectations.length > 0 && (
          <>
            <Typography.Text color="secondary" css={{ marginBottom: theme.spacing.sm }}>
              <FormattedMessage
                defaultMessage="Expectations"
                description="Label for the expectations section in the assessments pane"
              />
            </Typography.Text>
            <div
              css={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.spacing.sm,
                marginBottom: theme.spacing.sm,
              }}
            >
              {sortedExpectations.map((expectation) => (
                <ExpectationItem expectation={expectation} key={expectation.assessment_id} />
              ))}
            </div>
          </>
        )}
        <div css={{ marginTop: theme.spacing.sm }}>
          {showCreateForm ? (
            <AssessmentCreateForm
              assessmentName={undefined}
              spanId={activeSpanId}
              traceId={traceId}
              setExpanded={setShowCreateForm}
            />
          ) : (
            <Button
              componentId="shared.model-trace-explorer.show-create-assessment"
              size="small"
              onClick={() => setShowCreateForm(true)}
            >
              <FormattedMessage
                defaultMessage="Create new assessment"
                description="Button label to open assessment creation form"
              />
            </Button>
          )}
        </div>
      </div>

      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          marginTop: theme.spacing.lg,
          marginBottom: theme.spacing.xs,
        }}
      >
        <div
          css={{
            width: 3,
            height: theme.typography.lineHeightBase * 1.4,
            borderRadius: theme.borders.borderRadiusSm,
            backgroundColor: theme.colors.border,
          }}
        />
        <Typography.Text bold>
          <FormattedMessage defaultMessage="Comments" description="Label for comments section" />
        </Typography.Text>
      </div>

      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
        {groupedCommentFeedbacks.length === 0 && (
          <Typography.Text color="secondary" size="sm">
            <FormattedMessage defaultMessage="No comments yet" description="Empty state for comments section" />
          </Typography.Text>
        )}
        <CommentGroup comments={commentFeedbacks} />
        <div id="add-comment-form">
          {showCommentForm ? (
            <TextSelectionFeedback
              traceId={traceId}
              spanId={activeSpanId}
              autoStart
              onDone={() => setShowCommentForm(false)}
            />
          ) : (
            <Button
              componentId="shared.model-trace-explorer.show-comment-form"
              size="small"
              onClick={() => setShowCommentForm(true)}
              icon={<CommentBubbleIcon size={14} color={theme.colors.textSecondary} />}
              iconPosition="left"
              css={{ gap: theme.spacing.xs }}
            >
              <FormattedMessage defaultMessage="Add comment" description="Button to show comment creation form" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
