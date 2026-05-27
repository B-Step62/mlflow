import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import yaml from 'js-yaml';

import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracketsCurlyIcon,
  Button,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  DropdownMenu,
  Empty,
  GavelIcon,
  InfoIcon,
  LightningIcon,
  SpeechBubbleIcon,
  TargetIcon,
  ThumbsUpIcon,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from '@databricks/i18n';

import { isEvaluatingTracesInDetailsViewEnabled } from '../FeatureUtils';
import type {
  ExpectationAssessment,
  FeedbackAssessment,
  ModelTrace,
  ModelTraceChatMessage,
  ModelTraceInfoV3,
  ModelTraceSpanNode,
} from '../ModelTrace.types';
import { useModelTraceExplorerContext } from '../ModelTraceExplorerContext';
import { getIconTypeForSpan, getSpanTokenUsage, getTraceCost, getTraceTokenUsage } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPaneExpectationsSection } from '../assessments-pane/AssessmentsPaneExpectationsSection';
import { AssessmentsPaneFeedbackSection } from '../assessments-pane/AssessmentsPaneFeedbackSection';
import { AssessmentsPaneNotesSection } from '../assessments-pane/AssessmentsPaneNotesSection';
import { useModelTraceExplorerRunJudgesContext } from '../contexts/RunJudgesContext';
import { ModelTraceExplorerChatMessage } from '../right-pane/ModelTraceExplorerChatMessage';
import { ModelTraceExplorerEventsTab } from '../right-pane/ModelTraceExplorerEventsTab';
import { PrettyView } from './PrettyView';

type Props = {
  modelTraceInfo: ModelTrace['info'];
};

type SectionProps = {
  title: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

// Chevron sits on the LEFT of the title; section content is indented so it
// aligns horizontally with the title text (not the chevron). Every section
// renders as a self-contained card -- border + rounded corners + soft
// shadow + a small outer margin -- so the whole right pane reads as a
// vertical stack of cards.
const SECTION_CHEVRON_GUTTER = 20;

const Section = ({ title, icon, defaultOpen = true, actions, children }: SectionProps) => {
  const { theme } = useDesignSystemTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      css={{
        display: 'flex',
        flexDirection: 'column',
        margin: `${theme.spacing.sm}px ${theme.spacing.md}px`,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.legacyBorders.borderRadiusMd,
        boxShadow: theme.shadows.sm,
        backgroundColor: theme.colors.backgroundPrimary,
        overflow: 'hidden',
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
            gap: theme.spacing.xs,
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: theme.colors.textPrimary,
            textAlign: 'left',
          }}
        >
          <span css={{ display: 'inline-flex', width: SECTION_CHEVRON_GUTTER - theme.spacing.xs, alignItems: 'center', color: theme.colors.textSecondary }}>
            {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </span>
          {icon && (
            <span css={{ display: 'inline-flex', alignItems: 'center', color: theme.colors.textSecondary }}>
              {icon}
            </span>
          )}
          <Typography.Text bold>{title}</Typography.Text>
        </button>
        {open && actions}
      </div>
      {open && (
        <div
          css={{
            padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px`,
            paddingLeft: theme.spacing.md + SECTION_CHEVRON_GUTTER,
          }}
        >
          {children}
        </div>
      )}
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

// Trace-level actions ("Score trace", "Add to dataset") surfaced directly
// under the span title so they're always reachable, independent of which
// span is selected or whether the Feedback section is expanded. Buttons
// are only rendered when the underlying capability is wired up.
const SpanActionButtons = ({ traceId }: { traceId: string }) => {
  const { theme } = useDesignSystemTheme();
  const runJudgeConfiguration = useModelTraceExplorerRunJudgesContext();
  const { addToDatasetAction } = useModelTraceExplorerContext();
  const [judgeModalVisible, setJudgeModalVisible] = useState(false);

  const judgeAvailable = Boolean(
    runJudgeConfiguration.renderRunJudgeModal && isEvaluatingTracesInDetailsViewEnabled(),
  );
  const datasetAvailable = Boolean(addToDatasetAction);

  if (!judgeAvailable && !datasetAvailable) return null;

  return (
    <div
      css={{
        display: 'flex',
        gap: theme.spacing.xs,
        padding: `0 ${theme.spacing.md}px ${theme.spacing.sm}px`,
      }}
    >
      {judgeAvailable && (
        <>
          <Button
            componentId="mlflow.new-trace-experience.score-trace"
            size="small"
            icon={<GavelIcon />}
            onClick={() => setJudgeModalVisible(true)}
          >
            <FormattedMessage
              defaultMessage="Score trace"
              description="Button under the span title that opens the LLM judge modal to score the current trace"
            />
          </Button>
          {runJudgeConfiguration.renderRunJudgeModal?.({
            itemId: traceId,
            visible: judgeModalVisible,
            onClose: () => setJudgeModalVisible(false),
          })}
        </>
      )}
      {datasetAvailable && (
        <Button
          componentId="mlflow.new-trace-experience.add-to-dataset"
          size="small"
          icon={<DatabaseIcon />}
          onClick={() => addToDatasetAction?.openModal()}
        >
          <FormattedMessage
            defaultMessage="Add to dataset"
            description="Button under the span title that adds the current trace to a dataset"
          />
        </Button>
      )}
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

// Render an arbitrary attribute value as a compact string for the
// attributes key-value grid. Objects/arrays get one-line JSON; primitives
// get their natural string form; null/undefined become an em-dash.
const formatAttributeValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// Build alphabetically-sorted key/value rows from a span's attributes
// record. Returns [] when there's nothing to show so the section can
// hide entirely.
const buildAttributeRows = (attributes: unknown): { label: string; value: string }[] => {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return [];
  const entries = Object.entries(attributes as Record<string, unknown>);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => ({ label: key, value: formatAttributeValue(value) }));
};

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
  const hasEvents = Array.isArray(activeSpan?.events) && (activeSpan?.events?.length ?? 0) > 0;
  const chatMessages = activeSpan?.chatMessages;
  const hasChat = Array.isArray(chatMessages) && chatMessages.length > 0;

  const [renderMode, setRenderMode] = useState<InputsOutputsRenderMode>(hasChat ? 'chat' : 'pretty');
  // Default to chat view whenever the selected span has chat messages.
  useEffect(() => {
    setRenderMode(hasChat ? 'chat' : 'pretty');
  }, [hasChat]);
  const effectiveRenderMode: InputsOutputsRenderMode = renderMode === 'chat' && !hasChat ? 'pretty' : renderMode;

  // Split assessments by type so each appears under its own section.
  const { feedbacks, expectations } = useMemo<{
    feedbacks: FeedbackAssessment[];
    expectations: ExpectationAssessment[];
  }>(() => {
    const all = activeSpan?.assessments ?? [];
    const fb: FeedbackAssessment[] = [];
    const ex: ExpectationAssessment[] = [];
    for (const a of all) {
      if ('feedback' in a) fb.push(a);
      else if ('expectation' in a) ex.push(a);
    }
    return { feedbacks: fb, expectations: ex };
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

  const attributeRows = useMemo(() => buildAttributeRows(activeSpan?.attributes), [activeSpan?.attributes]);

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

  // Per-span tokens come from OTel attributes. On the root span we fall
  // back to the trace-level metadata so traces whose root span doesn't
  // mirror usage attrs still show a number.
  const spanTokens = getSpanTokenUsage(activeSpan.attributes);
  const effectiveTokens = spanTokens.total_tokens !== undefined ? spanTokens : isRootSpan ? tokenUsage : {};
  const totalTokens = effectiveTokens.total_tokens;
  const inputTokens = effectiveTokens.input_tokens;
  const outputTokens = effectiveTokens.output_tokens;
  const tokensValue =
    typeof totalTokens === 'number'
      ? typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? `${formatNumber(totalTokens)} (in: ${formatNumber(inputTokens ?? 0)}, out: ${formatNumber(outputTokens ?? 0)})`
        : formatNumber(totalTokens)
      : null;

  const infoRows: Row[] = [];

  // Span-level rows -- shown on any span where the field is present.
  if (activeSpan.modelName) {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Model" description="Info label - model name" />,
      value: activeSpan.modelName,
    });
  }
  if (tokensValue) {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Tokens" description="Info label - tokens" />,
      value: tokensValue,
    });
  }
  if (activeSpan.cost?.total_cost !== undefined) {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Cost" description="Info label - span cost" />,
      value: formatCost(activeSpan.cost.total_cost),
    });
  } else if (isRootSpan && typeof traceCost.total_cost === 'number') {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Cost" description="Info label - trace cost" />,
      value: formatCost(traceCost.total_cost),
    });
  }

  // Session / Tags are intrinsically trace-level; keep them on the root.
  if (isRootSpan) {
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
      <SpanActionButtons traceId={traceId} />

      {infoRows.length > 0 && (
        <Section
          icon={<InfoIcon />}
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
        icon={<ThumbsUpIcon />}
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
          hideJudgeAction
        />
      </Section>

      {hasInputs && (
        <Section
          icon={<ArrowDownIcon />}
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
          icon={<ArrowUpIcon />}
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

      {attributeRows.length > 0 && (
        <Section
          icon={<BracketsCurlyIcon />}
          title={
            <FormattedMessage
              defaultMessage="Attributes"
              description="Section heading for the attributes section in the new trace experience right pane"
            />
          }
          defaultOpen={false}
        >
          <InfoRows
            rows={attributeRows.map((row) => ({
              label: <span css={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.label}</span>,
              value: <span css={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{row.value}</span>,
            }))}
          />
        </Section>
      )}

      {hasEvents && (
        <Section
          icon={<LightningIcon />}
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
        icon={<TargetIcon />}
        title={
          <FormattedMessage
            defaultMessage="Expectations"
            description="Section heading for the Expectations section at the bottom of the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <AssessmentsPaneExpectationsSection
          expectations={expectations}
          activeSpanId={String(activeSpan.key)}
          traceId={traceId}
          hideTitle
        />
      </Section>

      <Section
        icon={<SpeechBubbleIcon />}
        title={
          <FormattedMessage
            defaultMessage="Comments"
            description="Section heading for the Comments (personal notes) section at the bottom of the new trace experience right pane"
          />
        }
        defaultOpen={false}
      >
        <AssessmentsPaneNotesSection key={traceId} traceId={traceId} feedbacks={feedbacks} hideTitle />
      </Section>
    </div>
  );
};
