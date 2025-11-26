import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Input, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';
import { getUser } from '@databricks/web-shared/global-settings';

import { useCreateAssessment } from '../hooks/useCreateAssessment';
import type { CreateAssessmentPayload } from '../api';

const MAX_SNIPPET_LENGTH = 1000;
const ASSESSMENT_NAME = 'comment';

type SelectedSnippet = {
  text: string;
  jsonPath: string;
  spanId?: string;
  wasTruncated: boolean;
};

type TextSelectionFeedbackProps = {
  traceId: string;
  spanId?: string;
};

export const TextSelectionFeedback = ({ traceId, spanId }: TextSelectionFeedbackProps) => {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <div css={{ marginTop: theme.spacing.md }}>
      {!expanded && (
        <Button
          componentId="shared.model-trace-explorer.select-text-feedback"
          type="tertiary"
          onClick={() => setExpanded(true)}
        >
          <FormattedMessage
            defaultMessage="Select text to give feedback"
            description="Button label to start text selection feedback flow"
          />
        </Button>
      )}
      {expanded && (
        <TextSelectionFeedbackForm
          traceId={traceId}
          spanId={spanId}
          onClose={() => setExpanded(false)}
          autoActivateSelection
        />
      )}
    </div>
  );
};

type TextSelectionFeedbackFormProps = {
  traceId: string;
  spanId?: string;
  onClose: () => void;
  autoActivateSelection?: boolean;
};

const buildRationale = (snippet: SelectedSnippet, comment: string) =>
  JSON.stringify({
    jsonPath: snippet.jsonPath,
    target: snippet.text,
    comment: comment ?? '',
  });

const isNodeWithin = (container: HTMLElement | null, node: Node | null) => {
  if (!container || !node) {
    return false;
  }
  if (node instanceof HTMLElement) {
    return container.contains(node);
  }
  return container.contains(node.parentElement);
};

const clampSnippet = (text: string): { text: string; wasTruncated: boolean } => {
  if (text.length <= MAX_SNIPPET_LENGTH) {
    return { text, wasTruncated: false };
  }
  return { text: `${text.slice(0, MAX_SNIPPET_LENGTH)}...`, wasTruncated: true };
};

const findSelectionContainer = (selection: Selection | null): Element | null => {
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const nodesToCheck: (Node | null)[] = [
    selection.getRangeAt(0).commonAncestorContainer,
    selection.anchorNode,
    selection.focusNode,
  ];

  for (const node of nodesToCheck) {
    if (!node) continue;
    const el = node instanceof Element ? node : node.parentElement;
    const candidate = el?.closest('[data-json-path]');
    if (candidate) {
      return candidate;
    }
  }
  return null;
};

const TextSelectionFeedbackForm = ({
  traceId,
  spanId,
  onClose,
  autoActivateSelection = false,
}: TextSelectionFeedbackFormProps) => {
  const { theme } = useDesignSystemTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectionMode, setSelectionMode] = useState(autoActivateSelection);
  const [selectedSnippet, setSelectedSnippet] = useState<SelectedSnippet | null>(null);
  const [thumbValue, setThumbValue] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const intl = useIntl();
  const highlightRef = useRef<HTMLElement | null>(null);

  const clearHighlight = useCallback(() => {
    const el = highlightRef.current;
    if (el) {
      el.style.backgroundColor = '';
      el.style.boxShadow = '';
      el.style.borderRadius = '';
      el.removeAttribute('data-selection-highlight');
    }
    highlightRef.current = null;
  }, []);

  const { createAssessmentMutation, isLoading } = useCreateAssessment({
    traceId,
    onSuccess: () => {
      setSelectionMode(false);
      setSelectedSnippet(null);
      setThumbValue(null);
      setComment('');
      setError(null);
      clearHighlight();
      onClose();
    },
  });

  useEffect(() => {
    setSelectedSnippet(null);
    setThumbValue(null);
    clearHighlight();
  }, [spanId]);

  useEffect(() => {
    if (!selectionMode || typeof window === 'undefined' || !window.getSelection) {
      return;
    }

    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        return;
      }

      // ignore selections inside the form itself
      if (isNodeWithin(rootRef.current, selection.anchorNode)) {
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText) {
        return;
      }

      const container = findSelectionContainer(selection);
      const jsonPath = container?.getAttribute('data-json-path') ?? '';
      const spanFromContainer = container?.getAttribute('data-span-id') || spanId || '';
      const { text, wasTruncated } = clampSnippet(selectedText);

      // apply persistent highlight to the container block when available
      if (container instanceof HTMLElement) {
        clearHighlight();
        const element = container as HTMLElement;
        element.style.backgroundColor = '#fff8d6';
        element.style.boxShadow = 'inset 0 0 0 1px #f0c200';
        element.style.borderRadius = theme.borders.borderRadiusSm;
        element.setAttribute('data-selection-highlight', 'true');
        highlightRef.current = element;
      }

      setSelectedSnippet({
        text,
        jsonPath: jsonPath || 'inputs/outputs',
        spanId: spanFromContainer || undefined,
        wasTruncated,
      });
      setError(null);
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      clearHighlight();
    };
  }, [
    clearHighlight,
    intl,
    selectionMode,
    spanId,
    theme.borders.borderRadiusSm,
    theme.colors.backgroundSecondary,
    theme.colors.border,
  ]);

  const canSubmit = useMemo(() => Boolean(selectedSnippet && thumbValue !== null && !isLoading), [
    selectedSnippet,
    thumbValue,
    isLoading,
  ]);

  const handleSubmit = useCallback(() => {
    if (!selectedSnippet || thumbValue === null) {
      return;
    }

    const rationale = buildRationale(selectedSnippet, comment.trim());
    const payload: CreateAssessmentPayload = {
      assessment: {
        assessment_name: ASSESSMENT_NAME,
        trace_id: traceId,
        span_id: selectedSnippet.spanId ?? spanId,
        rationale,
        metadata: {
          feedback_type: 'comment',
        },
        source: {
          source_type: 'HUMAN',
          source_id: getUser() ?? '',
        },
        feedback: {
          value: thumbValue,
        },
      },
    };

    createAssessmentMutation(payload);
  }, [comment, createAssessmentMutation, selectedSnippet, spanId, thumbValue, traceId]);

  return (
    <div
      ref={rootRef}
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        marginTop: theme.spacing.sm,
        padding: theme.spacing.sm,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusSm,
        backgroundColor: theme.colors.backgroundSecondary,
      }}
    >
      <div css={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm }}>
        <Typography.Text bold>
          <FormattedMessage
            defaultMessage="Select text to give feedback"
            description="Header for text selection feedback form"
          />
        </Typography.Text>
        <Button
          componentId="shared.model-trace-explorer.cancel-select-text-feedback"
          size="small"
          onClick={() => {
            setSelectionMode(false);
            clearHighlight();
            onClose();
          }}
        >
          <FormattedMessage defaultMessage="Cancel" description="Button label to cancel text selection feedback form" />
        </Button>
      </div>

      <Typography.Text size="sm" color="secondary">
        <FormattedMessage
          defaultMessage="Select any text in Inputs/Outputs; release to capture."
          description="Helper text for text selection feedback flow"
        />
      </Typography.Text>

      <div css={{ display: 'flex', gap: theme.spacing.xs }}>
        <Button
          componentId="shared.model-trace-explorer.thumb-up"
          type={thumbValue === true ? 'primary' : 'tertiary'}
          onClick={() => setThumbValue(true)}
          disabled={isLoading}
        >
          <FormattedMessage defaultMessage="Thumbs up" description="Thumbs up selection for feedback" />
        </Button>
        <Button
          componentId="shared.model-trace-explorer.thumb-down"
          type={thumbValue === false ? 'primary' : 'tertiary'}
          onClick={() => setThumbValue(false)}
          disabled={isLoading}
        >
          <FormattedMessage defaultMessage="Thumbs down" description="Thumbs down selection for feedback" />
        </Button>
      </div>

      <div
        css={{
          border: `1px dashed ${theme.colors.border}`,
          borderRadius: theme.borders.borderRadiusSm,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        {selectedSnippet ? (
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            <Typography.Text size="sm" bold>
              <FormattedMessage
                defaultMessage="Selected text"
                description="Label for the captured text snippet preview"
              />
            </Typography.Text>
            <Typography.Text size="sm" css={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {selectedSnippet.text}
            </Typography.Text>
            <Typography.Text size="xs" color="secondary">
              {selectedSnippet.jsonPath}
              {selectedSnippet.wasTruncated && ' (truncated)'}
            </Typography.Text>
            <Typography.Text size="xs" color="secondary">
              <FormattedMessage
                defaultMessage="Reselect to replace the snippet."
                description="Helper text indicating a new selection overwrites the previous one"
              />
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text size="sm" color="secondary">
            <FormattedMessage
              defaultMessage="Select any text from the trace to attach it here."
              description="Placeholder text before any snippet is captured"
            />
          </Typography.Text>
        )}
      </div>

      <div>
        <Typography.Text size="sm" color="secondary">
          <FormattedMessage defaultMessage="Comment (optional)" description="Label for feedback comment input" />
        </Typography.Text>
        <Input.TextArea
          componentId="shared.model-trace-explorer.feedback-comment"
          value={comment}
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={isLoading}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={intl.formatMessage({
            defaultMessage: 'Add context for your feedback',
            description: 'Placeholder for free-form feedback comment input',
          })}
        />
      </div>

      {error && (
        <Typography.Text size="sm" color="danger">
          {error}
        </Typography.Text>
      )}

      <div css={{ display: 'flex', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
        <Button
          componentId="shared.model-trace-explorer.close-select-text-feedback"
          onClick={() => {
            setSelectionMode(false);
            clearHighlight();
            onClose();
          }}
          disabled={isLoading}
        >
          <FormattedMessage defaultMessage="Close" description="Close button for text selection feedback form" />
        </Button>
        <Button
          type="primary"
          componentId="shared.model-trace-explorer.submit-select-text-feedback"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={isLoading}
        >
          <FormattedMessage defaultMessage="Create" description="Submit button for text selection feedback form" />
        </Button>
      </div>
    </div>
  );
};
