import { useMemo } from 'react';
import { Modal, Spinner, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

import type { MCPServer } from '../../types';
import { resolveDisplayName } from '../../utils';
import { useLatestMCPServerVersionQuery } from '../../hooks/useMCPServerDetailQuery';
import { getMockEndpointsSnapshot } from '../../hooks/useMockEndpoints';
import { getHiddenOptionKeys } from '../../hooks/useMockConnectVisibility';
import { buildConnectOptions } from './connectOptions';
import { resolveCanonicalOption } from './resolveCanonicalOption';
import { ConnectInstructions } from './ConnectInstructions';

// The quick "Connect" affordance: shows the single recommended way to connect to
// a server's latest version, so a developer can get going without reading the
// full version list or connection catalog.
//
// The content (which runs a data query) only mounts while the modal is open, so
// a closed modal adds no query dependency to its host (e.g. server cards).
export const ConnectModal = ({ server, open, onClose }: { server: MCPServer; open: boolean; onClose: () => void }) => {
  if (!open) {
    return null;
  }
  return <ConnectModalContent server={server} onClose={onClose} />;
};

const ConnectModalContent = ({ server, onClose }: { server: MCPServer; onClose: () => void }) => {
  const { theme } = useDesignSystemTheme();
  const displayName = resolveDisplayName(server);
  const { data: latestVersion, isLoading } = useLatestMCPServerVersionQuery(server.name, true);

  const canonical = useMemo(() => {
    if (!latestVersion) {
      return undefined;
    }
    const serverWithMocks: MCPServer = {
      ...server,
      access_bindings: [...(server.access_bindings ?? []), ...getMockEndpointsSnapshot(server.name)],
    };
    const options = buildConnectOptions({ server: serverWithMocks, version: latestVersion });
    return resolveCanonicalOption(options, getHiddenOptionKeys(server.name));
  }, [server, latestVersion]);

  return (
    <Modal
      componentId="mlflow.mcp_registry.connect.modal"
      title={
        <FormattedMessage
          defaultMessage="Connect to {name}"
          description="Quick connect modal title"
          values={{ name: displayName }}
        />
      }
      visible
      onCancel={onClose}
      footer={null}
    >
      {isLoading ? (
        <div css={{ display: 'flex', justifyContent: 'center', padding: theme.spacing.lg }}>
          <Spinner />
        </div>
      ) : canonical ? (
        <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
          <Typography.Hint>
            {latestVersion?.version && (
              <FormattedMessage
                defaultMessage="{label} · latest version v{version}"
                description="Quick connect modal subtitle naming the recommended option and version"
                values={{ label: canonical.label, version: latestVersion.version }}
              />
            )}
          </Typography.Hint>
          <ConnectInstructions option={canonical} />
        </div>
      ) : (
        <Typography.Text color="secondary">
          <FormattedMessage
            defaultMessage="No connection options are available for this server yet."
            description="Quick connect modal empty state"
          />
        </Typography.Text>
      )}
    </Modal>
  );
};
