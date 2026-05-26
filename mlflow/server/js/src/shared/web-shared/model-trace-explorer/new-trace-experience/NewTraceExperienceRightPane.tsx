import { keys } from 'lodash';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ChevronDownIcon, ChevronRightIcon, Empty, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import type { ModelTrace, ModelTraceChatMessage } from '../ModelTrace.types';
import { createListFromObject } from '../ModelTraceExplorer.utils';
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
  children: ReactNode;
};

const Section = ({ title, defaultOpen = true, children }: SectionProps) => {
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.xs,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          cursor: 'pointer',
          color: theme.colors.textPrimary,
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <Typography.Text bold>{title}</Typography.Text>
      </button>
      {open && <div css={{ padding: `0 ${theme.spacing.md}px ${theme.spacing.md}px` }}>{children}</div>}
    </section>
  );
};

// Render chat messages flat (no inner "Tools" / "Messages" headers, no cost
// badge) with a basic chat-bubble visual: bubbles align right for assistant,
// left for user / tool / system. Uses ModelTraceExplorerChatMessage for the
// inner content rendering.
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
              display: 'flex',
              flexDirection: 'column',
              alignItems: isAssistant ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              alignSelf: isAssistant ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              css={{
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.legacyBorders.borderRadiusLg,
                overflow: 'hidden',
                width: '100%',
              }}
            >
              <ModelTraceExplorerChatMessage message={message} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

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
  const hasAttributes = keys(activeSpan?.attributes).length > 0;
  const hasEvents = Array.isArray(activeSpan?.events) && (activeSpan?.events?.length ?? 0) > 0;
  const chatMessages = activeSpan?.chatMessages;
  const hasChat = Array.isArray(chatMessages) && chatMessages.length > 0;

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
      {hasChat && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Chat"
              description="Section heading for the chat (messages) section in the new trace experience right pane"
            />
          }
        >
          <ChatBubbles messages={chatMessages ?? []} />
        </Section>
      )}
      {inputList.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Inputs"
              description="Section heading for the span inputs section in the new trace experience right pane"
            />
          }
        >
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
        </Section>
      )}
      {outputList.length > 0 && (
        <Section
          title={
            <FormattedMessage
              defaultMessage="Outputs"
              description="Section heading for the span outputs section in the new trace experience right pane"
            />
          }
        >
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
