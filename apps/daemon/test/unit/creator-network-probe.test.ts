import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { probeCreatorNetwork } from '../../src/creator-services/network-probe.js';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('creator network probe', () => {
  it('distinguishes a refused local proxy from a video-site failure', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No test proxy address');
    const port = address.port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(await probeCreatorNetwork(`http://127.0.0.1:${port}`)).toMatchObject({ status: 'proxy_unreachable' });
  });

  it('identifies an accessible proxy whose upstream tunnel is rejected', async () => {
    const server = createServer();
    servers.push(server);
    server.on('connect', (_request, socket) => {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No test proxy address');
    expect(await probeCreatorNetwork(`http://127.0.0.1:${address.port}`)).toMatchObject({ status: 'upstream_unreachable' });
  });

  it('reports proxy authentication separately from upstream reachability', async () => {
    const server = createServer();
    servers.push(server);
    server.on('connect', (_request, socket) => {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No test proxy address');
    expect(await probeCreatorNetwork(`http://127.0.0.1:${address.port}`)).toEqual({ status: 'proxy_auth_required' });
  });
});
