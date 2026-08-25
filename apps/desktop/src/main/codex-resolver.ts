import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const BUNDLED_VERSION = '0.149.0';
const BUNDLED_COMMIT = '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0';

export type CodexRuntimeMode = 'bundled' | 'external';

export type ResolvedCodexEnvironment = {
  codexBin: string;
  codexHome: string;
  defaultCwd: string;
  env: NodeJS.ProcessEnv;
  source: CodexRuntimeMode;
  version: string;
  commit: string | null;
  runtimeRoot: string | null;
};

export type CodexResolutionDiagnostics = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  mode: CodexRuntimeMode;
  runtimeRoot?: string;
  manifestPath?: string;
  selectedCodexBin?: string;
  codexHome?: string;
  version?: string;
  errorCode?: string;
  message?: string;
};

export type LoginShellEnvironmentTask = {
  result: Promise<NodeJS.ProcessEnv | undefined>;
  cancel(): Promise<void>;
};

export class CodexResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: CodexResolutionDiagnostics
  ) {
    super(message);
    this.name = 'CodexResolutionError';
  }
}

export async function resolveCodexEnvironment(input: {
  mode?: CodexRuntimeMode;
  runtimeRoot?: string;
  userDataDir?: string;
  externalCodexBin?: string;
  selectedCodexBin?: string;
  processEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  defaultCwd?: string;
  probeVersion?(path: string, env: NodeJS.ProcessEnv): string;
  onDiagnostics?(diagnostics: CodexResolutionDiagnostics): void;
  successfulCodexBin?: string;
  savedCodexBin?: string;
  loginShellTask?: LoginShellEnvironmentTask;
} = {}): Promise<ResolvedCodexEnvironment | undefined> {
  const mode = input.selectedCodexBin !== undefined ? 'external' : input.mode ?? 'bundled';
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const processEnv = { ...(input.processEnv ?? process.env) };
  const userDataDir = resolve(input.userDataDir ?? processEnv.CLAWEE_DESKTOP_USER_DATA ?? join(process.cwd(), '.runtime', 'desktop-user-data'));
  const diagnostics: CodexResolutionDiagnostics = { platform, arch, mode };

  try {
    const result = mode === 'bundled'
      ? resolveBundled({
          runtimeRoot: input.runtimeRoot,
          userDataDir,
          processEnv,
          platform,
          arch,
          defaultCwd: input.defaultCwd,
          diagnostics
        })
      : resolveExternal({
          codexBin: input.selectedCodexBin ?? input.externalCodexBin,
          userDataDir,
          processEnv,
          platform,
          defaultCwd: input.defaultCwd,
          probeVersion: input.probeVersion,
          diagnostics
        });
    input.onDiagnostics?.({ ...diagnostics });
    return result;
  } catch (error) {
    const normalized = error instanceof CodexResolutionError
      ? error
      : failure('codex_runtime_missing', error instanceof Error ? error.message : String(error), diagnostics);
    input.onDiagnostics?.({ ...normalized.diagnostics, errorCode: normalized.code, message: normalized.message });
    throw normalized;
  }
}

export function validateManualCodexPath(
  path: string,
  input: { platform?: NodeJS.Platform } = {}
): string | undefined {
  const platform = input.platform ?? process.platform;
  const candidate = resolve(path);
  if (!isAbsolute(candidate) || !existsSync(candidate)) return undefined;
  const info = lstatSync(candidate);
  if (info.isSymbolicLink() || !info.isFile()) return undefined;
  const expectedName = platform === 'win32' ? 'codex.exe' : 'codex';
  return candidate.toLowerCase().endsWith(expectedName) ? candidate : undefined;
}

export function startLoginShellEnvironmentRead(_input: { timeoutMs?: number } = {}): LoginShellEnvironmentTask {
  return {
    result: Promise.resolve(undefined),
    cancel: async () => undefined
  };
}

export async function readLoginShellEnvironment(): Promise<NodeJS.ProcessEnv> {
  return {};
}

function resolveBundled(input: {
  runtimeRoot?: string;
  userDataDir: string;
  processEnv: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  defaultCwd?: string;
  diagnostics: CodexResolutionDiagnostics;
}): ResolvedCodexEnvironment {
  if (input.runtimeRoot === undefined) {
    throw failure('codex_runtime_missing', '未提供 OpenCreator 内置 Codex Runtime 路径', input.diagnostics);
  }
  const runtimeRoot = resolve(input.runtimeRoot);
  const manifestPath = join(runtimeRoot, 'manifest.json');
  Object.assign(input.diagnostics, { runtimeRoot, manifestPath });
  if (!existsSync(manifestPath)) {
    throw failure('codex_runtime_missing', `内置 Codex Runtime 清单不存在：${manifestPath}`, input.diagnostics);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  if (
    manifest.version !== BUNDLED_VERSION
    || manifest.commit !== BUNDLED_COMMIT
    || manifest.platform !== input.platform
    || manifest.arch !== input.arch
  ) {
    throw failure(
      'codex_runtime_version_mismatch',
      `内置 Codex Runtime 与当前 OpenCreator 不兼容（需要 ${BUNDLED_VERSION}）`,
      input.diagnostics
    );
  }
  const binary = readRecord(manifest.binary);
  const relativePath = readString(binary.relativePath);
  const expectedHash = readString(binary.sha256);
  if (relativePath === undefined || expectedHash === undefined) {
    throw failure('codex_runtime_hash_mismatch', '内置 Codex Runtime 主程序清单无效', input.diagnostics);
  }
  const codexBin = safeRuntimePath(runtimeRoot, relativePath, input.diagnostics);
  if (!existsSync(codexBin) || lstatSync(codexBin).isSymbolicLink() || !statSync(codexBin).isFile()) {
    throw failure('codex_runtime_missing', `内置 Codex 主程序不存在：${codexBin}`, input.diagnostics);
  }
  if (hashFile(codexBin) !== expectedHash) {
    throw failure('codex_runtime_hash_mismatch', '内置 Codex 主程序哈希校验失败', input.diagnostics);
  }
  const codexHome = join(input.userDataDir, 'runtime', 'codex', 'home');
  mkdirSync(codexHome, { recursive: true });
  const env = isolatedEnvironment(input.processEnv, codexHome, runtimeRoot);
  Object.assign(input.diagnostics, {
    selectedCodexBin: codexBin,
    codexHome,
    version: BUNDLED_VERSION
  });
  return {
    codexBin,
    codexHome,
    defaultCwd: resolve(input.defaultCwd ?? input.userDataDir),
    env,
    source: 'bundled',
    version: BUNDLED_VERSION,
    commit: BUNDLED_COMMIT,
    runtimeRoot
  };
}

function resolveExternal(input: {
  codexBin?: string;
  userDataDir: string;
  processEnv: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  defaultCwd?: string;
  probeVersion?(path: string, env: NodeJS.ProcessEnv): string;
  diagnostics: CodexResolutionDiagnostics;
}): ResolvedCodexEnvironment {
  if (input.codexBin === undefined) {
    throw failure('codex_runtime_missing', '外部 Codex 模式需要显式选择主程序', input.diagnostics);
  }
  const codexBin = validateManualCodexPath(input.codexBin, { platform: input.platform });
  if (codexBin === undefined) {
    throw failure('codex_runtime_missing', '选择的外部 Codex 主程序无效', input.diagnostics);
  }
  const codexHome = join(input.userDataDir, 'runtime', 'codex', 'external-home');
  mkdirSync(codexHome, { recursive: true });
  const env = isolatedEnvironment(input.processEnv, codexHome, dirname(codexBin));
  const versionOutput = input.probeVersion?.(codexBin, env) ?? probeCodexVersion(codexBin, env);
  const version = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(versionOutput)?.[1];
  if (version !== BUNDLED_VERSION) {
    throw failure(
      'codex_runtime_version_mismatch',
      `外部 Codex 版本不兼容：${version ?? '未知'}，需要 ${BUNDLED_VERSION}`,
      input.diagnostics
    );
  }
  Object.assign(input.diagnostics, { selectedCodexBin: codexBin, codexHome, version });
  return {
    codexBin,
    codexHome,
    defaultCwd: resolve(input.defaultCwd ?? input.userDataDir),
    env,
    source: 'external',
    version,
    commit: null,
    runtimeRoot: null
  };
}

function isolatedEnvironment(
  source: NodeJS.ProcessEnv,
  codexHome: string,
  runtimeRoot: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...source,
    CODEX_HOME: codexHome,
    CODEX_MANAGED_PACKAGE_ROOT: runtimeRoot
  };
  delete env.CODEX_BIN;
  return env;
}

function safeRuntimePath(
  root: string,
  candidate: string,
  diagnostics: CodexResolutionDiagnostics
): string {
  const path = resolve(root, candidate);
  const relativePath = relative(root, path);
  if (relativePath.startsWith('..') || resolve(root, relativePath) !== path) {
    throw failure('codex_runtime_hash_mismatch', '内置 Codex Runtime 路径越界', diagnostics);
  }
  return path;
}

function probeCodexVersion(path: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync(path, ['--version'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || 'Codex version probe failed');
  }
  return result.stdout.trim();
}

function failure(
  code: string,
  message: string,
  diagnostics: CodexResolutionDiagnostics
): CodexResolutionError {
  return new CodexResolutionError(code, message, { ...diagnostics, errorCode: code, message });
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
