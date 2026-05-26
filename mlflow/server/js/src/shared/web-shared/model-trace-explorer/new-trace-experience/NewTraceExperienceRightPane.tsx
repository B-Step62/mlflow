import { keys } from 'lodash';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import yaml from 'js-yaml';

import {
  ChevronDownIcon,
  ChevronRightIcon,
  DropdownMenu,
  Empty,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import type {
  FeedbackAssessment,
  ModelTrace,
  ModelTraceChatMessage,
  ModelTraceInfoV3,
  ModelTraceSpanNode,
} from '../ModelTrace.types';
import { getIconTypeForSpan, getTraceCost, getTraceTokenUsage } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPane } from '../assessments-pane/AssessmentsPane';
import { AssessmentsPaneFeedbackSection } from '../assessments-pane/AssessmentsPaneFeedbackSection';
import { ModelTraceExplorerAttributesTab } from '../right-pane/ModelTraceExplorerAttributesTab';
import { ModelTraceExplorerChatMessage } from '../right-pane/ModelTraceExplorerChatMessage';
import { ModelTraceExplorerEventsTab } from '../right-pane/ModelTraceExplorerEventsTab';

type Props = {
  modelTraceInfo: ModelTrace['info'];
};

type SectionProps = {
  title: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

const Section = ({ title, defaultOpen = true, actions, children }: SectionProps) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      css={{
        borderTop: `1px solid ${theme.colors.borderDecorative}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          gap: theme.spacing.sm,
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.textPrimary,
            textAlign: 'left',
          }}
        >
          <Typography.Text bold>{title}</Typography.Text>
          {/* Chevron lives on the right side of the section header. */}
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
        {open && actions}
      </div>
      {open && <div css={{ padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px` }}>{children}</div>}
    </section>
  );
};

// Span name header (no type label) at the top of the right pane.
const SpanTitleHeader = ({ activeSpan, isRootSpan }: { activeSpan: ModelTraceSpanNode; isRootSpan: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const name = typeof activeSpan.title === 'string' ? activeSpan.title : String(activeSpan.key);
  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: `${theme.spacing.md}px ${theme.spacing.md}px ${theme.spacing.sm}px`,
      }}
    >
      <ModelTraceExplorerIcon type={getIconTypeForSpan(activeSpan.type ?? '')} isRootSpan={isRootSpan} />
      <Typography.Title level={3} withoutMargins>
        {name}
      </Typography.Title>
    </div>
  );
};

type Row = { label: ReactNode; value: ReactNode };

const InfoRows = ({ rows }: { rows: Row[] }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        columnGap: theme.spacing.md,
        rowGap: theme.spacing.xs,
      }}
    >
      {rows.map((row, i) => (
        <Fragment key={i}>
          <div css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>{row.label}</div>
          <div css={{ color: theme.colors.textPrimary, fontSize: theme.typography.fontSizeSm, wordBreak: 'break-word' }}>
            {row.value}
          </div>
        </Fragment>
      ))}
    </div>
  );
};

const formatNumber = (n?: number | null) => (typeof n === 'number' ? n.toLocaleString('en-US') : '-');

const formatCost = (n?: number | null) => {
  if (typeof n !== 'number') return '-';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
};

const TagsValue = ({ tags }: { tags: { key: string; value: string }[] }) => {
  const { theme } = useDesignSystemTheme();
  const [showAll, setShowAll] = useState(false);
  const VISIBLE = 2;
  const visible = showAll ? tags : tags.slice(0, VISIBLE);
  const remaining = tags.length - visible.length;
  return (
    <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs, alignItems: 'center' }}>
      {visible.map(({ key, value }) => (
        <span
          key={key}
          css={{
            fontSize: theme.typography.fontSizeSm,
            padding: `0 ${theme.spacing.xs}px`,
            borderRadius: theme.legacyBorders.borderRadiusMd,
            backgroundColor: theme.colors.backgroundSecondary,
            color: theme.colors.textSecondary,
          }}
        >
          {key}: {value}
        </span>
      ))}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          css={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.actionDefaultTextDefault,
            fontSize: theme.typography.fontSizeSm,
          }}
        >
          +{remaining} more
        </button>
      )}
    </div>
  );
};

// Chat bubbles aligned right for assistant, left for user/tool/system.
const ChatBubbles = ({ messages }: { messages: ModelTraceChatMessage[] }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {messages.map((message, index) => {
        const role = message.role ?? 'user';
        const isAssistant = role === 'assistant';
        return (
          <div
            key={index}
            css={{
              maxWidth: '85%',
              alignSelf: isAssistant ? 'flex-end' : 'flex-start',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.legacyBorders.borderRadiusLg,
              overflow: 'hidden',
            }}
          >
            <ModelTraceExplorerChatMessage message={message} />
          </div>
        );
      })}
    </div>
  );
};

type InputsOutputsRenderMode = 'pretty' | 'yaml' | 'json' | 'chat';

const RenderModeMenu = ({
  value,
  onChange,
  hasChat,
}: {
  value: InputsOutputsRenderMode;
  onChange: (next: InputsOutputsRenderMode) => void;
  hasChat: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const labels: Record<InputsOutputsRenderMode, string> = {
    pretty: intl.formatMessage({
      defaultMessage: 'Default',
      description: 'Default (interactive tree) render-mode label for the Inputs/Outputs section in the new trace experience',
    }),
    yaml: intl.formatMessage({
      defaultMessage: 'YAML',
      description: 'YAML render-mode label for the Inputs/Outputs section in the new trace experience',
    }),
    json: intl.formatMessage({
      defaultMessage: 'JSON',
      description: 'JSON render-mode label for the Inputs/Outputs section in the new trace experience',
    }),
    chat: intl.formatMessage({
      defaultMessage: 'Chat',
      description: 'Chat render-mode label for the Inputs/Outputs section in the new trace experience',
    }),
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          css={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.textSecondary,
            fontSize: theme.typography.fontSizeSm,
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          {labels[value]}
          <ChevronDownIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item
          componentId="mlflow.new-trace-experience.io.render-mode.pretty"
          onClick={() => onChange('pretty')}
        >
          {labels.pretty}
        </DropdownMenu.Item>
        <DropdownMenu.Item componentId="mlflow.new-trace-experience.io.render-mode.yaml" onClick={() => onChange('yaml')}>
          {labels.yaml}
        </DropdownMenu.Item>
        <DropdownMenu.Item componentId="mlflow.new-trace-experience.io.render-mode.json" onClick={() => onChange('json')}>
          {labels.json}
        </DropdownMenu.Item>
        {hasChat && (
          <DropdownMenu.Item
            componentId="mlflow.new-trace-experience.io.render-mode.chat"
            onClick={() => onChange('chat')}
          >
            {labels.chat}
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

// Flat YAML / JSON dump for the YAML / JSON render modes.
const StructuredDump = ({ value, mode }: { value: unknown; mode: 'yaml' | 'json' }) => {
  const { theme } = useDesignSystemTheme();
  const text = useMemo(() => {
    if (mode === 'json') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    try {
      return yaml.dump(value, { lineWidth: 100, noRefs: true, sortKeys: false });
    } catch {
      return JSON.stringify(value, null, 2);
    }
  }, [value, mode]);

  return (
    <pre
      css={{
        margin: 0,
        padding: theme.spacing.md,
        backgroundColor: theme.colors.backgroundSecondary,
        borderRadius: theme.legacyBorders.borderRadiusMd,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: theme.typography.fontSizeSm,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: theme.colors.textPrimary,
      }}
    >
      {text}
    </pre>
  );
};

// "Pretty" interactive tree view, similar to Braintrust/DevTools — keys in
// violet monospace, nested objects/arrays collapsible on the left with a
// chevron, URLs rendered as links, null/undefined dimmed.
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

const KEY_COLOR = '#2272b4';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PrettyPrimitive = ({ value }: { value: unknown }) => {
  const { theme } = useDesignSystemTheme();
  if (value === null || value === undefined) {
    return <span css={{ color: theme.colors.textPlaceholder, fontFamily: MONO }}>null</span>;
  }
  if (typeof value === 'string') {
    if (isUrl(value)) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          css={{ color: theme.colors.textPrimary, textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          {value}
        </a>
      );
    }
    return <span css={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{value}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span css={{ fontFamily: MONO }}>{String(value)}</span>;
  }
  return <span css={{ fontFamily: MONO }}>{String(value)}</span>;
};

type PrettyEntryProps = {
  label: string | number;
  value: unknown;
  initialExpanded?: boolean;
};

const PrettyEntry = ({ label, value, initialExpanded = true }: PrettyEntryProps) => {
  const { theme } = useDesignSystemTheme();
  const [expanded, setExpanded] = useState(initialExpanded);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  if (isObject) {
    const count = isArray ? (value as unknown[]).length : Object.keys(value as object).length;
    return (
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: theme.spacing.xs,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.textPrimary,
            textAlign: 'left',
          }}
        >
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <span css={{ color: KEY_COLOR, fontFamily: MONO, fontWeight: 600 }}>{String(label)}</span>
          <span css={{ color: theme.colors.textSecondary, fontFamily: MONO, fontSize: theme.typography.fontSizeSm }}>
            {isArray ? `Array(${count})` : `{${count}}`}
          </span>
        </button>
        {expanded && (
          <div css={{ paddingLeft: theme.spacing.lg, marginTop: theme.spacing.xs, display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {isArray
              ? (value as unknown[]).map((v, i) => <PrettyEntry key={i} label={i} value={v} />)
              : Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                  <PrettyEntry key={k} label={k} value={v} />
                ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span css={{ color: KEY_COLOR, fontFamily: MONO, fontWeight: 600 }}>{String(label)}</span>
      <div css={{ paddingLeft: theme.spacing.lg, color: theme.colors.textPrimary }}>
        <PrettyPrimitive value={value} />
      </div>
    </div>
  );
};

// Renders a single payload's pretty tree. If the payload is itself an object,
// renders each top-level key as an entry at the root (no surrounding "inputs"
// or "outputs" wrapper). Primitive payloads render their own value.
const PrettyView = ({ value }: { value: unknown }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        fontSize: theme.typography.fontSizeSm,
      }}
    >
      {value !== null && typeof value === 'object' && !Array.isArray(value) ? (
        Object.entries(value as Record<string, unknown>).map(([k, v]) => <PrettyEntry key={k} label={k} value={v} />)
      ) : Array.isArray(value) ? (
        value.map((v, i) => <PrettyEntry key={i} label={i} value={v} />)
      ) : (
        <PrettyPrimitive value={value} />
      )}
    </div>
  );
};

export const NewTraceExperienceRightPane = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode, rootNode } = useModelTraceExplorerViewState();
  const activeSpan = selectedNode;
  const isRootSpan = Boolean(rootNode && activeSpan && rootNode.key === activeSpan.key);

  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '';

  const hasInputs = activeSpan?.inputs !== undefined && activeSpan?.inputs !== null;
  const hasOutputs = activeSpan?.outputs !== undefined && activeSpan?.outputs !== null;
  const hasAttributes = keys(activeSpan?.attributes).length > 0;
  const hasEvents = Array.isArray(activeSpan?.events) && (activeSpan?.events?.length ?? 0) > 0;
  const chatMessages = activeSpan?.chatMessages;
  const hasChat = Array.isArray(chatMessages) && chatMessages.length > 0;

  const [renderMode, setRenderMode] = useState<InputsOutputsRenderMode>(hasChat ? 'chat' : 'pretty');
  // Default to chat view whenever the selected span has chat messages.
  useEffect(() => {
    setRenderMode(hasChat ? 'chat' : 'pretty');
  }, [hasChat]);
  const effectiveRenderMode: InputsOutputsRenderMode = renderMode === 'chat' && !hasChat ? 'pretty' : renderMode;

  // Feedback assessments to render at the top of the right pane.
  const feedbacks = useMemo<FeedbackAssessment[]>(() => {
    const all = activeSpan?.assessments ?? [];
    return all.filter((a): a is FeedbackAssessment => 'feedback' in a);
  }, [activeSpan?.assessments]);

  // Split the already-parsed chatMessages array so the two sections never
  // duplicate and the message shapes stay compatible with the existing
  // ChatMessage renderer (which expects content as a string, not Anthropic-
  // style content blocks). Convention: the last message is the assistant
  // turn the span produced; everything before it is the conversation
  // context that was sent in.
  const { inputChatMessages, outputChatMessages } = useMemo(() => {
    const all = chatMessages ?? [];
    if (all.length === 0) return { inputChatMessages: [], outputChatMessages: [] };
    return {
      inputChatMessages: all.slice(0, -1),
      outputChatMessages: all.slice(-1),
    };
  }, [chatMessages]);

  const tokenUsage = useMemo(() => {
    try {
      return getTraceTokenUsage(modelTraceInfo as ModelTraceInfoV3);
    } catch {
      return {};
    }
  }, [modelTraceInfo]);
  const traceCost = useMemo(() => {
    try {
      return getTraceCost(modelTraceInfo as ModelTraceInfoV3);
    } catch {
      return {};
    }
  }, [modelTraceInfo]);

  if (!activeSpan) {
    return (
      <div
        css={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          '& > div': {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          },
        }}
      >
        <Empty
          description={
            <FormattedMessage
              defaultMessage="Select a span to see its details."
              description="Empty state for the new trace experience right pane before a span is selected"
            />
          }
        />
      </div>
    );
  }

  const tags = (modelTraceInfo as { tags?: Record<string, string> | { key: string; value: string }[] } | undefined)
    ?.tags;
  const tagPairs: { key: string; value: string }[] = Array.isArray(tags)
    ? tags
    : tags
      ? Object.entries(tags).map(([key, value]) => ({ key, value }))
      : [];
  const sessionId =
    (modelTraceInfo as ModelTraceInfoV3 | undefined)?.trace_metadata?.['mlflow.trace.session'] ??
    (modelTraceInfo as ModelTraceInfoV3 | undefined)?.trace_metadata?.['session_id'];

  // Tokens consolidated into one row. Show total with input/output breakdown
  // inline if available.
  const totalTokens = tokenUsage.total_tokens;
  const inputTokens = tokenUsage.input_tokens;
  const outputTokens = tokenUsage.output_tokens;
  const tokensValue =
    typeof totalTokens === 'number'
      ? typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? `${formatNumber(totalTokens)} (in: ${formatNumber(inputTokens ?? 0)}, out: ${formatNumber(outputTokens ?? 0)})`
        : formatNumber(totalTokens)
      : null;

  const infoRows: Row[] = [];

  // Span-level rows (apply to any span where present).
  if (activeSpan.modelName) {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Model" description="Info label - model name" />,
      value: activeSpan.modelName,
    });
  }
  if (activeSpan.cost?.total_cost !== undefined) {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Cost" description="Info label - span cost" />,
      value: formatCost(activeSpan.cost.total_cost),
    });
  }

  // Trace-level rows (tokens, total cost, session, tags) only on the root
  // span. Showing trace-level tokens on a child tool/retriever span is
  // misleading because those spans don't generate tokens themselves.
  if (isRootSpan) {
    if (tokensValue) {
      infoRows.push({
        label: <FormattedMessage defaultMessage="Tokens" description="Info label - trace-level tokens" />,
        value: tokensValue,
      });
    }
    if (typeof traceCost.total_cost === 'number' && activeSpan.cost?.total_cost === undefined) {
      infoRows.push({
        label: <FormattedMessage defaultMessage="Cost" description="Info label - trace cost" />,
        value: formatCost(traceCost.total_cost),
      });
    }
    if (sessionId) {
      infoRows.push({
        label: <FormattedMessage defaultMessage="Session" description="Info label - session" />,
        value: sessionId,
      });
    }
    if (tagPairs.length > 0) {
      infoRows.push({
        label: <FormattedMessage defaultMessage="Tags" description="Info label - tags" />,
        value: <TagsValue tags={tagPairs} />,
      });
    }
  }

  return (
    <div
      css={{
        flex: 1,
        minWidth: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <SpanTitleHeader activeSpan={activeSpan} isRootSpan={isRootSpan} />

      {infoRows.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Info"
              description="Section heading for the Info (Model / Tokens / Cost / Session / Tags) section in the new trace experience right pane"
            />
          }
        >
          <InfoRows rows={infoRows} />
        </Section>
      )}

      <Section
        title={
          <span css={{ display: 'inline-flex', alignItems: 'baseline', gap: theme.spacing.sm }}>
            <FormattedMessage
              defaultMessage="Feedback"
              description="Section heading for the Feedback section below Info in the new trace experience right pane"
            />
            <span css={{ color: theme.colors.textSecondary, fontWeight: 400, fontSize: theme.typography.fontSizeSm }}>
              <FormattedMessage
                defaultMessage="{count} feedback"
                description="Subtitle counter for the Feedback section header in the new trace experience right pane"
                values={{ count: feedbacks.length }}
              />
            </span>
          </span>
        }
        defaultOpen={false}
      >
        <AssessmentsPaneFeedbackSection
          enableRunScorer
          feedbacks={feedbacks}
          activeSpanId={String(activeSpan.key)}
          traceId={traceId}
          hideTitle
        />
      </Section>

      {hasInputs && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Input"
              description="Section heading for the span inputs section in the new trace experience right pane"
            />
          }
          actions={<RenderModeMenu value={effectiveRenderMode} onChange={setRenderMode} hasChat={hasChat} />}
        >
          {effectiveRenderMode === 'chat' && hasChat ? (
            <ChatBubbles messages={inputChatMessages} />
          ) : effectiveRenderMode === 'pretty' ? (
            <PrettyView value={activeSpan?.inputs} />
          ) : (
            <StructuredDump value={activeSpan?.inputs} mode={effectiveRenderMode === 'json' ? 'json' : 'yaml'} />
          )}
        </Section>
      )}
      {hasOutputs && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Output"
              description="Section heading for the span outputs section in the new trace experience right pane"
            />
          }
          actions={<RenderModeMenu value={effectiveRenderMode} onChange={setRenderMode} hasChat={hasChat} />}
        >
          {effectiveRenderMode === 'chat' && hasChat ? (
            <ChatBubbles messages={outputChatMessages} />
          ) : effectiveRenderMode === 'pretty' ? (
            <PrettyView value={activeSpan?.outputs} />
          ) : (
            <StructuredDump value={activeSpan?.outputs} mode={effectiveRenderMode === 'json' ? 'json' : 'yaml'} />
          )}
        </Section>
      )}

      {hasAttributes && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Attributes"
              description="Section heading for the attributes section in the new trace experience right pane"
            />
          }
          defaultOpen={false}
        >
          <ModelTraceExplorerAttributesTab activeSpan={activeSpan} searchFilter="" activeMatch={null} />
        </Section>
      )}

      {hasEvents && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Events"
              description="Section heading for the events section in the new trace experience right pane"
            />
          }
          defaultOpen={false}
        >
          <ModelTraceExplorerEventsTab activeSpan={activeSpan} searchFilter="" activeMatch={null} />
        </Section>
      )}

      <Section
        title={
          <FormattedMessage
            defaultMessage="Assessments"
            description="Section heading for the assessments umbrella (Feedback / Expectations / Notes / Issues) at the bottom of the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <AssessmentsPane
          assessments={activeSpan.assessments ?? []}
          traceId={traceId}
          activeSpanId={String(activeSpan.key)}
          disableCloseButton
        />
      </Section>
    </div>
  );
};
