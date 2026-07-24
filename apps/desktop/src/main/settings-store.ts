import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import type { DesktopSettings } from '../shared/types.js';

const defaultSettings: DesktopSettings = {
  closeBehavior: 'hide',
  notificationsEnabled: true
};

export type SettingsStore = {
  read(): DesktopSettings;
  update(patch: Partial<DesktopSettings>): DesktopSettings;
  flush(): void;
};

export type SettingsPersistence = {
  read(path: string): string;
  writeAtomic(path: string, contents: string): void;
};

export function createSettingsStore(
  path: string,
  persistence: SettingsPersistence = fileSettingsPersistence
): SettingsStore {
  let current = readSettings(path, persistence);
  return {
    read() {
      return structuredClone(current);
    },
    update(patch) {
      current = normalizeSettings({ ...current, ...patch });
      persistence.writeAtomic(path, `${JSON.stringify(current, null, 2)}\n`);
      return structuredClone(current);
    },
    flush() {}
  };
}

function readSettings(
  path: string,
  persistence: SettingsPersistence
): DesktopSettings {
  try {
    return normalizeSettings(JSON.parse(persistence.read(path)) as unknown);
  } catch {
    return structuredClone(defaultSettings);
  }
}

function normalizeSettings(value: unknown): DesktopSettings {
  if (!isRecord(value)) return structuredClone(defaultSettings);
  const closeBehavior = value.closeBehavior === 'quit' ? 'quit' : 'hide';
  const settings: DesktopSettings = {
    closeBehavior,
    notificationsEnabled: value.notificationsEnabled !== false
  };
  if (typeof value.codexBin === 'string' && value.codexBin.length > 0) {
    settings.codexBin = value.codexBin;
  }
  if (typeof value.successfulCodexBin === 'string' && value.successfulCodexBin.length > 0) {
    settings.successfulCodexBin = value.successfulCodexBin;
  }
  if (typeof value.importedRuntimeSource === 'string' && value.importedRuntimeSource.length > 0) {
    settings.importedRuntimeSource = value.importedRuntimeSource;
  }
  if (isRecord(value.window)) {
    const width = numberValue(value.window.width, 1280);
    const height = numberValue(value.window.height, 820);
    settings.window = {
      width,
      height,
      ...(numberOrUndefined(value.window.x) === undefined ? {} : { x: numberOrUndefined(value.window.x) }),
      ...(numberOrUndefined(value.window.y) === undefined ? {} : { y: numberOrUndefined(value.window.y) }),
      ...(value.window.maximized === true ? { maximized: true } : {})
    };
  }
  return settings;
}

const fileSettingsPersistence: SettingsPersistence = {
  read: path => readFileSync(path, 'utf8'),
  writeAtomic(path, contents) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, path);
  }
};

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
