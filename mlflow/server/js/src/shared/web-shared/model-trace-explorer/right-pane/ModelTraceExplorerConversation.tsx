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
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusMd,
      }}
    >
      {messages.map((message, index) => (
        <ModelTraceExplorerChatMessage
          css={{
            borderTop: index > 0 ? `1px solid ${theme.colors.border}` : undefined,
            // need to set radius for first and last message, otherwise the border will be cut off
            borderTopLeftRadius: index > 0 ? undefined : theme.borders.borderRadiusMd,
            borderTopRightRadius: index > 0 ? undefined : theme.borders.borderRadiusMd,
            borderBottomLeftRadius: index === messages.length - 1 ? theme.borders.borderRadiusMd : undefined,
            borderBottomRightRadius: index === messages.length - 1 ? theme.borders.borderRadiusMd : undefined,
          }}
          key={index}
          message={message}
        />
      ))}
    </div>
  );
}
