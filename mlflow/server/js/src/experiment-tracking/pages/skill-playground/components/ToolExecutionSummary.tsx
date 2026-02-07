import { Typography, useDesignSystemTheme, CheckCircleIcon, XCircleIcon, Spinner } from '@databricks/design-system';
import type { ToolCall } from '../types';

interface ToolExecutionSummaryProps {
  toolCalls: ToolCall[];
}

export const ToolExecutionSummary = ({ toolCalls }: ToolExecutionSummaryProps) => {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          backgroundColor: theme.colors.backgroundSecondary,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <Typography.Text size="sm" bold>
          Tools executed ({toolCalls.length})
        </Typography.Text>
      </div>
      <div css={{ display: 'flex', flexDirection: 'column' }}>
        {toolCalls.map((toolCall, index) => (
          <div
            key={index}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              borderBottom: index < toolCalls.length - 1 ? `1px solid ${theme.colors.border}` : 'none',
              '&:hover': {
                backgroundColor: theme.colors.backgroundSecondary,
              },
            }}
          >
            {/* Status icon */}
            {toolCall.status === 'success' && (
              <CheckCircleIcon css={{ color: theme.colors.green500, fontSize: 14, flexShrink: 0 }} />
            )}
            {toolCall.status === 'error' && (
              <XCircleIcon css={{ color: theme.colors.red500, fontSize: 14, flexShrink: 0 }} />
            )}
            {toolCall.status === 'running' && <Spinner size="small" />}

            {/* Tool name */}
            <Typography.Text
              size="sm"
              css={{
                fontFamily: 'monospace',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {toolCall.name}
            </Typography.Text>

            {/* Duration */}
            {toolCall.durationMs !== undefined && (
              <Typography.Text size="sm" color="secondary" css={{ flexShrink: 0 }}>
                {toolCall.durationMs >= 1000
                  ? `${(toolCall.durationMs / 1000).toFixed(1)}s`
                  : `${toolCall.durationMs}ms`}
              </Typography.Text>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
