import type { NormalizedTransport } from './connectOptions';

// Copy-pastable setup instructions for a connection option, in the two formats
// most MCP clients accept: the Claude Code CLI command and a .mcp.json config block.
export interface ConnectSnippets {
  claudeCommand: string;
  mcpJson: string;
}

// Placeholder shown in place of a secret the developer must supply themselves.
const placeholder = (name: string) => `<${name}>`;

const buildMcpJson = (serverName: string, config: Record<string, unknown>): string =>
  JSON.stringify({ mcpServers: { [serverName]: config } }, null, 2);

export const buildHostedSnippets = ({
  serverName,
  url,
  transport,
  headerNames,
}: {
  serverName: string;
  url: string;
  transport: Exclude<NormalizedTransport, 'stdio'>;
  headerNames: string[];
}): ConnectSnippets => {
  const commandLines = [`claude mcp add --transport ${transport} ${serverName} ${url}`];
  for (const name of headerNames) {
    commandLines.push(`  --header "${name}: ${placeholder(name)}"`);
  }

  const config = {
    type: transport,
    url,
    ...(headerNames.length > 0
      ? { headers: Object.fromEntries(headerNames.map((name) => [name, placeholder(name)])) }
      : {}),
  };

  return {
    claudeCommand: commandLines.join(' \\\n'),
    mcpJson: buildMcpJson(serverName, config),
  };
};

const packageRunner = (
  registryType: string,
  identifier: string,
  version?: string,
): { command: string; args: string[] } => {
  const pinned = version ? `${identifier}@${version}` : identifier;
  switch (registryType) {
    case 'pypi':
      return { command: 'uvx', args: [version ? `${identifier}==${version}` : identifier] };
    case 'oci':
    case 'docker':
      return { command: 'docker', args: ['run', '-i', '--rm', identifier] };
    default:
      // npm and anything else defaults to npx.
      return { command: 'npx', args: ['-y', pinned] };
  }
};

export const buildPackageSnippets = ({
  serverName,
  registryType,
  identifier,
  version,
  envNames,
}: {
  serverName: string;
  registryType: string;
  identifier: string;
  version?: string;
  envNames: string[];
}): ConnectSnippets => {
  const { command, args } = packageRunner(registryType, identifier, version);

  const commandLines = [`claude mcp add ${serverName}`];
  for (const name of envNames) {
    commandLines.push(`  --env ${name}=${placeholder(name)}`);
  }
  commandLines.push(`  -- ${command} ${args.join(' ')}`);

  const config = {
    command,
    args,
    ...(envNames.length > 0
      ? { env: Object.fromEntries(envNames.map((name) => [name, placeholder(name)])) }
      : {}),
  };

  return {
    claudeCommand: commandLines.join(' \\\n'),
    mcpJson: buildMcpJson(serverName, config),
  };
};
