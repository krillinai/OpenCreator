import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { statelessResponses } from './direct-transport.js';
import { officialEventStream } from './official-stream.js';

export async function createDirectRuntime(key: string, fetcher: typeof fetch = fetch, beginUse?: () => Promise<{ key: string; release(): Promise<void> }>) {
  const token = `oclocal_${randomBytes(32).toString('base64url')}`;
  const active = new Set<AbortController>();
  const handlers = new Set<Promise<void>>();
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/responses' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    const controller = new AbortController(); active.add(controller);
    let complete!: () => void;
    const done = new Promise<void>(resolve => { complete = resolve; }); handlers.add(done);
    const abort = () => controller.abort(); res.once('close', abort);
    let release: (() => Promise<void>) | undefined;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024 * 1024) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)); }
      const body = statelessResponses(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      const use = await beginUse?.(); release = use?.release;
      const response = await fetcher('https://openrouter.ai/api/v1/responses', { method: 'POST', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { Authorization: `Bearer ${use?.key ?? key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        res.writeHead(response.status === 402 ? 402 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: response.status === 402 ? '积分不足' : '官方模型服务暂不可用' } })); return;
      }
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') ?? 'text/event-stream', 'Cache-Control': 'no-store' });
      const bodyStream = response.headers.get('content-type')?.includes('text/event-stream') ? officialEventStream(response.body) : response.body;
      await pipeline(Readable.fromWeb(bodyStream as import('node:stream/web').ReadableStream), res);
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: '官方模型服务暂不可用' } }));
      else res.destroy();
    } finally {
      try { await release?.(); }
      finally { active.delete(controller); res.removeListener('close', abort); handlers.delete(done); complete(); }
    }
  });
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local service unavailable');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, token,
    async close() { for (const controller of active) controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await Promise.all(handlers); key = ''; }
  };
}
