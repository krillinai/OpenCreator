import { createHash } from 'node:crypto';
import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKrillinRuntimeHost, type KrillinRuntimeHost } from '../../src/creator/krillin/runtime-host.js';
import { createKrillinServiceClient } from '../../src/creator/krillin/service-client.js';

let tempDir = '';
let host: KrillinRuntimeHost | undefined;

afterEach(async () => {
  await host?.close();
  host = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Krillin Runtime Host', () => {
  it('uses the jobs root for writable state and cleans up restart and close processes', async () => {
    const fixture = createRuntimeFixture();
    const runtimeFilesBefore = listFiles(fixture.resourceRoot);
    host = createKrillinRuntimeHost({
      resourceRoot: fixture.resourceRoot,
      jobsRoot: fixture.jobsRoot,
      startupTimeoutMs: 3_000,
      tokenFactory: () => 'runtime-host-test-token',
      spawn: ((_command, _args, options) => spawn(
        process.execPath,
        [fixture.serverScript],
        options as SpawnOptionsWithoutStdio
      )) as typeof spawn
    });

    const first = await host.describe();
    expect(first.capabilities).toMatchObject({
      protocolVersion: 1,
      serviceVersion: 'fixture',
      stages: ['download', 'subtitle', 'tts', 'render-horizontal', 'render-vertical']
    });
    expect(statSync(fixture.jobsRoot).isDirectory()).toBe(true);
    expect(listFiles(fixture.resourceRoot)).toEqual(runtimeFilesBefore);
    expect(listFiles(fixture.jobsRoot)).toContain('app.log');

    const firstState = JSON.parse(readFileSync(
      join(fixture.jobsRoot, `service-state-${first.pid}.json`),
      'utf8'
    )) as { port: number };
    const wrongTokenClient = createKrillinServiceClient({
      origin: `http://127.0.0.1:${firstState.port}`,
      token: 'wrong-token'
    });
    await expect(wrongTokenClient.health()).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401
    });

    await host.restart();
    const second = await host.describe();
    expect(second.pid).not.toBe(first.pid);
    await expectProcessToExit(first.pid);

    await host.close();
    host = undefined;
    await expectProcessToExit(second.pid);
    expect(listFiles(fixture.resourceRoot)).toEqual(runtimeFilesBefore);
  });

  it('rejects a tampered packaged service before spawning it', async () => {
    const fixture = createRuntimeFixture();
    writeFileSync(fixture.servicePath, 'tampered');
    let spawnCount = 0;
    host = createKrillinRuntimeHost({
      resourceRoot: fixture.resourceRoot,
      jobsRoot: fixture.jobsRoot,
      spawn: ((..._args: Parameters<typeof spawn>) => {
        spawnCount += 1;
        return spawn(process.execPath, ['--version']);
      }) as typeof spawn
    });

    await expect(host.describe()).rejects.toThrow(/dependency_hash_mismatch/);
    expect(spawnCount).toBe(0);
  });
});

function createRuntimeFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-krillin-runtime-host-'));
  const resourceRoot = join(tempDir, 'runtime');
  const jobsRoot = join(tempDir, 'jobs');
  const servicePath = join(
    resourceRoot,
    'bin',
    `krillinai-opencreator-server${process.platform === 'win32' ? '.exe' : ''}`
  );
  const schemaPath = join(resourceRoot, 'api', 'opencreator', 'v1', 'schema.json');
  const serverScript = join(tempDir, 'fixture-server.mjs');
  mkdirSync(dirname(servicePath), { recursive: true });
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(servicePath, 'fixture-service');
  writeFileSync(schemaPath, '{"protocolVersion":1}\n');
  writeFileSync(serverScript, FIXTURE_SERVER);
  const protocolSha256 = hashFile(schemaPath);
  writeFileSync(join(resourceRoot, 'manifest.json'), `${JSON.stringify({
    version: 1,
    serviceVersion: 'fixture',
    protocolVersion: 1,
    protocolSha256,
    integrationPatchSha256: 'a'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    upstreamCommit: 'fixture',
    resources: [
      {
        path: relative(resourceRoot, servicePath).replaceAll('\\', '/'),
        sha256: hashFile(servicePath),
        kind: 'executable'
      },
      {
        path: 'api/opencreator/v1/schema.json',
        sha256: protocolSha256,
        kind: 'asset'
      }
    ]
  }, null, 2)}\n`);
  return { resourceRoot, jobsRoot, servicePath, serverScript };
}

function listFiles(root: string): string[] {
  if (!statExists(root)) return [];
  const result: string[] = [];
  visit(root);
  return result.sort();

  function visit(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
}

function statExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function expectProcessToExit(pid: number | undefined): Promise<void> {
  if (pid === undefined) throw new Error('fixture process did not expose a pid');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  expect(isProcessAlive(pid)).toBe(false);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const FIXTURE_SERVER = String.raw`
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const token = process.env.OPENCREATOR_KRILLIN_TOKEN;
const generation = Date.now() + process.pid;
const stages = ['download', 'subtitle', 'tts', 'render-horizontal', 'render-vertical'];
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.headers.authorization !== 'Bearer ' + token) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized' } }));
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/health') {
    response.end(JSON.stringify({ ok: true, generation }));
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/capabilities') {
    response.end(JSON.stringify({ protocolVersion: 1, serviceVersion: 'fixture', generation, stages }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') process.exit(2);
  writeFileSync(join(process.cwd(), 'app.log'), '');
  writeFileSync(
    join(process.cwd(), 'service-state-' + process.pid + '.json'),
    JSON.stringify({ port: address.port })
  );
  process.stdout.write(JSON.stringify({ port: address.port, generation }) + '\n');
});
`;
