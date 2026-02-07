import { SparkleIcon, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { GenAIMarkdownRenderer } from '../../../../shared/web-shared/genai-markdown-renderer';
import type { ChatMessage } from '../types';
import type { ToolUseInfo } from '../../../../assistant/types';

const PULSE_ANIMATION = {
  '0%, 100%': { transform: 'scale(1)' },
  '50%': { transform: 'scale(1.3)' },
};

const DOTS_ANIMATION = {
  '0%': { content: '""' },
  '33%': { content: '"."' },
  '66%': { content: '".."' },
  '100%': { content: '"..."' },
};

interface MessageBubbleProps {
  message: ChatMessage;
  activeTools?: ToolUseInfo[];
}

export const MessageBubble = ({ message, activeTools }: MessageBubbleProps) => {
  const { theme } = useDesignSystemTheme();
  const isUser = message.role === 'user';

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        css={{
          maxWidth: isUser ? '85%' : '100%',
          padding: theme.spacing.md,
          borderRadius: theme.borders.borderRadiusLg,
          backgroundColor: isUser ? theme.colors.backgroundSecondary : 'transparent',
          color: theme.colors.textPrimary,
          border: 'none',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {isUser ? (
          <Typography.Text css={{ whiteSpace: 'pre-wrap' }}>{message.content}</Typography.Text>
        ) : (
          <GenAIMarkdownRenderer>{message.content}</GenAIMarkdownRenderer>
        )}
        {/* Loading indicator — same pattern as AssistantChatPanel */}
        {message.isStreaming && (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              marginTop: theme.spacing.sm,
            }}
          >
            <SparkleIcon
              color="ai"
              css={{
                fontSize: 16,
                animation: 'pulse 1.5s ease-in-out infinite',
                '@keyframes pulse': PULSE_ANIMATION,
              }}
            />
            <span
              css={{
                fontSize: theme.typography.fontSizeBase,
                color: theme.colors.textSecondary,
                '&::after': {
                  content: '"..."',
                  animation: 'dots 1.5s steps(3, end) infinite',
                  display: 'inline-block',
                  width: '1.2em',
                },
                '@keyframes dots': DOTS_ANIMATION,
              }}
            >
              {activeTools && activeTools.length > 0 && activeTools[0].description
                ? `Tool: ${activeTools[0].description}`
                : 'Processing'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
