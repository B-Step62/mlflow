import { useRef, useEffect } from 'react';
import { useDesignSystemTheme, Typography } from '@databricks/design-system';
import { MessageBubble } from './MessageBubble';
import { ToolExecutionSummary } from './ToolExecutionSummary';
import { JudgeScoreBadges } from './JudgeScoreBadges';
import { ViewTraceButton } from './ViewTraceButton';
import type { ChatMessage } from '../types';
import type { ToolUseInfo } from '@mlflow/mlflow/src/assistant/types';

interface ChatHistoryProps {
  messages: ChatMessage[];
  activeTools?: ToolUseInfo[];
  experimentId: string;
}

export const ChatHistory = ({ messages, activeTools, experimentId }: ChatHistoryProps) => {
  const { theme } = useDesignSystemTheme();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div
        css={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.colors.textSecondary,
        }}
      >
        <Typography.Text color="secondary">Send a prompt to get started</Typography.Text>
      </div>
    );
  }

  return (
    <div
      css={{
        flex: 1,
        overflowY: 'auto',
        minHeight: 0,
        minWidth: 0,
        padding: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
      }}
    >
      {messages.map((message) => (
        <div key={message.id} css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <MessageBubble message={message} activeTools={message.isStreaming ? activeTools : undefined} />

          {/* Show tool calls, judge scores, and trace link after assistant messages */}
          {message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0 && (
            <ToolExecutionSummary toolCalls={message.toolCalls} />
          )}
          {message.role === 'assistant' && message.judgeScores && Object.keys(message.judgeScores).length > 0 && (
            <JudgeScoreBadges scores={message.judgeScores} />
          )}
          {message.role === 'assistant' && message.traceId && (
            <ViewTraceButton traceId={message.traceId} experimentId={experimentId} />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};
