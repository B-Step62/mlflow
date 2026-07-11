import {
  SegmentedControlButton,
  SegmentedControlGroup,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import type { RadioChangeEvent } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

import type { MockPersona } from '../hooks/useMockPersona';
import { useMockPersona } from '../hooks/useMockPersona';

// MOCKUP ONLY: a low-key prototype control tucked at the bottom of the sidebar.
// Rendered only when the sidebar is expanded (no room when collapsed).
export const MockPersonaSidebarControl = ({ collapsed }: { collapsed: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const [persona, setPersona] = useMockPersona();

  if (collapsed) {
    return null;
  }

  return (
    <div
      css={{
        marginTop: theme.spacing.sm,
        paddingTop: theme.spacing.sm,
        paddingInline: theme.spacing.sm,
        borderTop: `1px solid ${theme.colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.xs,
      }}
    >
      <Typography.Text size="sm" color="secondary">
        <FormattedMessage
          defaultMessage="Preview as"
          description="Label for the MCP registry prototype persona control"
        />
      </Typography.Text>
      <SegmentedControlGroup
        name="mcp-registry-persona"
        value={persona}
        onChange={(e: RadioChangeEvent) => setPersona(e.target.value as MockPersona)}
        componentId="mlflow.mcp_registry.persona_toggle"
        size="small"
      >
        <SegmentedControlButton value="admin">
          <FormattedMessage defaultMessage="Admin" description="Admin persona option" />
        </SegmentedControlButton>
        <SegmentedControlButton value="developer">
          <FormattedMessage defaultMessage="Developer" description="Developer persona option" />
        </SegmentedControlButton>
      </SegmentedControlGroup>
    </div>
  );
};
