export const DEV_RUNTIME_PROXY_BASE = '/.clawee/runtime';

export type DevDaemonConfig = {
  baseUrl: string;
  token: string;
};

export function parseDevDaemonConfig(input: {
  address: string;
  token: string;
}): DevDaemonConfig {
  const address = /^https?:\/\//.test(input.address)
    ? input.address
    : `http://${input.address}`;
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(address);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || input.token.length === 0
  ) {
    throw new Error('Runtime must use an explicit loopback HTTP origin and token');
  }
  return { baseUrl: address, token: input.token };
}

export function buildDevProxyTarget(baseUrl: string, incomingUrl: string): URL {
  const daemon = parseDaemonOrigin(baseUrl);
  const incoming = new URL(incomingUrl, 'http://127.0.0.1');
  if (
    incoming.pathname !== DEV_RUNTIME_PROXY_BASE
    && !incoming.pathname.startsWith(`${DEV_RUNTIME_PROXY_BASE}/`)
  ) {
    throw new Error('Runtime route is invalid');
  }
  const runtimePath = incoming.pathname.slice(DEV_RUNTIME_PROXY_BASE.length) || '/';
  validateRuntimePath(runtimePath);
  const target = new URL(`${runtimePath}${incoming.search}`, `${daemon.origin}/`);
  if (target.origin !== daemon.origin) {
    throw new Error('Runtime target must remain same-origin');
  }
  return target;
}

function parseDaemonOrigin(address: string): URL {
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(address);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Runtime origin is invalid');
  }
  return new URL(address);
}

function validateRuntimePath(path: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error('Runtime path is invalid');
  }
  for (const candidate of [path, decoded]) {
    if (
      candidate.startsWith('//')
      || candidate.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(candidate)
    ) {
      throw new Error('Runtime path is invalid');
    }
  }
}
