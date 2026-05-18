import type { HTMLAttributes } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { Empty, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { ModelTraceExplorerSummarySpans, SUMMARY_SPANS_MIN_WIDTH } from './ModelTraceExplorerSummarySpans';
import { useIntermediateNodes } from '../ModelTraceExplorer.utils';
import ModelTraceExplorerResizablePane from '../ModelTraceExplorerResizablePane';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPane } from '../assessments-pane/AssessmentsPane';
import { ASSESSMENT_PANE_MIN_WIDTH } from '../assessments-pane/AssessmentsPane.utils';
// Inline comments (Google-Docs style) are reused directly from the playground.
// This is intentional shortcut: we share the working components rather than
// extracting to shared/ first. Refactor to extract once the trace-side UX is
// stable. The new assessment_name `mlflow.comment` keeps inline comments
// separate from playground feedback.
import {
  type ActiveSelection,
  type InlineCommentDraft,
  type PlaygroundFeedback,
  FloatingAnnotateButton,
  InlineCommentMarks,
  InlineCommentPopover,
  feedbacksFromTraceAssessments,
  persistFeedback,
  useChatSelection,
} from '../../../../playground/feedback';

const TRACE_INLINE_COMMENT_ASSESSMENT_NAME = 'mlflow.comment';
const TRACE_INLINE_COMMENT_SOURCE_ID = 'trace-explorer';

type ActivePopover =
  | { mode: 'create'; selection: ActiveSelection }
  | { mode: 'view'; feedbackId: string; rect: DOMRect }
  | null;

export const ModelTraceExplorerSummaryView = () => {
  const { theme } = useDesignSystemTheme();
  const [paneWidth, setPaneWidth] = useState(500);

  const {
    rootNode,
    nodeMap,
    assessmentsPaneEnabled,
    assessmentsPaneExpanded,
    updatePaneSizeRatios,
    getPaneSizeRatios,
  } = useModelTraceExplorerViewState();

  const allAssessments = useMemo(() => Object.values(nodeMap).flatMap((node) => node.assessments), [nodeMap]);
  const traceId = rootNode?.traceId ?? '';

  // Existing inline comments for this trace, reconstructed from assessments.
  const existingComments = useMemo<PlaygroundFeedback[]>(
    () =>
      feedbacksFromTraceAssessments(
        traceId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allAssessments as any,
        TRACE_INLINE_COMMENT_ASSESSMENT_NAME,
      ),
    [traceId, allAssessments],
  );

  // Optimistic local additions until the trace re-fetches with the new assessment.
  const [pendingComments, setPendingComments] = useState<PlaygroundFeedback[]>([]);
  const comments = useMemo(
    () => [...existingComments, ...pendingComments],
    [existingComments, pendingComments],
  );

  const { selection, clear: clearSelection } = useChatSelection();
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);

  const onSizeRatioChange = useCallback(
    (ratio: number) => {
      updatePaneSizeRatios({ summarySidebar: ratio });
    },
    [updatePaneSizeRatios],
  );

  const intermediateNodes = useIntermediateNodes(rootNode);

  const submitComment = useCallback(
    async (draft: InlineCommentDraft) => {
      if (!traceId) return;
      const optimistic: PlaygroundFeedback = {
        assessment_id: `pending-${Date.now()}`,
        trace_id: traceId,
        rationale: draft.rationale,
        aspect: draft.aspect,
        expected_output: draft.expected_output,
        anchor: draft.anchor,
        pending: true,
      };
      setPendingComments((prev) => [...prev, optimistic]);
      try {
        const { assessment_id } = await persistFeedback({
          trace_id: traceId,
          rationale: draft.rationale,
          aspect: draft.aspect,
          expected_output: draft.expected_output,
          anchor: draft.anchor,
          assessment_name: TRACE_INLINE_COMMENT_ASSESSMENT_NAME,
          source_id: TRACE_INLINE_COMMENT_SOURCE_ID,
        });
        setPendingComments((prev) =>
          prev.map((c) => (c.assessment_id === optimistic.assessment_id ? { ...c, assessment_id, pending: false } : c)),
        );
      } catch (err) {
        // Roll back optimistic insert on failure so the highlight disappears.
        setPendingComments((prev) => prev.filter((c) => c.assessment_id !== optimistic.assessment_id));
        // eslint-disable-next-line no-console
        console.error('Failed to persist inline comment', err);
      }
    },
    [traceId],
  );

  if (!rootNode) {
    return (
      <div css={{ marginTop: theme.spacing.lg }}>
        <Empty
          description={
            <FormattedMessage
              defaultMessage="No span data to display"
              description="Title for the empty state in the model trace explorer summary view"
            />
          }
        />
      </div>
    );
  }
  const AssessmentsPaneComponent = (
    <AssessmentsPane assessments={allAssessments} traceId={rootNode.traceId} activeSpanId={undefined} />
  );

  // The `InlineCommentMarks` wrapper carries both the marks overlay and the
  // selection-anchor data attributes, and forwards flex layout so the
  // scrollable container inside `ModelTraceExplorerSummarySpans` (which uses
  // `flex: 1` + `overflow: auto`) continues to size correctly.
  const annotatedSummary = (
    <InlineCommentMarks
      feedbacks={comments.filter((c) => !c.resolved)}
      onClickMark={({ feedback, rect }) =>
        setActivePopover({ mode: 'view', feedbackId: feedback.assessment_id, rect })
      }
      containerProps={{
        'data-mlflow-feedback-anchor': traceId,
        'data-mlflow-feedback-trace-id': traceId,
        style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
      } as HTMLAttributes<HTMLDivElement>}
    >
      <ModelTraceExplorerSummarySpans rootNode={rootNode} intermediateNodes={intermediateNodes} />
    </InlineCommentMarks>
  );

  return (
    <>
      {assessmentsPaneEnabled && assessmentsPaneExpanded ? (
        <ModelTraceExplorerResizablePane
          initialRatio={getPaneSizeRatios().summarySidebar}
          paneWidth={paneWidth}
          setPaneWidth={setPaneWidth}
          leftChild={annotatedSummary}
          rightChild={AssessmentsPaneComponent}
          leftMinWidth={SUMMARY_SPANS_MIN_WIDTH + 2 * theme.spacing.md}
          rightMinWidth={ASSESSMENT_PANE_MIN_WIDTH + 2 * theme.spacing.sm}
          onRatioChange={onSizeRatioChange}
        />
      ) : (
        annotatedSummary
      )}

      {activePopover?.mode !== 'create' && (
        <FloatingAnnotateButton
          selection={selection}
          onClick={() => {
            if (selection) setActivePopover({ mode: 'create', selection });
          }}
        />
      )}
      {activePopover?.mode === 'create' && (
        <InlineCommentPopover
          mode="create"
          selection={activePopover.selection}
          rect={activePopover.selection.rect}
          onClose={() => {
            setActivePopover(null);
            clearSelection();
          }}
          onSubmit={async (draft) => {
            await submitComment(draft);
            setActivePopover(null);
            clearSelection();
          }}
        />
      )}
      {activePopover?.mode === 'view' &&
        (() => {
          const feedback = comments.find((c) => c.assessment_id === activePopover.feedbackId);
          if (!feedback) return null;
          return (
            <InlineCommentPopover
              mode="view"
              feedback={feedback}
              rect={activePopover.rect}
              onClose={() => setActivePopover(null)}
            />
          );
        })()}
    </>
  );
};
