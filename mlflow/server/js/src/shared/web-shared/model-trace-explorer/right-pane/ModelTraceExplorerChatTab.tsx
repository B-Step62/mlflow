import { useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { ModelTraceExplorerChatTool } from './ModelTraceExplorerChatTool';
import { ModelTraceExplorerConversation } from './ModelTraceExplorerConversation';
import type { ModelTraceSpanNode } from '../ModelTrace.types';
import { ModelTraceExplorerCollapsibleSection } from '../ModelTraceExplorerCollapsibleSection';

export function ModelTraceExplorerChatTab({ activeSpan }: { activeSpan: ModelTraceSpanNode }) {
  const { theme } = useDesignSystemTheme();
  const { chatMessages, chatTools } = activeSpan;

  return (
    <div
      css={{
        overflowY: 'auto',
        paddingLeft: theme.spacing.md + theme.spacing.xs,
        paddingRight: theme.spacing.md + theme.spacing.xs,
        paddingTop: theme.spacing.sm,
      }}
      data-testid="model-trace-explorer-chat-tab"
    >
      {chatTools && (
        <ModelTraceExplorerCollapsibleSection
          withBorder
          css={{ marginBottom: theme.spacing.sm }}
          headerPadding={`${theme.spacing.xs}px 0`}
          contentPadding={`${theme.spacing.xs}px 0 ${theme.spacing.xs}px ${theme.spacing.sm + theme.spacing.xs}px`}
          title={
            <FormattedMessage
              defaultMessage="Tools"
              description="Section header in the chat tab that displays all tools that were available for the chat model to call during execution"
            />
          }
          sectionKey="messages"
        >
          <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
            {chatTools.map((tool) => (
              <ModelTraceExplorerChatTool key={tool.function.name} tool={tool} />
            ))}
          </div>
        </ModelTraceExplorerCollapsibleSection>
      )}

      <ModelTraceExplorerCollapsibleSection
        title={
          <FormattedMessage
            defaultMessage="Messages"
            description="Section header in the chat tab that displays the message history between the user and the chat model"
          />
        }
        sectionKey="messages"
        withBorder
        headerPadding={`${theme.spacing.xs}px 0`}
        contentPadding={`${theme.spacing.xs}px 0 ${theme.spacing.xs}px ${theme.spacing.sm + theme.spacing.xs}px`}
      >
        <ModelTraceExplorerConversation messages={chatMessages ?? []} />
      </ModelTraceExplorerCollapsibleSection>
    </div>
  );
}
