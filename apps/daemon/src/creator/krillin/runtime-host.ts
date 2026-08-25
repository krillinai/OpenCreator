import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { terminateProcessTree } from '../process-tree.js';
import {
  readKrillinRuntimeManifest,
  resolveInside,
  verifyKrillinRuntimeManifest
} from './manifest.js';
import { createKrillinServiceClient, type KrillinServiceClient } from './service-client.js';

type RunningService = {
  child: ChildProcessWithoutNullStreams;
  client: KrillinServiceClient;
  generation: number;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

export type KrillinRuntimeHost = ReturnType<typeof createKrillinRuntimeHost>;

export function createKrillinRuntimeHost(input: {
  resourceRoot: string;
  jobsRoot: string;
  startupTimeoutMs?: number;
  spawn?: typeof spawn;
  tokenFactory?(): string;
}) {
  const spawnProcess = input.spawn ?? spawn;
  let running: RunningService | undefined;
  let starting: Promise<RunningService> | undefined;
  let closed = false;

  async function start(): Promise<RunningService> {
    if (closed) throw new Error('krillin_runtime_host_closed');
    if (running !== undefined && running.child.exitCode === null && !running.child.killed) return running;
    if (starting !== undefined) return starting;
    starting = launch().finally(() => { starting = undefined; });
    return starting;
  }

  async function launch(): Promise<RunningService> {
    const resourceRoot = resolve(input.resourceRoot);
    const jobsRoot = resolve(input.jobsRoot);
    const manifest = readKrillinRuntimeManifest(resourceRoot);
    verifyKrillinRuntimeManifest(resourceRoot, manifest);
    if (manifest.protocolVersion !== 1 || manifest.protocolSha256 === undefined) {
      throw new Error('dependency_not_packaged: KrillinAI Protocol V1 schema');
    }
    const protocolSchema = manifest.resources.find(resource => resource.path === 'api/opencreator/v1/schema.json');
    if (protocolSchema?.sha256.toLowerCase() !== manifest.protocolSha256.toLowerCase()) {
      throw new Error('dependency_hash_mismatch: KrillinAI Protocol V1 schema');
    }
    const service = manifest.resources.find(resource => (
      resource.kind === 'executable'
      && /(?:^|\/)krillinai-opencreator-server(?:\.exe)?$/i.test(resource.path)
    ));
    if (service === undefined) {
      throw new Error('dependency_not_packaged: krillinai-opencreator-server');
    }
    mkdirSync(jobsRoot, { recursive: true });
    const token = input.tokenFactory?.() ?? randomBytes(32).toString('hex');
    const child = spawnProcess(resolveInside(resourceRoot, service.path), [], {
      cwd: jobsRoot,
      env: {
        ...minimalEnvironment(process.env),
        KRILLINAI_RESOURCE_ROOT: resourceRoot,
        KRILLINAI_OFFLINE_DEPENDENCIES: '1',
        OPENCREATOR_KRILLIN_LISTEN: '127.0.0.1:0',
        OPENCREATOR_KRILLIN_JOBS_ROOT: jobsRoot,
        OPENCREATOR_KRILLIN_TOKEN: token
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true
    }) as unknown as ChildProcessWithoutNullStreams;
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    try {
      const startup = await readStartup(child, input.startupTimeoutMs ?? 15_000);
      const client = createKrillinServiceClient({
        origin: `http://127.0.0.1:${startup.port}`,
        token
      });
      const health = await client.health();
      if (!health.ok || health.generation !== startup.generation) {
        throw new Error('krillin_service_generation_mismatch');
      }
      if (closed) throw new Error('krillin_runtime_host_closed');
      const instance: RunningService = { child, client, generation: startup.generation, exited };
      running = instance;
      void exited.then(() => {
        if (running === instance) running = undefined;
      });
      return instance;
    } catch (cause) {
      await terminateProcessTree(child.pid);
      throw cause;
    }
  }

  return {
    async client(): Promise<KrillinServiceClient> {
      return (await start()).client;
    },
    async describe() {
      const service = await start();
      const capabilities = await service.client.capabilities();
      return { pid: service.child.pid, generation: service.generation, capabilities };
    },
    async restart(): Promise<KrillinServiceClient> {
      const previous = running;
      running = undefined;
      if (previous !== undefined) await stop(previous);
      return (await start()).client;
    },
    async close(): Promise<void> {
      closed = true;
      const pending = starting;
      if (pending !== undefined) await pending.catch(() => undefined);
      const service = running;
      running = undefined;
      if (service !== undefined) await stop(service);
    }
  };
}

async function stop(service: RunningService): Promise<void> {
  await terminateProcessTree(service.child.pid);
  await Promise.race([
    service.exited.then(() => undefined),
    new Promise<void>(resolvePromise => setTimeout(resolvePromise, 2_000))
  ]);
}

async function readStartup(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<{ port: number; generation: number }> {
  return new Promise((resolvePromise, reject) => {
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    const timeout = setTimeout(() => fail(new Error('krillin_service_start_timeout')), timeoutMs);
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${String(chunk)}`.slice(-4_000);
    });
    const onError = (error: Error) => fail(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(new Error(`krillin_service_exited_before_ready: ${code ?? signal}: ${redact(stderr)}`));
    };
    child.once('error', onError);
    child.once('exit', onExit);
    lines.once('line', line => {
      try {
        const parsed = JSON.parse(line) as { port?: unknown; generation?: unknown };
        if (!Number.isInteger(parsed.port) || Number(parsed.port) <= 0 || !Number.isSafeInteger(parsed.generation)) {
          throw new Error('invalid startup frame');
        }
        cleanup();
        resolvePromise({ port: Number(parsed.port), generation: Number(parsed.generation) });
      } catch (cause) {
        fail(new Error(`krillin_service_invalid_startup: ${cause instanceof Error ? cause.message : String(cause)}`));
      }
    });

    function fail(error: Error) {
      cleanup();
      void terminateProcessTree(child.pid);
      reject(error);
    }

    function cleanup() {
      clearTimeout(timeout);
      lines.close();
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    }
  });
}

function minimalEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL'];
  return Object.fromEntries(names.flatMap(name => env[name] === undefined ? [] : [[name, env[name]]])) as NodeJS.ProcessEnv;
}

function redact(value: string): string {
  return value.replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*\S+/gi, '$1=[redacted]');
}
