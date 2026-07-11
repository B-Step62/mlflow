import type {
  MCPAccessBindingSummary,
  MCPServer,
  MCPServerVersion,
  ServerJSONEnvironmentVariable,
  ServerJSONPackage,
  ServerJSONTransport,
} from '../../types';
import type { ConnectSnippets } from './snippets';
import { buildHostedSnippets, buildPackageSnippets } from './snippets';

export type NormalizedTransport = 'http' | 'sse' | 'stdio';

export type ConnectOptionKind = 'endpoint' | 'remote' | 'package';

// A single way to connect to an MCP server version. Access bindings, server.json
// remotes, and packages each map to this shape. `kind` keeps them groupable so
// the UI can render custom endpoints, official remotes, and local packages in
// separate sections.
export interface ConnectOption {
  // Stable identity used for React keys.
  key: string;
  kind: ConnectOptionKind;
  hosted: boolean;
  // Developer-friendly label, e.g. "Run locally with npx".
  label: string;
  // The URL (hosted) or package identifier (local), shown in monospace.
  detail: string;
  transport: NormalizedTransport;
  // Short tag label, e.g. "http" for hosted or "npx" for a local package.
  badge: string;
  // Short badge context, e.g. an alias/version pin.
  versionLabel?: string;
  // Secrets the developer must supply (headers for hosted, env vars for packages).
  envVars: ServerJSONEnvironmentVariable[];
  snippets: ConnectSnippets;
}

export const sanitizeServerName = (name: string): string => {
  const lastSegment = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  return lastSegment.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
};

const normalizeTransport = (raw: string | undefined): NormalizedTransport => {
  if (!raw) {
    return 'http';
  }
  if (raw.includes('sse')) {
    return 'sse';
  }
  if (raw === 'stdio') {
    return 'stdio';
  }
  return 'http';
};

const packageLabel = (registryType: string): string => {
  switch (registryType) {
    case 'npm':
      return 'Run locally with npx';
    case 'pypi':
      return 'Run locally with uvx';
    case 'oci':
    case 'docker':
      return 'Run with Docker';
    default:
      return 'Run locally';
  }
};

const packageBadge = (registryType: string): string => {
  switch (registryType) {
    case 'npm':
      return 'npx';
    case 'pypi':
      return 'uvx';
    case 'oci':
    case 'docker':
      return 'docker';
    default:
      return 'local';
  }
};

const bindingVersionLabel = (binding: MCPAccessBindingSummary): string | undefined => {
  if (binding.server_alias) {
    return binding.resolved_version
      ? `${binding.server_alias} (v${binding.resolved_version.version})`
      : binding.server_alias;
  }
  return binding.server_version ? `v${binding.server_version}` : undefined;
};

const buildBindingOption = (
  serverName: string,
  binding: MCPAccessBindingSummary,
  remotesByUrl: Map<string, ServerJSONTransport>,
): ConnectOption => {
  const transport = normalizeTransport(binding.transport_type) as Exclude<NormalizedTransport, 'stdio'>;
  // Access binding summaries do not carry headers, so enrich from the matching
  // server.json remote when one exists (keeps auth headers in the snippet).
  const headers = remotesByUrl.get(binding.endpoint_url)?.headers ?? [];
  return {
    key: `binding:${binding.binding_id}`,
    kind: 'endpoint',
    hosted: true,
    label: 'Custom endpoint',
    detail: binding.endpoint_url,
    transport,
    badge: transport,
    versionLabel: bindingVersionLabel(binding),
    envVars: headers,
    snippets: buildHostedSnippets({
      serverName,
      url: binding.endpoint_url,
      transport,
      headerNames: headers.map((h) => h.name),
    }),
  };
};

const buildRemoteOption = (serverName: string, remote: ServerJSONTransport): ConnectOption => {
  const transport = normalizeTransport(remote.type) as Exclude<NormalizedTransport, 'stdio'>;
  const headers = remote.headers ?? [];
  const url = remote.url ?? '';
  return {
    key: `remote:${url}`,
    kind: 'remote',
    hosted: true,
    label: 'Official endpoint',
    detail: url,
    transport,
    badge: transport,
    envVars: headers,
    snippets: buildHostedSnippets({
      serverName,
      url,
      transport,
      headerNames: headers.map((h) => h.name),
    }),
  };
};

const buildPackageOption = (serverName: string, pkg: ServerJSONPackage): ConnectOption => {
  const envVars = pkg.environmentVariables ?? [];
  return {
    key: `pkg:${pkg.registryType}:${pkg.identifier}`,
    kind: 'package',
    hosted: false,
    label: packageLabel(pkg.registryType),
    detail: pkg.identifier,
    transport: normalizeTransport(pkg.transport?.type),
    badge: packageBadge(pkg.registryType),
    versionLabel: pkg.version ? `v${pkg.version}` : undefined,
    envVars,
    snippets: buildPackageSnippets({
      serverName,
      registryType: pkg.registryType,
      identifier: pkg.identifier,
      version: pkg.version,
      envNames: envVars.map((v) => v.name),
    }),
  };
};

export const buildConnectOptions = ({
  server,
  version,
}: {
  server: MCPServer;
  version?: MCPServerVersion;
}): ConnectOption[] => {
  const serverName = sanitizeServerName(server.name);
  const remotes = version?.server_json?.remotes ?? [];
  const packages = version?.server_json?.packages ?? [];

  // Used to enrich a binding's snippet with headers from a same-URL remote,
  // since access binding summaries do not carry header definitions themselves.
  const remotesByUrl = new Map<string, ServerJSONTransport>();
  for (const remote of remotes) {
    if (remote.url) {
      remotesByUrl.set(remote.url, remote);
    }
  }

  const bindings = server.access_bindings ?? [];

  // Custom endpoints (bindings), official remotes, and packages are kept as
  // distinct kinds; the UI renders them in separate sections. No dedup: an
  // approved binding and the publisher's remote are different things even when
  // they point at the same URL.
  return [
    ...bindings.map((binding) => buildBindingOption(serverName, binding, remotesByUrl)),
    ...remotes.map((remote) => buildRemoteOption(serverName, remote)),
    ...packages.map((pkg) => buildPackageOption(serverName, pkg)),
  ];
};
