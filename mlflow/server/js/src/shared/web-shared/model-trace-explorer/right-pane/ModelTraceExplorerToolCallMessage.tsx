import { FunctionIcon, Tag, Tooltip, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from '@databricks/i18n';

import { shouldUseNewTraceExperience } from '../FeatureUtils';
import type { ModelTraceToolCall } from '../ModelTrace.types';
import { ModelTraceExplorerCodeSnippetBody } from '../ModelTraceExplorerCodeSnippetBody';
import { PrettyView } from '../new-trace-experience/PrettyView';

// Try to parse a possibly-JSON-string `arguments` payload into a JS value so
// it can be rendered as a Pretty tree. If parsing fails, fall back to the
// raw string.
const parseToolArgs = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export function ModelTraceExplorerToolCallMessage({ toolCall }: { toolCall: ModelTraceToolCall }) {
  const { theme } = useDesignSystemTheme();
  const useNewTraceExperience = shouldUseNewTraceExperience();
  const parsedArgs = useNewTraceExperience ? parseToolArgs(toolCall.function.arguments) : null;

  return (
    <div key={toolCall.id} css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      <Typography.Text
        color="secondary"
        css={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: `0px ${theme.spacing.sm + theme.spacing.xs}px`,
        }}
      >
        <FormattedMessage
          defaultMessage="called {functionName} in {toolCallId}"
          description="A message that shows the tool calls that an AI assistant made. The full message reads (for example): 'Assistant called get_weather in id_123'."
          values={{
            functionName: (
              <Tag
                color="purple"
                componentId="shared.model-trace-explorer.function-name-tag"
                css={{ margin: `0px ${theme.spacing.xs}px` }}
              >
                <FunctionIcon />
                <Typography.Text css={{ whiteSpace: 'nowrap', marginLeft: theme.spacing.xs }}>
                  {toolCall.function.name}
                </Typography.Text>
              </Tag>
            ),
            toolCallId: (
              <Tooltip componentId="shared.model-trace-explorer.tool-call-id-tooltip" content={toolCall.id}>
                <div css={{ display: 'inline-flex', flexShrink: 1, overflow: 'hidden', marginLeft: theme.spacing.xs }}>
                  <Typography.Text
                    css={{
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                    code
                    color="secondary"
                  >
                    {toolCall.id}
                  </Typography.Text>
                </div>
              </Tooltip>
            ),
          }}
        />
      </Typography.Text>
      {useNewTraceExperience ? (
        <div css={{ padding: `0 ${theme.spacing.sm + theme.spacing.xs}px` }}>
          <PrettyView value={parsedArgs} />
        </div>
      ) : (
        <ModelTraceExplorerCodeSnippetBody data={toolCall.function.arguments} />
      )}
    </div>
  );
}
