import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const run = promisify(execFile);
const e2eDir = dirname(fileURLToPath(import.meta.url));
const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('@package-smoke Desktop 网络在 Socket QoS 抛出 EINVAL 时仍可请求、上传和取消', async ({}, testInfo) => {
  const userData = mkdtempSync(join(tmpdir(), 'opencreator-desktop-network-'));
  let activeStreams = 0;
  let closedStreams = 0;
  const server = createServer((request, response) => {
    if (request.url === '/stream-status') {
      response.end(JSON.stringify({ activeStreams, closedStreams }));
      return;
    }
    if (request.url === '/persistent-events') {
      activeStreams += 1;
      response.setHeader('Content-Type', 'text/event-stream');
      response.write('data: ready\n\n');
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 100);
      response.on('close', () => {
        clearInterval(heartbeat);
        activeStreams -= 1;
        closedStreams += 1;
      });
      return;
    }
    if (request.url === '/wait') return;
    if (request.url === '/binary') {
      response.end(Buffer.from([0, 255, 17, 23]));
      return;
    }
    if (request.url === '/events') {
      response.setHeader('Content-Type', 'text/event-stream');
      response.write('data: first\n\n');
      response.end('data: second\n\n');
      return;
    }
    if (request.url === '/upload') {
      let bytes = 0;
      request.on('data', chunk => { bytes += chunk.length; });
      request.on('end', () => response.end(JSON.stringify({ bytes })));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end('{"ok":true}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const resultPath = join(userData, 'network-test-result.json');
    const electronLogPath = join(userData, 'electron.log');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCREATOR_DESKTOP_NETWORK_TEST_RESULT: resultPath,
      OPENCREATOR_DESKTOP_NETWORK_TEST_USER_DATA: userData,
      OPENCREATOR_DESKTOP_NETWORK_TEST_MODULE: pathToFileURL(resolve(e2eDir, '../dist/main/desktop-network.js')).href,
      OPENCREATOR_DESKTOP_BOOTSTRAP_TEST_MODULE: pathToFileURL(resolve(e2eDir, '../dist/main/bootstrap-controller.js')).href,
      OPENCREATOR_DESKTOP_PROTOCOL_TEST_MODULE: pathToFileURL(resolve(e2eDir, '../dist/main/protocol-handler.js')).href,
      OPENCREATOR_DESKTOP_NETWORK_TEST_ORIGIN: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_LOG_FILE: electronLogPath
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let processFailure: unknown;
    let stderr = '';
    try {
      // Electron rejects URL arguments followed by more arguments on Windows.
      // Pass test configuration through the environment on every platform.
      const result = await run(electronExecutable, [
        resolve(e2eDir, 'fixtures/desktop-network.mjs')
      ], { env, timeout: 30_000, windowsHide: true });
      stderr = result.stderr;
    } catch (error) { processFailure = error; }
    // GUI executables do not reliably expose console output on Windows.
    const report = existsSync(resultPath) ? readFileSync(resultPath, 'utf8') : 'No network test result file';
    await testInfo.attach('desktop-network-result', { body: report, contentType: 'application/json' });
    if (existsSync(electronLogPath)) {
      await testInfo.attach('desktop-network-electron-log', { path: electronLogPath, contentType: 'text/plain' });
    }
    expect(processFailure, report).toBeUndefined();
    expect(existsSync(resultPath), report).toBe(true);
    expect(JSON.parse(report)).toMatchObject({ ok: true, phase: 'complete' });
    expect(stderr).not.toContain('setTypeOfService EINVAL');
    await expect.poll(() => activeStreams).toBe(0);
    expect(closedStreams).toBe(40);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(userData, { recursive: true, force: true });
  }
});
