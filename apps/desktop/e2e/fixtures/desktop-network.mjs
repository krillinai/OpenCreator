import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { app, BrowserWindow } from 'electron';

let phase = 'initialization';
const report = result => writeFileSync(process.env.OPENCREATOR_DESKTOP_NETWORK_TEST_RESULT, `${JSON.stringify({ phase, ...result }, null, 2)}\n`);

report({ ok: false, pending: true });

void (async () => {
  app.setPath('userData', process.env.OPENCREATOR_DESKTOP_NETWORK_TEST_USER_DATA);
  Socket.prototype.setTypeOfService = () => {
    throw Object.assign(new Error('setTypeOfService EINVAL'), { code: 'EINVAL' });
  };
  globalThis.fetch = () => {
    throw new Error('Built-in Undici fetch must not handle Desktop requests');
  };
  const { installProtocolHandler, registerPrivilegedSchemes } = await import(process.env.OPENCREATOR_DESKTOP_PROTOCOL_TEST_MODULE);
  registerPrivilegedSchemes();
  await app.whenReady();
  phase = 'load network module';
  const { fetchDesktopRequest } = await import(process.env.OPENCREATOR_DESKTOP_NETWORK_TEST_MODULE);
  const origin = process.env.OPENCREATOR_DESKTOP_NETWORK_TEST_ORIGIN;
  phase = 'daemon health probe';
  const { BootstrapController } = await import(process.env.OPENCREATOR_DESKTOP_BOOTSTRAP_TEST_MODULE);
  const daemon = new EventEmitter();
  daemon.currentConnection = { address: origin, token: 'test' };
  let stopCount = 0;
  daemon.stop = async () => { stopCount += 1; };
  let timer;
  const healthy = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Daemon health probe did not complete')), 5_000);
    const controller = new BootstrapController({
      daemon,
      logger: {
        info: message => {
          if (message === 'Runtime proxy failure health probe succeeded') resolve(controller);
        },
        warn: message => reject(new Error(message))
      }
    });
    controller.markWorkspaceReady();
    controller.reportProxyFailure(daemon.currentConnection);
  });
  try {
    const controller = await healthy;
    assert.equal(stopCount, 0);
    assert.equal(controller.currentState.phase, 'ready');
    await controller.stop();
  } finally {
    clearTimeout(timer);
  }
  phase = 'JSON request';
  const json = await fetchDesktopRequest(`${origin}/json`);
  assert.deepEqual(await json.json(), { ok: true });
  phase = 'binary request';
  const binary = await fetchDesktopRequest(`${origin}/binary`);
  assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 255, 17, 23]);
  phase = 'SSE request';
  const events = await fetchDesktopRequest(`${origin}/events`);
  assert.equal(await events.text(), 'data: first\n\ndata: second\n\n');
  phase = 'streaming upload';
  const upload = await fetchDesktopRequest(`${origin}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4096));
        controller.enqueue(new Uint8Array(8192));
        controller.close();
      }
    }),
    duplex: 'half'
  });
  assert.deepEqual(await upload.json(), { bytes: 12288 });
  phase = 'cancellation';
  const cancellation = new AbortController();
  const pending = fetchDesktopRequest(`${origin}/wait`, { signal: cancellation.signal });
  setTimeout(() => cancellation.abort(), 50);
  await assert.rejects(pending, { name: 'AbortError' });
  phase = 'protocol streaming cancellation';
  const webRoot = process.env.OPENCREATOR_DESKTOP_NETWORK_TEST_USER_DATA;
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body>Protocol cancellation regression</body></html>');
  const protocol = await installProtocolHandler({
    webRoot,
    bootstrapRoot: webRoot,
    getConnection: () => ({ address: origin, token: 'test' }),
    logger: { info() {}, warn() {}, warnRateLimited() {} }
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadURL('opencreator-app://app/index.html');
  for (const cancelReader of [false, true]) {
    const outcome = await window.webContents.executeJavaScript(`(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const prefix = 'opencreator-app://app/.opencreator/runtime';
      for (let i = 0; i < 20; i++) {
        const controller = new AbortController();
        const response = await fetch(prefix + '/persistent-events', { signal: controller.signal });
        const reader = response.body.getReader();
        await reader.read();
        if (${cancelReader}) await reader.cancel();
        controller.abort();
        // Check before the next request so a leak reports the actual failure,
        // rather than timing out when the seventh SSE request cannot start.
        const health = await Promise.race([
          fetch(prefix + '/healthz').then(response => response.json()).then(() => 'ok'),
          pause(1_500).then(() => 'blocked')
        ]);
        if (health !== 'ok') return { health, streams: i + 1 };
      }
      return { health: 'ok', streams: 20 };
    })()`);
    assert.deepEqual(outcome, { health: 'ok', streams: 20 });
  }
  const streamStatus = await fetchDesktopRequest(`${origin}/stream-status`);
  assert.deepEqual(await streamStatus.json(), { activeStreams: 0, closedStreams: 40 });
  window.destroy();
  protocol.suspendRuntime();
  phase = 'complete';
  report({ ok: true });
  console.log('DESKTOP_NETWORK_QOS_REGRESSION_PASSED');
  app.exit(0);
})().catch(error => {
  report({ ok: false, error: error?.stack ?? String(error) });
  console.error(error);
  app.exit(1);
});
