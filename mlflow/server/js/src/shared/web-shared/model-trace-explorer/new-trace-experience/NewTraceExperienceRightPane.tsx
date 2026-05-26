import { keys } from 'lodash';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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
  ModelTrace,
  ModelTraceChatMessage,
  ModelTraceInfoV3,
  ModelTraceSpanNode,
} from '../ModelTrace.types';
import {
  createListFromObject,
  getIconTypeForSpan,
  getTraceCost,
  getTraceTokenUsage,
} from '../ModelTraceExplorer.utils';
import { ModelTraceExplorerIcon } from '../ModelTraceExplorerIcon';
import { useModelTraceExplorerViewState } from '../ModelTraceExplorerViewStateContext';
import { AssessmentsPane } from '../assessments-pane/AssessmentsPane';
import { ModelTraceExplorerFieldRenderer } from '../field-renderers/ModelTraceExplorerFieldRenderer';
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
const SpanTitleHeader = ({ activeSpan }: { activeSpan: ModelTraceSpanNode }) => {
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
      <ModelTraceExplorerIcon type={getIconTypeForSpan(activeSpan.type ?? '')} />
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

type InputsOutputsRenderMode = 'default' | 'chat';

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
    default: intl.formatMessage({
      defaultMessage: 'Default',
      description: 'Default render-mode label for the Inputs/Outputs section in the new trace experience',
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
          componentId="mlflow.new-trace-experience.io.render-mode.default"
          onClick={() => onChange('default')}
        >
          {labels.default}
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

export const NewTraceExperienceRightPane = ({ modelTraceInfo }: Props) => {
  const { theme } = useDesignSystemTheme();
  const { selectedNode, rootNode } = useModelTraceExplorerViewState();
  const activeSpan = selectedNode;
  const isRootSpan = Boolean(rootNode && activeSpan && rootNode.key === activeSpan.key);

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

  const [renderMode, setRenderMode] = useState<InputsOutputsRenderMode>('default');
  const effectiveRenderMode: InputsOutputsRenderMode = hasChat ? renderMode : 'default';
  useMemo(() => {
    setRenderMode(hasChat ? 'chat' : 'default');
  }, [hasChat]);

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

  const cost = typeof traceCost.total_cost === 'number' ? traceCost.total_cost : activeSpan.cost?.total_cost;

  const infoRows: Row[] = [];

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
  if (typeof cost === 'number') {
    infoRows.push({
      label: <FormattedMessage defaultMessage="Cost" description="Info label - cost" />,
      value: formatCost(cost),
    });
  }
  // Trace-level rows only on the root span.
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
      <SpanTitleHeader activeSpan={activeSpan} />

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
              <RenderModeMenu value={effectiveRenderMode} onChange={setRenderMode} hasChat={hasChat} />
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
