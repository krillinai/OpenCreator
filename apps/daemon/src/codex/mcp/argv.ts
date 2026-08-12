import type { AddMcpServerInput, NormalizedAddMcpServerInput } from './types.js';

export function buildMcpListArgs(): string[] {
  return ['mcp', 'list', '--json'];
}

export function buildMcpGetArgs(name: string): string[] {
  return ['mcp', 'get', name, '--json'];
}

export function buildMcpRemoveArgs(name: string): string[] {
  return ['mcp', 'remove', name];
}

export function buildMcpLoginArgs(name: string): string[] {
  return ['mcp', 'login', name];
}

export function buildMcpLogoutArgs(name: string): string[] {
  return ['mcp', 'logout', name];
}

export function buildMcpAddArgs(input: AddMcpServerInput | NormalizedAddMcpServerInput): string[] {
  const envArgs = buildEnvArgs(input.env ?? {});
  const args = ['mcp', 'add', input.name, ...envArgs];

  if (input.transport === 'stdio') {
    args.push('--', input.command, ...(input.args ?? []));
    return args;
  }

  if (input.bearerTokenEnvVar !== undefined) {
    args.push('--bearer-token-env-var', input.bearerTokenEnvVar);
  }
  if (input.oauthClientId !== undefined) {
    args.push('--oauth-client-id', input.oauthClientId);
  }
  if (input.oauthResource !== undefined) {
    args.push('--oauth-resource', input.oauthResource);
  }
  args.push('--url', input.url);
  return args;
}

function buildEnvArgs(env: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    args.push('--env', `${key}=${value}`);
  }
  return args;
}
