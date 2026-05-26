import { keys } from 'lodash';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ChevronDownIcon,
  ChevronRightIcon,
  Empty,
  SegmentedControlButton,
  SegmentedControlGroup,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type {
  ModelTrace,
  ModelTraceChatMessage,
  ModelTraceInfoV3,
  ModelTraceSpanNode,
} from '../ModelTrace.types';
import { createListFromObject, getTraceCost, getTraceTokenUsage } from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPane } from '../assessments-pane/AssessmentsPane';
import { ModelTraceExplorerFieldRenderer } from '../field-renderers/ModelTraceExplorerFieldRenderer';
import { ModelTraceExplorerAttributesTab } from '../right-pane/ModelTraceExplorerAttributesTab';
import { ModelTraceExplorerChatMessage } from '../right-pane/ModelTraceExplorerChatMessage';
import { ModelTraceExplorerEventsTab } from '../right-pane/ModelTraceExplorerEventsTab';
import { getIconTypeForSpan } from '../ModelTraceExplorer.utils';

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
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          <Typography.Text bold>{title}</Typography.Text>
        </button>
        {open && actions}
      </div>
      {open && <div css={{ padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px` }}>{children}</div>}
    </section>
  );
};

// Span name + type header at the top of the right pane.
const SpanTitleHeader = ({ activeSpan }: { activeSpan: ModelTraceSpanNode }) => {
  const { theme } = useDesignSystemTheme();
  const name = typeof activeSpan.title === 'string' ? activeSpan.title : String(activeSpan.key);
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.md}px ${theme.spacing.md}px ${theme.spacing.sm}px`,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
        <ModelTraceExplorerIcon type={getIconTypeForSpan(activeSpan.type ?? '')} />
        <Typography.Title level={3} withoutMargins>
          {name}
        </Typography.Title>
      </div>
      {activeSpan.type && (
        <Typography.Text color="secondary" css={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>
          {String(activeSpan.type)}
        </Typography.Text>
      )}
    </div>
  );
};

// Render a key-value list for the metrics card.
type Row = { label: ReactNode; value: ReactNode };

const MetricsRows = ({ rows }: { rows: Row[] }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div css={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: theme.spacing.md, rowGap: theme.spacing.xs }}>
      {rows.map(({ label, value }, i) => (
        <>
          <div key={`l-${i}`} css={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSizeSm }}>
            {label}
          </div>
          <div key={`v-${i}`} css={{ color: theme.colors.textPrimary, fontSize: theme.typography.fontSizeSm }}>
            {value}
          </div>
        </>
      ))}
    </div>
  );
};

const formatDuration = (ms?: number) => {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(2)} min`;
};

const formatNumber = (n?: number | null) => (typeof n === 'number' ? n.toLocaleString('en-US') : '-');

const formatCost = (n?: number | null) => {
  if (typeof n !== 'number') return '-';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
};

const formatTimestamp = (ts?: number) => {
  if (typeof ts !== 'number') return '-';
  return new Date(ts).toLocaleString();
};

// Render chat messages as left/right-aligned bubbles. No outer chrome,
// no per-message borders — just stacked bubbles in a column.
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

type InputsOutputsRenderMode = 'default' | 'chat';

export const NewTraceExperienceRightPane = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode } = useModelTraceExplorerViewState();
  const activeSpan = selectedNode;

  const traceId =
    (modelTraceInfo as { trace_id?: string } | undefined)?.trace_id ??
    (modelTraceInfo as { request_id?: string } | undefined)?.request_id ??
    '';

  const inputList = useMemo(() => createListFromObject(activeSpan?.inputs), [activeSpan]);
  const outputList = useMemo(() => createListFromObject(activeSpan?.outputs), [activeSpan]);
  const hasInputsOrOutputs = inputList.length > 0 || outputList.length > 0;
  const hasAttributes = keys(activeSpan?.attributes).length > 0;
  const hasEvents = Array.isArray(activeSpan?.events) && (activeSpan?.events?.length ?? 0) > 0;
  const chatMessages = activeSpan?.chatMessages;
  const hasChat = Array.isArray(chatMessages) && chatMessages.length > 0;

  // Render-mode toggle for the Inputs / Outputs section. "chat" only enabled
  // when the active span has chat messages; defaults to chat when present.
  const [renderMode, setRenderMode] = useState<InputsOutputsRenderMode>('default');
  const effectiveRenderMode: InputsOutputsRenderMode = hasChat ? renderMode : 'default';

  // Default to chat mode when the user lands on a span that has chat messages.
  useMemo(() => {
    setRenderMode(hasChat ? 'chat' : 'default');
  }, [hasChat]);

  // Token usage + cost from the V3 trace metadata, if present.
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

  // Trace-level start time and duration come from modelTraceInfo. V1 stores
  // these as ms numbers (`timestamp_ms`, `execution_time_ms`); V3 stores them
  // as ISO-string + formatted string.
  const infoV1 = modelTraceInfo as
    | { timestamp_ms?: number; execution_time_ms?: number }
    | undefined;
  const infoV3 = modelTraceInfo as ModelTraceInfoV3 | undefined;
  const startTs = infoV1?.timestamp_ms ?? (infoV3?.request_time ? Date.parse(infoV3.request_time) : undefined);
  const durationMs = infoV1?.execution_time_ms;

  const metricsRows: Row[] = [
    { label: <FormattedMessage defaultMessage="Start" description="Metrics label - start time" />, value: formatTimestamp(startTs) },
    {
      label: <FormattedMessage defaultMessage="Duration" description="Metrics label - duration" />,
      value: infoV3?.execution_duration ?? formatDuration(durationMs),
    },
    activeSpan.modelName
      ? { label: <FormattedMessage defaultMessage="Model" description="Metrics label - model name" />, value: activeSpan.modelName }
      : null,
    typeof tokenUsage.total_tokens === 'number'
      ? { label: <FormattedMessage defaultMessage="Total tokens" description="Metrics label - total tokens" />, value: formatNumber(tokenUsage.total_tokens) }
      : null,
    typeof tokenUsage.input_tokens === 'number'
      ? { label: <FormattedMessage defaultMessage="Input tokens" description="Metrics label - input tokens" />, value: formatNumber(tokenUsage.input_tokens) }
      : null,
    typeof tokenUsage.output_tokens === 'number'
      ? { label: <FormattedMessage defaultMessage="Output tokens" description="Metrics label - output tokens" />, value: formatNumber(tokenUsage.output_tokens) }
      : null,
    typeof traceCost.total_cost === 'number'
      ? { label: <FormattedMessage defaultMessage="Cost" description="Metrics label - cost" />, value: formatCost(traceCost.total_cost) }
      : activeSpan.cost?.total_cost !== undefined
        ? { label: <FormattedMessage defaultMessage="Cost" description="Metrics label - cost" />, value: formatCost(activeSpan.cost.total_cost) }
        : null,
    sessionId
      ? { label: <FormattedMessage defaultMessage="Session" description="Metrics label - session" />, value: sessionId }
      : null,
    tagPairs.length > 0
      ? {
          label: <FormattedMessage defaultMessage="Tags" description="Metrics label - tags" />,
          value: (
            <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {tagPairs.map(({ key, value }) => (
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
            </div>
          ),
        }
      : null,
  ].filter(Boolean) as Row[];

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
      <SpanTitleHeader activeSpan={activeSpan} />

      {metricsRows.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Metrics"
              description="Section heading for the metrics card (start, duration, tokens, cost, session, tags) in the new trace experience right pane"
            />
          }
        >
          <MetricsRows rows={metricsRows} />
        </Section>
      )}

      {(hasInputsOrOutputs || hasChat) && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Inputs / Outputs"
              description="Section heading for the inputs+outputs section in the new trace experience right pane"
            />
          }
          actions={
            hasChat ? (
              <SegmentedControlGroup
                componentId="mlflow.new-trace-experience.io.render-mode"
                name="io-render-mode"
                size="small"
                value={effectiveRenderMode}
                onChange={(e) => setRenderMode(e.target.value as InputsOutputsRenderMode)}
              >
                <SegmentedControlButton value="default">
                  <FormattedMessage
                    defaultMessage="Default"
                    description="Render-mode label - default field renderer for the new trace experience Inputs/Outputs section"
                  />
                </SegmentedControlButton>
                <SegmentedControlButton value="chat">
                  <FormattedMessage
                    defaultMessage="Chat"
                    description="Render-mode label - chat-bubble renderer for the new trace experience Inputs/Outputs section"
                  />
                </SegmentedControlButton>
              </SegmentedControlGroup>
            ) : undefined
          }
        >
          {effectiveRenderMode === 'chat' && hasChat ? (
            <ChatBubbles messages={chatMessages ?? []} />
          ) : (
            <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
              {inputList.length > 0 && (
                <div>
                  <Typography.Text bold css={{ marginBottom: theme.spacing.xs, display: 'block' }}>
                    <FormattedMessage defaultMessage="Inputs" description="Sub-heading for inputs in the new trace experience" />
                  </Typography.Text>
                  <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                    {inputList.map(({ key, value }, index) => (
                      <ModelTraceExplorerFieldRenderer
                        key={key || index}
                        title={key}
                        data={value}
                        renderMode="default"
                        assessments={activeSpan?.assessments}
                      />
                    ))}
                  </div>
                </div>
              )}
              {outputList.length > 0 && (
                <div>
                  <Typography.Text bold css={{ marginBottom: theme.spacing.xs, display: 'block' }}>
                    <FormattedMessage defaultMessage="Outputs" description="Sub-heading for outputs in the new trace experience" />
                  </Typography.Text>
                  <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                    {outputList.map(({ key, value }, index) => (
                      <ModelTraceExplorerFieldRenderer
                        key={key || index}
                        title={key}
                        data={value}
                        renderMode="default"
                        assessments={activeSpan?.assessments}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
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
