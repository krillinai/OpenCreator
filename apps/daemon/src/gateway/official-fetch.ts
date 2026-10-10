import { execFile } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function createOfficialFetch(input: {
  readProxy?(): Promise<string>;
  platform?: NodeJS.Platform;
} = {}): typeof fetch {
  let systemProxy: Promise<string> | undefined;
  let proxyCheckedAt = 0;
  async function proxy() {
    const configured = (await input.readProxy?.())?.trim();
    if (configured) return configured;
    if ((input.platform ?? process.platform) !== 'darwin') return '';
    if (!systemProxy || Date.now() - proxyCheckedAt > 30_000) {
      proxyCheckedAt = Date.now();
      systemProxy = new Promise<string>(resolve => {
        execFile('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 1_000 }, (error, stdout) => {
          if (error) { resolve(''); return; }
          const field = (name: string) => new RegExp(`^\\s*${name}\\s*:\\s*(\\S+)\\s*$`, 'm').exec(stdout)?.[1];
          const host = field('HTTPSProxy');
          const port = Number(field('HTTPSPort'));
          resolve(field('HTTPSEnable') === '1' && host && /^[a-zA-Z0-9.-]+$/.test(host)
            && Number.isInteger(port) && port > 0 && port <= 65535 ? `http://${host}:${port}` : '');
        });
      });
    }
    return systemProxy;
  }
  return async (target, options) => {
    const request = new Request(target, options);
    request.headers.set('Accept-Encoding', 'identity');
    const address = await proxy();
    request.signal.throwIfAborted();
    if (!address || new URL(request.url).protocol !== 'https:') return fetch(request);
    const content = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    const headers = Object.fromEntries(request.headers);
    if (content) headers['content-length'] = String(content.length);
    // Return the stream as soon as headers arrive; image persistence owns its deadline.
    return new Promise<Response>((resolve, reject) => {
      const remote = httpsRequest(request.url, {
        method: request.method, headers, agent: new HttpsProxyAgent(address), signal: request.signal
      }, response => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const encoding = responseHeaders.get('content-encoding')?.toLowerCase();
        const decoder = encoding === 'gzip' ? createGunzip()
          : encoding === 'br' ? createBrotliDecompress()
          : encoding === 'deflate' ? createInflate() : undefined;
        const body = decoder ? response.pipe(decoder) : response;
        if (decoder) {
          response.once('error', error => decoder.destroy(error));
          decoder.once('close', () => response.destroy());
          responseHeaders.delete('content-encoding');
        }
        responseHeaders.delete('content-length');
        responseHeaders.delete('transfer-encoding');
        const status = response.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null
          : Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      });
      remote.once('error', reject);
      remote.end(content);
    });
  };
}
