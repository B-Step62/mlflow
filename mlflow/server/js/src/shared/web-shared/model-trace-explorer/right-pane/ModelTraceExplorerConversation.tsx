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
      {messages.map((message, index) => {
        const isUserMessage = message.role === 'user';

        return (
          <div
            key={index}
            css={{
              paddingLeft: isUserMessage ? theme.spacing.md : 0,
              paddingRight: isUserMessage ? 0 : theme.spacing.md,
            }}
          >
            <ModelTraceExplorerChatMessage message={message} />
          </div>
        );
      })}
    </div>
  );
}
