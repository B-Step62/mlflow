import { useCallback } from 'react';
import { getLocalStorageItem, useLocalStorage } from '@databricks/web-shared/hooks';

import type { MCPAccessBindingSummary, MCPRemoteTransportType } from '../types';

// MOCKUP ONLY: custom endpoints an admin "added" during the demo, stored per
// server in localStorage so they survive navigation. A real build would persist
// these server-side as access bindings.

const ENDPOINTS_VERSION = 1;
const endpointsKey = (serverName: string) => `mlflow.mcp_registry.mock_endpoints.${serverName}`;

export interface NewMockEndpoint {
  endpoint_url: string;
  transport_type: MCPRemoteTransportType;
  server_version?: string;
  server_alias?: string;
}

export const useMockEndpoints = (
  serverName: string,
): [MCPAccessBindingSummary[], (endpoint: NewMockEndpoint) => void] => {
  const [endpoints, setEndpoints] = useLocalStorage<MCPAccessBindingSummary[]>({
    key: endpointsKey(serverName),
    version: ENDPOINTS_VERSION,
    initialValue: [],
  });

  const addEndpoint = useCallback(
    (endpoint: NewMockEndpoint) => {
      setEndpoints((current) => [
        ...current,
        {
          binding_id: -Date.now(),
          server_name: serverName,
          endpoint_url: endpoint.endpoint_url,
          transport_type: endpoint.transport_type,
          server_version: endpoint.server_version,
          server_alias: endpoint.server_alias,
        },
      ]);
    },
    [serverName, setEndpoints],
  );

  return [endpoints, addEndpoint];
};

// Non-hook snapshot reader for the quick-connect modal opened from a card.
export const getMockEndpointsSnapshot = (serverName: string): MCPAccessBindingSummary[] =>
  getLocalStorageItem<MCPAccessBindingSummary[]>(endpointsKey(serverName), ENDPOINTS_VERSION, false, []);
