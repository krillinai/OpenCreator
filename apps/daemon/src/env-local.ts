import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const VOLCENGINE_ENV_KEYS = ['VOLCENGINE_APP_ID', 'VOLCENGINE_ACCESS_TOKEN'] as const;
export type VolcengineEnvKey = (typeof VOLCENGINE_ENV_KEYS)[number];

export type VolcengineEnvironment = Partial<Record<VolcengineEnvKey, string>>;

export type LocalEnvironmentLoadOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string | null;
};

export function parseEnvFile(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const trimmed = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadVolcengineEnvironment(
  options: LocalEnvironmentLoadOptions = {}
): VolcengineEnvironment {
  const env = options.env ?? process.env;
  const fileValues = readWhitelistedVolcengineEnvFile(options);
  const result: VolcengineEnvironment = {};
  for (const key of VOLCENGINE_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      const trimmed = env[key]?.trim() ?? '';
      if (trimmed) result[key] = trimmed;
      continue;
    }
    const fromFile = fileValues[key]?.trim();
    if (fromFile) result[key] = fromFile;
  }
  return result;
}

function readWhitelistedVolcengineEnvFile(
  options: LocalEnvironmentLoadOptions
): VolcengineEnvironment {
  const file = resolveVolcengineEnvFile(options);
  if (file === undefined) return {};
  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  const result: VolcengineEnvironment = {};
  for (const key of VOLCENGINE_ENV_KEYS) {
    const value = parsed[key]?.trim();
    if (value) result[key] = value;
  }
  return result;
}

function resolveVolcengineEnvFile(options: LocalEnvironmentLoadOptions): string | undefined {
  const env = options.env ?? process.env;
  const explicit = env.OPENCREATOR_ENV_FILE?.trim();
  if (explicit) {
    return existsSync(explicit) ? resolve(explicit) : undefined;
  }
  if (options.homeDir === null) return undefined;
  const homeFile = join(options.homeDir ?? homedir(), '.opencreator', '.env.local');
  return existsSync(homeFile) ? homeFile : undefined;
}
