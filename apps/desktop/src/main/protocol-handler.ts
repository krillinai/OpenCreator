import { open, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { protocol } from 'electron';
import { fetchDesktopRequest } from './desktop-network.js';
import type { DaemonConnection } from '../shared/types.js';
import type { DesktopLogger } from './logger.js';
import {
  RuntimeProxyError,
  createRuntimeProxyHeaders,
  createRuntimeProxyTarget,
  isStreamingRuntimeUploadRequest,
  isRuntimeRequestUrl,
  readBoundedRequestBody,
  runtimeProxyErrorDetails
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

export type ProtocolHandlerController = {
  suspendRuntime(): void;
  resumeRuntime(): void;
};

export async function installProtocolHandler(input: {
  webRoot: string;
  bootstrapRoot: string;
  getConnection(): DaemonConnection | undefined;
  onTransportFailure?(connection: DaemonConnection): void;
  logger: DesktopLogger;
}): Promise<ProtocolHandlerController> {
  let runtimeSuspended = false;
  const activeRequests = new Set<AbortController>();
  await protocol.handle('opencreator-app', async request => {
    const url = new URL(request.url);
    if (isRuntimeRequestUrl(url)) {
      if (runtimeSuspended) {
        return jsonError(503, 'RUNTIME_SHUTTING_DOWN', 'OpenCreator Runtime is stopping');
      }
      const controller = new AbortController();
      activeRequests.add(controller);
      return await proxyRuntimeRequest(
        request,
        url,
        input.getConnection(),
        input.logger,
        AbortSignal.any([request.signal, controller.signal]),
        () => activeRequests.delete(controller),
        () => controller.abort(),
        input.onTransportFailure
      );
    }
    if (url.hostname === 'app') {
      return await staticResponse(input.webRoot, request, true);
    }
    if (url.hostname === 'bootstrap') {
      return await staticResponse(input.bootstrapRoot, request, false);
    }
    return new Response('Not found', { status: 404 });
  });
  return {
    suspendRuntime() {
      runtimeSuspended = true;
      for (const controller of activeRequests) controller.abort();
      activeRequests.clear();
    },
    resumeRuntime() {
      runtimeSuspended = false;
    }
  };
}

async function proxyRuntimeRequest(
  request: Request,
  url: URL,
  connection: DaemonConnection | undefined,
  logger: DesktopLogger,
  signal: AbortSignal,
  onComplete: () => void,
  abortUpstream: () => void,
  onTransportFailure?: (connection: DaemonConnection) => void
): Promise<Response> {
  if (connection === undefined) {
    onComplete();
    logger.warnRateLimited('runtime-proxy-unavailable', 'Runtime proxy connection unavailable', {
      method: request.method,
      path: url.pathname
    }, 5_000);
    return jsonError(503, 'RUNTIME_UNAVAILABLE', 'OpenCreator Runtime is not ready');
  }
  const startedAt = performance.now();
  let phase = 'target';
  let daemonPort: string | undefined;
  try {
    const target = createRuntimeProxyTarget(url, connection.address);
    daemonPort = target.port;
    phase = 'headers';
    const headers = createRuntimeProxyHeaders(request.headers, connection.token);
    const streamsUpload = isStreamingRuntimeUploadRequest(target, request);
    phase = 'body';
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
      signal
    };
    if (streamsUpload && body !== undefined) upstreamRequest.duplex = 'half';
    phase = 'fetch';
    signal.throwIfAborted();
    const upstream = await fetchDesktopRequest(target.toString(), upstreamRequest);
    return relayRuntimeResponse(upstream, logger, signal, onComplete, {
      method: request.method,
      path: url.pathname,
      daemonPort,
      startedAt,
      connection,
      abortUpstream,
      onTransportFailure
    });
  } catch (error) {
    onComplete();
    if (signal.aborted) {
      return jsonError(503, 'RUNTIME_REQUEST_ABORTED', 'Runtime request was cancelled');
    }
    if (error instanceof RuntimeProxyError) {
      return jsonError(error.status, error.code, error.message);
    }
    logger.warn('Runtime proxy request failed', {
      method: request.method,
      path: url.pathname,
      phase,
      durationMs: Math.round(performance.now() - startedAt),
      daemonPort,
      errors: runtimeProxyErrorDetails(error)
    });
    if (phase === 'fetch' && !request.signal.aborted) onTransportFailure?.(connection);
    return jsonError(502, 'RUNTIME_PROXY_FAILED', 'Runtime request failed');
  }
}

function relayRuntimeResponse(
  upstream: Response,
  logger: DesktopLogger,
  signal: AbortSignal,
  onComplete: () => void,
  context: {
    method: string;
    path: string;
    daemonPort: string;
    startedAt: number;
    connection: DaemonConnection;
    abortUpstream(): void;
    onTransportFailure?: (connection: DaemonConnection) => void;
  }
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
    onComplete();
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
    onComplete();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (released) return;
        if (result.done) {
          release();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (released) return;
        release();
        if (!signal.aborted) {
          logger.warn('Runtime proxy response stream failed', {
            method: context.method,
            path: context.path,
            phase: 'response-stream',
            durationMs: Math.round(performance.now() - context.startedAt),
            daemonPort: context.daemonPort,
            errors: runtimeProxyErrorDetails(error)
          });
          context.onTransportFailure?.(context.connection);
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      // Cancelling Chromium's response reader alone leaves its SSE connection open.
      context.abortUpstream();
      const cancellation = reader.cancel(reason);
      release();
      await cancellation.catch(() => undefined);
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
  request: Request,
  spaFallback: boolean
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { Allow: 'GET, HEAD' }
    });
  }
  const pathname = new URL(request.url).pathname;
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
  const info = await stat(path);
  const rangeHeader = request.headers.get('range') ?? undefined;
  const range = parseByteRange(rangeHeader, info.size);
  const headers = new Headers({
    'Content-Type': contentType(path),
    'Cache-Control': extname(path) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Accept-Ranges': 'bytes'
  });
  if (rangeHeader !== undefined && range === undefined) {
    headers.set('Content-Range', `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const contentLength = Math.max(0, end - start + 1);
  headers.set('Content-Length', String(contentLength));
  if (range !== undefined) {
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  if (extname(path) === '.html') {
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
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
  if (request.method === 'HEAD' || contentLength === 0) {
    return new Response(null, { status: range === undefined ? 200 : 206, headers });
  }
  return new Response(await fileRangeStream(path, start, end), {
    status: range === undefined ? 200 : 206,
    headers
  });
}

function parseByteRange(
  value: string | undefined,
  size: number
): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (match === null || size === 0) return undefined;
  const [, startValue, endValue] = match;
  if (startValue === '' && endValue === '') return undefined;
  if (startValue === '') {
    const suffixLength = Number(endValue);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(startValue);
  const requestedEnd = endValue === '' ? size - 1 : Number(endValue);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)) return undefined;
  if (start < 0 || start >= size || requestedEnd < start) return undefined;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function fileRangeStream(
  path: string,
  start: number,
  end: number
): Promise<ReadableStream<Uint8Array>> {
  const handle = await open(path, 'r');
  let position = start;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (position > end) {
        await close();
        controller.close();
        return;
      }
      try {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, end - position + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) {
          await close();
          controller.close();
          return;
        }
        position += bytesRead;
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        await close().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel() {
      await close().catch(() => undefined);
    }
  });
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
    case '.mp4': return 'video/mp4';
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
