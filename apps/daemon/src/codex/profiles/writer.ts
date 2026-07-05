import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { parse } from 'toml';
import { profileFileName, validateProfileConfig } from './config.js';
import type { TomlPrimitive, TomlProfileConfig, TomlProfileValue } from './types.js';

export type ProfileWriter = {
  createProfile(name: string, config: TomlProfileConfig): Promise<void>;
  updateProfile(name: string, config: TomlProfileConfig): Promise<void>;
  deleteProfile(name: string): Promise<void>;
};

const locks = new Map<string, Promise<void>>();
let fileCounter = 0;

export function createProfileWriter(input: { codexHome: string }): ProfileWriter {
  const codexHome = input.codexHome;

  return {
    createProfile(name, config) {
      return withCodexHomeLock(codexHome, () => createProfile(codexHome, name, config));
    },
    updateProfile(name, config) {
      return withCodexHomeLock(codexHome, () => updateProfile(codexHome, name, config));
    },
    deleteProfile(name) {
      return withCodexHomeLock(codexHome, () => deleteProfile(codexHome, name));
    }
  };
}

export function serializeCodexProfileOverlay(config: TomlProfileConfig): string {
  const validation = validateProfileConfig(config);
  if (!validation.ok) throw new Error(`CODEX_PROFILE_INVALID: ${validation.message}`);

  return `${Object.entries(config)
    .map(([key, value]) => `${key} = ${serializeValue(value)}`)
    .join('\n')}\n`;
}

async function withCodexHomeLock(codexHome: string, operation: () => void | Promise<void>): Promise<void> {
  const previous = locks.get(codexHome) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current, () => current);
  locks.set(codexHome, chained);

  try {
    await previous.catch(() => undefined);
    await operation();
  } finally {
    release();
    if (locks.get(codexHome) === chained) locks.delete(codexHome);
  }
}

function createProfile(codexHome: string, name: string, config: TomlProfileConfig): void {
  const fileName = profileFileName(name);
  const profilePath = join(codexHome, fileName);
  if (existsSync(profilePath)) throw new Error(`CODEX_PROFILE_EXISTS: ${fileName}`);

  const content = serializeCodexProfileOverlay(config);
  validateBaseConfig(codexHome);
  writeProfileFile(codexHome, fileName, content);
}

function updateProfile(codexHome: string, name: string, config: TomlProfileConfig): void {
  const fileName = profileFileName(name);
  const profilePath = join(codexHome, fileName);
  if (!existsSync(profilePath)) throw new Error(`CODEX_PROFILE_NOT_FOUND: ${fileName}`);

  const content = serializeCodexProfileOverlay(config);
  validateBaseConfig(codexHome);
  backupProfile(codexHome, fileName, profilePath);
  writeProfileFile(codexHome, fileName, content);
}

function deleteProfile(codexHome: string, name: string): void {
  const fileName = profileFileName(name);
  const profilePath = join(codexHome, fileName);
  if (!existsSync(profilePath)) throw new Error(`CODEX_PROFILE_NOT_FOUND: ${fileName}`);

  validateBaseConfig(codexHome);
  backupProfile(codexHome, fileName, profilePath);
  rmSync(profilePath);
}

function writeProfileFile(codexHome: string, fileName: string, content: string): void {
  mkdirSync(codexHome, { recursive: true });
  const profilePath = join(codexHome, fileName);
  const tempPath = join(codexHome, `.${fileName}.${process.pid}.${Date.now()}.${nextFileCounter()}.tmp`);

  try {
    writeFileSync(tempPath, content);
    parse(readFileSync(tempPath, 'utf8'));
    renameSync(tempPath, profilePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function validateBaseConfig(codexHome: string): void {
  const baseConfigPath = join(codexHome, 'config.toml');
  if (!existsSync(baseConfigPath)) return;

  try {
    parse(readFileSync(baseConfigPath, 'utf8'));
  } catch (error) {
    throw new Error(`CODEX_CONFIG_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function backupProfile(codexHome: string, fileName: string, profilePath: string): void {
  const backupDir = join(codexHome, 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `${fileName}.${new Date().toISOString().replace(/[:.]/g, '-')}.${nextFileCounter()}.bak`);
  copyFileSync(profilePath, backupPath);
}

function serializeValue(value: TomlProfileValue): string {
  if (Array.isArray(value)) return `[${value.map(serializePrimitive).join(', ')}]`;
  return serializePrimitive(value);
}

function serializePrimitive(value: TomlPrimitive): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  return value ? 'true' : 'false';
}

function nextFileCounter(): number {
  fileCounter = (fileCounter + 1) % Number.MAX_SAFE_INTEGER;
  return fileCounter;
}
