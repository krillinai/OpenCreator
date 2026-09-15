import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MAX_WALK_DEPTH = 8;

export type LocalEnvironmentLoadOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
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

export function loadLocalEnvironment(
  options: LocalEnvironmentLoadOptions = {}
): string[] {
  const env = options.env ?? process.env;
  const loaded: string[] = [];
  for (const file of resolveLocalEnvFiles(options)) {
    applyEnvFile(file, env);
    loaded.push(file);
  }
  return loaded;
}

function resolveLocalEnvFiles(options: LocalEnvironmentLoadOptions): string[] {
  const env = options.env ?? process.env;
  const explicit = env.OPENCREATOR_ENV_FILE?.trim();
  if (explicit) {
    return existsSync(explicit) ? [resolve(explicit)] : [];
  }

  const files: string[] = [];
  if (options.homeDir !== null) {
    const homeFile = join(options.homeDir ?? homedir(), '.opencreator', '.env.local');
    if (existsSync(homeFile)) files.push(homeFile);
  }

  let dir = resolve(options.cwd ?? process.cwd());
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate) && !files.includes(candidate)) {
      files.push(candidate);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

function applyEnvFile(file: string, env: NodeJS.ProcessEnv): void {
  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }
}
