import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer
} from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktopE2EEnterpriseEmail = 'desktop-e2e@example.com';
export const desktopE2EEnterprisePassword = 'desktop-e2e-password';

const keyringService = 'com.opencreator.enterprise.e2e';
const agentIdPattern =
  /^opencreator_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rootDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

export class FakeEnterpriseAuthServer {
  private server: Server | undefined;
  private readonly token = `desktop-e2e-${randomUUID()}`;
  private agentId: string | undefined;

  async start(): Promise<string> {
    if (this.server !== undefined) {
      throw new Error('Fake enterprise auth server started twice');
    }
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        sendJson(response, 500, {
          error: { code: 'fake_server_failed' }
        });
      });
    });
    await new Promise<void>((resolveStart, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolveStart());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Fake enterprise auth server has no TCP address');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const current = this.server;
    this.server = undefined;
    if (current === undefined) return;
    current.closeIdleConnections();
    current.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => {
      current.close(error => {
        if (error) reject(error);
        else resolveClose();
      });
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const path = new URL(
      request.url ?? '/',
      'http://127.0.0.1'
    ).pathname;

    if (request.method === 'POST' && path === '/api/v1/auth/login') {
      const body = await readJsonBody(request);
      if (
        !isRecord(body)
        || body.email !== desktopE2EEnterpriseEmail
        || body.password !== desktopE2EEnterprisePassword
        || body.client_id !== 'opencreator-agent'
        || typeof body.agent_id !== 'string'
        || !agentIdPattern.test(body.agent_id)
      ) {
        sendJson(response, 401, { error: { code: 'unauthorized' } });
        return;
      }
      this.agentId = body.agent_id;
      sendJson(response, 200, {
        data: {
          account: enterpriseAccount(),
          agent: enterpriseAgent(this.agentId),
          access_token: this.token,
          token_type: 'Bearer',
          expires_at: '2099-08-06T00:00:00.000Z'
        }
      });
      return;
    }

    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendJson(response, 401, { error: { code: 'unauthorized' } });
      return;
    }

    if (request.method === 'GET' && path === '/api/v1/auth/me') {
      if (this.agentId === undefined) {
        sendJson(response, 401, { error: { code: 'unauthorized' } });
        return;
      }
      sendJson(response, 200, {
        data: {
          account: enterpriseAccount(),
          agent: enterpriseAgent(this.agentId),
          collector_registration: {
            exists: true,
            revoked: false,
            install_command: 'exit 0',
            install_powershell_command: 'exit 0'
          },
          applications: { frontend: true }
        }
      });
      return;
    }

    if (request.method === 'POST' && path === '/api/v1/auth/logout') {
      response.statusCode = 204;
      response.end();
      return;
    }

    sendJson(response, 404, { error: { code: 'not_found' } });
  }
}

export function writeEnterpriseE2EConfig(
  path: string,
  gateway: string
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `gateway = ${JSON.stringify(gateway)}\n`);
}

export async function deleteEnterpriseE2ECredential(
  runId: string
): Promise<void> {
  const cleanupScript = `
    const { createRequire } = require('node:module');
    const requireFromDaemon = createRequire(process.argv[1]);
    const { AsyncEntry } = requireFromDaemon('@napi-rs/keyring');
    const entry = new AsyncEntry(
      ${JSON.stringify(keyringService)},
      'opencreator-agent:' + process.argv[2]
    );
    entry.deletePassword().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  `;
  const child = spawn(process.execPath, [
    '-e',
    cleanupScript,
    join(rootDir, 'apps', 'daemon', 'package.json'),
    runId
  ], {
    stdio: 'ignore',
    windowsHide: true
  });
  await new Promise<void>((resolveCleanup, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      child.unref();
      reject(new Error('Enterprise E2E keyring cleanup timed out'));
    }, 3_000);
    timeout.unref();
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolveCleanup();
      else reject(new Error('Enterprise E2E keyring cleanup failed'));
    });
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 64 * 1024) throw new Error('Fake auth body is too large');
    chunks.push(value);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function enterpriseAccount() {
  return {
    account_id: 'acct_desktop_e2e',
    email: desktopE2EEnterpriseEmail,
    name: 'Desktop E2E',
    status: 'active'
  };
}

function enterpriseAgent(agentId: string) {
  return {
    agent_id: agentId,
    name: 'Desktop E2E'
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
