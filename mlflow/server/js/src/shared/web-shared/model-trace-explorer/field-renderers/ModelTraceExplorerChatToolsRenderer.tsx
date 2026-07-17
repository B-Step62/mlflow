import { Typography, useDesignSystemTheme } from '@databricks/design-system';

import type { ModelTraceChatTool } from '../ModelTrace.types';
import { ModelTraceExplorerChatTool } from '../right-pane/ModelTraceExplorerChatTool';

export const ModelTraceExplorerChatToolsRenderer = ({
  title,
  titleSuffix,
  tools,
}: {
  title: string;
  titleSuffix?: React.ReactNode;
  tools: ModelTraceChatTool[];
}) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.borders.borderRadiusSm,
      }}
    >
      {(title || titleSuffix) && (
        <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {title && (
            <Typography.Text css={{ marginLeft: theme.spacing.xs }} bold>
              {title}
            </Typography.Text>
          )}
          {titleSuffix}
        </div>
      )}
      {tools.map((tool) => (
        <ModelTraceExplorerChatTool key={tool.function.name} tool={tool} />
      ))}
    </div>
  );
};
