import { stat, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { protocol } from 'electron';
import type { DaemonConnection } from '../shared/types.js';
import type { DesktopLogger } from './logger.js';
import {
  RuntimeProxyError,
  createRuntimeProxyHeaders,
  createRuntimeProxyTarget,
  isStreamingRuntimeUploadRequest,
  isRuntimeRequestUrl,
  readBoundedRequestBody
} from './runtime-proxy.js';

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'opencreator-app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        allowServiceWorkers: false,
        bypassCSP: false
      }
    }
  ]);
}

export async function installProtocolHandler(input: {
  webRoot: string;
  bootstrapRoot: string;
  getConnection(): DaemonConnection | undefined;
  logger: DesktopLogger;
}): Promise<void> {
  await protocol.handle('opencreator-app', async request => {
    const url = new URL(request.url);
    if (isRuntimeRequestUrl(url)) {
      return await proxyRuntimeRequest(request, url, input.getConnection(), input.logger);
    }
    if (url.hostname === 'app') {
      return await staticResponse(input.webRoot, url.pathname, true);
    }
    if (url.hostname === 'bootstrap') {
      return await staticResponse(input.bootstrapRoot, url.pathname, false);
    }
    return new Response('Not found', { status: 404 });
  });
}

async function proxyRuntimeRequest(
  request: Request,
  url: URL,
  connection: DaemonConnection | undefined,
  logger: DesktopLogger
): Promise<Response> {
  if (connection === undefined) {
    return jsonError(503, 'RUNTIME_UNAVAILABLE', 'OpenCreator Runtime is not ready');
  }
  try {
    const target = createRuntimeProxyTarget(url, connection.address);
    const headers = createRuntimeProxyHeaders(request.headers, connection.token);
    const streamsUpload = isStreamingRuntimeUploadRequest(target, request);
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : streamsUpload
        ? request.body ?? undefined
        : await readBoundedRequestBody(request);
    const upstreamRequest: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: request.signal
    };
    if (streamsUpload && body !== undefined) upstreamRequest.duplex = 'half';
    const upstream = await fetch(target.toString(), upstreamRequest);
    return relayRuntimeResponse(upstream, logger);
  } catch (error) {
    if (error instanceof RuntimeProxyError) {
      return jsonError(error.status, error.code, error.message);
    }
    logger.warn('Runtime proxy request failed', {
      path: url.pathname,
      message: error instanceof Error ? error.message : String(error)
    });
    return jsonError(502, 'RUNTIME_PROXY_FAILED', 'Runtime request failed');
  }
}

function relayRuntimeResponse(
  upstream: Response,
  logger: DesktopLogger
): Response {
  const headers = new Headers(upstream.headers);
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
  ]) {
    headers.delete(name);
  }
  const source = upstream.body;
  if (source === null) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
  const reader = source.getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        release();
        logger.warn('Runtime proxy response stream failed', {
          message: error instanceof Error ? error.message : String(error)
        });
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      release();
    }
  });
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export async function staticResponse(
  root: string,
  pathname: string,
  spaFallback: boolean
): Promise<Response> {
  let path: string;
  try {
    path = resolveStaticPath(root, pathname);
  } catch {
    return new Response('Forbidden', { status: 403 });
  }
  if (!await isFile(path)) {
    if (!spaFallback || !shouldUseSpaFallback(pathname)) {
      return new Response('Not found', { status: 404 });
    }
    path = resolve(root, 'index.html');
    if (!await isFile(path)) return new Response('Not found', { status: 404 });
  }
  const headers = new Headers({
    'Content-Type': contentType(path),
    'Cache-Control': extname(path) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  if (extname(path) === '.html') {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://i.ytimg.com",
        "font-src 'self' data:",
        "connect-src 'self' blob:",
        "worker-src 'self' blob:",
        "media-src 'self' blob: https: http:",
        "frame-src https://www.youtube-nocookie.com https://player.bilibili.com",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'"
      ].join('; ')
    );
  }
  return new Response(await readFile(path), { status: 200, headers });
}

function resolveStaticPath(root: string, pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' || decoded.length === 0
    ? 'index.html'
    : decoded.replace(/^\/+/, '');
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, relative);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error('Path escapes static root');
  }
  return candidate;
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

function shouldUseSpaFallback(pathname: string): boolean {
  try {
    const decoded = decodeURIComponent(pathname);
    return decoded === '/'
      || decoded.endsWith('/')
      || extname(decoded) === '';
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
