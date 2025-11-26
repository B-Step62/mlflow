import { isNil, partition } from 'lodash';
import { useMemo, useState } from 'react';

import { Button, CloseIcon, Tooltip, Typography, useDesignSystemTheme, Tabs } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { AssessmentCreateForm } from './AssessmentCreateForm';
import { ASSESSMENT_PANE_MIN_WIDTH } from './AssessmentsPane.utils';
import { ExpectationItem } from './ExpectationItem';
import { FeedbackGroup } from './FeedbackGroup';
import { TextSelectionFeedback } from './TextSelectionFeedback';
import type { Assessment, FeedbackAssessment } from '../ModelTrace.types';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { CommentGroup } from './CommentGroup';

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
  const [activeTab, setActiveTab] = useState<'assessments' | 'comments'>('assessments');
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
      <Tabs.Root
        value={activeTab}
        onValueChange={(tab) => setActiveTab(tab as 'assessments' | 'comments')}
        componentId="shared.model-trace-explorer.assessments-comments-tabs"
      >
        <Tabs.List css={{ marginBottom: theme.spacing.sm }}>
          <Tabs.Trigger value="assessments">
            <FormattedMessage defaultMessage="Assessments" description="Tab label for assessments view" />
          </Tabs.Trigger>
          <Tabs.Trigger value="comments">
            <FormattedMessage defaultMessage="Comments" description="Tab label for comments view" />
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="assessments" css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
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
          <AssessmentCreateForm
            assessmentName={undefined}
            spanId={activeSpanId}
            traceId={traceId}
            setExpanded={() => {}}
          />
        </Tabs.Content>

        <Tabs.Content value="comments" css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          {groupedCommentFeedbacks.length === 0 && (
            <Typography.Text color="secondary" size="sm" css={{ marginBottom: theme.spacing.sm }}>
              <FormattedMessage defaultMessage="No comments yet" description="Empty state for comments tab" />
            </Typography.Text>
          )}
          <CommentGroup comments={commentFeedbacks} />
          <div id="add-comment-form">
            <TextSelectionFeedback traceId={traceId} spanId={activeSpanId} autoStart={false} />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};
