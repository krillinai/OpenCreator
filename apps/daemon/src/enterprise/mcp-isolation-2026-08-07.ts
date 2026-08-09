import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'toml';

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function listEnterpriseMcpIsolationServerNames(input: {
  codexHome: string;
  enterpriseOrigin: string;
}): string[] {
  const configPath = join(input.codexHome, 'config.toml');
  if (!existsSync(configPath)) return [];

  const parsed = parse(readFileSync(configPath, 'utf8')) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.mcp_servers)) return [];

  return Object.entries(parsed.mcp_servers)
    .flatMap(([name, value]) => {
      if (
        !MCP_SERVER_NAME_PATTERN.test(name)
        || !isRecord(value)
        || value.enabled === false
        || typeof value.url !== 'string'
        || !isEnterpriseGatewayMcpUrl(value.url, input.enterpriseOrigin)
      ) {
        return [];
      }
      return [name];
    })
    .sort((left, right) => left.localeCompare(right));
}

function isEnterpriseGatewayMcpUrl(
  candidate: string,
  enterpriseOrigin: string
): boolean {
  let candidateUrl: URL;
  let originUrl: URL;
  try {
    candidateUrl = new URL(candidate);
    originUrl = new URL(enterpriseOrigin);
  } catch {
    return false;
  }
  return (
    candidateUrl.origin === originUrl.origin
    && (
      candidateUrl.pathname === '/mcp'
      || candidateUrl.pathname.startsWith('/mcp/')
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
