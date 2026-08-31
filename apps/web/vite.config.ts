import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import {
  DEV_RUNTIME_PROXY_BASE,
  buildDevProxyTarget,
  parseDevDaemonConfig,
  type DevDaemonConfig
} from './src/runtime/dev-proxy-target.js';

type RuntimeConfig = DevDaemonConfig;

type RuntimeProcess = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  config: Promise<RuntimeConfig>;
};

let runtimeProcess: RuntimeProcess | undefined;
const MAX_RUNTIME_OUTPUT_BUFFER = 1024 * 1024;
const webDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), opencreatorRuntimeDevPlugin()],
  server: {
    host: '127.0.0.1',
    port: 19861,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});

function opencreatorRuntimeDevPlugin(): Plugin {
  return {
    name: 'opencreator-runtime-dev',
    configureServer(server) {
      server.middlewares.use('/.opencreator/runtime-config', async (_request, response) => {
        try {
          const config = await getRuntimeConfig();
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ baseUrl: DEV_RUNTIME_PROXY_BASE }));
        } catch (error) {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({
            error: {
              code: 'RUNTIME_START_FAILED',
              message: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      });

      server.middlewares.use(DEV_RUNTIME_PROXY_BASE, async (request, response) => {
        try {
          const config = await getRuntimeConfig();
          proxyRuntimeRequest(config, request, response);
        } catch (error) {
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({
            error: {
              code: 'RUNTIME_PROXY_FAILED',
              message: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      });

      server.httpServer?.once('close', () => {
        stopRuntimeProcess();
      });
    },
    closeBundle() {
      stopRuntimeProcess();
    }
  };
}

function stopRuntimeProcess(): void {
  const activeRuntime = runtimeProcess;
  runtimeProcess = undefined;
  if (activeRuntime !== undefined) terminateRuntimeProcess(activeRuntime.child);
}

function getRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeProcess ??= startRuntimeProcess();
  return runtimeProcess.config;
}

function startRuntimeProcess(): RuntimeProcess {
  const creatorRuntimeRoot = resolveDevCreatorRuntimeRoot();
  const ytDlpPath = resolveDevYtDlpPath();
  const packageManager = packageManagerCommand(
    process.env.OPENCREATOR_RUNTIME_DEV_PREPARED === '1'
      ? [
          '--filter',
          '@opencreator/daemon',
          'exec',
          'node',
          '--import',
          'tsx',
          'src/main.ts',
          '--opencreator-enterprise-config=.runtime/config.toml'
        ]
      : [
          '--filter',
          '@opencreator/daemon',
          'dev'
        ]
  );
  const child = spawn(packageManager.command, packageManager.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(creatorRuntimeRoot === undefined
        ? {}
        : { OPENCREATOR_CREATOR_RUNTIME_ROOT: creatorRuntimeRoot }),
      ...(ytDlpPath === undefined
        ? {}
        : { OPENCREATOR_YT_DLP_PATH: ytDlpPath })
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  const config = new Promise<RuntimeConfig>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Runtime did not print connection config in time. ${stderr.trim()}`.trim()));
    }, 30_000);

    const rejectOnce = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = boundedAppend(stdout, chunk);
      const parsed = parseRuntimeConfigFromOutput(stdout);
      if (parsed !== null) {
        clearTimeout(timeout);
        stdout = '';
        stderr = '';
        resolve(parsed);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = boundedAppend(stderr, chunk);
    });

    child.on('error', error => {
      if (runtimeProcess?.child === child) runtimeProcess = undefined;
      rejectOnce(error);
    });

    child.on('exit', (code, signal) => {
      const wasActiveRuntime = runtimeProcess?.child === child;
      if (wasActiveRuntime) runtimeProcess = undefined;
      if (code !== null && code !== 0) {
        rejectOnce(new Error(`Runtime exited with code ${code}. ${stderr.trim()}`.trim()));
      }
      if (wasActiveRuntime) {
        console.warn(
          `[clawee-runtime-dev] Runtime exited (${code === null ? signal ?? 'unknown' : `code ${code}`}); it will restart on the next request.`
        );
      }
    });
  });

  return { child, config };
}

function resolveDevCreatorRuntimeRoot(): string | undefined {
  const configured = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT?.trim();
  if (configured) return resolve(configured);

  const candidate = resolve(
    webDir,
    '../desktop/.pack/creator-runtime/krillinai'
  );
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const requiredAssets = [
    join(candidate, 'manifest.json'),
    join(candidate, 'api', 'opencreator', 'v1', 'schema.json'),
    join(candidate, 'bin', `krillinai-cli${executableSuffix}`)
  ];
  return requiredAssets.every(path => existsSync(path)) ? candidate : undefined;
}

function resolveDevYtDlpPath(): string | undefined {
  const configured = process.env.OPENCREATOR_YT_DLP_PATH?.trim();
  return configured ? resolve(configured) : undefined;
}

function terminateRuntimeProcess(child: RuntimeProcess['child']): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5_000
    });
    return;
  }
  child.kill('SIGTERM');
}

function packageManagerCommand(args: string[]): {
  command: string;
  args: string[];
} {
  const cli = [
    process.env.npm_execpath,
    process.platform === 'win32' && process.env.APPDATA !== undefined
      ? join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
      : undefined
  ].find(candidate => (
    typeof candidate === 'string'
    && /\.(?:c|m)?js$/i.test(candidate)
    && existsSync(candidate)
  ));
  if (typeof cli === 'string' && /\.(?:c|m)?js$/i.test(cli)) {
    return { command: process.execPath, args: [cli, ...args] };
  }
  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args
  };
}

function parseRuntimeConfigFromOutput(output: string): RuntimeConfig | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (typeof record.address !== 'string' || typeof record.token !== 'string') continue;
      return parseDevDaemonConfig({
        address: record.address,
        token: record.token
      });
    } catch {
      continue;
    }
  }

  return null;
}

function proxyRuntimeRequest(
  config: RuntimeConfig,
  incoming: import('node:http').IncomingMessage,
  outgoing: import('node:http').ServerResponse
) {
  const incomingUrl = incoming.url ?? '/';
  const fullRuntimeUrl = incomingUrl.startsWith(DEV_RUNTIME_PROXY_BASE)
    ? incomingUrl
    : `${DEV_RUNTIME_PROXY_BASE}${incomingUrl.startsWith('/') ? '' : '/'}${incomingUrl}`;
  const target = buildDevProxyTarget(config.baseUrl, fullRuntimeUrl);
  const headers = { ...incoming.headers };
  for (const name of ['authorization', 'host', 'origin', 'referer', 'connection']) {
    delete headers[name];
  }
  headers.authorization = `Bearer ${config.token}`;

  let proxyResponse: import('node:http').IncomingMessage | undefined;

  const proxyRequest = httpRequest(
    target,
    {
      method: incoming.method,
      headers
    },
    response => {
      proxyResponse = response;
      outgoing.statusCode = response.statusCode ?? 502;
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) outgoing.setHeader(name, value);
      }
      response.pipe(outgoing);
    }
  );

  const destroyUpstream = () => {
    proxyResponse?.destroy();
    proxyRequest.destroy();
  };

  incoming.on('aborted', destroyUpstream);
  outgoing.on('close', () => {
    if (!outgoing.writableEnded) destroyUpstream();
  });

  proxyRequest.on('error', error => {
    if (outgoing.headersSent) {
      outgoing.destroy(error);
      return;
    }

    outgoing.statusCode = 502;
    outgoing.setHeader('Content-Type', 'application/json');
    outgoing.end(JSON.stringify({
      error: {
        code: 'RUNTIME_PROXY_FAILED',
        message: error.message
      }
    }));
  });

  incoming.pipe(proxyRequest);
}

function boundedAppend(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_RUNTIME_OUTPUT_BUFFER
    ? next
    : next.slice(-MAX_RUNTIME_OUTPUT_BUFFER);
}
