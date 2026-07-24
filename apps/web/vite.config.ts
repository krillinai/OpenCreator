import react from '@vitejs/plugin-react';
import { request as httpRequest } from 'node:http';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
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

export default defineConfig({
  plugins: [react(), claweeRuntimeDevPlugin()],
  server: {
    host: '127.0.0.1',
    port: 9000,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});

function claweeRuntimeDevPlugin(): Plugin {
  return {
    name: 'clawee-runtime-dev',
    configureServer(server) {
      server.middlewares.use('/.clawee/runtime-config', async (_request, response) => {
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
        runtimeProcess?.child.kill();
        runtimeProcess = undefined;
      });
    }
  };
}

function getRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeProcess ??= startRuntimeProcess();
  return runtimeProcess.config;
}

function startRuntimeProcess(): RuntimeProcess {
  const child = spawn('pnpm', ['--filter', '@clawee/daemon', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
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
      rejectOnce(error);
    });

    child.on('exit', code => {
      if (code !== null && code !== 0) {
        rejectOnce(new Error(`Runtime exited with code ${code}. ${stderr.trim()}`.trim()));
      }
    });
  });

  return { child, config };
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

  const proxyRequest = httpRequest(
    target,
    {
      method: incoming.method,
      headers
    },
    proxyResponse => {
      outgoing.statusCode = proxyResponse.statusCode ?? 502;
      for (const [name, value] of Object.entries(proxyResponse.headers)) {
        if (value !== undefined) outgoing.setHeader(name, value);
      }
      proxyResponse.pipe(outgoing);
    }
  );

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
