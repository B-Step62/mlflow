import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, InfoIcon, PlusIcon, Tooltip, Typography, useDesignSystemTheme } from '@databricks/design-system';
import { FormattedMessage } from 'react-intl';

import type { MCPServer, MCPServerVersion } from '../../types';
import { useMockEndpoints } from '../../hooks/useMockEndpoints';
import { useMockConnectVisibility } from '../../hooks/useMockConnectVisibility';
import { buildConnectOptions } from './connectOptions';
import type { ConnectOption } from './connectOptions';
import { ConnectOptionRow } from './ConnectOptionRow';
import { AddEndpointModal } from './AddEndpointModal';
import { RawJSONToggle } from '../ServerJSONSection';

// A quiet section header: a label plus a help icon whose tooltip carries the
// explanation, keeping the group list compact.
const SectionHeading = ({ title, help, action }: { title: ReactNode; help: ReactNode; action?: ReactNode }) => {
  const { theme } = useDesignSystemTheme();
  return (
    <div
      css={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.xs,
      }}
    >
      <div css={{ display: 'flex', alignItems: 'center', gap: theme.spacing.xs }}>
        <Typography.Text bold>{title}</Typography.Text>
        <Tooltip componentId="mlflow.mcp_registry.connect.section_help" content={help}>
          <span css={{ display: 'inline-flex', color: theme.colors.textSecondary, cursor: 'help' }}>
            <InfoIcon />
          </span>
        </Tooltip>
      </div>
      {action}
    </div>
  );
};

// The "Connect" surface: every way to reach a server version, grouped by source.
// Custom (org-approved) endpoints, the publisher's official remotes, and local
// packages each get their own section so the two hosted sources stay distinct.
// Developers get a read-only consumption view; admins additionally get the
// "Add endpoint" action and the raw server.json toggle.
export const ConnectTab = ({
  server,
  version,
  isAdmin,
}: {
  server: MCPServer;
  version: MCPServerVersion;
  isAdmin: boolean;
}) => {
  const { theme } = useDesignSystemTheme();
  const [mockEndpoints, addEndpoint] = useMockEndpoints(server.name);
  const [hiddenKeys, toggleVisibility] = useMockConnectVisibility(server.name);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const options = useMemo(() => {
    const serverWithMocks: MCPServer = {
      ...server,
      access_bindings: [...(server.access_bindings ?? []), ...mockEndpoints],
    };
    return buildConnectOptions({ server: serverWithMocks, version });
  }, [server, version, mockEndpoints]);

  // Admins see every option (hidden ones dimmed, with a switch); developers see
  // only the options an admin has left visible.
  const visibleOptions = isAdmin ? options : options.filter((o) => !hiddenKeys.includes(o.key));
  const customEndpoints = visibleOptions.filter((o) => o.kind === 'endpoint');
  const officialRemotes = visibleOptions.filter((o) => o.kind === 'remote');
  const packages = visibleOptions.filter((o) => o.kind === 'package');

  const renderRows = (rows: ConnectOption[]) => (
    <div
      css={{
        border: `1px solid ${theme.colors.borderDecorative}`,
        borderRadius: theme.borders.borderRadiusMd,
        overflow: 'hidden',
      }}
    >
      {rows.map((option, index) => (
        <ConnectOptionRow
          key={option.key}
          option={option}
          expanded={expandedKey === option.key}
          onToggle={() => setExpandedKey(expandedKey === option.key ? null : option.key)}
          isAdmin={isAdmin}
          hidden={hiddenKeys.includes(option.key)}
          onToggleVisibility={() => toggleVisibility(option.key)}
          showTopBorder={index > 0}
        />
      ))}
    </div>
  );

  const nothingToShow = visibleOptions.length === 0;

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.lg }}>
      {/* Custom endpoints: approved for this workspace. For admins this is
          always shown so the "Add endpoint" affordance is available even before
          any exist; developers only see it when endpoints exist. */}
      {(isAdmin || customEndpoints.length > 0) && (
        <div>
          <SectionHeading
            title={
              <FormattedMessage defaultMessage="Custom endpoints" description="Connect tab custom endpoints group heading" />
            }
            help={
              <FormattedMessage
                defaultMessage="Endpoints approved for your workspace"
                description="Connect tab custom endpoints group description"
              />
            }
            action={
              isAdmin && (
                <Button
                  componentId="mlflow.mcp_registry.connect.add_endpoint"
                  icon={<PlusIcon />}
                  onClick={() => setAddOpen(true)}
                >
                  <FormattedMessage defaultMessage="Add endpoint" description="Add custom endpoint button" />
                </Button>
              )
            }
          />
          {customEndpoints.length > 0 ? (
            renderRows(customEndpoints)
          ) : (
            <Typography.Hint>
              <FormattedMessage
                defaultMessage="No custom endpoints yet."
                description="Empty state for the custom endpoints group"
              />
            </Typography.Hint>
          )}
        </div>
      )}

      {officialRemotes.length > 0 && (
        <div>
          <SectionHeading
            title={
              <FormattedMessage
                defaultMessage="Official endpoints"
                description="Connect tab official remotes group heading"
              />
            }
            help={
              <FormattedMessage
                defaultMessage="Remote endpoints published by the maintainer in server.json"
                description="Connect tab official remotes group description"
              />
            }
          />
          {renderRows(officialRemotes)}
        </div>
      )}

      {packages.length > 0 && (
        <div>
          <SectionHeading
            title={<FormattedMessage defaultMessage="Run locally" description="Connect tab local packages group heading" />}
            help={
              <FormattedMessage
                defaultMessage="Launch the server on your own machine"
                description="Connect tab local packages group description"
              />
            }
          />
          {renderRows(packages)}
        </div>
      )}

      {nothingToShow && (
        <Typography.Hint>
          <FormattedMessage
            defaultMessage="No connection options are available for this version."
            description="Empty state when a version has no connection options"
          />
        </Typography.Hint>
      )}

      {isAdmin && version.server_json && <RawJSONToggle serverJson={version.server_json} />}

      {isAdmin && (
        <AddEndpointModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={addEndpoint} server={server} />
      )}
    </div>
  );
};
