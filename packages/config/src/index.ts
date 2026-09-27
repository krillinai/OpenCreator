import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse, stringify } from '@iarna/toml';
import type {
  OpenCreatorStorageSettings,
  OpenCreatorUiSettings,
  UpdateOpenCreatorStorageSettingsRequest,
  UpdateOpenCreatorUiSettingsRequest
} from '@opencreator/protocol';

export {
  sha256Text,
  verifyFileIntegrityWithCache,
  type FileIntegrityVerificationResult,
  type IntegrityFile
} from './file-integrity-cache.js';

export type OpenCreatorPaths = {
  root: string;
  configFile: string;
  credentialsFile: string;
  dataDir: string;
  runtimeDir: string;
  codexHome: string;
  creatorCodexHome: string;
  creatorDir: string;
  logsDir: string;
};

export type OpenCreatorRuntimeChannel = 'production' | 'development';

export type OpenCreatorDesktopConfig = {
  closeBehavior: 'hide' | 'quit';
  notificationsEnabled: boolean;
  telemetryEnabled: boolean;
  telemetryInstallId?: string;
  codexBin?: string;
  successfulCodexBin?: string;
  window?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized?: boolean;
  };
};

export type OpenCreatorRuntimeConfig = {
  codexMode: 'bundled' | 'external';
  externalCodexBin?: string;
};

export type OpenCreatorConfigDocument = {
  version: number;
  ui?: OpenCreatorUiSettings;
  storage?: OpenCreatorStorageSettings;
  desktop?: OpenCreatorDesktopConfig;
  runtime?: OpenCreatorRuntimeConfig;
  creatorServices?: Record<string, unknown>;
};

export type OpenCreatorConfigSnapshot = {
  document: OpenCreatorConfigDocument;
  configured: {
    ui: boolean;
    storage: boolean;
    desktop: boolean;
    runtime: boolean;
    creatorServices: boolean;
  };
};

const defaultUiSettings: OpenCreatorUiSettings = {
  language: 'system',
  colorMode: 'dark',
  accentColor: 'red',
  customAccentColor: '#3b82f6',
  defaultPermission: 'danger-full-access'
};

const defaultDesktopConfig: OpenCreatorDesktopConfig = {
  closeBehavior: 'hide',
  notificationsEnabled: true,
  telemetryEnabled: true
};

const defaultRuntimeConfig: OpenCreatorRuntimeConfig = {
  codexMode: 'bundled'
};

export function resolveOpenCreatorPaths(input: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  runtimeChannel?: OpenCreatorRuntimeChannel;
} = {}): OpenCreatorPaths {
  const env = input.env ?? process.env;
  const productRoot = join(input.homeDir ?? homedir(), '.opencreator');
  const defaultRoot = input.runtimeChannel === 'development'
    ? join(productRoot, 'development')
    : productRoot;
  const root = resolve(env.OPENCREATOR_HOME?.trim() || defaultRoot);
  const runtimeDir = join(root, 'runtime');
  return {
    root,
    configFile: join(root, 'config.toml'),
    credentialsFile: join(root, 'credentials.json'),
    dataDir: join(root, 'data'),
    runtimeDir,
    codexHome: join(runtimeDir, 'codex'),
    creatorCodexHome: join(runtimeDir, 'creator-codex'),
    creatorDir: join(root, 'creator'),
    logsDir: join(root, 'logs')
  };
}

export function readOpenCreatorConfig(path: string): OpenCreatorConfigSnapshot {
  return withConfigLock(path, () => readOpenCreatorConfigUnlocked(path));
}

export function updateOpenCreatorConfig(
  path: string,
  update: (document: OpenCreatorConfigDocument) => OpenCreatorConfigDocument
): OpenCreatorConfigSnapshot {
  return withConfigLock(path, () => {
    const current = readOpenCreatorConfigUnlocked(path);
    const next = normalizeDocument(update(structuredClone(current.document)));
    writeConfigFile(path, next);
    return snapshot(next);
  });
}

export function updateOpenCreatorUiSettings(
  path: string,
  patch: UpdateOpenCreatorUiSettingsRequest
): OpenCreatorConfigSnapshot {
  return updateOpenCreatorConfig(path, document => ({
    ...document,
    ui: normalizeUiSettings({ ...document.ui, ...patch })
  }));
}

export function updateOpenCreatorStorageSettings(
  path: string,
  patch: UpdateOpenCreatorStorageSettingsRequest
): OpenCreatorConfigSnapshot {
  return updateOpenCreatorConfig(path, document => ({
    ...document,
    storage: normalizeStorageSettings({ ...document.storage, ...patch })
  }));
}

function readOpenCreatorConfigUnlocked(path: string): OpenCreatorConfigSnapshot {
  if (!existsSync(path)) return snapshot({ version: 1 });
  const source = readFileSync(path, 'utf8');
  const parsed = parse(source) as unknown;
  if (!isRecord(parsed)) throw new Error('OPENCREATOR_CONFIG_INVALID');
  return snapshot(normalizeDocument(parsed));
}

function normalizeDocument(value: unknown): OpenCreatorConfigDocument {
  const source = isRecord(value) ? value : {};
  return {
    version: typeof source.version === 'number' && Number.isInteger(source.version)
      ? source.version
      : 1,
    ...(isRecord(source.ui) ? { ui: normalizeUiSettings(source.ui) } : {}),
    ...(isRecord(source.storage)
      ? { storage: normalizeStorageSettings(source.storage) }
      : {}),
    ...(isRecord(source.desktop)
      ? { desktop: normalizeDesktopConfig(source.desktop) }
      : {}),
    ...(isRecord(source.runtime)
      ? { runtime: normalizeRuntimeConfig(source.runtime) }
      : {}),
    ...(isRecord(source.creator_services)
      ? { creatorServices: structuredClone(source.creator_services) }
      : isRecord(source.creatorServices)
        ? { creatorServices: structuredClone(source.creatorServices) }
        : {})
  };
}

function snapshot(document: OpenCreatorConfigDocument): OpenCreatorConfigSnapshot {
  return {
    document: {
      version: document.version,
      ...(document.ui === undefined
        ? {}
        : { ui: normalizeUiSettings(document.ui) }),
      ...(document.storage === undefined
        ? {}
        : { storage: normalizeStorageSettings(document.storage) }),
      ...(document.desktop === undefined
        ? {}
        : { desktop: normalizeDesktopConfig(document.desktop) }),
      ...(document.runtime === undefined
        ? {}
        : { runtime: normalizeRuntimeConfig(document.runtime) }),
      ...(document.creatorServices === undefined
        ? {}
        : { creatorServices: structuredClone(document.creatorServices) })
    },
    configured: {
      ui: document.ui !== undefined,
      storage: document.storage !== undefined,
      desktop: document.desktop !== undefined,
      runtime: document.runtime !== undefined,
      creatorServices: document.creatorServices !== undefined
    }
  };
}

export function resolveUiSettings(snapshot: OpenCreatorConfigSnapshot): OpenCreatorUiSettings {
  return normalizeUiSettings(snapshot.document.ui ?? defaultUiSettings);
}

export function resolveStorageSettings(
  snapshot: OpenCreatorConfigSnapshot,
  defaults: OpenCreatorStorageSettings
): OpenCreatorStorageSettings {
  return normalizeStorageSettings(snapshot.document.storage ?? defaults, defaults);
}

function normalizeStorageSettings(
  value: unknown,
  defaults?: OpenCreatorStorageSettings
): OpenCreatorStorageSettings {
  const source = isRecord(value) ? value : {};
  const defaultProjectRoot = nonEmptyString(
    source.defaultProjectRoot ?? source.default_project_root
  ) ?? defaults?.defaultProjectRoot ?? '';
  const outputRoot = nonEmptyString(source.outputRoot ?? source.output_root)
    ?? defaults?.outputRoot
    ?? '';
  return {
    defaultProjectRoot: resolve(defaultProjectRoot),
    outputRoot: resolve(outputRoot)
  };
}

export function resolveDesktopConfig(
  snapshot: OpenCreatorConfigSnapshot
): OpenCreatorDesktopConfig {
  return normalizeDesktopConfig(snapshot.document.desktop ?? defaultDesktopConfig);
}

export function resolveRuntimeConfig(
  snapshot: OpenCreatorConfigSnapshot
): OpenCreatorRuntimeConfig {
  return normalizeRuntimeConfig(snapshot.document.runtime ?? defaultRuntimeConfig);
}

function normalizeUiSettings(value: unknown): OpenCreatorUiSettings {
  const source = isRecord(value) ? value : {};
  const customAccentSource = source.customAccentColor ?? source.custom_accent_color;
  const customAccentColor = typeof customAccentSource === 'string'
    && /^#[\da-f]{6}$/i.test(customAccentSource)
    ? customAccentSource.toLowerCase()
    : defaultUiSettings.customAccentColor;
  const colorMode = source.colorMode ?? source.color_mode;
  const accentColor = source.accentColor ?? source.accent_color;
  const defaultPermission = source.defaultPermission ?? source.default_permission;
  return {
    language: source.language === 'zh-CN' || source.language === 'en-US' || source.language === 'sv-SE'
      ? source.language
      : 'system',
    colorMode: colorMode === 'light' ? 'light' : 'dark',
    accentColor:
      accentColor === 'neutral'
      || accentColor === 'blue'
      || accentColor === 'cyan'
      || accentColor === 'purple'
      || accentColor === 'orange'
      || accentColor === 'custom'
        ? accentColor
        : 'red',
    customAccentColor,
    defaultPermission:
      defaultPermission === 'follow-project'
      || defaultPermission === 'follow-global'
      || defaultPermission === 'workspace-write'
        ? defaultPermission
        : 'danger-full-access'
  };
}

function normalizeDesktopConfig(value: unknown): OpenCreatorDesktopConfig {
  const source = isRecord(value) ? value : {};
  const window = isRecord(source.window)
    && typeof source.window.width === 'number'
    && Number.isFinite(source.window.width)
    && typeof source.window.height === 'number'
    && Number.isFinite(source.window.height)
    ? {
        width: source.window.width,
        height: source.window.height,
        ...(typeof source.window.x === 'number' && Number.isFinite(source.window.x)
          ? { x: source.window.x }
          : {}),
        ...(typeof source.window.y === 'number' && Number.isFinite(source.window.y)
          ? { y: source.window.y }
          : {}),
        ...(source.window.maximized === true ? { maximized: true } : {})
      }
    : undefined;
  return {
    closeBehavior: (source.closeBehavior ?? source.close_behavior) === 'quit' ? 'quit' : 'hide',
    notificationsEnabled: (source.notificationsEnabled ?? source.notifications_enabled) !== false,
    telemetryEnabled: (source.telemetryEnabled ?? source.telemetry_enabled) !== false,
    ...(validUuid(source.telemetryInstallId ?? source.telemetry_install_id) === undefined
      ? {}
      : {
          telemetryInstallId: validUuid(
            source.telemetryInstallId ?? source.telemetry_install_id
          )
        }),
    ...(nonEmptyString(source.codexBin ?? source.codex_bin) === undefined
      ? {}
      : { codexBin: nonEmptyString(source.codexBin ?? source.codex_bin) }),
    ...(nonEmptyString(source.successfulCodexBin ?? source.successful_codex_bin) === undefined
      ? {}
      : {
          successfulCodexBin: nonEmptyString(
            source.successfulCodexBin ?? source.successful_codex_bin
          )
        }),
    ...(window === undefined ? {} : { window })
  };
}

function normalizeRuntimeConfig(value: unknown): OpenCreatorRuntimeConfig {
  const source = isRecord(value) ? value : {};
  const externalCodexSource = source.externalCodexBin ?? source.external_codex_bin;
  const externalCodexBin = typeof externalCodexSource === 'string'
    && externalCodexSource.trim().length > 0
    ? externalCodexSource
    : undefined;
  return {
    codexMode: (source.codexMode ?? source.codex_mode) === 'external'
      ? 'external'
      : 'bundled',
    ...(externalCodexBin === undefined ? {} : { externalCodexBin })
  };
}

function writeConfigFile(path: string, document: OpenCreatorConfigDocument): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dirname(path), 0o700);
  const serializable = {
    version: document.version,
    ...(document.ui === undefined ? {} : { ui: serializeUi(document.ui) }),
    ...(document.storage === undefined
      ? {}
      : { storage: serializeStorage(document.storage) }),
    ...(document.desktop === undefined
      ? {}
      : { desktop: serializeDesktop(document.desktop) }),
    ...(document.runtime === undefined
      ? {}
      : { runtime: serializeRuntime(document.runtime) }),
    ...(document.creatorServices === undefined
      ? {}
      : { creator_services: document.creatorServices })
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, stringify(serializable as any), { mode: 0o600 });
  renameSync(temporary, path);
}

function serializeStorage(value: OpenCreatorStorageSettings): Record<string, unknown> {
  return {
    default_project_root: value.defaultProjectRoot,
    output_root: value.outputRoot
  };
}

function serializeUi(value: OpenCreatorUiSettings): Record<string, unknown> {
  return {
    language: value.language,
    color_mode: value.colorMode,
    accent_color: value.accentColor,
    custom_accent_color: value.customAccentColor,
    default_permission: value.defaultPermission
  };
}

function serializeDesktop(value: OpenCreatorDesktopConfig): Record<string, unknown> {
  return {
    close_behavior: value.closeBehavior,
    notifications_enabled: value.notificationsEnabled,
    telemetry_enabled: value.telemetryEnabled,
    ...(value.telemetryInstallId === undefined
      ? {}
      : { telemetry_install_id: value.telemetryInstallId }),
    ...(value.codexBin === undefined ? {} : { codex_bin: value.codexBin }),
    ...(value.successfulCodexBin === undefined
      ? {}
      : { successful_codex_bin: value.successfulCodexBin }),
    ...(value.window === undefined ? {} : { window: value.window })
  };
}

function serializeRuntime(value: OpenCreatorRuntimeConfig): Record<string, unknown> {
  return {
    codex_mode: value.codexMode,
    ...(value.externalCodexBin === undefined
      ? {}
      : { external_codex_bin: value.externalCodexBin })
  };
}

function withConfigLock<Result>(path: string, action: () => Result): Result {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dirname(path), 0o700);
  const lockPath = `${path}.lock`;
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (!isFileExists(error)) throw error;
      if (isStaleLock(lockPath)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      sleep(10);
    }
  }
  if (descriptor === undefined) throw new Error('OPENCREATOR_CONFIG_LOCKED');
  try {
    return action();
  } finally {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}

function isStaleLock(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > 30_000;
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function isFileExists(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST';
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function validUuid(value: unknown): string | undefined {
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
