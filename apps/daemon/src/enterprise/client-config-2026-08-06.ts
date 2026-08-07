import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, stringify } from '@iarna/toml';
import { resolveEnterpriseOrigin } from './config-2026-07-30.js';

export const ENTERPRISE_AGENT_ID_PATTERN =
  /^clawee_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EnterpriseClientConfig = {
  gateway: string;
  agentId?: string;
};

export function readEnterpriseClientConfig(
  path: string,
  read: (path: string) => string = filePath => readFileSync(filePath, 'utf8')
): EnterpriseClientConfig {
  const resolvedPath = resolve(path);
  let parsed: unknown;
  try {
    parsed = parse(read(resolvedPath)) as unknown;
  } catch {
    throw new Error(`ENTERPRISE_CONFIG_INVALID: ${resolvedPath}`);
  }
  if (
    !isRecord(parsed)
    || Object.keys(parsed).some(key => key !== 'gateway' && key !== 'agent_id')
    || typeof parsed.gateway !== 'string'
    || (
      parsed.agent_id !== undefined
      && (
        typeof parsed.agent_id !== 'string'
        || !ENTERPRISE_AGENT_ID_PATTERN.test(parsed.agent_id)
      )
    )
  ) {
    throw new Error(`ENTERPRISE_CONFIG_INVALID: ${resolvedPath}`);
  }
  try {
    return {
      gateway: resolveEnterpriseOrigin(parsed.gateway.trim()).origin,
      ...(typeof parsed.agent_id === 'string'
        ? { agentId: parsed.agent_id }
        : {})
    };
  } catch {
    throw new Error(`ENTERPRISE_CONFIG_INVALID: ${resolvedPath}`);
  }
}

export function serializeEnterpriseClientConfig(
  config: EnterpriseClientConfig
): string {
  return stringify({
    gateway: config.gateway,
    ...(config.agentId === undefined ? {} : { agent_id: config.agentId })
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
