import { useState } from 'react';
import {
  CopyIcon,
  SegmentedControlButton,
  SegmentedControlGroup,
  Tag,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import type { RadioChangeEvent } from '@databricks/design-system';
import { CodeSnippet } from '@databricks/web-shared/snippet';
import { FormattedMessage } from 'react-intl';

import type { ConnectOption } from './connectOptions';
import { CopyButton } from '../../../shared/building_blocks/CopyButton';

type SnippetFormat = 'cli' | 'json';

// Copy-pastable setup instructions for a single connection option, with a toggle
// between the Claude Code CLI command and a .mcp.json config block.
export const ConnectInstructions = ({ option }: { option: ConnectOption }) => {
  const { theme } = useDesignSystemTheme();
  const [format, setFormat] = useState<SnippetFormat>('cli');

  const code = format === 'cli' ? option.snippets.claudeCommand : option.snippets.mcpJson;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
      <SegmentedControlGroup
        name="mcp-registry-connect-format"
        value={format}
        onChange={(e: RadioChangeEvent) => setFormat(e.target.value as SnippetFormat)}
        componentId="mlflow.mcp_registry.connect.instructions.format"
        size="small"
      >
        <SegmentedControlButton value="cli">
          <FormattedMessage defaultMessage="Claude Code" description="MCP connect instructions CLI format tab" />
        </SegmentedControlButton>
        <SegmentedControlButton value="json">
          <FormattedMessage defaultMessage=".mcp.json" description="MCP connect instructions JSON config format tab" />
        </SegmentedControlButton>
      </SegmentedControlGroup>

      <div
        css={{
          position: 'relative',
          borderRadius: theme.borders.borderRadiusMd,
          overflow: 'hidden',
          border: `1px solid ${theme.colors.border}`,
        }}
      >
        <CopyButton
          componentId="mlflow.mcp_registry.connect.instructions.copy"
          css={{ zIndex: 1, position: 'absolute', top: theme.spacing.xs, right: theme.spacing.xs }}
          showLabel={false}
          copyText={code}
          icon={<CopyIcon />}
        />
        <CodeSnippet
          language={format === 'cli' ? 'text' : 'json'}
          theme={theme.isDarkMode ? 'duotoneDark' : 'light'}
          style={{ fontSize: 12, padding: theme.spacing.md, overflow: 'auto' }}
        >
          {code}
        </CodeSnippet>
      </div>

      {option.envVars.length > 0 && (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
          <Typography.Hint>
            <FormattedMessage
              defaultMessage="Replace the placeholder values with your own credentials:"
              description="Hint prompting the developer to fill in credential placeholders"
            />
          </Typography.Hint>
          <div css={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {option.envVars.map((envVar) => (
              <div key={envVar.name} css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
                <Typography.Text css={{ fontFamily: 'monospace' }} size="sm">
                  {envVar.name}
                </Typography.Text>
                {envVar.isRequired && (
                  <Tag componentId="mlflow.mcp_registry.connect.env_required" color="lemon">
                    <FormattedMessage defaultMessage="required" description="Required credential badge" />
                  </Tag>
                )}
                {envVar.isSecret && (
                  <Tag componentId="mlflow.mcp_registry.connect.env_secret" color="coral">
                    <FormattedMessage defaultMessage="secret" description="Secret credential badge" />
                  </Tag>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
