import react from '@vitejs/plugin-react';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { URL } from 'node:url';
import type { Readable } from 'node:stream';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

type RuntimeConfig = {
  baseUrl: string;
  token: string;
};

type RuntimeProcess = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  config: Promise<RuntimeConfig>;
};

let runtimeProcess: RuntimeProcess | undefined;
const DEV_RUNTIME_PROXY_BASE = '/.clawee/runtime';

export default defineConfig({
  plugins: [react(), claweeRuntimeDevPlugin()],
  server: {
    host: '127.0.0.1',
    port: 9000,
    strictPort: false
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
          response.end(JSON.stringify({ baseUrl: DEV_RUNTIME_PROXY_BASE, token: config.token }));
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
      stdout += chunk;
      const parsed = parseRuntimeConfigFromOutput(stdout);
      if (parsed !== null) {
        clearTimeout(timeout);
        resolve(parsed);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
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
      return { baseUrl: normalizeRuntimeAddress(record.address), token: record.token };
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeRuntimeAddress(address: string): string {
  if (/^https?:\/\//.test(address)) return address;
  return `http://${address}`;
}

function proxyRuntimeRequest(
  config: RuntimeConfig,
  incoming: import('node:http').IncomingMessage,
  outgoing: import('node:http').ServerResponse
) {
  const incomingUrl = incoming.url ?? '/';
  const runtimePath = incomingUrl.startsWith(DEV_RUNTIME_PROXY_BASE)
    ? incomingUrl.slice(DEV_RUNTIME_PROXY_BASE.length) || '/'
    : incomingUrl || '/';
  const target = new URL(runtimePath, config.baseUrl.replace(/\/+$/, '') + '/');
  const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = { ...incoming.headers };
  delete headers.host;
  delete headers.connection;

  const proxyRequest = requestImpl(
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
