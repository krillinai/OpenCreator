import { connect } from 'node:net';
import { request } from 'node:https';
import { connect as connectTls } from 'node:tls';
import { HttpsProxyAgent } from 'https-proxy-agent';

export type CreatorNetworkProbeResult =
  | { status: 'not_configured' | 'proxy_unreachable' | 'proxy_auth_required' | 'upstream_unreachable' }
  | { status: 'reachable'; httpStatus: number };

export async function probeCreatorNetwork(proxy: string): Promise<CreatorNetworkProbeResult> {
  if (!proxy.trim()) return { status: 'not_configured' };
  const url = new URL(proxy);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!await proxyEndpointReachable(host, port, url.protocol === 'https:')) {
    return { status: 'proxy_unreachable' };
  }
  return await new Promise<CreatorNetworkProbeResult>(resolve => {
    let tunnelStatus: number | undefined;
    const check = request('https://www.youtube.com/robots.txt', {
      method: 'HEAD',
      agent: new HttpsProxyAgent(proxy),
      signal: AbortSignal.timeout(8000)
    }, response => {
      response.resume();
      resolve(tunnelStatus === 407
        ? { status: 'proxy_auth_required' }
        : tunnelStatus !== undefined && tunnelStatus !== 200
        ? { status: 'upstream_unreachable' }
        : { status: 'reachable', httpStatus: response.statusCode ?? 0 });
    });
    check.on('proxyConnect', (connection: { statusCode: number }) => { tunnelStatus = connection.statusCode; });
    check.once('error', () => resolve({ status: 'upstream_unreachable' }));
    check.end();
  });
}

function proxyEndpointReachable(host: string, port: number, secure: boolean): Promise<boolean> {
  return new Promise(resolve => {
    const socket = secure
      ? connectTls({ host, port, servername: host })
      : connect({ host, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(3000, () => finish(false));
    socket.once(secure ? 'secureConnect' : 'connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
