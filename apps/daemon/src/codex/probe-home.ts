import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  join,
  resolve
} from 'node:path';
import {
  parse,
  stringify
} from '@iarna/toml';

const PROBE_CONFIG_KEYS = [
  'model',
  'model_provider',
  'model_catalog_json',
  'model_context_window',
  'model_supports_reasoning_summaries',
  'openai_base_url',
  'chatgpt_base_url',
  'cli_auth_credentials_store',
  'forced_login_method',
  'forced_chatgpt_workspace_id',
  'service_tier'
] as const;

type TomlDocument = ReturnType<typeof parse>;

export type CodexProbeHome = {
  path: string;
  cleanup(): void;
};

export function createCodexProbeHome(
  sourceHome: string,
  temporaryRoot = tmpdir()
): CodexProbeHome {
  const path = mkdtempSync(join(temporaryRoot, 'opencreator-codex-probe-'));
  chmodSync(path, 0o700);

  try {
    copyRegularFile(join(sourceHome, 'auth.json'), join(path, 'auth.json'));
    createMinimalProbeConfig(sourceHome, path);
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }

  return {
    path,
    cleanup() {
      rmSync(path, { recursive: true, force: true });
    }
  };
}

export function createCodexIsolatedHome(
  sourceHome: string,
  path: string
): CodexProbeHome {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  copyRegularFile(join(sourceHome, 'auth.json'), join(path, 'auth.json'));
  createMinimalProbeConfig(sourceHome, path);
  return {
    path,
    cleanup() {
      // The isolated session rollout must survive between turns.
    }
  };
}

function createMinimalProbeConfig(sourceHome: string, probeHome: string): void {
  const sourcePath = join(sourceHome, 'config.toml');
  if (!existsSync(sourcePath)) return;
  const source = parse(readFileSync(sourcePath, 'utf8'));
  const config: TomlDocument = {};

  for (const key of PROBE_CONFIG_KEYS) {
    const value = source[key];
    if (value !== undefined) config[key] = value;
  }

  const providerId = typeof config.model_provider === 'string'
    ? config.model_provider
    : undefined;
  const providers = isRecord(source.model_providers)
    ? source.model_providers
    : undefined;
  const selectedProvider = providerId === undefined
    ? undefined
    : providers?.[providerId];
  if (providerId !== undefined && isRecord(selectedProvider)) {
    config.model_providers = {
      [providerId]: selectedProvider
    };
  }

  relocateModelCatalog(config, sourceHome, probeHome);
  const destination = join(probeHome, 'config.toml');
  writeFileSync(destination, stringify(config), { mode: 0o600 });
  chmodSync(destination, 0o600);
}

function relocateModelCatalog(
  config: TomlDocument,
  sourceHome: string,
  probeHome: string
): void {
  if (typeof config.model_catalog_json !== 'string') return;
  const source = resolve(sourceHome, config.model_catalog_json);
  if (!existsSync(source)) return;
  const stat = statSync(source);
  if (!stat.isFile()) {
    throw new Error('Codex Probe model_catalog_json is not a regular file');
  }
  const destinationDir = join(probeHome, 'model-catalogs');
  const destination = join(destinationDir, basename(source));
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  config.model_catalog_json = destination;
}

function copyRegularFile(source: string, destination: string): void {
  if (!existsSync(source)) return;
  const stat = statSync(source);
  if (!stat.isFile()) {
    throw new Error(`Codex Probe source is not a regular file: ${basename(source)}`);
  }
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
}

function isRecord(value: unknown): value is Record<string, TomlDocument[string]> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}
