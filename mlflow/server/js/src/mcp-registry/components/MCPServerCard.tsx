import { useState } from 'react';
import { Button, Card, ConnectIcon, Tooltip, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import type { MCPServer } from '../types';
import MCPRegistryRoutes from '../routes';
import { textClampStyles, textEllipsisStyles, cardBodyStyles, cardHeaderRowStyles } from '../styles';
import { MCPServerIcon } from './MCPServerIcon';
import { MCPServerTags } from './MCPServerTags';
import { ConnectModal } from './connect/ConnectModal';
import Utils from '../../common/utils/Utils';

export const MCPServerCard = ({ server, dimmed }: { server: MCPServer; dimmed?: boolean }) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [connectOpen, setConnectOpen] = useState(false);

  const timestamp = server.last_updated_timestamp
    ? Utils.formatTimestamp(server.last_updated_timestamp, intl)
    : undefined;

  return (
    <Card
      componentId="mlflow.mcp_registry.card"
      width="100%"
      href={`#${MCPRegistryRoutes.getMCPServerDetailRoute(server.name)}`}
      dangerouslyAppendEmotionCSS={{ height: '100%', opacity: dimmed ? 0.5 : 1 }}
    >
      <div css={cardBodyStyles(theme)}>
        <div css={cardHeaderRowStyles(theme)}>
          <MCPServerIcon icons={server.icons} name={server.name} />
          <Typography.Text bold css={{ ...textEllipsisStyles, flex: 1 }}>
            {server.name}
          </Typography.Text>
          {server.latest_version && (
            <Typography.Text color="secondary" size="sm" css={{ flexShrink: 0 }}>
              v{server.latest_version}
            </Typography.Text>
          )}
        </div>
        {server.description && (
          <Typography.Text color="secondary" size="sm" css={textClampStyles(2)}>
            {server.description}
          </Typography.Text>
        )}
        {Object.keys(server.tags || {}).length > 0 && <MCPServerTags tags={server.tags || {}} />}
        <div css={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
          {timestamp ? (
            <Typography.Text color="secondary" size="sm">
              {timestamp}
            </Typography.Text>
          ) : (
            <span />
          )}
          <Tooltip
            componentId="mlflow.mcp_registry.card.connect.tooltip"
            content={<FormattedMessage defaultMessage="Connect" description="MCP server card connect button" />}
          >
            <Button
              componentId="mlflow.mcp_registry.card.connect"
              size="small"
              type="tertiary"
              icon={<ConnectIcon />}
              aria-label={intl.formatMessage({
                defaultMessage: 'Connect',
                description: 'MCP server card connect button',
              })}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConnectOpen(true);
              }}
            />
          </Tooltip>
        </div>
      </div>
      <ConnectModal server={server} open={connectOpen} onClose={() => setConnectOpen(false)} />
    </Card>
  );
};
