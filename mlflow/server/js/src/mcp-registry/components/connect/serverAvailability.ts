import type { MCPServer } from '../../types';
import { getHiddenOptionKeys } from '../../hooks/useMockConnectVisibility';
import { getMockEndpointsSnapshot } from '../../hooks/useMockEndpoints';

// MOCKUP: a server is "available" to a developer when it exposes at least one
// custom endpoint (access binding) that an admin has not disabled. This mirrors
// the RFC's notion that a server appears in direct-access discovery only when it
// has an approved access binding.
export const isServerAvailable = (server: MCPServer): boolean => {
  const hidden = getHiddenOptionKeys(server.name);
  const bindings = [...(server.access_bindings ?? []), ...getMockEndpointsSnapshot(server.name)];
  return bindings.some((binding) => !hidden.includes(`binding:${binding.binding_id}`));
};
