import { isNil } from 'lodash';

import { useDesignSystemTheme } from '@databricks/design-system';

import { ModelTraceExplorerChatMessage } from './ModelTraceExplorerChatMessage';
import type { ModelTraceChatMessage } from '../ModelTrace.types';

export function ModelTraceExplorerConversation({ messages }: { messages: ModelTraceChatMessage[] | null }) {
  const { theme } = useDesignSystemTheme();

  if (isNil(messages)) {
    return null;
  }

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
      }}
    >
      {messages.map((message, index) => (
        <ModelTraceExplorerChatMessage
          css={{
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.borders.borderRadiusMd,
          }}
          key={index}
          message={message}
        />
      ))}
    </div>
  );
}
