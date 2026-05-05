/**
 * Feedback / annotation rail for the agent playground (Epic 4).
 *
 * Implements YUK-17 (anchor + selection capture), YUK-18 (composer popover),
 * YUK-19 (sidebar rail), and the YUK-20 round-trip through the trace
 * assessments API. Feedback is stored as a Feedback assessment on the
 * source trace with `metadata.anchor` carrying the JSON-serialized text
 * range so the cockpit can re-resolve it on reload.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button, Input, Modal, Tag, Typography, useDesignSystemTheme } from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

// --- Types -------------------------------------------------------------------

/**
 * Logical anchor for a piece of feedback against an assistant message. We
 * persist character offsets within the message text rather than DOM offsets
 * so the anchor survives re-renders. ``prefix`` / ``suffix`` are the few
 * characters around the selection — used to re-resolve the range if the
 * underlying text changes (rare; the rendered message is the same payload
 * the assistant returned).
 */
export type AssistantMessageAnchor = {
  message_id: string;
  trace_id?: string;
  start: number;
  end: number;
  selected_text: string;
  prefix: string;
  suffix: string;
};

export const ASPECT_OPTIONS = ['quality', 'safety', 'groundedness', 'tone'] as const;
export type Aspect = (typeof ASPECT_OPTIONS)[number] | string;

export type PlaygroundFeedback = {
  assessment_id: string; // server-generated once persisted, optimistic id before
  trace_id: string;
  rationale: string;
  aspect: Aspect;
  expected_output?: string;
  anchor: AssistantMessageAnchor;
  // Set once a Dispatch creates the corresponding Issue.
  dispatched_issue_id?: string;
  // UI-only state; not persisted.
  resolved?: boolean;
  pending?: boolean;
};

// --- Selection capture -------------------------------------------------------

const ANCHOR_CONTEXT_CHARS = 24;

export type ActiveSelection = {
  message_id: string;
  trace_id?: string;
  start: number;
  end: number;
  selected_text: string;
  prefix: string;
  suffix: string;
  // Page-coordinate rectangle of the selection (for positioning the 💬 button).
  rect: DOMRect;
};

/**
 * Capture the user's text selection within any element marked with
 * ``data-mlflow-feedback-anchor="<message_id>"``. Resolving DOM offsets to
 * character offsets within the source text relies on the rendered message
 * being a single text node (which it is in the current chat layout — see
 * `PlaygroundPage.tsx`'s assistant bubble).
 */
export const useChatSelection = (): {
  selection: ActiveSelection | null;
  clear: () => void;
} => {
  const [selection, setSelection] = useState<ActiveSelection | null>(null);

  const update = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const anchorNode = range.startContainer;
    // Walk up to find the nearest annotated container.
    let element: HTMLElement | null =
      anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as HTMLElement) : (anchorNode.parentElement ?? null);
    while (element && !element.dataset['mlflowFeedbackAnchor']) {
      element = element.parentElement;
    }
    if (!element) {
      setSelection(null);
      return;
    }
    const messageId = element.dataset['mlflowFeedbackAnchor'];
    if (!messageId) {
      setSelection(null);
      return;
    }
    const traceId = element.dataset['mlflowFeedbackTraceId'] || undefined;
    const fullText = element.textContent ?? '';
    const selectedText = sel.toString();
    if (!selectedText.trim()) {
      setSelection(null);
      return;
    }
    // Character offsets within `fullText`. We compute by walking the range
    // boundaries against the element's text content.
    const preRange = document.createRange();
    preRange.selectNodeContents(element);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + selectedText.length;
    const prefix = fullText.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start);
    const suffix = fullText.slice(end, end + ANCHOR_CONTEXT_CHARS);
    setSelection({
      message_id: messageId,
      trace_id: traceId,
      start,
      end,
      selected_text: selectedText,
      prefix,
      suffix,
      rect: range.getBoundingClientRect(),
    });
  }, []);

  useEffect(() => {
    const onSelect = () => update();
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [update]);

  return {
    selection,
    clear: () => {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    },
  };
};

// --- Floating 💬 button ------------------------------------------------------

export const FloatingAnnotateButton = ({
  selection,
  onClick,
}: {
  selection: ActiveSelection | null;
  onClick: () => void;
}) => {
  if (!selection) return null;
  const { rect } = selection;
  // Viewport-relative coordinates. Using `position: fixed` so the button
  // tracks the selection regardless of which positioned ancestor the
  // playground happens to be mounted under (the MLflow shell wraps the
  // route in a positioned container, which would shift `position: absolute`
  // off-screen).
  const top = Math.max(8, rect.top - 36);
  const left = Math.min(window.innerWidth - 130, rect.right + 6);
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent the mousedown from collapsing the selection before our handler runs.
        e.preventDefault();
      }}
      onClick={onClick}
      css={{
        position: 'fixed',
        top,
        left,
        zIndex: 1000,
        background: 'white',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 999,
        padding: '4px 10px',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        fontSize: 14,
        lineHeight: 1.2,
      }}
      aria-label="Add feedback comment"
    >
      💬 Comment
    </button>
  );
};

// --- Composer popover --------------------------------------------------------

export const FeedbackComposer = ({
  selection,
  visible,
  onCancel,
  onSubmit,
}: {
  selection: ActiveSelection | null;
  visible: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    rationale: string;
    aspect: Aspect;
    expected_output?: string;
    anchor: AssistantMessageAnchor;
  }) => Promise<void> | void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [rationale, setRationale] = useState('');
  const [aspect, setAspect] = useState<Aspect>('quality');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (visible) {
      // Reset every time the composer reopens for a new selection.
      setRationale('');
      setAspect('quality');
      setExpectedOutput('');
      setSubmitting(false);
    }
  }, [visible, selection?.start, selection?.end, selection?.message_id]);

  useLayoutEffect(() => {
    if (visible) {
      // Defer focus a tick so Modal's transition doesn't steal it back.
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [visible]);

  const submit = async () => {
    if (!selection || !rationale.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        rationale: rationale.trim(),
        aspect,
        expected_output: expectedOutput.trim() || undefined,
        anchor: {
          message_id: selection.message_id,
          trace_id: selection.trace_id,
          start: selection.start,
          end: selection.end,
          selected_text: selection.selected_text,
          prefix: selection.prefix,
          suffix: selection.suffix,
        },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      componentId="mlflow.playground.feedback.composer"
      visible={visible}
      title="Leave feedback"
      onCancel={onCancel}
      okText="Save"
      cancelText="Cancel"
      onOk={submit}
      okButtonProps={{
        disabled: !rationale.trim() || submitting,
        loading: submitting,
      }}
    >
      {selection && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <div
            css={{
              padding: theme.spacing.sm,
              borderLeft: `3px solid ${theme.colors.blue400}`,
              backgroundColor: 'rgba(238,244,255,0.6)',
              fontStyle: 'italic',
              maxHeight: 96,
              overflow: 'auto',
            }}
          >
            "{selection.selected_text}"
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>Aspect</Typography.Text>
            <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
              {ASPECT_OPTIONS.map((option) => (
                <Tag
                  key={option}
                  componentId="mlflow.playground.feedback.aspect-chip"
                  color={aspect === option ? 'indigo' : 'default'}
                  onClick={() => setAspect(option)}
                  css={{ cursor: 'pointer' }}
                >
                  {option}
                </Tag>
              ))}
            </div>
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              What's wrong? (required)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.rationale"
              ref={textareaRef as never}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder="Describe the problem. e.g. 'tone is too casual for support'"
            />
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              Expected response (optional)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.expected"
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="Optional: what should the assistant have said?"
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

// --- Sidebar rail ------------------------------------------------------------

export type FeedbackCardCallbacks = {
  onHover: (feedbackId: string | null) => void;
  onDispatch: (feedback: PlaygroundFeedback) => void;
  onResolve: (feedback: PlaygroundFeedback) => void;
  onOpenIssue?: (issueId: string) => void;
  // Run the regression test for a dispatched feedback's issue. Only shown when
  // `feedback.dispatched_issue_id` is set. The page wires this to
  // `runIssueTest(issueId)` and surfaces the verdict via a top-right toast.
  onRunTest?: (feedback: PlaygroundFeedback) => void;
  // Set of dispatched-issue ids whose test run is currently in flight; the
  // matching feedback card shows a spinner instead of the "Test" button.
  runningTestIssueIds?: Set<string>;
  // Set of feedback assessment ids whose dispatch is currently in flight.
  // Drives the [Dispatch] button's loading spinner.
  dispatchingIds?: Set<string>;
};

export const FeedbackRail = ({
  feedbacks,
  hoveredId,
  flashedId,
  callbacks,
}: {
  feedbacks: PlaygroundFeedback[];
  hoveredId: string | null;
  flashedId: string | null;
  callbacks: FeedbackCardCallbacks;
}) => {
  const { theme } = useDesignSystemTheme();
  const visible = feedbacks.filter((f) => !f.resolved);

  if (visible.length === 0) {
    return (
      <div
        css={{
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.md,
          color: theme.colors.textSecondary,
          fontSize: theme.typography.fontSizeSm,
          textAlign: 'center',
        }}
      >
        Select text in any assistant reply and click 💬 to leave feedback.
      </div>
    );
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        overflowY: 'auto',
      }}
    >
      {visible.map((feedback) => {
        const flashing = flashedId === feedback.assessment_id;
        const dispatched = !!feedback.dispatched_issue_id;
        return (
          <div
            key={feedback.assessment_id}
            data-mlflow-feedback-card={feedback.assessment_id}
            onMouseEnter={() => callbacks.onHover(feedback.assessment_id)}
            onMouseLeave={() => callbacks.onHover(null)}
            css={{
              border: `1px solid ${hoveredId === feedback.assessment_id ? theme.colors.blue400 : theme.colors.border}`,
              borderRadius: theme.borders.borderRadiusMd,
              padding: theme.spacing.sm,
              backgroundColor: flashing ? 'rgba(255, 244, 200, 0.85)' : 'rgba(255,255,255,0.96)',
              transition: 'background-color 0.18s ease, border-color 0.12s ease',
              opacity: feedback.pending ? 0.6 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.xs,
            }}
          >
            <div css={{ display: 'flex', justifyContent: 'space-between', gap: theme.spacing.xs }}>
              <Tag componentId="mlflow.playground.feedback.aspect-tag" color="indigo">
                {feedback.aspect}
              </Tag>
              {dispatched && (
                <button
                  type="button"
                  onClick={() => callbacks.onOpenIssue?.(feedback.dispatched_issue_id as string)}
                  css={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: theme.colors.green600,
                    fontSize: theme.typography.fontSizeSm,
                    textDecoration: 'underline',
                  }}
                >
                  Dispatched ✓ → {feedback.dispatched_issue_id}
                </button>
              )}
            </div>
            <Typography.Text
              size="sm"
              color="secondary"
              css={{
                fontStyle: 'italic',
                borderLeft: `2px solid ${theme.colors.border}`,
                paddingLeft: theme.spacing.xs,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              "{feedback.anchor.selected_text}"
            </Typography.Text>
            <Typography.Text>{feedback.rationale}</Typography.Text>
            {feedback.expected_output && (
              <Typography.Text size="sm" color="secondary">
                expected: "{feedback.expected_output}"
              </Typography.Text>
            )}
            <div css={{ display: 'flex', gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
              <Button
                componentId="mlflow.playground.feedback.dispatch"
                type="primary"
                size="small"
                disabled={!feedback.rationale.trim() || dispatched || feedback.pending}
                loading={callbacks.dispatchingIds?.has(feedback.assessment_id)}
                onClick={() => callbacks.onDispatch(feedback)}
              >
                {dispatched ? 'Dispatched' : 'Dispatch'}
              </Button>
              {dispatched && callbacks.onRunTest && (
                <Button
                  componentId="mlflow.playground.feedback.run-test"
                  size="small"
                  loading={callbacks.runningTestIssueIds?.has(feedback.dispatched_issue_id as string)}
                  onClick={() => callbacks.onRunTest?.(feedback)}
                >
                  Test
                </Button>
              )}
              <Button
                componentId="mlflow.playground.feedback.resolve"
                size="small"
                disabled={feedback.pending}
                onClick={() => callbacks.onResolve(feedback)}
              >
                Resolve
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// --- Persistence -------------------------------------------------------------

const ASSESSMENT_NAME = 'playground.feedback';

/**
 * Persist a new feedback as a Feedback assessment on the source trace.
 * Returns the server's authoritative assessment_id so the optimistic UI
 * row can be reconciled.
 */
export const persistFeedback = async (input: {
  trace_id: string;
  rationale: string;
  aspect: Aspect;
  expected_output?: string;
  anchor: AssistantMessageAnchor;
}): Promise<{ assessment_id: string }> => {
  const metadata: { [k: string]: string } = {
    anchor: JSON.stringify(input.anchor),
    aspect: input.aspect,
    dispatch_eligible: input.rationale.trim() ? 'true' : 'false',
  };
  if (input.expected_output) {
    metadata['expected_output'] = input.expected_output;
  }
  const body = {
    assessment: {
      assessment_name: ASSESSMENT_NAME,
      trace_id: input.trace_id,
      source: { source_type: 'HUMAN', source_id: 'playground-cockpit' },
      rationale: input.rationale,
      metadata,
      feedback: { value: input.aspect },
    },
  };
  const response = await fetch(
    getAjaxUrl(`ajax-api/3.0/mlflow/traces/${encodeURIComponent(input.trace_id)}/assessments`),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getDefaultHeaders(document.cookie),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to persist feedback (${response.status}): ${await response.text()}`);
  }
  const json = (await response.json()) as { assessment?: { assessment_id?: string } };
  return { assessment_id: json.assessment?.assessment_id ?? '' };
};

/**
 * Reconstruct ``PlaygroundFeedback`` from the assessments embedded in a trace's
 * info payload. Skips assessments without ``metadata.anchor`` (those weren't
 * created by the cockpit).
 */
export const feedbacksFromTraceAssessments = (
  traceId: string,
  assessments:
    | Array<{
        assessment_id: string;
        assessment_name?: string;
        rationale?: string;
        metadata?: Record<string, string>;
        valid?: boolean;
      }>
    | undefined,
): PlaygroundFeedback[] => {
  if (!assessments) return [];
  const out: PlaygroundFeedback[] = [];
  for (const a of assessments) {
    if (a.assessment_name !== ASSESSMENT_NAME) continue;
    if (a.valid === false) continue;
    const rawAnchor = a.metadata?.['anchor'];
    if (!rawAnchor) continue;
    let anchor: AssistantMessageAnchor;
    try {
      anchor = JSON.parse(rawAnchor) as AssistantMessageAnchor;
    } catch {
      continue;
    }
    out.push({
      assessment_id: a.assessment_id,
      trace_id: traceId,
      rationale: a.rationale ?? '',
      aspect: (a.metadata?.['aspect'] as Aspect) ?? 'quality',
      expected_output: a.metadata?.['expected_output'],
      anchor,
      dispatched_issue_id: a.metadata?.['issue_id'],
    });
  }
  return out;
};

// --- Dispatch flow ----------------------------------------------------------

export type DispatchPayload = {
  rationale: string;
  failing_assistant_message: string;
  conversation_prefix: Array<{ role: string; content: string }>;
  expected_response?: string;
  aspect?: string;
  experiment_id?: string;
  source_trace_id?: string;
  source_feedback_id?: string;
};

export type DispatchResult = {
  issue_id: string;
  test_case_id?: string;
  dataset_name?: string;
};

export const dispatchFeedback = async (payload: DispatchPayload): Promise<DispatchResult> => {
  const response = await fetch(getAjaxUrl('ajax-api/3.0/mlflow/playground/issues/dispatch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getDefaultHeaders(document.cookie),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dispatch failed (${response.status}): ${text || response.statusText}`);
  }
  return (await response.json()) as DispatchResult;
};

/**
 * Annotate the feedback's persisted assessment with the new issue_id so the
 * dispatched card retains the link across reloads. Best-effort: if the patch
 * fails, the dispatch itself is still considered successful — the card can
 * still surface the issue id from local state.
 */
export const tagFeedbackWithIssueId = async (traceId: string, assessmentId: string, issueId: string): Promise<void> => {
  try {
    await fetch(
      getAjaxUrl(
        `ajax-api/3.0/mlflow/traces/${encodeURIComponent(traceId)}/assessments/${encodeURIComponent(assessmentId)}`,
      ),
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getDefaultHeaders(document.cookie),
        },
        body: JSON.stringify({
          assessment: { metadata: { issue_id: issueId } },
          update_mask: { paths: ['metadata'] },
        }),
      },
    );
  } catch {
    // best-effort; don't surface errors to the user — dispatch already
    // succeeded and the local state holds the issue id for this session.
  }
};

export const DispatchModal = ({
  feedback,
  visible,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  feedback: PlaygroundFeedback | null;
  visible: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (overrides: { rationale: string; aspect: string; expected_output?: string }) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const [rationale, setRationale] = useState('');
  const [aspect, setAspect] = useState<Aspect>('quality');
  const [expectedOutput, setExpectedOutput] = useState('');

  useEffect(() => {
    if (visible && feedback) {
      setRationale(feedback.rationale);
      setAspect(feedback.aspect);
      setExpectedOutput(feedback.expected_output ?? '');
    }
  }, [visible, feedback]);

  return (
    <Modal
      componentId="mlflow.playground.feedback.dispatch-modal"
      visible={visible}
      title="Dispatch as Issue"
      okText="Create Issue"
      cancelText="Cancel"
      onCancel={onCancel}
      onOk={() =>
        onConfirm({
          rationale: rationale.trim(),
          aspect,
          expected_output: expectedOutput.trim() || undefined,
        })
      }
      okButtonProps={{
        disabled: !rationale.trim() || isSubmitting,
        loading: isSubmitting,
      }}
    >
      {feedback && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
          <Typography.Text color="secondary" size="sm">
            We'll generate a runnable test from this feedback, store it in this experiment's regression dataset, and
            create an Issue at state=todo with `source_trace_id` set to{' '}
            <code css={{ fontFamily: 'monospace' }}>{feedback.trace_id}</code>.
          </Typography.Text>
          <div
            css={{
              padding: theme.spacing.sm,
              borderLeft: `3px solid ${theme.colors.blue400}`,
              backgroundColor: 'rgba(238,244,255,0.6)',
              fontStyle: 'italic',
              maxHeight: 96,
              overflow: 'auto',
            }}
          >
            "{feedback.anchor.selected_text}"
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>Aspect</Typography.Text>
            <div css={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
              {ASPECT_OPTIONS.map((option) => (
                <Tag
                  key={option}
                  componentId="mlflow.playground.feedback.dispatch-aspect-chip"
                  color={aspect === option ? 'indigo' : 'default'}
                  onClick={() => setAspect(option)}
                  css={{ cursor: 'pointer' }}
                >
                  {option}
                </Tag>
              ))}
            </div>
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              Rationale (drives the generated test)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.dispatch-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
          </div>
          <div>
            <Typography.Text css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              Expected response (optional)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.dispatch-expected"
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
};

// --- Anchor highlight helpers ------------------------------------------------

/**
 * Resolve a stored anchor against a fresh element's text. Returns the offsets
 * the renderer should highlight; falls back to the stored offsets when prefix /
 * suffix don't unambiguously locate the snippet.
 */
export const resolveAnchorOffsets = (
  element: HTMLElement,
  anchor: AssistantMessageAnchor,
): { start: number; end: number } | null => {
  const text = element.textContent ?? '';
  const candidate = `${anchor.prefix}${anchor.selected_text}${anchor.suffix}`;
  const idx = text.indexOf(candidate);
  if (idx >= 0) {
    const start = idx + anchor.prefix.length;
    return { start, end: start + anchor.selected_text.length };
  }
  // Fallback: try the raw selected text alone.
  const direct = text.indexOf(anchor.selected_text);
  if (direct >= 0) {
    return { start: direct, end: direct + anchor.selected_text.length };
  }
  return null;
};
