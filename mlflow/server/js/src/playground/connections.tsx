/**
 * Agent connection registry — frontend client + UI primitives (Epic 8).
 *
 * Backed by /ajax-api/3.0/mlflow/playground/agent-connections/* (YUK-47).
 * The registry is in-memory on the playground server: workers
 * (`mlflow agent connect ...`) self-register, and the playground polls
 * `/health` to drop dead connections. The picker rendered from this module
 * is the source of truth for "which agent does the chat hit right now".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  CheckCircleIcon,
  CircleOffIcon,
  CircleOutlineIcon,
  DropdownMenu,
  LoopIcon,
  Tag,
  Typography,
  useDesignSystemTheme,
} from '@databricks/design-system';

import {
  getAjaxUrl,
  getDefaultHeaders,
} from '../shared/web-shared/model-trace-explorer/ModelTraceExplorer.request.utils';

export type ConnectionStatus = 'pending' | 'ready' | 'failed' | 'dead';

export type AgentConnection = {
  connection_id: string;
  name: string;
  agent_url: string;
  repo_dir: string | null;
  source_issue_id: string | null;
  branch: string | null;
  base_commit: string | null;
  status: ConnectionStatus;
  status_message: string | null;
  created_at_ms: number;
};

export type ConnectionList = {
  connections: AgentConnection[];
  active_connection_id: string | null;
};

const CONN_BASE = 'ajax-api/3.0/mlflow/playground/agent-connections';

export const fetchConnections = async (): Promise<ConnectionList> => {
  const response = await fetch(getAjaxUrl(CONN_BASE), {
    headers: getDefaultHeaders(document.cookie),
  });
  if (!response.ok) {
    throw new Error(`Failed to list connections (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as ConnectionList;
};

export const activateConnection = async (connectionId: string): Promise<AgentConnection> => {
  const response = await fetch(
    getAjaxUrl(`${CONN_BASE}/${encodeURIComponent(connectionId)}/activate`),
    {
      method: 'POST',
      headers: getDefaultHeaders(document.cookie),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to activate connection (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as AgentConnection;
};

const STATUS_TONE: Record<ConnectionStatus, { label: string; color: 'lime' | 'lemon' | 'coral' | 'default' }> = {
  ready: { label: 'ready', color: 'lime' },
  pending: { label: 'pending', color: 'lemon' },
  failed: { label: 'failed', color: 'coral' },
  dead: { label: 'dead', color: 'default' },
};

// Icon components are `ForwardRefExoticComponent<IconProps>`; let TS infer
// the record value type so the strict prop shape doesn't get widened to
// something incompatible (matches the COLUMN_ICON pattern in issues-board).
const STATUS_ICON = {
  ready: CheckCircleIcon,
  pending: LoopIcon,
  failed: CircleOffIcon,
  dead: CircleOutlineIcon,
} satisfies Record<ConnectionStatus, unknown>;

export const ConnectionPicker = ({
  connections,
  activeConnectionId,
  onActivate,
}: {
  connections: AgentConnection[];
  activeConnectionId: string | null;
  onActivate: (connectionId: string) => void;
}) => {
  const { theme } = useDesignSystemTheme();
  const active = connections.find((c) => c.connection_id === activeConnectionId) ?? null;
  const Tone = active ? STATUS_TONE[active.status] : STATUS_TONE.dead;
  const ActiveIcon = active ? STATUS_ICON[active.status] : CircleOutlineIcon;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button componentId="mlflow.playground.connection-picker.trigger" size="small">
          <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}>
            <ActiveIcon />
            <Typography.Text size="sm" css={{ fontWeight: 600 }}>
              {active ? `Agent: ${active.name}` : 'No agent connected'}
            </Typography.Text>
            {active && (
              <Tag componentId="mlflow.playground.connection-picker.status" color={Tone.color}>
                {Tone.label}
              </Tag>
            )}
          </span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {connections.length === 0 ? (
          <DropdownMenu.Item componentId="mlflow.playground.connection-picker.empty" disabled>
            No connections registered.
          </DropdownMenu.Item>
        ) : (
          connections.map((connection) => {
            const Icon = STATUS_ICON[connection.status];
            const tone = STATUS_TONE[connection.status];
            const isActive = connection.connection_id === activeConnectionId;
            return (
              <DropdownMenu.Item
                key={connection.connection_id}
                componentId={`mlflow.playground.connection-picker.item-${connection.connection_id}`}
                onClick={() => !isActive && onActivate(connection.connection_id)}
                disabled={connection.status !== 'ready' && connection.status !== 'pending'}
              >
                <span css={{ display: 'inline-flex', alignItems: 'center', gap: theme.spacing.xs }}>
                  <Icon />
                  <span css={{ fontWeight: isActive ? 700 : 400 }}>{connection.name}</span>
                  <Tag
                    componentId={`mlflow.playground.connection-picker.status-${connection.connection_id}`}
                    color={tone.color}
                  >
                    {tone.label}
                  </Tag>
                  {isActive && (
                    <Typography.Text size="sm" color="secondary">
                      (active)
                    </Typography.Text>
                  )}
                </span>
              </DropdownMenu.Item>
            );
          })
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
};

/**
 * Hook that polls the connection registry and exposes activate+refresh.
 *
 * Polling at 3s is brisk enough to surface a worker becoming `ready` while
 * the user is on the page; cheap because the endpoint is in-memory and
 * lock-free under read.
 */
export const useConnections = (
  pollIntervalMs = 3000,
): {
  connections: AgentConnection[];
  activeConnectionId: string | null;
  loading: boolean;
  error: string | null;
  activate: (connectionId: string) => Promise<void>;
  refresh: () => Promise<void>;
} => {
  const [state, setState] = useState<ConnectionList>({ connections: [], active_connection_id: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchConnections();
      if (!cancelledRef.current) {
        setState(data);
        setError(null);
      }
    } catch (e) {
      if (!cancelledRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  const activate = useCallback(
    async (connectionId: string) => {
      await activateConnection(connectionId);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [pollIntervalMs, refresh]);

  return useMemo(
    () => ({
      connections: state.connections,
      activeConnectionId: state.active_connection_id,
      loading,
      error,
      activate,
      refresh,
    }),
    [state.connections, state.active_connection_id, loading, error, activate, refresh],
  );
};
