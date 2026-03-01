import { Tooltip, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { ModelTraceExplorerChatTool } from './ModelTraceExplorerChatTool';
import { ModelTraceExplorerContextBreakdown } from './ModelTraceExplorerContextBreakdown';
import { ModelTraceExplorerConversation } from './ModelTraceExplorerConversation';
import type { ModelTraceChatMessage, ModelTraceChatTool } from '../ModelTrace.types';
import { ModelTraceExplorerCollapsibleSection } from '../ModelTraceExplorerCollapsibleSection';

export function ModelTraceExplorerChatTab({
  chatMessages,
  chatTools,
  inputTokens,
  maxInputTokens,
}: {
  chatMessages: ModelTraceChatMessage[];
  chatTools?: ModelTraceChatTool[];
  inputTokens?: number;
  maxInputTokens?: number;
}) {
  const { theme } = useDesignSystemTheme();

  return (
    <div
      css={{
        overflowY: 'auto',
        padding: theme.spacing.md,
      }}
      data-testid="model-trace-explorer-chat-tab"
    >
      <ModelTraceExplorerCollapsibleSection
        css={{ marginBottom: theme.spacing.sm }}
        title={
          <Tooltip
            componentId="shared.model-trace-explorer.context-breakdown-title-tooltip"
            content="Approximate breakdown of the input context by source (system prompt, user messages, tool results, etc.). Token counts are estimated based on character length when usage data is unavailable."
          >
            <span>
              <FormattedMessage
                defaultMessage="Context breakdown"
                description="Section header in the chat tab that displays a breakdown of the input context by source (system prompt, user message, tool results, etc.)"
              />
            </span>
          </Tooltip>
        }
        sectionKey="context-breakdown"
        defaultExpanded={false}
        previewContent={
          <ModelTraceExplorerContextBreakdown
            chatMessages={chatMessages}
            chatTools={chatTools}
            inputTokens={inputTokens}
            maxInputTokens={maxInputTokens}
            barOnly
          />
        }
      >
        <ModelTraceExplorerContextBreakdown
          chatMessages={chatMessages}
          chatTools={chatTools}
          inputTokens={inputTokens}
          maxInputTokens={maxInputTokens}
        />
      </ModelTraceExplorerCollapsibleSection>

      {chatTools && (
        <ModelTraceExplorerCollapsibleSection
          css={{ marginBottom: theme.spacing.sm }}
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
      >
        <ModelTraceExplorerConversation messages={chatMessages} />
      </ModelTraceExplorerCollapsibleSection>
    </div>
  );
}
