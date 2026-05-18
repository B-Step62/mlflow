/**
 * Feedback / annotation system for the agent playground.
 *
 * Comments are stored as Feedback assessments on the source trace with
 * `metadata.anchor` carrying the serialized text range. They render as
 * inline highlights on the assistant message (Google-Docs style); the
 * `InlineCommentPopover` handles both create (from a floating selection
 * trigger) and view (from a click on an existing highlight). Saving a
 * comment auto-creates the corresponding Issue + regression test case;
 * "Dispatch" is no longer a user-facing step. (YUK-57)
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  Button,
  CloseIcon,
  Input,
  SpeechBubbleIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';

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

export type FeedbackVerdict = {
  passed: boolean;
  trace_id?: string;
  reasons?: string[];
};

export type PlaygroundFeedback = {
  assessment_id: string; // server-generated once persisted, optimistic id before
  trace_id: string;
  rationale: string;
  aspect: Aspect;
  expected_output?: string;
  anchor: AssistantMessageAnchor;
  // Set once saving completes — auto-dispatched alongside persistFeedback.
  dispatched_issue_id?: string;
  // UI-only state; not persisted.
  resolved?: boolean;
  pending?: boolean;
  // Last regression-test verdict for this feedback's issue, populated when
  // the user runs the test from the inline popover. Drives highlight color.
  latestVerdict?: FeedbackVerdict;
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

// --- Persistence -------------------------------------------------------------

export const ASSESSMENT_NAME = 'playground.feedback';

/**
 * Persist a new feedback as a Feedback assessment on the source trace.
 * Returns the server's authoritative assessment_id so the optimistic UI
 * row can be reconciled.
 *
 * ``assessment_name`` and ``source_id`` are configurable so the same
 * machinery can be reused for inline comments in the trace UI (or any
 * other surface) with its own namespace.
 */
export const persistFeedback = async (input: {
  trace_id: string;
  rationale: string;
  aspect: Aspect;
  expected_output?: string;
  anchor: AssistantMessageAnchor;
  assessment_name?: string;
  source_id?: string;
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
      assessment_name: input.assessment_name ?? ASSESSMENT_NAME,
      trace_id: input.trace_id,
      source: { source_type: 'HUMAN', source_id: input.source_id ?? 'playground-cockpit' },
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
  assessmentName: string = ASSESSMENT_NAME,
): PlaygroundFeedback[] => {
  if (!assessments) return [];
  const out: PlaygroundFeedback[] = [];
  for (const a of assessments) {
    if (a.assessment_name !== assessmentName) continue;
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
  // Whitespace-tolerant fallback. The markdown renderer can normalise
  // whitespace differently from what `window.getSelection().toString()`
  // captured (e.g. collapsing newlines around block boundaries). We map
  // each character of `text` to its position in a whitespace-collapsed
  // form, find the selection there, and translate back to original-text
  // offsets. Without this the highlight silently drops on multi-paragraph
  // selections inside markdown — the assessment saves fine, but the chip
  // never paints.
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  const collapsedSelected = collapse(anchor.selected_text);
  if (!collapsedSelected) return null;
  const collapsedText = collapse(text);
  const collapsedIdx = collapsedText.indexOf(collapsedSelected);
  if (collapsedIdx < 0) return null;
  // Walk the original text, counting only collapsed-significant characters
  // (single spaces and non-whitespace) to map collapsed offsets back.
  let collapsedPos = 0;
  let inWhitespaceRun = false;
  let leadingWs = true;
  let originalStart = -1;
  let originalEnd = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isWs = /\s/.test(ch);
    if (isWs) {
      if (!inWhitespaceRun && !leadingWs) collapsedPos += 1;
      inWhitespaceRun = true;
      continue;
    }
    if (collapsedPos === collapsedIdx && originalStart < 0) originalStart = i;
    inWhitespaceRun = false;
    leadingWs = false;
    collapsedPos += 1;
    if (collapsedPos === collapsedIdx + collapsedSelected.length) {
      originalEnd = i + 1;
      break;
    }
  }
  if (originalStart < 0 || originalEnd < 0) return null;
  return { start: originalStart, end: originalEnd };
};

// --- Inline highlight rendering ---------------------------------------------

const HIGHLIGHT_ATTR = 'data-mlflow-feedback-mark';

const verdictTone = (feedback: PlaygroundFeedback): 'failing' | 'passing' | 'neutral' | 'resolved' => {
  if (feedback.resolved) return 'resolved';
  if (!feedback.latestVerdict) return 'neutral';
  return feedback.latestVerdict.passed ? 'passing' : 'failing';
};

type MarkStyle = { background: string; underline: string };

const markStyle = (tone: ReturnType<typeof verdictTone>): MarkStyle => {
  switch (tone) {
    case 'failing':
      return { background: 'rgba(255, 224, 224, 0.7)', underline: '#d32f2f' };
    case 'passing':
      return { background: 'rgba(220, 245, 220, 0.7)', underline: '#2e7d32' };
    case 'resolved':
      return { background: 'transparent', underline: 'rgba(120,120,120,0.5)' };
    default:
      return { background: 'rgba(245, 235, 200, 0.65)', underline: '#a07000' };
  }
};

/**
 * Walk the children of `container` and surround the text range
 * `[start, end)` with a `<mark>` element. The walk is offset-based against
 * `container.textContent`, so it works through markdown-rendered DOM trees
 * (paragraphs, lists, code spans). Returns the mark element on success.
 *
 * Multi-text-node ranges are wrapped with multiple sibling `<mark>` tags
 * carrying the same feedback id — clicking any of them opens the same
 * popover. This avoids reparenting markdown structures.
 */
const wrapRange = (container: HTMLElement, start: number, end: number, feedbackId: string, style: MarkStyle): void => {
  if (end <= start) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip whitespace-only nodes that markdown adds between blocks; they
      // would mis-align our offsets vs `textContent` (which preserves them).
      // We do NOT filter them out — `textContent` includes these characters,
      // so our offset accounting must include them too.
      void node;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let acc = 0;
  const wraps: Array<{ node: Text; from: number; to: number }> = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    const node = current as Text;
    const text = node.data;
    const len = text.length;
    const nodeStart = acc;
    const nodeEnd = acc + len;
    // Clamp the global range against this node's bounds.
    const wrapFrom = Math.max(0, start - nodeStart);
    const wrapTo = Math.min(len, end - nodeStart);
    if (wrapTo > wrapFrom && nodeEnd > start && nodeStart < end) {
      wraps.push({ node, from: wrapFrom, to: wrapTo });
    }
    acc = nodeEnd;
    if (acc >= end) break;
    current = walker.nextNode();
  }

  for (const { node, from, to } of wraps) {
    // Split the text node so the wrapped portion is its own node.
    const before = from > 0 ? node.splitText(from) : node;
    if (to - from < before.data.length) {
      before.splitText(to - from);
    }
    const mark = document.createElement('mark');
    mark.setAttribute(HIGHLIGHT_ATTR, feedbackId);
    mark.style.backgroundColor = style.background;
    mark.style.borderBottom = `2px solid ${style.underline}`;
    mark.style.borderRadius = '2px';
    mark.style.padding = '0 1px';
    mark.style.cursor = 'pointer';
    before.parentNode?.insertBefore(mark, before);
    mark.appendChild(before);
  }
};

const stripExistingMarks = (container: HTMLElement): void => {
  const marks = container.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
};

export type InlineCommentClick = {
  feedback: PlaygroundFeedback;
  rect: DOMRect;
};

/**
 * Wraps an assistant message's rendered content and overlays clickable
 * highlights for each feedback whose anchor falls inside the message. Acts
 * as a transparent passthrough (renders children inside a single `<div>` so
 * the parent's CSS / data-attributes still apply).
 *
 * Re-runs after every render: existing marks are stripped first so React
 * re-renders of the markdown body don't double-wrap.
 */
export const InlineCommentMarks = ({
  feedbacks,
  onClickMark,
  children,
  className,
  containerProps,
}: {
  feedbacks: PlaygroundFeedback[];
  onClickMark: (click: InlineCommentClick) => void;
  children: ReactNode;
  // Optional class on the wrapping `<div>` so consumers can opt into
  // flex / overflow layouts without breaking the playground usage.
  className?: string;
  // Additional attributes (e.g. `data-mlflow-feedback-anchor`) spread onto
  // the wrapping `<div>`. Lets a single element carry both the marks
  // overlay and the selection anchor.
  containerProps?: React.HTMLAttributes<HTMLDivElement>;
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Stable source for the click handler — the rendered <mark> nodes look up
  // by feedback id, which matches the latest list at click time.
  const feedbacksRef = useRef(feedbacks);
  feedbacksRef.current = feedbacks;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    stripExistingMarks(container);
    // Sort by start so nested splits proceed left-to-right; subsequent wraps
    // walk a tree where earlier ranges are already isolated into their own
    // text nodes, which keeps offset math correct.
    const sorted = [...feedbacks].sort((a, b) => a.anchor.start - b.anchor.start);
    for (const feedback of sorted) {
      const offsets = resolveAnchorOffsets(container, feedback.anchor);
      if (!offsets) continue;
      wrapRange(container, offsets.start, offsets.end, feedback.assessment_id, markStyle(verdictTone(feedback)));
    }
    return () => {
      // Best-effort cleanup if the component unmounts mid-paint.
      stripExistingMarks(container);
    };
  });

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const mark = target.closest(`mark[${HIGHLIGHT_ATTR}]`) as HTMLElement | null;
      if (!mark) return;
      const id = mark.getAttribute(HIGHLIGHT_ATTR);
      if (!id) return;
      const feedback = feedbacksRef.current.find((f) => f.assessment_id === id);
      if (!feedback) return;
      event.stopPropagation();
      onClickMark({ feedback, rect: mark.getBoundingClientRect() });
    },
    [onClickMark],
  );

  return (
    <div ref={containerRef} onClick={handleClick} className={className} {...containerProps}>
      {children}
    </div>
  );
};

// --- Inline comment popover -------------------------------------------------

export type InlineCommentDraft = {
  rationale: string;
  aspect: Aspect;
  expected_output?: string;
  anchor: AssistantMessageAnchor;
};

export type InlineCommentSubmit = (draft: InlineCommentDraft) => Promise<void> | void;

export type PopoverAnchor = { rect: DOMRect };

const POPOVER_WIDTH = 360;
const POPOVER_OFFSET = 8;

const computePopoverPosition = (rect: DOMRect): { top: number; left: number } => {
  const desiredLeft = rect.left;
  const left = Math.max(8, Math.min(window.innerWidth - POPOVER_WIDTH - 8, desiredLeft));
  // Prefer placing above the highlight; fall back to below if too close to top.
  const aboveTop = rect.top - POPOVER_OFFSET;
  const belowTop = rect.bottom + POPOVER_OFFSET;
  const top = aboveTop > 220 ? aboveTop : belowTop;
  return { top, left };
};

const StatusPill = ({ feedback }: { feedback: PlaygroundFeedback }) => {
  const { theme } = useDesignSystemTheme();
  const tone = verdictTone(feedback);
  const hasTest = !!feedback.dispatched_issue_id;
  const baseLabel = hasTest ? 'No test run yet' : 'No test yet';
  const map: Record<typeof tone, { label: string; bg: string; fg: string }> = {
    neutral: { label: baseLabel, bg: 'rgba(245, 235, 200, 0.6)', fg: theme.colors.textSecondary },
    failing: { label: 'Failing', bg: 'rgba(255, 224, 224, 0.8)', fg: theme.colors.red700 },
    passing: { label: 'Passing', bg: 'rgba(220, 245, 220, 0.8)', fg: theme.colors.green700 },
    resolved: { label: 'Resolved', bg: theme.colors.backgroundSecondary, fg: theme.colors.textSecondary },
  };
  const entry = map[tone];
  return (
    <span
      css={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        padding: `2px ${theme.spacing.sm}px`,
        borderRadius: 999,
        fontSize: theme.typography.fontSizeSm,
        fontWeight: 500,
        backgroundColor: entry.bg,
        color: entry.fg,
      }}
    >
      {entry.label}
    </span>
  );
};

/**
 * Single floating popover that handles both creating a new comment (anchored
 * at the active text selection) and viewing / acting on an existing comment
 * (anchored at the clicked highlight). The popover positions itself in
 * viewport coords; the parent owns its open/close state via `mode`.
 */
export const InlineCommentPopover = ({
  mode,
  selection,
  feedback,
  rect,
  onClose,
  onSubmit,
  onFixIt,
  onRunTest,
  onResolve,
  onDelete,
  onOpenIssue,
  isSubmitting,
  isFixing,
  isRunning,
}: {
  mode: 'create' | 'view';
  selection?: ActiveSelection | null;
  feedback?: PlaygroundFeedback;
  rect: DOMRect;
  onClose: () => void;
  onSubmit?: InlineCommentSubmit;
  // Generate the regression test if needed AND copy the fix prompt to the
  // clipboard. Always shown in view mode (unless resolved). The test is the
  // slow part (LLM call); the parent surfaces a spinner via `isFixing`. In
  // the future this will dispatch to a worker instead of just copying.
  onFixIt?: (feedback: PlaygroundFeedback) => void;
  onRunTest?: (feedback: PlaygroundFeedback) => void;
  onResolve?: (feedback: PlaygroundFeedback) => void;
  onDelete?: (feedback: PlaygroundFeedback) => void;
  onOpenIssue?: (issueId: string) => void;
  isSubmitting?: boolean;
  isFixing?: boolean;
  isRunning?: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [rationale, setRationale] = useState('');

  // Reset form on (re)open. For view mode we don't currently support
  // editing, so the form fields are read-only summaries below.
  useEffect(() => {
    if (mode === 'create') {
      setRationale('');
    }
  }, [mode, selection?.start, selection?.end, selection?.message_id]);

  useLayoutEffect(() => {
    if (mode === 'create') {
      const t = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode]);

  // Click-outside / Escape close.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const submit = async () => {
    if (mode !== 'create' || !selection || !rationale.trim() || !onSubmit) return;
    await onSubmit({
      rationale: rationale.trim(),
      // Aspect/expected-output were dropped from the popover UI per UX
      // simplification; default to 'quality' so the assessment metadata
      // shape downstream (persistFeedback, dispatchFeedback) stays stable.
      aspect: 'quality',
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
  };

  const { top, left } = computePopoverPosition(rect);

  const selectedText = mode === 'create' ? selection?.selected_text : feedback?.anchor.selected_text;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={mode === 'create' ? 'Add comment' : 'Comment'}
      css={{
        position: 'fixed',
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 1100,
        backgroundColor: theme.colors.backgroundPrimary,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Text css={{ fontWeight: 600 }}>{mode === 'create' ? 'Leave feedback' : 'Comment'}</Typography.Text>
        <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
          {mode === 'view' && feedback?.dispatched_issue_id && (
            <button
              type="button"
              onClick={() => onOpenIssue?.(feedback.dispatched_issue_id as string)}
              css={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: theme.typography.fontSizeSm,
                color: theme.colors.actionDefaultTextDefault,
                textDecoration: 'underline',
              }}
              title="Open issue detail"
            >
              {feedback.dispatched_issue_id}
            </button>
          )}
          <Button
            componentId="mlflow.playground.feedback.popover.close"
            size="small"
            type="tertiary"
            icon={<CloseIcon />}
            onClick={onClose}
            aria-label="Close"
          />
        </div>
      </div>

      {selectedText && (
        <div
          css={{
            padding: theme.spacing.sm,
            borderLeft: `3px solid ${theme.colors.blue400}`,
            backgroundColor: 'rgba(238,244,255,0.6)',
            fontStyle: 'italic',
            maxHeight: 84,
            overflow: 'auto',
            fontSize: theme.typography.fontSizeSm,
          }}
        >
          "{selectedText}"
        </div>
      )}

      {mode === 'create' ? (
        <>
          <div>
            <Typography.Text size="sm" color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              What's wrong? (required)
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.popover.rationale"
              ref={textareaRef as never}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder="e.g. 'tone is too casual for support'"
            />
          </div>
          <div
            css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.xs, marginTop: theme.spacing.xs }}
          >
            <Button componentId="mlflow.playground.feedback.popover.cancel" size="small" onClick={onClose}>
              Cancel
            </Button>
            <Button
              componentId="mlflow.playground.feedback.popover.save"
              type="primary"
              size="small"
              disabled={!rationale.trim() || !!isSubmitting}
              loading={!!isSubmitting}
              onClick={() => void submit()}
            >
              Save
            </Button>
          </div>
        </>
      ) : feedback ? (
        <>
          <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            <StatusPill feedback={feedback} />
          </div>
          <Typography.Text>{feedback.rationale}</Typography.Text>
          {feedback.latestVerdict && !feedback.latestVerdict.passed && feedback.latestVerdict.reasons?.length ? (
            <div
              css={{
                padding: theme.spacing.sm,
                borderRadius: theme.borders.borderRadiusMd,
                backgroundColor: 'rgba(255, 224, 224, 0.4)',
                fontSize: theme.typography.fontSizeSm,
              }}
            >
              <Typography.Text size="sm" css={{ display: 'block', fontWeight: 600, marginBottom: theme.spacing.xs }}>
                Why it failed
              </Typography.Text>
              {feedback.latestVerdict.reasons.slice(0, 3).map((reason, i) => (
                <Typography.Text key={i} size="sm" color="secondary" css={{ display: 'block' }}>
                  • {reason}
                </Typography.Text>
              ))}
            </div>
          ) : null}
          <div
            css={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: theme.spacing.xs,
              marginTop: theme.spacing.xs,
              flexWrap: 'wrap',
            }}
          >
            <Button
              componentId="mlflow.playground.feedback.popover.delete"
              size="small"
              type="tertiary"
              onClick={() => onDelete?.(feedback)}
              disabled={feedback.pending}
            >
              Delete
            </Button>
            <Button
              componentId="mlflow.playground.feedback.popover.resolve"
              size="small"
              onClick={() => onResolve?.(feedback)}
              disabled={feedback.pending || feedback.resolved}
            >
              {feedback.resolved ? 'Resolved' : 'Resolve'}
            </Button>
            {feedback.dispatched_issue_id && onRunTest && (
              <Button
                componentId="mlflow.playground.feedback.popover.run"
                size="small"
                loading={!!isRunning}
                onClick={() => onRunTest(feedback)}
              >
                {feedback.latestVerdict ? 'Run again' : 'Run test'}
              </Button>
            )}
            {onFixIt && !feedback.resolved && (
              <Button
                componentId="mlflow.playground.feedback.popover.fix-it"
                type="primary"
                size="small"
                loading={!!isFixing}
                disabled={feedback.pending}
                onClick={() => onFixIt(feedback)}
              >
                Send to worker
              </Button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

// Re-exported for callers that want to clamp anchor positions outside this
// module (e.g. for screenshot tests).
export { computePopoverPosition };

// --- Message-level comments button ------------------------------------------
//
// Sub-selection highlights are great for "this specific phrase is wrong" but
// don't have a place for "the whole answer misses the user's intent" — there's
// nothing to wrap a mark around. The button below the message bubble closes
// that gap: it lists all comments anchored to the message (both selection-
// based and message-level) and exposes a textarea for adding a new
// message-level one. Same downstream actions as the inline popover (resolve,
// delete, run test, fix it).

const MESSAGE_LEVEL_ANCHOR_OFFSET = 0;

/** Anchor used for message-level (no sub-selection) feedback. The empty
 * range means InlineCommentMarks won't paint a highlight, which is what we
 * want — the comment is about the whole reply, not a substring. */
export const messageLevelAnchor = (
  message_id: string,
  trace_id: string | undefined,
): AssistantMessageAnchor => ({
  message_id,
  trace_id,
  start: MESSAGE_LEVEL_ANCHOR_OFFSET,
  end: MESSAGE_LEVEL_ANCHOR_OFFSET,
  selected_text: '',
  prefix: '',
  suffix: '',
});

const isMessageLevel = (a: AssistantMessageAnchor) =>
  a.start === a.end && a.selected_text === '' && a.prefix === '' && a.suffix === '';

export const MessageCommentsButton = ({
  messageId,
  traceId,
  feedbacks,
  onSubmit,
  onResolve,
  onDelete,
  onRunTest,
  onFixIt,
  onOpenIssue,
  isFixingIds,
  isRunningIssueIds,
}: {
  messageId: string;
  traceId: string | undefined;
  feedbacks: PlaygroundFeedback[];
  onSubmit: InlineCommentSubmit;
  onResolve: (feedback: PlaygroundFeedback) => void;
  onDelete: (feedback: PlaygroundFeedback) => void;
  onRunTest?: (feedback: PlaygroundFeedback) => void;
  onFixIt?: (feedback: PlaygroundFeedback) => void;
  onOpenIssue?: (issueId: string) => void;
  // Per-feedback / per-issue progress flags driven by the parent. Keys here
  // mirror the inline-popover wiring so the message-level panel surfaces the
  // same spinners the inline path already does.
  isFixingIds?: Set<string>;
  isRunningIssueIds?: Set<string>;
}) => {
  const { theme } = useDesignSystemTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const visible = feedbacks.filter((f) => !f.resolved);
  const count = visible.length;

  // Auto-focus the textarea when the panel opens. Matches the inline popover's
  // behavior so keyboard-first users can start typing immediately.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => textareaRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Click-outside / Escape close — same convention as InlineCommentPopover.
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    await onSubmit({
      rationale: text,
      aspect: 'quality',
      anchor: messageLevelAnchor(messageId, traceId),
    });
    setDraft('');
  }, [draft, messageId, traceId, onSubmit]);

  return (
    <div ref={containerRef} css={{ position: 'relative', alignSelf: 'flex-start' }}>
      <Button
        componentId="mlflow.playground.feedback.message-comments.toggle"
        size="small"
        type="tertiary"
        icon={<SpeechBubbleIcon />}
        onClick={() => setOpen((v) => !v)}
      >
        {count > 0 ? String(count) : 'Comment'}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Message comments"
          css={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: theme.spacing.xs,
            width: 380,
            maxHeight: 480,
            overflow: 'auto',
            zIndex: 1100,
            backgroundColor: theme.colors.backgroundPrimary,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
            padding: theme.spacing.md,
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing.sm,
          }}
        >
          <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography.Text css={{ fontWeight: 600 }}>
              Comments {count > 0 ? `(${count})` : ''}
            </Typography.Text>
            <Button
              componentId="mlflow.playground.feedback.message-comments.close"
              size="small"
              type="tertiary"
              icon={<CloseIcon />}
              onClick={() => setOpen(false)}
              aria-label="Close"
            />
          </div>

          {visible.length === 0 ? (
            <Typography.Text size="sm" color="secondary">
              No comments yet on this message.
            </Typography.Text>
          ) : (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
              {visible.map((f) => (
                <CommentRow
                  key={f.assessment_id}
                  feedback={f}
                  onResolve={onResolve}
                  onDelete={onDelete}
                  onRunTest={onRunTest}
                  onFixIt={onFixIt}
                  onOpenIssue={onOpenIssue}
                  isFixing={isFixingIds?.has(f.assessment_id) ?? false}
                  isRunning={
                    f.dispatched_issue_id ? (isRunningIssueIds?.has(f.dispatched_issue_id) ?? false) : false
                  }
                />
              ))}
            </div>
          )}

          <div css={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: theme.spacing.sm }}>
            <Typography.Text size="sm" color="secondary" css={{ display: 'block', marginBottom: theme.spacing.xs }}>
              Add a comment about this whole message
            </Typography.Text>
            <Input.TextArea
              componentId="mlflow.playground.feedback.message-comments.rationale"
              ref={textareaRef as never}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder="e.g. 'misses the user's actual intent'"
            />
            <div
              css={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: theme.spacing.xs,
                marginTop: theme.spacing.xs,
              }}
            >
              <Button
                componentId="mlflow.playground.feedback.message-comments.cancel"
                size="small"
                onClick={() => {
                  setDraft('');
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                componentId="mlflow.playground.feedback.message-comments.save"
                type="primary"
                size="small"
                disabled={!draft.trim()}
                onClick={() => void handleSubmit()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CommentRow = ({
  feedback,
  onResolve,
  onDelete,
  onRunTest,
  onFixIt,
  onOpenIssue,
  isFixing,
  isRunning,
}: {
  feedback: PlaygroundFeedback;
  onResolve: (feedback: PlaygroundFeedback) => void;
  onDelete: (feedback: PlaygroundFeedback) => void;
  onRunTest?: (feedback: PlaygroundFeedback) => void;
  onFixIt?: (feedback: PlaygroundFeedback) => void;
  onOpenIssue?: (issueId: string) => void;
  isFixing: boolean;
  isRunning: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const messageLevel = isMessageLevel(feedback.anchor);
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: theme.spacing.sm,
        borderRadius: theme.borders.borderRadiusMd,
        border: `1px solid ${theme.colors.border}`,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
        <StatusPill feedback={feedback} />
        {feedback.dispatched_issue_id && (
          <button
            type="button"
            onClick={() => onOpenIssue?.(feedback.dispatched_issue_id as string)}
            css={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSizeSm,
              color: theme.colors.actionDefaultTextDefault,
              textDecoration: 'underline',
            }}
            title="Open issue detail"
          >
            {feedback.dispatched_issue_id}
          </button>
        )}
      </div>
      {!messageLevel && feedback.anchor.selected_text && (
        <div
          css={{
            padding: theme.spacing.xs,
            borderLeft: `3px solid ${theme.colors.blue400}`,
            backgroundColor: 'rgba(238,244,255,0.6)',
            fontStyle: 'italic',
            fontSize: theme.typography.fontSizeSm,
            maxHeight: 60,
            overflow: 'auto',
          }}
        >
          "{feedback.anchor.selected_text}"
        </div>
      )}
      <Typography.Text>{feedback.rationale}</Typography.Text>
      <div
        css={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: theme.spacing.xs,
          flexWrap: 'wrap',
        }}
      >
        <Button
          componentId="mlflow.playground.feedback.message-comments.delete"
          size="small"
          type="tertiary"
          onClick={() => onDelete(feedback)}
          disabled={feedback.pending}
        >
          Delete
        </Button>
        <Button
          componentId="mlflow.playground.feedback.message-comments.resolve"
          size="small"
          onClick={() => onResolve(feedback)}
          disabled={feedback.pending || feedback.resolved}
        >
          {feedback.resolved ? 'Resolved' : 'Resolve'}
        </Button>
        {feedback.dispatched_issue_id && onRunTest && (
          <Button
            componentId="mlflow.playground.feedback.message-comments.run"
            size="small"
            loading={isRunning}
            onClick={() => onRunTest(feedback)}
          >
            {feedback.latestVerdict ? 'Run again' : 'Run test'}
          </Button>
        )}
        {onFixIt && !feedback.resolved && (
          <Button
            componentId="mlflow.playground.feedback.message-comments.fix-it"
            type="primary"
            size="small"
            loading={isFixing}
            disabled={feedback.pending}
            onClick={() => onFixIt(feedback)}
          >
            Send to worker
          </Button>
        )}
      </div>
    </div>
  );
};
