import { useState } from 'react';
import {
  Input,
  Modal,
  SimpleSelect,
  SimpleSelectOption,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';
import { FormattedMessage, useIntl } from 'react-intl';

import type { MCPServer, MCPRemoteTransportType } from '../../types';
import type { NewMockEndpoint } from '../../hooks/useMockEndpoints';

// MOCKUP ONLY: collects a hosted endpoint and hands it back to the caller, which
// stores it in localStorage. Intentionally does NOT call the create-binding API
// so the shared demo backend is never mutated mid-presentation.
export const AddEndpointModal = ({
  open,
  onClose,
  onAdd,
  server,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (endpoint: NewMockEndpoint) => void;
  server: MCPServer;
}) => {
  const { theme } = useDesignSystemTheme();
  const intl = useIntl();
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<MCPRemoteTransportType>('streamable-http');
  const [target, setTarget] = useState(server.latest_version ? `version:${server.latest_version}` : 'version:');

  const reset = () => {
    setUrl('');
    setTransport('streamable-http');
    setTarget(server.latest_version ? `version:${server.latest_version}` : 'version:');
  };

  const handleOk = () => {
    const [kind, value] = target.split(/:(.*)/s);
    onAdd({
      endpoint_url: url.trim(),
      transport_type: transport,
      server_alias: kind === 'alias' ? value : undefined,
      server_version: kind === 'version' ? value : undefined,
    });
    reset();
    onClose();
  };

  return (
    <Modal
      componentId="mlflow.mcp_registry.connect.add_endpoint_modal"
      title={<FormattedMessage defaultMessage="Add hosted endpoint" description="Add endpoint modal title" />}
      visible={open}
      destroyOnClose
      okText={<FormattedMessage defaultMessage="Add endpoint" description="Add endpoint confirm button" />}
      okButtonProps={{ disabled: !url.trim() }}
      cancelText={<FormattedMessage defaultMessage="Cancel" description="Cancel button" />}
      onOk={handleOk}
      onCancel={() => {
        reset();
        onClose();
      }}
    >
      <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
        <div>
          <Typography.Text bold css={{ marginBottom: theme.spacing.xs, display: 'block' }}>
            <FormattedMessage defaultMessage="Endpoint URL" description="Endpoint URL field label" />
          </Typography.Text>
          <Input
            componentId="mlflow.mcp_registry.connect.add_endpoint_url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.internal/my-server"
          />
        </div>
        <div>
          <Typography.Text bold css={{ marginBottom: theme.spacing.xs, display: 'block' }}>
            <FormattedMessage defaultMessage="Transport" description="Endpoint transport field label" />
          </Typography.Text>
          <SimpleSelect
            id="mcp-registry-add-endpoint-transport"
            componentId="mlflow.mcp_registry.connect.add_endpoint_transport"
            value={transport}
            onChange={({ target: t }) => setTransport(t.value as MCPRemoteTransportType)}
          >
            <SimpleSelectOption value="streamable-http">streamable-http</SimpleSelectOption>
            <SimpleSelectOption value="sse">sse</SimpleSelectOption>
          </SimpleSelect>
        </div>
        <div>
          <Typography.Text bold css={{ marginBottom: theme.spacing.xs, display: 'block' }}>
            <FormattedMessage defaultMessage="Targets" description="Endpoint target version/alias label" />
          </Typography.Text>
          <SimpleSelect
            id="mcp-registry-add-endpoint-target"
            componentId="mlflow.mcp_registry.connect.add_endpoint_target"
            value={target}
            onChange={({ target: t }) => setTarget(t.value)}
          >
            {server.latest_version && (
              <SimpleSelectOption value={`version:${server.latest_version}`}>
                {intl.formatMessage(
                  {
                    defaultMessage: 'Latest version (v{version})',
                    description: 'Endpoint target option for the latest version',
                  },
                  { version: server.latest_version },
                )}
              </SimpleSelectOption>
            )}
            {server.aliases.map((alias) => (
              <SimpleSelectOption key={alias.alias} value={`alias:${alias.alias}`}>
                {alias.alias}
              </SimpleSelectOption>
            ))}
          </SimpleSelect>
        </div>
      </div>
    </Modal>
  );
};
