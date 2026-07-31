import { mkdirSync, readFileSync, statSync } from 'node:fs';
import {
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CodexAvailabilityProbe } from '@clawee/protocol';
import type { FastifyInstance } from 'fastify';
import {
  applyCapabilityMatrix,
  collectCodexCapabilityMatrixAsync,
  collectStartupCapabilityMatrixAsync,
  probeCodexVersionAsync,
  withRuntimeSkillCapabilities,
  type RuntimeCapabilityMatrix
} from './codex/capabilities.js';
import { resolveCodexHome } from './codex/home.js';
import {
  CODEX_PROBE_TIMEOUT_MS,
  probeCodex
} from './codex/probe.js';
import { createRuntimeToken } from './security/token.js';
import { installGracefulShutdown } from './shutdown.js';
import {
  createProductionServerInput,
  resolveProductionServerEnvironment
} from './startup.js';
import { acquireRuntimeLock } from './runtime-lock.js';
import { createSystemEnterpriseCredentialStore } from './enterprise/credential-store-2026-07-30.js';

type BootstrapPhase = 'starting_runtime';

let server: FastifyInstance | undefined;
let closeWork: Promise<void> | undefined;
let releaseRuntimeLock: (() => void) | undefined;
let cancelCapabilityRefresh: (() => void) | undefined;
let cancelAvailabilityProbe: (() => void) | undefined;

await main().catch(error => {
  emitBootstrapError({
    code: 'DAEMON_START_FAILED',
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const token = createRuntimeToken();
  const environment = resolveProductionServerEnvironment();
  const codexBin = environment.codexBin ?? 'codex';
  const dataDir = resolve(environment.dataDir ?? '.runtime');
  const codexHome = environment.codexHome === undefined
    ? resolveCodexHome().path
    : resolveCodexHome({ isolatedHome: environment.codexHome }).path;
  mkdirSync(dataDir, { recursive: true });
  releaseRuntimeLock = acquireRuntimeLock(dataDir);
  process.once('exit', () => releaseRuntimeLock?.());

  const versionProbe = await probeCodexVersionAsync({
    codexBin,
    timeoutMs: 3_000
  });
  if (!versionProbe.ready) {
    emitBootstrapError({
      code: 'CODEX_VERSION_CHECK_FAILED',
      message: 'Codex CLI 无法正常启动，请重新安装或选择其他 Codex 可执行文件',
      details: {
        codexBin,
        version: versionProbe.version,
        warning: versionProbe.warning
      }
    });
    process.exitCode = 1;
    return;
  }

  const shouldRunAvailabilityProbe =
    requiresProbe() && process.env.CLAWEE_CODEX_PROBE_VERIFIED !== '1';
  let availabilityProbe: CodexAvailabilityProbe = shouldRunAvailabilityProbe
    ? { status: 'pending' }
    : {
        status: 'skipped',
        checkedAt: new Date().toISOString()
      };

  emitBootstrap('starting_runtime');
  const capabilityResolution = await resolveCapabilities(codexBin, dataDir);
  const capabilities = capabilityResolution.state;
  const { buildServer } = await import('./api/server.js');
  server = await buildServer(createProductionServerInput({
    token,
    capabilities,
    enterpriseCredentialStore: createSystemEnterpriseCredentialStore({
      e2eRunId: environment.enterpriseE2ERunId
    }),
    getCodexAvailabilityProbe: () => availabilityProbe,
    persistentAppServerEnabled:
      process.env.CLAWEE_PERSISTENT_APP_SERVER !== '0',
    ...environment
  }));
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  capabilityResolution.startBackgroundRefresh();

  installGracefulShutdown({
    close: closeServer,
    onError(error) {
      console.error(`Failed to close daemon cleanly: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });
  installParentPortShutdown();
  console.log(JSON.stringify({ address, token }));
  if (shouldRunAvailabilityProbe) {
    const controller = new AbortController();
    cancelAvailabilityProbe = () => controller.abort();
    void runAvailabilityProbe({
      codexBin,
      codexHome,
      dataDir,
      signal: controller.signal,
      update(next) {
        availabilityProbe = next;
      }
    });
  }
}

function requiresProbe(): boolean {
  return process.env.CLAWEE_REQUIRE_CODEX_PROBE === '1';
}

async function closeServer(): Promise<void> {
  cancelCapabilityRefresh?.();
  cancelAvailabilityProbe?.();
  closeWork ??= server?.close() ?? Promise.resolve();
  await closeWork;
  releaseRuntimeLock?.();
}

function installParentPortShutdown(): void {
  const parentPort = (
    process as NodeJS.Process & {
      parentPort?: {
        on(event: 'message', listener: (event: { data?: unknown } | unknown) => void): void;
      };
    }
  ).parentPort;
  parentPort?.on('message', event => {
    const payload = isRecord(event) && 'data' in event ? event.data : event;
    if (!isRecord(payload) || payload.type !== 'shutdown') return;
    void closeServer().catch(error => {
      console.error(`Failed to close daemon after parent request: ${String(error)}`);
      process.exitCode = 1;
    });
  });
}

async function resolveCapabilities(
  codexBin: string,
  dataDir: string
): Promise<{
  state: RuntimeCapabilityMatrix;
  startBackgroundRefresh(): void;
}> {
  const cachePath = join(dataDir, 'codex-capabilities.json');
  const fingerprint = codexFingerprint(codexBin);
  const cached = readCapabilityCache(cachePath, fingerprint);
  if (cached !== undefined) {
    return {
      state: cached,
      startBackgroundRefresh() {}
    };
  }
  const state = await collectStartupCapabilityMatrixAsync({
    codexBin,
    timeoutMs: 500
  });
  let started = false;
  return {
    state,
    startBackgroundRefresh() {
      if (started) return;
      started = true;
      const controller = new AbortController();
      cancelCapabilityRefresh = () => controller.abort();
      void collectCodexCapabilityMatrixAsync({
        codexBin,
        timeoutMs: 5_000,
        signal: controller.signal
      }).then(async matrix => {
        if (controller.signal.aborted) return;
        applyCapabilityMatrix(state, matrix);
        withRuntimeSkillCapabilities(state);
        await writeCapabilityCache(cachePath, fingerprint, matrix);
      }).catch(error => {
        if (!controller.signal.aborted) {
          console.warn(`Codex capability refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`);
        }
      });
    }
  };
}

async function writeCapabilityCache(
  path: string,
  fingerprint: string,
  matrix: RuntimeCapabilityMatrix
): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ fingerprint, matrix }, null, 2)}\n`,
      { mode: 0o600 }
    );
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function codexFingerprint(codexBin: string): string {
  try {
    const stat = statSync(codexBin);
    return `${resolve(codexBin)}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return codexBin;
  }
}

function readCapabilityCache(
  path: string,
  fingerprint: string
): RuntimeCapabilityMatrix | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.fingerprint !== fingerprint || !isRecord(parsed.matrix)) {
      return undefined;
    }
    return parsed.matrix as RuntimeCapabilityMatrix;
  } catch {
    return undefined;
  }
}

function emitBootstrap(
  phase: BootstrapPhase,
  extra: Record<string, unknown> = {}
): void {
  console.log(JSON.stringify({
    type: 'clawee_daemon_bootstrap',
    phase,
    at: new Date().toISOString(),
    ...extra
  }));
}

function emitBootstrapError(input: {
  code: string;
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}): void {
  console.log(JSON.stringify({
    type: 'clawee_daemon_bootstrap_error',
    at: new Date().toISOString(),
    ...input
  }));
}

function probeErrorCode(
  reason: string,
  exitCode: number | null,
  explicitCode?: string
): string {
  if (explicitCode !== undefined) return explicitCode;
  if (reason === 'spawn_failed') return 'CODEX_PROBE_SPAWN_FAILED';
  if (reason === 'spawn_timeout') return 'CODEX_PROBE_SPAWN_TIMEOUT';
  if (reason === 'timeout' || reason === 'inactivity_timeout') return 'CODEX_PROBE_TIMEOUT';
  if (exitCode !== 0) return 'CODEX_PROBE_EXIT_NON_ZERO';
  return 'CODEX_PROBE_NO_RESPONSE';
}

function probeErrorMessage(input: {
  terminationReason: string;
  exitCode: number | null;
  stderrSummary?: string;
}): string {
  if (input.stderrSummary !== undefined) return input.stderrSummary;
  if (input.exitCode !== null && input.exitCode !== 0) {
    return `Codex CLI 退出码为 ${input.exitCode}`;
  }
  return `Codex CLI 未返回有效回复（${input.terminationReason}）`;
}

async function runAvailabilityProbe(input: {
  codexBin: string;
  codexHome: string;
  dataDir: string;
  signal: AbortSignal;
  update(probe: CodexAvailabilityProbe): void;
}): Promise<void> {
  const result = await probeCodex({
    codexBin: input.codexBin,
    codexHome: input.codexHome,
    cwd: join(input.dataDir, 'probe'),
    timeoutMs: CODEX_PROBE_TIMEOUT_MS,
    signal: input.signal
  });
  if (input.signal.aborted) return;
  const checkedAt = new Date().toISOString();
  if (result.ready) {
    input.update({
      status: 'succeeded',
      checkedAt,
      durationMs: result.durationMs,
      responseReceived: result.responseReceived,
      markerMatched: result.markerMatched
    });
    return;
  }
  const errorCode = probeErrorCode(
    result.terminationReason,
    result.exitCode,
    result.errorCode
  );
  const message = probeErrorMessage(result);
  input.update({
    status: 'failed',
    checkedAt,
    durationMs: result.durationMs,
    responseReceived: result.responseReceived,
    markerMatched: result.markerMatched,
    errorCode,
    message
  });
  console.warn(`Codex 后台可用性验证失败 [${errorCode}]：${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
