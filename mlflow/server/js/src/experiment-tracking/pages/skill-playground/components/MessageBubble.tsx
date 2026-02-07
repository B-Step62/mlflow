import { Typography, useDesignSystemTheme } from '@databricks/design-system';
import type { ChatMessage } from '../types';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = ({ message }: MessageBubbleProps) => {
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
          <div
            css={{
              fontSize: theme.typography.fontSizeBase,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              '& code': {
                backgroundColor: theme.colors.backgroundSecondary,
                padding: `${theme.spacing.xs / 2}px ${theme.spacing.xs}px`,
                borderRadius: theme.borders.borderRadiusSm,
                fontFamily: 'monospace',
                fontSize: '0.9em',
              },
              '& pre': {
                backgroundColor: theme.colors.backgroundSecondary,
                padding: theme.spacing.md,
                borderRadius: theme.borders.borderRadiusMd,
                overflow: 'auto',
                margin: `${theme.spacing.sm}px 0`,
              },
              '& pre code': {
                backgroundColor: 'transparent',
                padding: 0,
              },
            }}
            dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
          />
        )}
        {message.isStreaming && (
          <span
            css={{
              display: 'inline-block',
              width: 8,
              height: 16,
              backgroundColor: theme.colors.textPrimary,
              marginLeft: theme.spacing.xs,
              animation: 'blink 1s step-end infinite',
              '@keyframes blink': {
                '50%': { opacity: 0 },
              },
            }}
          />
        )}
      </div>
    </div>
  );
};

// Simple markdown-like formatting (just bold, code, and code blocks)
function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
