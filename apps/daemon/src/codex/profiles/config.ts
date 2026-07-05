import { parse } from 'toml';
import type {
  CodexProfile,
  ParseProfileConfigResult,
  TomlPrimitive,
  TomlProfileConfig,
  TomlProfileValue,
  ValidationResult
} from './types.js';

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function isValidProfileName(name: string): boolean {
  return name.length > 0 && PROFILE_NAME_PATTERN.test(name);
}

export function profileFileName(name: string): `${string}.config.toml` {
  if (!isValidProfileName(name)) throw new Error(`CODEX_PROFILE_INVALID: invalid profile name: ${name}`);
  return `${name}.config.toml`;
}

export function profileNameFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.config.toml')) return undefined;
  const name = fileName.slice(0, -'.config.toml'.length);
  return isValidProfileName(name) ? name : undefined;
}

export function validateProfileConfig(config: Record<string, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(config)) {
    if (!isValidProfileName(key)) return { ok: false, message: `invalid config key: ${key}` };
    if (!isTomlProfileValue(value)) {
      return { ok: false, message: `unsupported profile value for key: ${key}` };
    }
  }
  return { ok: true };
}

export function parseCodexProfileOverlay(name: string, content: string): ParseProfileConfigResult {
  let parsed: unknown;
  try {
    parsed = content.trim().length === 0 ? {} : parse(content);
  } catch (error) {
    const diagnostic = `Failed to parse ${profileFileName(name)}: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, profile: invalidProfile(name, [diagnostic]), diagnostics: [diagnostic] };
  }

  const root = isRecord(parsed) ? parsed : {};
  const validation = validateProfileConfig(root);
  if (!validation.ok) {
    const profile = invalidProfile(name, [validation.message]);
    return { ok: false, profile, diagnostics: [validation.message] };
  }

  return {
    ok: true,
    profile: {
      name,
      status: 'valid',
      config: normalizeProfileConfig(root),
      diagnostics: [],
      source: profileFileName(name)
    },
    diagnostics: []
  };
}

function invalidProfile(name: string, diagnostics: string[]): Omit<CodexProfile, 'codexHomeMode'> {
  return {
    name,
    status: 'invalid',
    config: {},
    diagnostics,
    source: profileFileName(name)
  };
}

function normalizeProfileConfig(config: Record<string, unknown>): TomlProfileConfig {
  const normalized: TomlProfileConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (isTomlProfileValue(value)) normalized[key] = value;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTomlProfileValue(value: unknown): value is TomlProfileValue {
  if (isTomlPrimitive(value)) return true;
  return Array.isArray(value) && value.every(isTomlPrimitive);
}

function isTomlPrimitive(value: unknown): value is TomlPrimitive {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
