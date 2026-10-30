import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  join,
  resolve
} from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type Page
} from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import type { GatewayCredentials } from '../../daemon/src/gateway/config-store.js';
import { createOpenCreatorCreatorServicesConfigStore } from '../../daemon/src/creator-services/config-store.js';
import {
  closePackagedApp,
  launchPackagedApp,
  launchSecondInstance,
  relaunchPackagedApp,
  requestPackagedAppQuit,
  waitForProcessExit,
  type PackagedApp
} from './packaged-app.js';
const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const desktopVersion = (JSON.parse(
  readFileSync(join(desktopDir, 'package.json'), 'utf8')
) as { version: string }).version;
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');
const fakeCodexLauncherSource = join(e2eDir, 'fixtures', 'fake-codex-launcher.go');

test.describe.configure({ mode: 'serial' });

test('@package-smoke 官方配音试听加载公开样本且不触发付费合成', async ({}, testInfo) => {
  const account = { id: 'speech-test', email: 'speech@example.test', verified: true };
  const models = [
    { id: 'text-model', modality: 'text' as const, capabilities: ['chat'] },
    { id: 'speech-model', modality: 'speech' as const, capabilities: [], voices: ['marin'] }
  ];
  const requestId = 'ocreq_packaged_speech';
  let submissions = 0;
  const samples: Array<{ model: string | null; voice: string | null; language: string | null; authorization?: string }> = [];
  const gateway = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/client/bootstrap') response.end(JSON.stringify(bootstrap));
    else if (path === '/api/v1/me') response.end(JSON.stringify({ account }));
    else if (path === '/api/v1/client/models') response.end(JSON.stringify({ models, defaults: bootstrap.defaults }));
    else if (path === '/v1/audio/speech') {
      submissions++;
      response.writeHead(202, { 'X-Request-ID': requestId }).end(JSON.stringify({ requestId, state: 'submitting', billingState: 'reserved' }));
    } else if (path === '/api/v1/voice-previews') {
      const query = new URL(request.url!, 'http://localhost').searchParams;
      samples.push({ model: query.get('model'), voice: query.get('voice'), language: query.get('language'), authorization: request.headers.authorization });
      response.setHeader('Content-Type', 'audio/mpeg');
      response.setHeader('Content-Language', 'en');
      response.end('ID3-packaged-speech');
    } else response.end(JSON.stringify({ items: [] }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const bootstrap = {
    schemaVersion: 3 as const, account, models, defaults: { text: 'text-model', speech: 'speech-model' },
    keyVersion: 'speech-1', bindingVersion: 'speech:1', keyRotation: false,
    transport: 'gateway' as const, supplier: 'chatanywhere' as const, baseUrl: `${origin}/v1`
  };
  let fixture: DesktopFixture | undefined;
  try {
    fixture = await launchPackagedDesktop('success', { runtimeMode: 'bundled', gatewayOrigin: origin,
      gatewaySelectedModels: bootstrap.defaults,
      gatewayCredentials: { ...bootstrap, accessToken: 'speech-private-access', refreshToken: 'speech-private-refresh',
        expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900_000).toISOString() }
    });
    await waitForWorkspace(fixture.page);
    await expect.poll(async () => (await runtimeRequest<{ activationState: string }>(fixture!.page, 'GET', '/gateway/account')).body.activationState).toBe('ready');
    expect(await fixture.page.evaluate(() => window.opencreatorDesktop?.readConnectionConfig())).toEqual({ baseUrl: '/.opencreator/runtime' });
    expect((await runtimeRequest(fixture.page, 'GET', '/projects?status=all')).body)
      .toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ name: 'Default project' })]) });
    const audio = await fixture.page.evaluate(async () => {
      const response = await fetch('/.opencreator/runtime/creator-services/tts/preview', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openai', voiceId: 'marin', text: 'Hello' }) });
      return { status: response.status, contentType: response.headers.get('content-type'), content: await response.text() };
    });
    expect(audio).toMatchObject({ status: 200, contentType: 'audio/mpeg', content: 'ID3-packaged-speech' });
    expect(samples).toEqual([{ model: 'speech-model', voice: 'marin', language: 'en', authorization: undefined }]);
    expect(submissions).toBe(0);
    await testInfo.attach('voice-preview.json', { body: JSON.stringify({ submissions, samples, audio }), contentType: 'application/json' });
    await fixture.page.screenshot({ path: testInfo.outputPath('voice-preview-workspace.png') });
  } finally {
    if (fixture) await closeFixture(fixture);
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
  }
});

test('@package-smoke 慢网关不阻塞缓存账号进入工作区，后台恢复完成后可输入任务', async ({}, testInfo) => {
  const account = { id: 'startup-test', email: 'startup@example.test', verified: true };
  const models = [{ id: 'official-model', modality: 'text' as const, capabilities: ['responses'] }];
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let bootstrapRequests = 0;
  const gateway = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/client/bootstrap') {
      bootstrapRequests++;
      await waiting;
      if (!response.destroyed) response.end(JSON.stringify(bootstrap));
    } else if (path === '/api/v1/client/usage') {
      response.end(JSON.stringify({ keyVersion: '1' }));
    } else if (path === '/api/v1/me') {
      response.end(JSON.stringify({ account }));
    } else if (path === '/api/v1/client/models') {
      response.end(JSON.stringify({ models }));
    } else {
      response.end(JSON.stringify({ items: [] }));
    }
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const bootstrap = {
    schemaVersion: 1 as const, account, models, defaults: { text: 'official-model' },
    modelKey: 'private-model-key', keyVersion: '1', bindingVersion: 'startup:1',
    baseUrl: `${origin}/v1`, keyRotation: true
  };
  let fixture: DesktopFixture | undefined;
  try {
    const startedAt = Date.now();
    fixture = await launchPackagedDesktop('success', {
      runtimeMode: 'bundled',
      gatewayOrigin: origin,
      gatewayCredentials: {
        ...bootstrap, accessToken: 'private-access-token', refreshToken: 'private-refresh-token',
        expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900_000).toISOString()
      }
    });
    await fixture.page.waitForURL(url => url.protocol === 'opencreator-app:' && url.hostname === 'app');
    await expect(fixture.page.locator('.opencreator-shell')).toBeVisible();
    await expect.poll(() => fixture!.page.evaluate(async () => (await window.opencreatorDesktop?.readBootstrapState())?.phase)).toBe('ready');
    await expect.poll(() => bootstrapRequests).toBe(1);
    await navigateToAppRoute(fixture.page, '#/chat');
    const input = fixture.page.getByRole('textbox', { name: '输入任务' });
    await expect(input).toBeDisabled();
    await expect(fixture.page.getByRole('status').filter({ hasText: '已登录，正在连接模型服务…' })).toBeVisible();
    expect((await runtimeRequest(fixture.page, 'GET', '/gateway/account')).body)
      .toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'loading', account });
    expect((await runtimeRequest(fixture.page, 'GET', '/projects?status=all')).body)
      .toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: 'Default project' })]) });
    await testInfo.attach('startup-timing.json', {
      body: JSON.stringify({ workspaceReadyMs: Date.now() - startedAt, gatewayStillPending: true }),
      contentType: 'application/json'
    });
    await fixture.page.screenshot({ path: testInfo.outputPath('startup-models-loading.png') });
    release();
    await expect.poll(async () => (await runtimeRequest<{ activationState: string }>(fixture!.page, 'GET', '/gateway/account')).body.activationState)
      .toBe('ready');
    await expect(input).toBeEnabled();
    await input.fill('启动后可输入任务');
    await expect(input).toHaveValue('启动后可输入任务');
  } finally {
    release();
    if (fixture) await closeFixture(fixture);
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
  }
});

test('@package-smoke 直连模型目录挂起时进入工作区，退出取消后台恢复', async ({}, testInfo) => {
  const account = { id: 'direct-startup', email: 'direct-startup@example.test', verified: true };
  const models = [{ id: 'openai/gpt-4.1-mini', modality: 'text' as const, capabilities: ['responses'] }];
  const tunnels = new Set<Socket>();
  let connections = 0;
  const proxy = createServer();
  proxy.on('connect', (_request, socket) => {
    const tunnel = socket as Socket;
    tunnels.add(tunnel); connections++;
    tunnel.on('error', () => undefined);
    tunnel.on('close', () => tunnels.delete(tunnel));
    tunnel.on('end', () => tunnel.end());
    tunnel.on('data', () => undefined);
    // Accept CONNECT but hold TLS open, keeping all supplier traffic local and pending.
    tunnel.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const gateway = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    response.end(JSON.stringify(path === '/api/v1/client/bootstrap' ? bootstrap
      : path === '/api/v1/client/models' ? { models }
        : path === '/api/v1/me' ? { account } : { keyVersion: '1' }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const bootstrap = {
    schemaVersion: 1 as const, account, models, defaults: { text: models[0]!.id },
    modelKey: 'private-direct-model-key', keyVersion: '1', bindingVersion: 'direct:1',
    transport: 'openrouter-direct' as const, baseUrl: 'https://openrouter.ai/api/v1', keyRotation: true
  };
  let fixture: DesktopFixture | undefined;
  try {
    const startedAt = Date.now();
    fixture = await launchPackagedDesktop('success', {
      runtimeMode: 'bundled', gatewayOrigin: origin,
      proxy: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
      gatewayCredentials: { ...bootstrap, accessToken: 'private-access-token', refreshToken: 'private-refresh-token',
        expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900_000).toISOString() }
    });
    await fixture.page.waitForURL(url => url.protocol === 'opencreator-app:' && url.hostname === 'app');
    await expect(fixture.page.locator('.opencreator-shell')).toBeVisible();
    const workspaceReadyMs = Date.now() - startedAt;
    const startupLog = readFileSync(join(fixture.root, '.opencreator', 'logs', 'desktop-main.log'), 'utf8')
      .split('\n').filter(line => /Desktop starting|Daemon Utility Process (starting|ready)|workspace ready/.test(line)).join('\n');
    const timingPath = testInfo.outputPath('direct-startup-timing.json');
    writeFileSync(timingPath, JSON.stringify({ workspaceReadyMs, startupLog }, null, 2));
    await testInfo.attach('direct-startup-timing.json', { path: timingPath, contentType: 'application/json' });
    await expect.poll(() => fixture!.page.evaluate(async () => (await window.opencreatorDesktop?.readBootstrapState())?.phase)).toBe('ready');
    // The first tunnel is exit detection; the second is the still-pending model catalog.
    await expect.poll(() => connections).toBeGreaterThanOrEqual(2);
    expect(tunnels.size).toBeGreaterThan(0);
    expect((await runtimeRequest(fixture.page, 'GET', '/gateway/account')).body)
      .toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'loading', account });
    expect((await runtimeRequest(fixture.page, 'GET', '/projects?status=all')).body)
      .toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: 'Default project' })]) });
    await navigateToAppRoute(fixture.page, '#/chat');
    await expect(fixture.page.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    await fixture.page.screenshot({ path: testInfo.outputPath('direct-startup-models-loading.png') });
    await requestPackagedAppQuit(fixture);
    expect(await waitForProcessExit(fixture.process, 3_000)).toBe(true);
    expect(fixture.process.exitCode).toBe(0);
    await expect.poll(() => tunnels.size).toBe(0);
  } finally {
    if (fixture) await closeFixture(fixture);
    for (const socket of tunnels) socket.destroy();
    proxy.closeAllConnections(); gateway.closeAllConnections();
    await Promise.all([
      new Promise<void>(resolve => proxy.close(() => resolve())),
      new Promise<void>(resolve => gateway.close(() => resolve()))
    ]);
  }
});

test('@package-smoke 旧账号收到 gateway_migrated 后恢复新网关，个人中心不再报错', async ({}, testInfo) => {
  const account = { id: 'migrated-startup', email: 'migrated-startup@example.test', verified: true };
  const models = [{ id: 'gpt-4.1-mini', modality: 'text' as const, capabilities: ['responses', 'chat'] }];
  let usageRequests = 0;
  let bootstrapRequests = 0;
  let bootstrapRotate: string | null = null;
  const gateway = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/client/usage') {
      usageRequests++;
      response.writeHead(409).end(JSON.stringify({ error: { code: 'gateway_migrated' } }));
    } else if (path === '/api/v1/client/bootstrap') {
      bootstrapRequests++;
      bootstrapRotate = new URL(request.url!, origin).searchParams.get('rotate');
      response.end(JSON.stringify(bootstrap));
    } else if (path === '/api/v1/me') response.end(JSON.stringify({ account }));
    else if (path === '/api/v1/client/models') response.end(JSON.stringify({ models, defaults: bootstrap.defaults }));
    else if (path === '/api/v1/billing/summary') response.end(JSON.stringify({
      balance: { availableUnits: '1000000000', reservedUnits: '0', periodEnd: null, asOf: new Date().toISOString() },
      subscription: null, billingAvailable: false, plansUrl: `${origin}/pricing`
    }));
    else response.end(JSON.stringify({ items: [] }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const bootstrap = {
    schemaVersion: 3 as const, account, models, defaults: { text: models[0]!.id },
    keyVersion: 'gateway-3', bindingVersion: 'migrated:gateway-3', keyRotation: false,
    transport: 'gateway' as const, supplier: 'chatanywhere' as const, baseUrl: `${origin}/v1`
  };
  let fixture: DesktopFixture | undefined;
  try {
    fixture = await launchPackagedDesktop('success', {
      runtimeMode: 'bundled', gatewayOrigin: origin,
      gatewayCredentials: { schemaVersion: 1, account,
        models: [{ id: 'openai/gpt-4.1-mini', modality: 'text', capabilities: ['responses'] }], defaults: { text: 'openai/gpt-4.1-mini' },
        modelKey: 'obsolete-private-key', keyVersion: 'legacy-1', bindingVersion: 'migrated:legacy-1',
        transport: 'openrouter-direct', baseUrl: 'https://openrouter.ai/api/v1', keyRotation: true,
        accessToken: 'private-access-token', refreshToken: 'private-refresh-token', expiresIn: 900,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString()
      }
    });
    await waitForWorkspace(fixture.page);
    await expect.poll(async () => (await runtimeRequest<{ activationState: string }>(fixture!.page, 'GET', '/gateway/account')).body.activationState).toBe('ready');
    expect(usageRequests).toBe(1);
    expect(bootstrapRequests).toBe(1);
    expect(bootstrapRotate).toBe('0');
    await navigateToAppRoute(fixture.page, '#/account');
    await expect(fixture.page.getByRole('heading', { name: account.email, exact: true })).toBeVisible();
    await expect(fixture.page.getByText('网关返回错误，请稍后重试。', { exact: true })).toHaveCount(0);
    await expect(fixture.page.getByText('官方模型服务暂不可用', { exact: true })).toHaveCount(0);
    await fixture.page.screenshot({ path: testInfo.outputPath('migrated-account-ready.png') });
    const saved = JSON.parse(readFileSync(join(fixture.root, '.opencreator', 'data', 'config', 'gateway-credentials.json'), 'utf8')) as GatewayCredentials;
    expect(saved).toMatchObject({ schemaVersion: 3, transport: 'gateway', keyRotation: false });
    expect(saved).not.toHaveProperty('modelKey');
    await navigateToAppRoute(fixture.page, '#/chat');
    await expect(fixture.page.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    await fixture.page.getByRole('textbox', { name: '输入任务' }).fill('迁移后可输入任务');
    expect(usageRequests).toBe(1);
  } finally {
    if (fixture) await closeFixture(fixture);
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
  }
});

test('@package-smoke 充值回跳进入个人中心并以网关订单确认到账', async ({}, testInfo) => {
  let paid = false;
  let orderChecks = 0;
  const account = { id: 'billing-test', email: 'billing@example.test', verified: true };
  const gateway = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/auth/device/start') response.end(JSON.stringify({ attemptId: 'billing-attempt', deviceSecret: 'test-device-secret', authorizationUrl: `${origin}/device`, interval: 5, expiresIn: 600 }));
    else if (path === '/api/v1/auth/device/token') response.end(JSON.stringify({ accessToken: 'billing-access', refreshToken: 'billing-refresh', expiresIn: 900 }));
    else if (path === '/api/v1/client/bootstrap') { response.statusCode = 503; response.end(JSON.stringify({ error: { code: 'services_not_ready' } })); }
    else if (path === '/api/v1/me') response.end(JSON.stringify({ account }));
    else if (path === '/api/v1/billing/summary') response.end(JSON.stringify({ balance: { availableUnits: paid ? '2500000000' : '0', reservedUnits: '0', periodEnd: null, asOf: new Date().toISOString() }, subscription: null, billingAvailable: false, plansUrl: origin + '/pricing' }));
    else if (path === '/api/v1/billing/orders/order-a') {
      if (request.headers.authorization !== 'Bearer billing-access') { response.statusCode = 401; response.end(JSON.stringify({ error: { code: 'auth_required' } })); return; }
      orderChecks++;
      response.end(JSON.stringify({ order: { id: 'order-a', planId: 'starter', currency: 'usd', amountUnits: '500', creditUnits: '2500000000', status: paid ? 'completed' : 'pending', paymentStatus: paid ? 'paid' : 'pending', creditStatus: paid ? 'ready' : 'pending', reviewRequired: false, paymentMode: 'test', createdAt: new Date().toISOString(), paidAt: null, completedAt: null } }));
    } else response.end(JSON.stringify({ items: [] }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  let fixture: DesktopFixture | undefined;
  try {
    fixture = await launchPackagedDesktop('success', { gatewayOrigin: origin });
    await waitForWorkspace(fixture.page);
    await runtimeRequest(fixture.page, 'POST', '/gateway/auth/start', {});
    await runtimeRequest(fixture.page, 'POST', '/gateway/auth/check', {});
    await navigateToAppRoute(fixture.page, '#/account');
    await expect(fixture.page.getByRole('heading', { name: account.email })).toBeVisible();
    await navigateToAppRoute(fixture.page, '#/new');
    await launchSecondInstance(fixture, ['opencreator://billing/return?orderId=order-a']);
    await expect(fixture.page).toHaveURL(/#\/account\?billing=return&orderId=order-a$/);
    await expect(fixture.page.getByText('待付款', { exact: true })).toBeVisible();
    await expect(fixture.page.getByText(/充值成功/)).toHaveCount(0);
    paid = true;
    await fixture.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(fixture.page.getByText('充值成功，已到账 2500 积分', { exact: true })).toBeVisible();
    await expect(fixture.page.locator('.account-credits__value')).toContainText('2500');
    expect(orderChecks).toBeGreaterThanOrEqual(2);
    await expect(fixture.page.getByRole('dialog')).toHaveCount(0);
    await expect(fixture.page.getByRole('tab')).toHaveCount(0);
    await fixture.page.screenshot({ path: testInfo.outputPath('billing-return-account.png') });
  } finally {
    if (fixture) await closeFixture(fixture);
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
  }
});

test('@package-smoke 授权回调唤起个人中心，模型初始化期间立即显示登录态', async ({}, testInfo) => {
  let approved = false;
  let tokenRequests = 0;
  let releaseBootstrap!: () => void;
  const bootstrapReady = new Promise<void>(resolve => { releaseBootstrap = resolve; });
  const account = { id: 'login-test', email: 'login@example.test', verified: true };
  const gateway = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/auth/device/start') {
      response.end(JSON.stringify({ attemptId: 'login-attempt', deviceSecret: 'private-device-secret', authorizationUrl: `${origin}/device?grant=login-attempt`, interval: 5, expiresIn: 600 }));
    } else if (path === '/api/v1/auth/device/token') {
      tokenRequests++;
      response.statusCode = approved ? 200 : 428;
      response.end(JSON.stringify(approved ? { accessToken: 'private-access', refreshToken: 'private-refresh', expiresIn: 900 } : { error: { code: 'authorization_pending' } }));
    } else if (path === '/api/v1/client/bootstrap') {
      await bootstrapReady;
      response.statusCode = 503;
      response.end(JSON.stringify({ error: { code: 'services_not_ready' } }));
    } else if (path === '/api/v1/me') {
      response.end(JSON.stringify({ account }));
    } else if (path === '/api/v1/plans') {
      response.end(JSON.stringify({ plans: [], billingAvailable: false }));
    } else if (path === '/api/v1/billing/summary') {
      response.end(JSON.stringify({ balance: { availableUnits: '0', reservedUnits: '0', periodEnd: null, asOf: new Date().toISOString() }, subscription: null, billingAvailable: false }));
    } else {
      response.end(JSON.stringify({ ok: true }));
    }
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  let fixture: DesktopFixture | undefined;
  try {
    fixture = await launchPackagedDesktop('success', { gatewayOrigin: origin });
    await waitForWorkspace(fixture.page);
    const grant = await runtimeRequest(fixture.page, 'POST', '/gateway/auth/start', {});
    expect(grant.status).toBe(200);
    await navigateToAppRoute(fixture.page, '#/account');
    await expect(fixture.page.getByText('请在浏览器中完成登录')).toBeVisible();
    if (process.platform === 'win32') {
      if (fixture.process.pid === undefined) throw new Error('Desktop process ID is unavailable');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices;
          public static class OpenCreatorE2EWindow {
            [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
            [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
          }';
        $windowHandle = (Get-Process -Id ${fixture.process.pid}).MainWindowHandle;
        if ($windowHandle -eq [IntPtr]::Zero) { throw 'Desktop native window is unavailable'; }
        [OpenCreatorE2EWindow]::ShowWindowAsync($windowHandle, 6) | Out-Null;
        $deadline = [DateTime]::UtcNow.AddSeconds(5);
        while (-not [OpenCreatorE2EWindow]::IsIconic($windowHandle) -and [DateTime]::UtcNow -lt $deadline) {
          Start-Sleep -Milliseconds 50;
        }
        if (-not [OpenCreatorE2EWindow]::IsIconic($windowHandle)) { throw 'Desktop native window did not minimize'; }
      `], { timeout: 10_000 });
    } else {
      await fixture.page.getByRole('button', { name: '最小化窗口', exact: true }).click();
    }
    approved = true;
    const checks: string[] = [];
    fixture.page.on('request', request => { if (request.url().endsWith('/gateway/auth/check')) checks.push(request.url()); });
    await launchSecondInstance(fixture, ['opencreator://auth/complete']);
    await expect(fixture.page).toHaveURL(/#\/account\?login=complete$/);
    await expect.poll(() => fixture!.page.evaluate(() => document.visibilityState)).toBe('visible');
    await expect.poll(() => checks.length).toBeGreaterThan(0);
    await expect(fixture.page.getByRole('region', { name: 'OpenCreator 账户', exact: true }).getByRole('status')).toHaveText('已登录', { timeout: 10_000 });
    await expect(fixture.page.getByText('官方模型服务正在连接', { exact: true })).toBeVisible();
    const state = await runtimeRequest<{ authState: string; activationState: string }>(fixture.page, 'GET', '/gateway/account');
    expect(state.body).toMatchObject({ authState: 'signed_in', activationState: 'loading' });
    expect(tokenRequests).toBe(1);
    await fixture.page.screenshot({ path: testInfo.outputPath('login-models-loading.png') });
    releaseBootstrap();
    await expect(fixture.page.getByRole('heading', { name: account.email, exact: true })).toBeVisible();
    await expect(fixture.page.getByRole('region', { name: 'OpenCreator 账户', exact: true }).getByRole('status')).toHaveText('已登录');
    await expect(fixture.page.getByText('官方模型服务暂不可用', { exact: true })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: '模型设置', exact: true })).toBeEnabled();
    const signedIn = await runtimeRequest(fixture.page, 'GET', '/gateway/account');
    expect(signedIn.body).toMatchObject({ authState: 'signed_in', activationState: 'blocked', account });
    expect(JSON.stringify(signedIn.body)).not.toMatch(/private-access|private-refresh|private-device-secret/);
  } finally {
    releaseBootstrap();
    if (fixture) await closeFixture(fixture);
    gateway.closeAllConnections();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
  }
});

test('@package-smoke 全新账号启动时引导配置 Agent，跳过后可重新配置', async () => {
  const fixture = await launchPackagedDesktop('success', { signedOut: true });
  try {
    await waitForRuntimeReady(fixture.page, false);
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeVisible();
    await expect(fixture.page.getByRole('combobox', { name: '供应商' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: '使用 ChatGPT 登录' })).toHaveCount(0);
    await fixture.page.getByRole('button', { name: '稍后配置，进入本地模式' }).click();
    await fixture.page.getByRole('button', { name: '设置', exact: true }).click();
    await fixture.page.getByRole('button', { name: /AI 服务/ }).click();
    await expect(fixture.page.getByText('Agent 尚未配置，无法发送任务。')).toBeVisible();
    await fixture.page.getByRole('button', { name: '配置 Agent' }).click();
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeVisible();
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke first run defaults to English and switches language across setup and settings', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('success', {
    signedOut: true,
    uiLanguage: null,
    browserLanguage: 'zh-CN',
    gatewayOrigin: 'http://127.0.0.1:9'
  });
  try {
    await fixture.page.waitForURL(url => url.protocol === 'opencreator-app:' && url.hostname === 'app');
    await expect.poll(async () => (await fixture.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState()))?.phase).toBe('ready');
    await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(fixture.page.getByRole('region', { name: 'Get started with Agent' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: 'Sign-in mode' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: 'Local mode' })).toBeVisible();
    const englishSelector = fixture.page.getByRole('combobox', { name: 'Display language' });
    await expect(englishSelector).toHaveValue('English');
    await expect(englishSelector).toHaveAttribute('data-value', 'en-US');
    await expect.poll(async () => (await runtimeRequest<{ settings: { language: string } }>(fixture.page, 'GET', '/settings/ui')).body.settings.language).toBe('en-US');
    await fixture.page.screenshot({ path: testInfo.outputPath('first-run-english.png') });

    await englishSelector.click();
    await fixture.page.locator('[role="option"][data-value="zh-CN"]').click();
    await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(fixture.page.getByRole('button', { name: '登录模式' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: '本地模式', exact: true })).toBeVisible();
    const chineseSelector = fixture.page.getByRole('combobox', { name: '显示语言' });
    await expect(chineseSelector).toHaveValue('简体中文 · Chinese (Simplified)');
    await fixture.page.screenshot({ path: testInfo.outputPath('first-run-chinese.png') });
    const originalViewport = await fixture.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await fixture.page.setViewportSize({ width: 375, height: 812 });
    await expect(chineseSelector).toBeVisible();
    expect(await chineseSelector.evaluate(element => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      const canvas = document.createElement('canvas').getContext('2d');
      if (canvas === null) return false;
      canvas.font = style.font;
      return canvas.measureText(input.value).width <= input.clientWidth
        - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    })).toBe(true);
    expect(await fixture.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fixture.page.screenshot({ path: testInfo.outputPath('first-run-chinese-narrow.png') });
    await fixture.page.setViewportSize(originalViewport);
    await expect.poll(async () => (await runtimeRequest<{ settings: { language: string } }>(fixture.page, 'GET', '/settings/ui')).body.settings.language).toBe('zh-CN');

    await chineseSelector.click();
    await fixture.page.locator('[role="option"][data-value="en-US"]').click();
    await expect(fixture.page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect.poll(async () => (await runtimeRequest<{ settings: { language: string } }>(fixture.page, 'GET', '/settings/ui')).body.settings.language).toBe('en-US');
    await fixture.page.getByRole('button', { name: 'Sign-in mode' }).click();
    await expect(fixture.page.getByRole('button', { name: 'Sign in to OpenCreator' })).toBeVisible();
    await fixture.page.getByRole('button', { name: 'Back' }).click();
    await fixture.page.getByRole('button', { name: 'Local mode' }).click();
    await expect(fixture.page.getByRole('combobox', { name: 'Provider' })).toBeVisible();
    await fixture.page.getByRole('button', { name: 'Continue locally and set up later' }).click();
    await fixture.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(fixture.page.getByRole('combobox', { name: 'Display language' })).toHaveValue('English');
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 已有 API 凭据时仍显示复用确认和手动填写入口', async () => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForRuntimeReady(fixture.page, false);
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: '自定义模型服务' })).toBeVisible();
    await expect(fixture.page.getByText(/API Key 已配置/)).toBeVisible();
    await expect(fixture.page.getByLabel('API Key')).toHaveCount(0);
    await fixture.page.getByRole('button', { name: '使用本机 Codex，继续' }).click();
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeHidden();
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 自定义 Provider 无 ChatGPT 登录态时可复用已有配置', async () => {
  const fixture = await launchPackagedDesktop('success', { seedLocalCodexProvider: true });
  try {
    await waitForRuntimeReady(fixture.page, false);
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeVisible();
    await expect(fixture.page.getByText('已找到本机 Codex')).toBeVisible();
    await expect(fixture.page.getByText(/API Key 已配置 · custom-model/)).toBeVisible();
    await expect(fixture.page.getByLabel('API Key')).toHaveCount(0);
    await fixture.page.getByRole('button', { name: '使用本机 Codex，继续' }).click();
    await expect(fixture.page.getByRole('region', { name: '开始使用 Agent' })).toBeHidden();
    expect(existsSync(join(fixture.root, 'codex-home', 'auth.json'))).toBe(false);
  } finally {
    await closeFixture(fixture);
  }
});

test('首次启动从本机 Codex 导入配置但不修改原目录', async () => {
  const fixture = await launchPackagedDesktop('success', { seedLocalCodex: true });
  try {
    await waitForRuntimeReady(fixture.page, false);
    const source = join(fixture.root, 'codex-home');
    const state = await fixture.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState());
    const imported = state?.codexHome;
    expect(imported).toBeDefined();
    if (imported === undefined) throw new Error('Codex home is unavailable');
    expect(readFileSync(join(imported, 'config.toml'), 'utf8')).toContain('model = "existing-model"');
    expect(readFileSync(join(source, 'config.toml'), 'utf8')).toBe('model = "existing-model"\n');
    expect(readFileSync(join(imported, 'auth.json'), 'utf8')).toBe(readFileSync(join(source, 'auth.json'), 'utf8'));
    await expect(fixture.page.getByRole('button', { name: '使用本机 Codex，继续' })).toBeVisible();
  } finally {
    await closeFixture(fixture);
  }
});

test('打包 App 将旧 Electron 数据当作无关数据且不迁移', async () => {
  const fixture = await launchPackagedDesktop('success', {
    minimalPath: true,
    runtimeMode: 'bundled',
    seedLegacyData: true,
    writeCurrentConfig: false
  });
  try {
    await waitForRuntimeReady(fixture.page);
    const state = await fixture.page.evaluate(
      () => window.opencreatorDesktop?.readBootstrapState()
    );
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: packagedCodexExecutablePath(),
      codexHome: join(fixture.root, '.opencreator', 'runtime', 'codex')
    });
    expect(existsSync(
      join(fixture.root, '.opencreator', 'data', 'legacy-marker.txt')
    )).toBe(false);
    expect(existsSync(
      join(fixture.root, '.opencreator', 'runtime', 'codex', 'legacy-codex-marker.txt')
    )).toBe(false);
    expect(readFileSync(
      join(fixture.root, '.opencreator', 'config.toml'),
      'utf8'
    )).toContain('codex_mode = "bundled"');
  } finally {
    await closeFixture(fixture);
  }
});

test('实际 Desktop 包发送匿名日使用数据且不包含创作内容', async () => {
  const reports: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      reports.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"accepted":true}');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  let fixture: DesktopFixture | undefined;

  try {
    fixture = await launchPackagedDesktop('success', {
      telemetryUrl: `http://127.0.0.1:${address.port}/api/v1/public/desktop-usage`
    });
    await expect.poll(() => reports.at(-1)).toMatchObject({
      usage_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      launch_count: 1,
      active_minutes: 0,
      app_version: desktopVersion,
      operating_system: process.platform,
      architecture: process.arch,
      install_id: expect.stringMatching(/^[0-9a-f-]{36}$/)
    });
    expect(Object.keys(reports.at(-1) ?? {}).sort()).toEqual([
      'active_minutes',
      'app_version',
      'architecture',
      'install_id',
      'launch_count',
      'operating_system',
      'usage_date'
    ]);
    expect(await fixture.page.evaluate(
      () => window.opencreatorDesktop?.readDesktopPreferences()
    )).toMatchObject({ telemetryEnabled: true });
  } finally {
    if (fixture !== undefined) await closeFixture(fixture);
    await new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error));
    });
  }
});

test('bundled 模式在最小 PATH 下忽略 nvm 安装的 Codex', async () => {
  const fixture = await launchPackagedDesktop('success', {
    codexLocation: 'nvm',
    minimalPath: true,
    runtimeMode: 'bundled'
  });
  try {
    await waitForRuntimeReady(fixture.page);
    const state = await fixture.page.evaluate(
      () => window.opencreatorDesktop?.readBootstrapState()
    );
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: packagedCodexExecutablePath(),
      codexHome: join(fixture.root, '.opencreator', 'runtime', 'codex')
    });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

test('bundled 模式在最小 PATH 下忽略 ChatGPT 应用内置的 Codex', async () => {
  const fixture = await launchPackagedDesktop('success', {
    codexLocation: 'chatgpt-app',
    minimalPath: true,
    misleadingCodexWrapper: true,
    runtimeMode: 'bundled'
  });
  try {
    await waitForRuntimeReady(fixture.page);
    const state = await fixture.page.evaluate(
      () => window.opencreatorDesktop?.readBootstrapState()
    );
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: packagedCodexExecutablePath(),
      codexHome: join(fixture.root, '.opencreator', 'runtime', 'codex')
    });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 启动和刷新不触发付费 Probe，并代理 JSON、二进制和 SSE', async ({}, testInfo) => {
  const fixture = await launchPlatformProbeDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    await expect(fixture.page.getByRole('button', { name: '工作台' })).toBeVisible();
    await expect(fixture.page.getByRole('button', { name: 'Dashboard' })).toHaveCount(0);
    await navigateToAppRoute(fixture.page, '#/plugins');
    await expect(fixture.page.getByRole('tab', { name: '技能' })).toBeVisible();
    await expect(fixture.page.getByRole('tab', { name: 'Skills' })).toHaveCount(0);
    await fixture.page.getByRole('button', { name: '工作台' }).click();
    await expect(fixture.page.getByText('登录即可享受云端协作')).toHaveCount(0);
    await expect(fixture.page.getByRole('button', { name: '登录' })).toHaveCount(0);
    expect((await runtimeRequest(fixture.page, 'GET', '/codex/status')).body)
      .toMatchObject({ availabilityProbe: { status: 'skipped' } });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    const startupMetrics = await fixture.page.evaluate(async () => (
      await window.opencreatorDesktop?.readBootstrapState()
    )?.startupMetrics);
    expect(startupMetrics).toMatchObject({
      appEntryAt: expect.any(Number),
      appReadyAt: expect.any(Number),
      windowCreatedAt: expect.any(Number),
      bootstrapDomReadyAt: expect.any(Number),
      bootstrapDidFinishLoadAt: expect.any(Number)
    });
    expect(startupMetrics?.appReadyAt).toBeGreaterThanOrEqual(
      startupMetrics?.appEntryAt ?? Number.POSITIVE_INFINITY
    );
    expect(startupMetrics?.windowCreatedAt).toBeGreaterThanOrEqual(
      startupMetrics?.appReadyAt ?? Number.POSITIVE_INFINITY
    );
    expect(startupMetrics?.bootstrapDomReadyAt).toBeGreaterThanOrEqual(
      startupMetrics?.windowCreatedAt ?? Number.POSITIVE_INFINITY
    );
    expect(startupMetrics?.bootstrapDidFinishLoadAt).toBeGreaterThanOrEqual(
      startupMetrics?.bootstrapDomReadyAt ?? Number.POSITIVE_INFINITY
    );

    const security = await fixture.page.evaluate(async () => ({
      requireType: typeof (window as Window & { require?: unknown }).require,
      processType: typeof (window as Window & { process?: unknown }).process,
      bridgeKind: window.opencreatorDesktop?.kind,
      windowChrome: window.opencreatorDesktop?.windowChrome,
      resolveDroppedFilePathType: typeof window.opencreatorDesktop?.resolveDroppedFilePath,
      connection: await window.opencreatorDesktop?.readConnectionConfig()
    }));
    expect(security).toMatchObject({
      requireType: 'undefined',
      processType: 'undefined',
      bridgeKind: 'desktop',
      windowChrome: process.platform === 'darwin'
        ? {
            integratedTitleBar: true,
            titleBarHeight: 38,
            trafficLightInset: 76
          }
        : {
            integratedTitleBar: false
          },
      resolveDroppedFilePathType: 'function'
    });
    expect(security.connection).toEqual({
      baseUrl: '/.opencreator/runtime'
    });
    if (process.platform === 'darwin') {
      const titleBarLayout = await fixture.page.evaluate(() => {
        const dragRegion = document.querySelector<HTMLElement>(
          '.desktop-titlebar-drag-region'
        )!;
        const sidebar = document.querySelector<HTMLElement>('.opencreator-sidebar')!;
        const mainPane = document.querySelector<HTMLElement>('.opencreator-main-pane')!;
        const dragRect = dragRegion.getBoundingClientRect();
        return {
          shellCapability: document.querySelector('.app-drop-shell')
            ?.getAttribute('data-integrated-title-bar'),
          dragRect: {
            x: dragRect.x,
            y: dragRect.y,
            height: dragRect.height
          },
          sidebarPaddingTop: getComputedStyle(sidebar).paddingTop,
          mainPaddingTop: getComputedStyle(mainPane).paddingTop
        };
      });
      expect(titleBarLayout).toEqual({
        shellCapability: 'true',
        dragRect: {
          x: 76,
          y: 0,
          height: 38
        },
        sidebarPaddingTop: '51px',
        mainPaddingTop: '38px'
      });
      await fixture.page.screenshot({
        path: testInfo.outputPath('integrated-titlebar-2026-08-05.png')
      });
      const previousTheme = await fixture.page.evaluate(() => {
        const value = document.documentElement.dataset.theme;
        document.documentElement.dataset.theme = 'light';
        return value;
      });
      await fixture.page.screenshot({
        path: testInfo.outputPath('integrated-titlebar-light-2026-08-05.png')
      });
      await fixture.page.evaluate(theme => {
        if (theme === undefined) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
      }, previousTheme);
    }

    const mainPid = requiredPid(fixture.process.pid);
    const daemonPid = await waitForDaemonUtilityPid(mainPid);
    await expect.poll(
      async () => await directDaemonHealth(daemonPid),
      { timeout: 15_000 }
    ).toEqual({ status: 200, body: { ok: true } });

    await expect.poll(async () => await fixture.page.evaluate(async () => {
      try {
        const response = await fetch('/.opencreator/runtime/healthz', {
          signal: AbortSignal.timeout(2_000)
        });
        const text = await response.text();
        return {
          status: response.status,
          body: JSON.parse(text),
          error: ''
        };
      } catch (error) {
        return {
          status: 0,
          body: null,
          error: String(error instanceof Error ? error.message : error)
        };
      }
    }), { timeout: 15_000 }).toEqual({
      status: 200,
      body: { ok: true },
      error: ''
    });

    const proxyResult = await fixture.page.evaluate(async () => {
      const draftId = `desktop-e2e-${Date.now()}`;
      const query = new URLSearchParams({
        draftId,
        fileName: 'proxy.txt',
        mime: 'text/plain'
      });
      const bytes = new TextEncoder().encode('opencreator desktop binary proxy');
      const upload = await fetch(`/.opencreator/runtime/attachments?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes
      });
      const uploaded = await upload.json() as {
        attachment: { id: string };
      };
      const content = await fetch(
        `/.opencreator/runtime/attachments/${encodeURIComponent(uploaded.attachment.id)}/content?draftId=${encodeURIComponent(draftId)}`
      );

      const runResponse = await fetch('/.opencreator/runtime/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'hello from desktop e2e',
          sandbox: 'read-only'
        })
      });
      const run = await runResponse.json() as { id: string };
      let status = '';
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await fetch(`/.opencreator/runtime/runs/${encodeURIComponent(run.id)}`);
        const payload = await current.json() as { status: string };
        status = payload.status;
        if (['succeeded', 'failed', 'canceled'].includes(status)) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      const events = await fetch(
        `/.opencreator/runtime/runs/${encodeURIComponent(run.id)}/events?fromSeq=0`
      );
      return {
        uploadStatus: upload.status,
        contentStatus: content.status,
        contentText: await content.text(),
        runStatus: status,
        eventContentType: events.headers.get('content-type'),
        eventText: await events.text()
      };
    });

    expect(proxyResult).toMatchObject({
      uploadStatus: 201,
      contentStatus: 200,
      contentText: 'opencreator desktop binary proxy',
      runStatus: 'succeeded'
    });
    expect(proxyResult.eventContentType).toContain('text/event-stream');
    expect(proxyResult.eventText).toContain('event: done');

    await launchSecondInstance(fixture, ['opencreator://tasks']);
    await expect.poll(() => fixture.page.evaluate(() => window.location.hash))
      .toBe('#/tasks');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fixture.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspace(fixture.page);
    }
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);

    const pageClosed = fixture.page.waitForEvent('close');
    await fixture.page.evaluate(() => {
      window.close();
    });
    await pageClosed;
    expect(isProcessAlive(mainPid)).toBe(true);
    expect(findDaemonUtilityPid(mainPid)).toBe(daemonPid);
  } finally {
    await closeFixture(fixture);
  }
});

test('打包 App 将会话标题提升到 38px 原生标题栏且文件入口可点击', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('success');
  const projectDir = join(fixture.root, 'titlebar-workspace');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'README.md'), '# titlebar workspace\n');

  try {
    await waitForWorkspace(fixture.page);
    const createdProject = await runtimeRequest<{
      project: { id: string };
    }>(fixture.page, 'POST', '/projects', {
      cwd: projectDir,
      name: '标题栏验证项目',
      sandbox: 'workspace-write'
    });
    const createdThread = await runtimeRequest<{
      thread: { id: string };
    }>(fixture.page, 'POST', '/threads', {
      projectId: createdProject.body.project.id,
      title: 'hello',
      sandbox: 'workspace-write'
    });

    await fixture.page.addInitScript(threadId => {
      const originalFetch = window.fetch.bind(window);
      let releaseHistory: (() => void) | undefined;
      const historyGate = new Promise<void>(resolve => {
        releaseHistory = resolve;
      });
      Object.defineProperty(window, '__opencreatorReleaseHistoryLoad', {
        configurable: true,
        value: () => releaseHistory?.()
      });
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes(`/threads/${threadId}/history?`)) {
          await historyGate;
        }
        return await originalFetch(...args);
      };
    }, createdThread.body.thread.id);
    await fixture.page.evaluate(threadId => {
      window.location.hash = `#/thread/${threadId}`;
    }, createdThread.body.thread.id);
    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);

    await expect(fixture.page.getByRole('status', {
      name: '正在加载会话历史'
    })).toBeVisible();
    await expect(fixture.page.locator('.conversation-page')).not.toHaveClass(/is-empty/);
    await expect(fixture.page.getByText('需要帮你做点什么')).toHaveCount(0);
    await expect(fixture.page.getByText('数据分析')).toHaveCount(0);
    await fixture.page.evaluate(() => {
      (
        window as Window & { __opencreatorReleaseHistoryLoad?: () => void }
      ).__opencreatorReleaseHistoryLoad?.();
    });
    await expect(fixture.page.getByRole('status', {
      name: '正在加载会话历史'
    })).toHaveCount(0);
    await expect(fixture.page.locator('.conversation-page')).toHaveClass(/is-empty/);

    const title = fixture.page.getByRole('heading', { name: 'hello' });
    const conversationHeader = fixture.page.locator(
      process.platform === 'darwin'
        ? '.opencreator-main-titlebar'
        : '.conversation-page > .conversation-header'
    );
    const fileButton = conversationHeader.getByRole('button', {
      name: '文件',
      exact: true
    });
    await expect(title).toBeVisible();
    await expect(conversationHeader).toBeVisible();
    await expect(fileButton).toBeVisible();

    if (process.platform === 'darwin') {
      const titlebarLayout = await fixture.page.evaluate(() => {
        const mainPane = document.querySelector<HTMLElement>('.opencreator-main-pane')!;
        const titlebar = document.querySelector<HTMLElement>('.opencreator-main-titlebar')!;
        const title = titlebar.querySelector<HTMLElement>('h1')!;
        const fileButton = titlebar.querySelector<HTMLElement>('.conversation-file-button')!;
        const conversationPage = document.querySelector<HTMLElement>('.conversation-page')!;
        const titlebarRect = titlebar.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const fileButtonRect = fileButton.getBoundingClientRect();
        const conversationPageRect = conversationPage.getBoundingClientRect();
        return {
          titleCount: document.querySelectorAll('.conversation-header h1').length,
          mainPanePaddingTop: getComputedStyle(mainPane).paddingTop,
          titlebarRect: {
            y: titlebarRect.y,
            height: titlebarRect.height
          },
          titleRect: {
            y: titleRect.y,
            bottom: titleRect.bottom
          },
          fileButtonRect: {
            y: fileButtonRect.y,
            bottom: fileButtonRect.bottom
          },
          conversationPageY: conversationPageRect.y
        };
      });

      expect(titlebarLayout.titleCount).toBe(1);
      expect(titlebarLayout.mainPanePaddingTop).toBe('0px');
      expect(titlebarLayout.titlebarRect.y).toBe(0);
      expect(titlebarLayout.titlebarRect.height).toBe(38);
      expect(titlebarLayout.titleRect.y).toBeGreaterThanOrEqual(0);
      expect(titlebarLayout.titleRect.bottom).toBeLessThanOrEqual(38);
      expect(titlebarLayout.fileButtonRect.y).toBeGreaterThanOrEqual(0);
      expect(titlebarLayout.fileButtonRect.bottom).toBeLessThanOrEqual(38);
      expect(titlebarLayout.conversationPageY).toBeGreaterThanOrEqual(37);
      expect(titlebarLayout.conversationPageY).toBeLessThanOrEqual(39);

      await fixture.page.screenshot({
        path: testInfo.outputPath('conversation-titlebar-2026-08-05.png')
      });
    }

    await fileButton.click();
    await expect(fixture.page.getByLabel('会话和文件工作区')).toBeVisible();
    await expect(fileButton).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await closeFixture(fixture);
  }
});

test('打包 App 可稳定预览隐藏正文和本地图片，并阻止用户脚本', async () => {
  const fixture = await launchPackagedDesktop('success');
  const projectDir = join(fixture.root, 'html-preview-project');
  const fileName = '隐藏天气页回归-2026-07-28.html';
  const backgroundName = '天气背景回归-2026-07-28.png';
  const consoleErrors: string[] = [];
  fixture.page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  mkdirSync(projectDir);
  writeFileSync(
    join(projectDir, backgroundName),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  );
  writeFileSync(
    join(projectDir, fileName),
    `<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <style>
            html, body { min-height: 100%; margin: 0; }
            body { background: #f4f7f8; }
            .weather-report {
              display: none;
              visibility: hidden;
              opacity: 0;
              max-height: 0;
              overflow: hidden;
              color: transparent;
              transform: translateX(-200vw) scale(0);
              min-height: 420px;
              padding: 32px;
              background-image: url("./${backgroundName}");
            }
          </style>
        </head>
        <body>
          <main class="weather-report">
            <h1>武汉天气预览回归</h1>
            <p>隐藏正文已经恢复，本地背景图已经内联。</p>
          </main>
          <script>document.documentElement.dataset.userScriptExecuted = "true"</script>
        </body>
      </html>`
  );

  try {
    await waitForWorkspace(fixture.page);
    const createdProject = await runtimeRequest<{
      project: { id: string };
    }>(fixture.page, 'POST', '/projects', {
      cwd: projectDir,
      name: 'HTML 预览回归项目',
      sandbox: 'workspace-write'
    });
    const createdThread = await runtimeRequest<{
      thread: { id: string };
    }>(fixture.page, 'POST', '/threads', {
      projectId: createdProject.body.project.id,
      title: 'HTML 预览回归会话',
      sandbox: 'workspace-write'
    });

    await fixture.page.evaluate(({ threadId, path }) => {
      const query = new URLSearchParams({ threadId, path });
      window.location.hash = `#/files?${query.toString()}`;
    }, {
      threadId: createdThread.body.thread.id,
      path: fileName
    });
    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);

    const preview = fixture.page.getByTitle(`${fileName} HTML 预览`);
    await expect(preview).toBeVisible();
    const frame = preview.contentFrame();
    const heading = frame.getByRole('heading', { name: '武汉天气预览回归' });
    await expect(heading).toBeVisible({ timeout: 8_000 });
    await expect(frame.getByText('隐藏正文已经恢复，本地背景图已经内联。')).toBeVisible();
    await expect.poll(
      () => frame.locator('html').getAttribute('data-opencreator-preview-state')
    ).toBe('recovered');

    const frameRect = await preview.boundingBox();
    expect(frameRect?.height ?? 0).toBeGreaterThan(400);
    expect(await frame.locator('html').getAttribute('data-user-script-executed')).toBeNull();
    expect(await frame.locator('script').count()).toBe(1);
    await expect(frame.locator('script')).toHaveAttribute(
      'src',
      /html-preview-runtime-2026-07-28\.js$/
    );

    const source = await preview.getAttribute('srcdoc') ?? '';
    expect(source).toContain('data:image/png;base64,');
    expect(source).not.toContain('document.documentElement.dataset.userScriptExecuted');
    expect(consoleErrors.filter(message => (
      message.includes('Content Security Policy')
      || message.includes('Refused to')
    ))).toEqual([]);

    const separator = fixture.page.getByRole('separator', {
      name: '调整会话和文件区域宽度'
    });
    const separatorBox = await separator.boundingBox();
    const previewBox = await preview.boundingBox();
    if (separatorBox === null || previewBox === null) {
      throw new Error('无法读取打包 App 的 HTML 拖拽区域尺寸');
    }

    const dragY = separatorBox.y + Math.min(separatorBox.height / 2, 120);
    const targetX = Math.min(previewBox.x + 160, previewBox.x + previewBox.width / 2);
    await fixture.page.mouse.move(separatorBox.x + separatorBox.width / 2, dragY);
    await fixture.page.mouse.down();
    await expect(fixture.page.locator('.pane-resize-shield')).toBeVisible();
    await fixture.page.mouse.move(targetX, dragY, { steps: 8 });
    await fixture.page.mouse.up();

    await expect(fixture.page.locator('.pane-resize-shield')).toHaveCount(0);
    await expect(fixture.page.locator('html')).not.toHaveClass(/is-pane-resizing/);
    const releasedBox = await separator.boundingBox();
    if (releasedBox === null) throw new Error('无法读取打包 App 松开后的分隔条尺寸');
    await fixture.page.mouse.move(Math.max(20, releasedBox.x - 180), dragY, { steps: 5 });
    const afterFreeMoveBox = await separator.boundingBox();
    expect(Math.abs((afterFreeMoveBox?.x ?? 0) - releasedBox.x)).toBeLessThan(2);
  } finally {
    await closeFixture(fixture);
  }
});

test('打包 App 使用 Codex app-server 并持久化项目与会话', async ({}, testInfo) => {
  let fixture = await launchPackagedDesktop('success');
  const projectDir = join(fixture.root, 'persistent-project');
  mkdirSync(projectDir);

  try {
    await waitForWorkspace(fixture.page);
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);
    await navigateToAppRoute(fixture.page, '#/chat');
    await expect(fixture.page.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    expect(existsSync(
      join(fixture.root, 'Documents', 'OpenCreator', 'Default Project')
    )).toBe(true);

    const initialProjects = await runtimeRequest<{
      projects: Array<{ id: string; name: string }>;
    }>(fixture.page, 'GET', '/projects?status=all');
    expect(initialProjects.status).toBe(200);
    expect(
      initialProjects.body.projects.filter(project => project.name === 'Default project')
    ).toHaveLength(1);
    const defaultProject = initialProjects.body.projects.find(project => project.name === 'Default project');
    if (defaultProject === undefined) throw new Error('打包 App 未创建默认工作目录');
    const initialCreatorJob = await runtimeRequest<{
      job: { id: string };
    }>(fixture.page, 'POST', '/creator/jobs', {
      projectId: defaultProject.id,
      templateId: 'cover',
      creationKey: 'desktop-default-cover',
      state: { prompt: '默认项目封面' }
    });
    expect(initialCreatorJob.status).toBe(201);

    await fixture.page.getByRole('button', { name: '我的项目' }).click();
    await expect(fixture.page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    await expect(fixture.page.getByRole('button', {
      name: '打开项目 默认项目封面'
    })).toBeVisible();
    await fixture.page.screenshot({
      path: testInfo.outputPath('project-library-2026-08-21.png')
    });

    await expect.poll(async () => {
      const response = await runtimeRequest<{
        capabilities: { appServer?: boolean; warnings?: string[] };
      }>(fixture.page, 'GET', '/codex/status');
      return {
        status: response.status,
        appServer: response.body.capabilities.appServer,
        warnings: response.body.capabilities.warnings
      };
    }, { timeout: 15_000 }).toMatchObject({
      status: 200,
      appServer: true
    });

    const createdProject = await runtimeRequest<{
      project: { id: string; name: string };
    }>(fixture.page, 'POST', '/projects', {
      cwd: projectDir,
      name: '持久化项目',
      sandbox: 'workspace-write'
    });
    expect(createdProject.status).toBe(201);

    const createdThread = await runtimeRequest<{
      thread: { id: string; projectId: string | null };
    }>(fixture.page, 'POST', '/threads', {
      projectId: createdProject.body.project.id,
      title: '持久化会话',
      sandbox: 'workspace-write'
    });
    expect(createdThread.status).toBe(201);
    expect(createdThread.body.thread.projectId).toBe(createdProject.body.project.id);
    const createdCreatorJob = await runtimeRequest<{
      job: { id: string };
    }>(fixture.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'cover',
      creationKey: 'desktop-persisted-cover',
      state: { prompt: '持久化项目封面' }
    });
    expect(createdCreatorJob.status).toBe(201);

    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);
    await fixture.page.getByRole('button', { name: '我的项目' }).click();
    await expect(fixture.page.getByRole('button', {
      name: '打开项目 持久化项目封面'
    })).toBeVisible();
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);

    const previous = fixture;
    await closePackagedApp(previous);
    fixture = {
      ...await relaunchPackagedApp(previous),
      root: previous.root,
      stateDir: previous.stateDir
    };

    await waitForWorkspace(fixture.page);
    await fixture.page.getByRole('button', { name: '我的项目' }).click();
    await expect(fixture.page.getByRole('button', {
      name: '打开项目 持久化项目封面'
    })).toBeVisible();
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);

    const persistedProjects = await runtimeRequest<{
      projects: Array<{ id: string; name: string }>;
    }>(fixture.page, 'GET', '/projects?status=all');
    expect(persistedProjects.status).toBe(200);
    expect(
      persistedProjects.body.projects.filter(project => project.name === 'Default project')
    ).toHaveLength(1);
    expect(persistedProjects.body.projects).toContainEqual(expect.objectContaining({
      id: createdProject.body.project.id,
      name: '持久化项目'
    }));

    const persistedThreads = await runtimeRequest<{
      threads: Array<{ id: string; projectId: string | null; title: string | null }>;
    }>(fixture.page, 'GET', '/threads?status=active&limit=50');
    expect(persistedThreads.status).toBe(200);
    expect(persistedThreads.body.threads).toContainEqual(expect.objectContaining({
      id: createdThread.body.thread.id,
      projectId: createdProject.body.project.id,
      title: '持久化会话'
    }));
  } finally {
    await closeFixture(fixture);
  }
});

test('打包 App 首页 Skills 菜单保持在内容区内', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('success');

  try {
    await waitForWorkspace(fixture.page);
    const codexHome = await fixture.page.evaluate(async () => (
      await window.opencreatorDesktop?.readBootstrapState()
    )?.codexHome);
    if (codexHome === undefined) throw new Error('桌面启动状态未返回隔离 Codex Home');
    const skillsDir = join(codexHome, 'skills');
    for (let index = 1; index <= 16; index += 1) {
      const skillDir = join(skillsDir, `viewport-skill-${index}`);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        [
          '---',
          `name: viewport-skill-${index}`,
          `description: 第 ${index} 个视口边界测试 Skill`,
          '---',
          ''
        ].join('\n')
      );
    }
    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);
    await navigateToAppRoute(fixture.page, '#/chat');

    const textbox = fixture.page.getByRole('textbox', { name: '输入任务' });
    await expect(textbox).toBeEnabled();
    await textbox.fill('/');

    const menu = fixture.page.getByRole('listbox', { name: '能力菜单' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveCount(16);

    const geometry = await fixture.page.evaluate(() => {
      const menuElement = document.querySelector<HTMLElement>('.composer-slash-menu');
      const inputRoot = document.querySelector<HTMLElement>('.composer-input-wrap');
      const boundary = document.querySelector<HTMLElement>('.conversation-page');
      if (menuElement === null || inputRoot === null || boundary === null) {
        throw new Error('无法读取 Skills 菜单定位元素');
      }
      const menuRect = menuElement.getBoundingClientRect();
      const inputRect = inputRoot.getBoundingClientRect();
      const boundaryRect = boundary.getBoundingClientRect();
      return {
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        menuHeight: menuRect.height,
        menuScrollHeight: menuElement.scrollHeight,
        inputTop: inputRect.top,
        boundaryTop: boundaryRect.top
      };
    });

    expect(geometry.menuTop).toBeGreaterThanOrEqual(geometry.boundaryTop + 11);
    expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.inputTop - 7);
    expect(geometry.menuHeight).toBeLessThan(geometry.menuScrollHeight);
    await fixture.page.screenshot({
      path: testInfo.outputPath('skills-menu-viewport-2026-08-02.png')
    });
  } finally {
    await closeFixture(fixture);
  }
});

test('未启用付费 Probe 时不执行失败探测，工作区保持可用', async () => {
  const fixture = await launchPlatformProbeDesktop('probe-failure');
  try {
    await waitForWorkspace(fixture.page);
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const response = await fetch('/.opencreator/runtime/codex/status');
      const payload = await response.json() as {
        availabilityProbe?: { status?: string; errorCode?: string };
        diagnostics?: string[];
      };
      return {
        status: payload.availabilityProbe?.status,
        errorCode: payload.availabilityProbe?.errorCode,
        hasDiagnostic: payload.diagnostics?.some(message =>
          message.includes('Codex background availability verification failed')
        ) ?? false
      };
    }), { timeout: 15_000 }).toEqual({
      status: 'skipped',
      errorCode: undefined,
      hasDiagnostic: false
    });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    expect(fixture.page.url()).toContain('opencreator-app://app/');
  } finally {
    await closeFixture(fixture);
  }
});

test('Dashboard 握手超时后显示本地错误页并可无 Probe 重载', async () => {
  const fixture = await launchPackagedDesktop('workspace-failure');
  try {
    await expect(fixture.page.locator('#status-title')).toHaveText(
      'Dashboard failed to load',
      { timeout: 30_000 }
    );
    await expect(fixture.page.locator('#reload-workspace')).toBeVisible();
    await expect(fixture.page.locator('#restart-runtime')).toBeVisible();
    await expect(fixture.page.locator('#failure-actions')).toBeHidden();
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);

    const mainPid = requiredPid(fixture.process.pid);
    const daemonPid = await waitForDaemonUtilityPid(mainPid);
    await fixture.page.locator('#reload-workspace').click();
    await waitForWorkspace(fixture.page);
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    expect(findDaemonUtilityPid(mainPid)).toBe(daemonPid);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke Daemon 连续退出保留 Creator 草稿，自动恢复耗尽后可手动重启', async () => {
  const fixture = await launchPlatformProbeDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    const mainPid = requiredPid(fixture.process.pid);
    await fixture.page.getByRole('button', { name: '工作台', exact: true }).click();
    await fixture.page.getByRole('button', { name: /^视频翻译/ }).click();
    const composer = fixture.page.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    await composer.fill('保留这段尚未提交的翻译要求');
    await fixture.page.evaluate(() => { document.body.dataset.runtimeRecoveryMarker = 'retain-renderer'; });
    const firstDaemonPid = await waitForDaemonUtilityPid(mainPid);
    process.kill(firstDaemonPid, 'SIGKILL');

    const replacementPid = await waitForDaemonUtilityPid(mainPid, firstDaemonPid);
    expect(replacementPid).not.toBe(firstDaemonPid);
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const state = await window.opencreatorDesktop?.readBootstrapState();
      const response = await fetch('/.opencreator/runtime/healthz').catch(() => undefined);
      return {
        phase: state?.phase,
        health: response?.status
      };
    }).catch(() => ({
      phase: undefined,
      health: undefined
    })), { timeout: 30_000 }).toEqual({ phase: 'ready', health: 200 });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    await expect(composer).toHaveValue('保留这段尚未提交的翻译要求');
    let currentPid = replacementPid;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      process.kill(currentPid, 'SIGKILL');
      currentPid = await waitForDaemonUtilityPid(mainPid, currentPid);
      await expect.poll(async () => (await fixture.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState()))?.phase).toBe('ready');
      await expect(composer).toHaveValue('保留这段尚未提交的翻译要求');
    }
    process.kill(currentPid, 'SIGKILL');
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const state = await window.opencreatorDesktop?.readBootstrapState();
      return {
        phase: state?.phase,
        code: state?.error?.code
      };
    }).catch(() => ({
      phase: undefined,
      code: undefined
    })), { timeout: 15_000 }).toEqual({
      phase: 'failed',
      code: 'DAEMON_RESTART_EXHAUSTED'
    });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    await expect(fixture.page.getByRole('button', { name: '重启本地服务', exact: true })).toBeVisible();
    fixture.page.once('dialog', dialog => void dialog.accept());
    await fixture.page.getByRole('button', { name: '重启本地服务', exact: true }).click();
    await expect.poll(async () => (await fixture.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState()))?.phase).toBe('ready');
    await expect(composer).toHaveValue('保留这段尚未提交的翻译要求');
    expect(await fixture.page.evaluate(() => document.body.dataset.runtimeRecoveryMarker)).toBe('retain-renderer');
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke IPC 拒绝非 OpenCreator 页面来源', async () => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    await fixture.page.goto('data:text/html,<title>untrusted</title>');
    const result = await fixture.page.evaluate(async () => {
      if (!window.opencreatorDesktop) return 'bridge-missing';
      try {
        await window.opencreatorDesktop.readConnectionConfig();
        return 'unexpected-success';
      } catch (error) {
        return String(error instanceof Error ? error.message : error);
      }
    });
    expect(result).toContain('IPC sender is not trusted');
  } finally {
    await closeFixture(fixture);
  }
});

test('启动页使用 OpenCreator 文字品牌', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('probe-hang');
  try {
    await fixture.page.waitForURL(url => (
      url.protocol === 'opencreator-app:'
      && url.hostname === 'bootstrap'
    ));
    const brandName = fixture.page.locator('.brand-name');
    await expect(brandName).toBeVisible();
    await expect(brandName).toHaveText('OpenCreator');
    await expect(brandName).toHaveCSS('font-size', '20px');
    await expect(brandName).toHaveCSS('font-weight', '600');
    await expect(fixture.page.locator('.bootstrap-panel img')).toHaveCount(0);

    await fixture.page.screenshot({
      path: testInfo.outputPath('opencreator-startup-2026-08-21.png')
    });
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 跳过付费 Probe 并快速退出，回收 Codex 子进程', async () => {
  const fixture = await launchPlatformProbeDesktop('probe-hang');
  try {
    await waitForWorkspace(fixture.page);
    expect((await runtimeRequest(fixture.page, 'GET', '/codex/status')).body)
      .toMatchObject({ availabilityProbe: { status: 'skipped' } });
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(0);
    const codexPids = readFileSync(join(fixture.stateDir, 'invocations.ndjson'), 'utf8')
      .trim().split('\n').map(line => (JSON.parse(line) as { pid: number }).pid);
    expect(codexPids.length).toBeGreaterThan(0);

    await requestPackagedAppQuit(fixture);
    expect(await waitForProcessExit(fixture.process, 3_000)).toBe(true);
    expect(fixture.process.exitCode).toBe(0);
    await expect.poll(() => codexPids.some(isProcessAlive), { timeout: 15_000 }).toBe(false);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 启动 Codex app-server 后在 3 秒内退出', async () => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    const models = await runtimeRequest<{ models: unknown[] }>(
      fixture.page,
      'GET',
      '/codex/models'
    );
    expect(models.status).toBe(200);

    const startedAt = Date.now();
    await requestPackagedAppQuit(fixture);

    expect(await waitForProcessExit(fixture.process, 3_000)).toBe(true);
    expect(fixture.process.exitCode).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 关闭后隐藏保留本地服务，重新打开后可以正常退出', async () => {
  test.skip(process.platform !== 'darwin', 'Custom window controls are macOS only');
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForRuntimeReady(fixture.page, false);
    await fixture.page.evaluate(async () => {
      await window.opencreatorDesktop?.updateDesktopPreferences({ closeBehavior: 'hide' });
    });
    await fixture.page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    expect(fixture.process.exitCode).toBeNull();
    expect((await runtimeRequest(fixture.page, 'GET', '/healthz')).status).toBe(200);

    await launchSecondInstance(fixture);
    await expect(fixture.page.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
    await requestPackagedAppQuit(fixture);
    expect(await waitForProcessExit(fixture.process, 3_000)).toBe(true);
    expect(fixture.process.exitCode).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 创作模块连接内嵌 Runtime 并使用默认项目', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    expect(await fixture.page.evaluate(() => window.opencreatorDesktop?.readConnectionConfig()))
      .toEqual({ baseUrl: '/.opencreator/runtime' });
    await expect.poll(async () => {
      const response = await runtimeRequest<{ projects: Array<{ name: string }> }>(
        fixture.page, 'GET', '/projects?status=all'
      );
      return response.body.projects.filter(project => project.name === 'Default project').length;
    }).toBe(1);
    expect((await runtimeRequest(fixture.page, 'GET', '/creator/templates')).status).toBe(200);

    for (const [tool, title] of [
      ['video-translation', '视频翻译配音'],
      ['video-download', '视频下载'],
      ['image-generation', '图像生成'],
      ['video-generation', '视频生成'],
      ['smart-dubbing', '文本转语音'],
      ['cover-generator', '封面生成'],
      ['stickman-video', '火柴人动画']
    ]) {
      await navigateToAppRoute(fixture.page, `#/workbench?tool=${tool}`);
      await expect(fixture.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(fixture.page.getByRole('heading', { name: '本地创作服务未连接' })).toHaveCount(0);
      await fixture.page.screenshot({ path: testInfo.outputPath(`${tool}.png`) });
    }
  } finally {
    await closeFixture(fixture);
  }
});

test('@package-smoke 字幕 Worker 和 WASM 在实际 App 的 CSP 下加载并渲染', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await launchPackagedDesktop('success', { runtimeMode: 'bundled' });
  const loaded: string[] = [];
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const requested: string[] = [];
  const failedResponses: Array<{ url: string; status: number }> = [];
  const timings: Record<string, number> = {};
  fixture.page.on('request', request => requested.push(request.url()));
  fixture.page.on('response', response => {
    loaded.push(response.url());
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  fixture.page.on('pageerror', error => errors.push(error.message));
  fixture.page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  fixture.page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  try {
    await waitForWorkspace(fixture.page);
    // A fresh profile hashes the complete bundled Runtime in the background.
    // Its cache is written only after every resource has passed verification.
    const verificationStartedAt = Date.now();
    const verificationCache = join(fixture.root, '.opencreator', 'data', 'runtime-verification', 'krillinai.json');
    await expect.poll(() => existsSync(verificationCache), {
      message: 'Bundled Creator Runtime integrity verification must complete before subtitle compilation',
      timeout: 120_000,
      intervals: [100, 250, 500, 1_000]
    }).toBe(true);
    timings.runtimeVerificationMs = Date.now() - verificationStartedAt;
    expect(JSON.parse(readFileSync(verificationCache, 'utf8')).files.length).toBeGreaterThan(0);
    await fixture.page.setViewportSize({ width: 1440, height: 900 });
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.page, 'GET', '/projects?status=all');
    const created = await runtimeRequest<{ job: { id: string } }>(fixture.page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id, templateId: 'video-translation', templateVersion: 2, creationKey: 'packaged-subtitle-renderer',
      state: { sourceType: 'file', sourceLanguage: 'en', targetLanguage: 'zh_cn', composeVideo: true, workspacePhase: 'result', resultVersion: 1 }
    });
    expect(created.status).toBe(201);
    const jobId = created.body.job.id;
    const videoPath = join(fixture.root, '.opencreator', 'creator', 'jobs', jobId, 'source.mp4');
    mkdirSync(dirname(videoPath), { recursive: true });
    const resources = process.platform === 'darwin'
      ? resolve(dirname(packagedExecutable(desktopDir)), '../Resources')
      : join(dirname(packagedExecutable(desktopDir)), 'resources');
    const ffmpeg = join(resources, 'creator-runtime', 'krillinai', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:d=2:r=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath], { windowsHide: true });
    const database = new DatabaseSync(join(fixture.root, '.opencreator', 'data', 'app.sqlite'));
    try {
      const row = database.prepare('SELECT state_json, created_at FROM creator_jobs WHERE id = ?').get(jobId)!;
      const state = JSON.parse(String(row.state_json));
      const sourceId = 'packaged-subtitle-source';
      const subtitleId = 'packaged-subtitle-target';
      const insert = database.prepare('INSERT INTO creator_artifacts (id, job_id, kind, version, status, path, metadata_json) VALUES (?, ?, ?, 1, ?, ?, ?)');
      insert.run(sourceId, jobId, 'source_video', 'completed', videoPath, JSON.stringify({ fileName: 'source.mp4', width: 640, height: 360, resultVersion: 1 }));
      insert.run(subtitleId, jobId, 'target_subtitle', 'completed', null, JSON.stringify({ resultVersion: 1,
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:02,000', text: '字幕渲染测试' }] }));
      state.resultSnapshots = [{ version: 1, createdAt: row.created_at, action: 'stage-succeeded', stageId: 'subtitle', description: 'Subtitle translation',
        artifactRefs: { source_video: [sourceId], target_subtitle: [subtitleId] }, changedArtifactIds: [subtitleId], staleArtifactIds: [], state: { ...state } }];
      database.prepare('UPDATE creator_jobs SET status = ?, revision = revision + 1, state_json = ? WHERE id = ?').run('completed', JSON.stringify(state), jobId);
    } finally { database.close(); }
    // Measure compilation separately from cold Runtime verification and rendering.
    const compilationStartedAt = Date.now();
    const compilation = fixture.page.waitForResponse(response => response.url().endsWith('/creator/subtitle-render/prepare'), { timeout: 60_000 });
    await navigateToAppRoute(fixture.page, `#/workbench?tool=video-translation&jobId=${created.body.job.id}`);
    expect((await compilation).status()).toBe(200);
    timings.compilationMs = Date.now() - compilationStartedAt;
    const renderingStartedAt = Date.now();
    const composition = fixture.page.locator('.subtitle-composition-preview');
    await expect(composition).toHaveAttribute('data-status', 'ready');
    timings.renderingMs = Date.now() - renderingStartedAt;
    await expect(composition.locator('canvas')).toBeVisible();
    expect(loaded.some(url => url.includes('/subtitle-render/fonts/'))).toBe(true);
    expect(loaded.some(url => /\/assets\/worker-.*\.js$/.test(url))).toBe(true);
    expect(loaded.some(url => /\.wasm$/.test(url))).toBe(true);
    expect(errors).toEqual([]);
    await fixture.page.waitForTimeout(300);
    await composition.screenshot({ path: testInfo.outputPath('packaged-subtitle-preview.png') });
  } finally {
    const subtitleResource = (url: string) => /\/subtitle-render\/|\/assets\/(?:subtitle-renderer|worker-)|\.wasm$/.test(url);
    await testInfo.attach('subtitle-renderer-diagnostics.json', {
      body: JSON.stringify({ timings, loaded: loaded.filter(subtitleResource), requested: requested.filter(subtitleResource), errors, consoleErrors, failedRequests, failedResponses }, null, 2), contentType: 'application/json'
    });
    const desktopLog = join(fixture.root, '.opencreator', 'logs', 'desktop-main.log');
    if (existsSync(desktopLog)) await testInfo.attach('subtitle-desktop-main.log', { path: desktopLog, contentType: 'text/plain' });
    await closeFixture(fixture);
  }
});

test('@package-smoke Windows YouTube 专用登录完成和取消，保存后重启复用', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows normal Chrome login');
  let fixture = await launchPackagedDesktop('success');
  const endpoint = '/platform-connections/youtube';
  try {
    await waitForWorkspace(fixture.page);
    await navigateToAppRoute(fixture.page, '#/settings?tab=platform-connections');
    const section = fixture.page.getByRole('group', { name: 'YouTube', exact: true });
    const state = await runtimeRequest<{ connectionMethod: string }>(fixture.page, 'GET', endpoint);
    expect(state.body.connectionMethod).toBe('browser-login');
    await expect(section.getByRole('combobox')).toHaveCount(0);
    await section.getByRole('button', { name: '连接', exact: true }).click();
    await expect(section.getByRole('button', { name: '完成登录', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(fixture.page.getByRole('alertdialog')).toHaveCount(0);
    await expect(section.getByLabel('连接码')).toHaveCount(0);
    await fixture.page.screenshot({ path: testInfo.outputPath('windows-youtube-login.png') });
    await section.getByRole('button', { name: '取消', exact: true }).click();
    await expect(section.locator('.platform-connection-status')).toHaveText('未连接');
    await section.getByRole('button', { name: '连接', exact: true }).click();
    await expect(section.getByRole('button', { name: '完成登录', exact: true })).toBeVisible({ timeout: 30_000 });
    await section.getByRole('button', { name: '完成登录', exact: true }).click();
    await expect(section.getByText('YouTube sign-in is incomplete. Reconnect and finish signing in in the sign-in window.', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(section.locator('.platform-connection-status')).toHaveText('连接失败');
    // 使用纯测试凭据验证持久化和重启，真实账号登录由用户在正常 Chrome 中完成。
    const text = '# Netscape HTTP Cookie File\n' + ['SID', 'SAPISID'].map(name =>
      ['.youtube.com', 'TRUE', '/', 'TRUE', Math.floor(Date.now() / 1000) + 3600, name, 'fixture-' + name].join('\t')
    ).join('\n');
    expect((await runtimeRequest(fixture.page, 'POST', endpoint + '/import', { cookies: text })).status).toBe(200);
    await expect(section.locator('.platform-connection-status')).toHaveText('已连接');
    const previous = fixture;
    await closePackagedApp(previous);
    fixture = { ...await relaunchPackagedApp(previous), root: previous.root, stateDir: previous.stateDir };
    await waitForWorkspace(fixture.page);
    await navigateToAppRoute(fixture.page, '#/settings?tab=platform-connections');
    const restored = fixture.page.getByRole('group', { name: 'YouTube', exact: true });
    await expect(restored.locator('.platform-connection-status')).toHaveText('已连接');
    await restored.getByRole('button', { name: '重新连接', exact: true }).click();
    await expect(restored.locator('.platform-connection-status')).toHaveText('已连接');
    await expect(restored.getByRole('button', { name: '完成登录' })).toHaveCount(0);
    expect(JSON.stringify((await runtimeRequest(fixture.page, 'GET', endpoint)).body)).not.toMatch(/fixture-|SID|cookies/);
    await fixture.page.screenshot({ path: testInfo.outputPath('windows-youtube-connected.png') });
    await restored.getByRole('button', { name: '断开', exact: true }).click();
    await expect(restored.locator('.platform-connection-status')).toHaveText('未连接');
  } finally {
    await runtimeRequest(fixture.page, 'POST', endpoint + '/cancel').catch(() => undefined);
    await closeFixture(fixture);
  }
});

test('@package-smoke YouTube 连接复用已登录 Chrome 并自动保存登录态', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin' || process.env.OPENCREATOR_E2E_REAL_YOUTUBE !== '1', 'Requires an existing signed-in local Chrome profile');
  let fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    await navigateToAppRoute(fixture.page, '#/settings?tab=platform-connections');
    await expect(fixture.page.getByRole('heading', { name: '平台连接', exact: true })).toBeVisible();
    await expect(fixture.page.getByRole('combobox', { name: '浏览器账号' })).toBeVisible();
    await fixture.page.getByRole('button', { name: '连接', exact: true }).click();
    await expect(fixture.page.getByRole('status').filter({ hasText: '已连接' })).toBeVisible({ timeout: 30_000 });
    const state = await runtimeRequest<{ status: string }>(fixture.page, 'GET', '/platform-connections/youtube');
    expect(state.body.status).toBe('connected');
    expect(JSON.stringify(state.body)).not.toMatch(/SAPISID|secret|cookies|credentials/);
    await fixture.page.screenshot({ path: testInfo.outputPath('youtube-connected.png') });
    if (process.env.OPENCREATOR_E2E_YOUTUBE_PROXY) {
      expect((await runtimeRequest(fixture.page, 'PATCH', '/creator-services/network', { proxy: process.env.OPENCREATOR_E2E_YOUTUBE_PROXY })).status).toBe(200);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const metadata = await runtimeRequest<{ title: string }>(fixture.page, 'GET', '/video-metadata?url=' + encodeURIComponent('https://www.youtube.com/watch?v=m5yrQMnc_jQ'));
      expect(metadata.status).toBe(200);
      expect(metadata.body.title.length).toBeGreaterThan(0);
    }
    const previous = fixture;
    await closePackagedApp(previous);
    fixture = { ...await relaunchPackagedApp(previous), root: previous.root, stateDir: previous.stateDir };
    await waitForWorkspace(fixture.page);
    await navigateToAppRoute(fixture.page, '#/settings?tab=platform-connections');
    await expect(fixture.page.getByRole('status').filter({ hasText: '已连接' })).toBeVisible();
    const restoredMetadata = await runtimeRequest<{ title: string }>(fixture.page, 'GET', '/video-metadata?url=' + encodeURIComponent('https://www.youtube.com/watch?v=m5yrQMnc_jQ'));
    expect(restoredMetadata.status).toBe(200);
    expect(restoredMetadata.body.title.length).toBeGreaterThan(0);
    await fixture.page.getByRole('button', { name: '断开', exact: true }).click();
    await expect(fixture.page.getByRole('status').filter({ hasText: '未连接' })).toBeVisible();
  } finally { await closeFixture(fixture); }
});

test('@package-smoke 设置关闭后退出时，关闭按钮结束实际 App', async () => {
  test.skip(process.platform !== 'darwin', 'Custom window controls are macOS only');
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForRuntimeReady(fixture.page, false);
    await fixture.page.evaluate(async () => {
      await window.opencreatorDesktop?.updateDesktopPreferences({ closeBehavior: 'quit' });
    });
    await fixture.page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    expect(await waitForProcessExit(fixture.process, 3_000)).toBe(true);
    expect(fixture.process.exitCode).toBe(0);
  } finally {
    await closeFixture(fixture);
  }
});

type DesktopFixture = PackagedApp & {
  root: string;
  stateDir: string;
  closeGateway?: () => Promise<void>;
};

async function launchPlatformProbeDesktop(mode: string): Promise<DesktopFixture> {
  const account = { id: 'probe-test', email: 'probe@example.test', verified: true };
  const models = [{ id: 'official-model', modality: 'text' as const, capabilities: ['responses'] }];
  const gateway = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/client/bootstrap') {
      response.end(JSON.stringify(bootstrap));
    } else if (path === '/api/v1/client/models') {
      response.end(JSON.stringify({ models }));
    } else if (path === '/api/v1/client/usage') {
      response.end(JSON.stringify({ keyVersion: '1' }));
    } else if (path === '/api/v1/me') {
      response.end(JSON.stringify({ account }));
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ error: { code: 'not_found' } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  const bootstrap = {
    schemaVersion: 3 as const, account, models, defaults: { text: 'official-model' },
    keyVersion: '1', bindingVersion: 'probe:1',
    transport: 'gateway' as const, supplier: 'chatanywhere' as const,
    baseUrl: `${origin}/v1`, keyRotation: false
  };
  const closeGateway = async () => {
    gateway.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      gateway.close(error => error ? reject(error) : resolve());
    });
  };
  try {
    const fixture = await launchPackagedDesktop(mode, {
      gatewayOrigin: origin,
      gatewaySelectedModels: bootstrap.defaults,
      gatewayCredentials: {
        ...bootstrap, accessToken: 'private-access-token', refreshToken: 'private-refresh-token',
        expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900_000).toISOString()
      }
    });
    return { ...fixture, closeGateway };
  } catch (error) {
    await closeGateway();
    throw error;
  }
}

async function launchPackagedDesktop(
  mode: string,
  options: {
    codexLocation?: 'path' | 'nvm' | 'chatgpt-app';
    minimalPath?: boolean;
    misleadingCodexWrapper?: boolean;
    runtimeMode?: 'bundled' | 'external';
    seedLegacyData?: boolean;
    writeCurrentConfig?: boolean;
    signedOut?: boolean;
    seedLocalCodex?: boolean;
    seedLocalCodexProvider?: boolean;
    telemetryUrl?: string;
    gatewayOrigin?: string;
    gatewayCredentials?: GatewayCredentials;
    gatewaySelectedModels?: Record<string, string>;
    proxy?: string;
    uiLanguage?: 'zh-CN' | null;
    browserLanguage?: string;
  } = {}
): Promise<DesktopFixture> {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-desktop-e2e-'));
  const binDir = options.codexLocation === 'nvm'
    ? join(root, '.nvm', 'versions', 'node', 'v22.14.0', 'bin')
    : options.codexLocation === 'chatgpt-app'
      ? join(root, 'Applications', 'ChatGPT.app', 'Contents', 'Resources')
      : join(root, 'bin');
  const stateDir = join(root, 'fake-codex-state');
  const codexHome = join(root, 'codex-home');
  if (options.seedLocalCodex) {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), '{"OPENAI_API_KEY":"existing-key"}');
    writeFileSync(join(codexHome, 'config.toml'), 'model = "existing-model"\n');
  }
  if (options.seedLocalCodexProvider) {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), [
      'model = "custom-model"',
      'model_provider = "gateway"',
      '[model_providers.gateway]',
      'base_url = "https://gateway.example.test/v1"',
      'experimental_bearer_token = "provider-secret"',
      'requires_openai_auth = false',
      ''
    ].join('\n'));
  }
  const userData = join(root, 'user-data');
  writeCodexShim(binDir, {
    OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR: stateDir,
    OPENCREATOR_E2E_FAKE_CODEX_MODE: mode,
    OPENCREATOR_E2E_FAKE_CODEX_SIGNED_OUT: options.signedOut ? '1' : '0',
    OPENCREATOR_E2E_FAKE_CODEX_CUSTOM_PROVIDER: options.seedLocalCodexProvider ? '1' : '0',
    OPENCREATOR_E2E_NODE_BINARY: process.execPath,
    OPENCREATOR_E2E_FAKE_CODEX_SCRIPT: fakeCodexScript
  });
  mkdirSync(userData, { recursive: true });
  if (options.seedLegacyData === true) {
    writeLegacyDesktopData(
      userData,
      join(binDir, process.platform === 'win32' ? 'codex.exe' : 'codex')
    );
  }
  if (options.writeCurrentConfig !== false) {
    writeOpenCreatorConfig(
      join(root, '.opencreator'),
      join(binDir, process.platform === 'win32' ? 'codex.exe' : 'codex'),
      options.runtimeMode ?? 'external',
      options.uiLanguage === undefined ? 'zh-CN' : options.uiLanguage
    );
  }
  if (options.proxy) {
    const store = createOpenCreatorCreatorServicesConfigStore({
      configFile: join(root, '.opencreator', 'config.toml'),
      credentialsFile: join(root, '.opencreator', 'credentials.json')
    });
    await store.write({ ...await store.read(), proxy: options.proxy });
  }
  if (options.misleadingCodexWrapper === true) {
    writeMisleadingCodexWrapper(join(root, '.local', 'bin'));
  }
  if (options.gatewayCredentials) {
    const configDir = join(root, '.opencreator', 'data', 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'gateway-credentials.json'), JSON.stringify(options.gatewayCredentials));
    if (options.gatewaySelectedModels) {
      writeFileSync(join(configDir, 'gateway.json'), JSON.stringify({
        source: 'gateway', bindingVersion: options.gatewayCredentials.bindingVersion ?? null,
        selectedModels: options.gatewaySelectedModels
      }));
    }
  }

  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [
      `--user-data-dir=${userData}`,
      '--disable-gpu',
      ...(options.browserLanguage ? [`--lang=${options.browserLanguage}`] : [])
    ],
    env: {
      ...withoutElectronRunAsNode(process.env),
      PATH: options.minimalPath
        ? minimalSystemPath()
        : `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      SHELL: process.platform === 'win32' ? process.env.ComSpec : '/bin/false',
      ...(options.minimalPath
        ? {
            HOME: root,
            USERPROFILE: root
          }
        : {}),
      OPENCREATOR_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
      OPENCREATOR_HOME: join(root, '.opencreator'),
      CODEX_HOME: codexHome,
      OPENCREATOR_CODEX_APPLICATION_ROOTS: join(root, 'Applications'),
      OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR: stateDir,
      OPENCREATOR_E2E_FAKE_CODEX_MODE: mode,
      OPENCREATOR_E2E_FAKE_CODEX_SIGNED_OUT: options.signedOut ? '1' : '0',
      OPENCREATOR_E2E_FAKE_CODEX_CUSTOM_PROVIDER: options.seedLocalCodexProvider ? '1' : '0',
      OPENCREATOR_E2E_NODE_BINARY: process.execPath,
      OPENCREATOR_E2E_FAKE_CODEX_SCRIPT: fakeCodexScript,
      ...(options.gatewayOrigin ? { OPENCREATOR_GATEWAY_ORIGIN: options.gatewayOrigin } : {}),
      ...(options.telemetryUrl === undefined
        ? {}
        : { OPENCREATOR_TELEMETRY_URL: options.telemetryUrl }),
      ...(mode === 'workspace-failure'
        ? {
            OPENCREATOR_E2E_IGNORE_FIRST_WORKSPACE_READY: '1',
            OPENCREATOR_E2E_WORKSPACE_READY_TIMEOUT_MS: '3000'
          }
        : {})
    },
    timeoutMs: 30_000
  });
  return { ...app, root, stateDir };
}

function writeOpenCreatorConfig(
  productHome: string,
  codexBin: string,
  runtimeMode: 'bundled' | 'external',
  uiLanguage: 'zh-CN' | null
): void {
  mkdirSync(productHome, { recursive: true });
  writeFileSync(join(productHome, 'config.toml'), [
    'version = 1',
    '',
    '[desktop]',
    'close_behavior = "hide"',
    'notifications_enabled = true',
    '',
    '[runtime]',
    `codex_mode = ${JSON.stringify(runtimeMode)}`,
    `external_codex_bin = ${JSON.stringify(codexBin)}`,
    ...(uiLanguage === null ? [] : ['', '[ui]', `language = ${JSON.stringify(uiLanguage)}`]),
    ''
  ].join('\n'));
}

function writeLegacyDesktopData(userData: string, codexBin: string): void {
  const daemonDir = join(userData, 'daemon');
  const legacyCodexHome = join(userData, 'runtime', 'codex', 'home');
  mkdirSync(daemonDir, { recursive: true });
  mkdirSync(legacyCodexHome, { recursive: true });
  const database = new DatabaseSync(join(daemonDir, 'app.sqlite'));
  database.exec('create table legacy_marker (value text not null)');
  database.close();
  writeFileSync(join(daemonDir, 'legacy-marker.txt'), 'must-not-migrate\n');
  writeFileSync(
    join(legacyCodexHome, 'legacy-codex-marker.txt'),
    'must-not-migrate\n'
  );
  writeFileSync(join(userData, 'desktop-settings.json'), `${JSON.stringify({
    closeBehavior: 'quit',
    notificationsEnabled: false,
    codexRuntimeMode: 'external',
    externalCodexBin: codexBin
  }, null, 2)}\n`);
}

function minimalSystemPath(): string {
  if (process.platform === 'win32') {
    return process.env.SystemRoot === undefined
      ? ''
      : join(process.env.SystemRoot, 'System32');
  }
  return '/usr/bin:/bin:/usr/sbin:/sbin';
}

function packagedCodexExecutablePath(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'codex-runtime', 'bin', 'codex')
    : join(
        packageRoot,
        'resources',
        'codex-runtime',
        'bin',
        process.platform === 'win32' ? 'codex.exe' : 'codex'
      );
}

async function waitForWorkspace(page: Page): Promise<void> {
  await waitForRuntimeReady(page);
  await expect(page.locator('.opencreator-shell')).toBeVisible();
}

async function navigateToAppRoute(page: Page, hash: string): Promise<void> {
  await page.evaluate(route => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, hash);
}

async function waitForRuntimeReady(page: Page, confirmSetup = true): Promise<void> {
  await page.waitForURL(url => (
    url.protocol === 'opencreator-app:'
    && url.hostname === 'app'
  ), { timeout: 45_000 });
  await expect.poll(async () => await page.evaluate(async () => {
    return (await window.opencreatorDesktop?.readBootstrapState())?.phase;
  })).toBe('ready');
  const confirmed = await page.evaluate(() => window.localStorage.getItem('opencreator.agent-setup-confirmed.v1') !== null);
  if (confirmed) return;
  const setup = page.getByRole('region', { name: /^(开始使用 Agent|Get started with Agent)$/ });
  await setup.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (!await setup.isVisible()) return;
  const localMode = page.getByRole('button', { name: /^(本地模式|Local mode)$/ });
  if (await localMode.isVisible()) await localMode.click();
  if (!confirmSetup) return;
  const useLocalCodex = page.getByRole('button', { name: /^(使用本机 Codex，继续|Use local Codex and continue)$/ });
  if (await useLocalCodex.isVisible()) await useLocalCodex.click();
  await setup.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined);
  if (await setup.isVisible()) await page.getByRole('button', { name: /^(稍后配置，进入本地模式|Continue locally and set up later)$/ }).click();
}

async function runtimeRequest<T>(
  page: Page,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: T }> {
  return await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/.opencreator/runtime${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return {
      status: response.status,
      body: await response.json() as T
    };
  }, { method, path, body });
}

async function closeFixture(fixture: DesktopFixture): Promise<void> {
  try { await closePackagedApp(fixture); }
  finally { await fixture.closeGateway?.(); }
  if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function writeCodexShim(binDir: string, environment: Record<string, string>): void {
  mkdirSync(binDir, { recursive: true });
  const fixtureConfig = join(binDir, 'fake-codex-config.json');
  writeFileSync(fixtureConfig, JSON.stringify(environment));
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'codex.exe')
    : join(binDir, 'codex');
  if (process.platform === 'win32') {
    const cacheDir = join(desktopDir, '.cache', 'e2e');
    const cachedLauncher = join(cacheDir, 'fake-codex-launcher.exe');
    mkdirSync(cacheDir, { recursive: true });
    if (
      !existsSync(cachedLauncher)
      || statSync(cachedLauncher).mtimeMs < statSync(fakeCodexLauncherSource).mtimeMs
    ) {
      execFileSync('go', ['build', '-trimpath', '-o', cachedLauncher, fakeCodexLauncherSource], {
        cwd: desktopDir,
        stdio: 'inherit'
      });
    }
    copyFileSync(cachedLauncher, scriptPath);
    return;
  }
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" --fixture-config "${fixtureConfig}" "$@"\n`
  );
  chmodSync(scriptPath, 0o755);
}

function writeMisleadingCodexWrapper(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'codex.cmd')
    : join(binDir, 'codex');
  writeFileSync(
    scriptPath,
    process.platform === 'win32'
      ? [
          '@echo off',
          'if "%1"=="--version" (',
          '  echo codex-cli 0.0.0-legacy',
          '  exit /b 0',
          ')',
          'exit /b 17',
          ''
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'if [ "$1" = "--version" ]; then',
          '  echo "codex-cli 0.0.0-legacy"',
          '  exit 0',
          'fi',
          'exit 17',
          ''
        ].join('\n')
  );
  if (process.platform !== 'win32') chmodSync(scriptPath, 0o755);
}

function readCounter(stateDir: string, name: string): number {
  const path = join(stateDir, name);
  return existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
}

async function waitForDaemonUtilityPid(
  mainPid: number,
  excludedPid?: number
): Promise<number> {
  return await expect.poll(
    () => findDaemonUtilityPid(mainPid, excludedPid),
    { timeout: 15_000 }
  ).not.toBeUndefined().then(() => {
    const pid = findDaemonUtilityPid(mainPid, excludedPid);
    if (pid === undefined) throw new Error('Daemon Utility Process not found');
    return pid;
  });
}

function findDaemonUtilityPid(mainPid: number, excludedPid?: number): number | undefined {
  const rows = process.platform === 'win32'
    ? windowsProcessRows()
    : posixProcessRows();
  const descendants = new Set([mainPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.find(row => (
    row.pid !== excludedPid
    && descendants.has(row.ppid)
    && row.command.includes('--utility-sub-type=node.mojom.NodeService')
  ))?.pid;
}

function windowsProcessRows(): Array<{
  pid: number;
  ppid: number;
  command: string;
}> {
  const output = execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | '
      + 'Select-Object ProcessId,ParentProcessId,CommandLine | '
      + 'ConvertTo-Json -Compress'
  ], {
    encoding: 'utf8'
  }).trim();
  if (output.length === 0) return [];
  const parsed = JSON.parse(output) as Array<{
    ProcessId: number;
    ParentProcessId: number;
    CommandLine?: string | null;
  }> | {
    ProcessId: number;
    ParentProcessId: number;
    CommandLine?: string | null;
  };
  return (Array.isArray(parsed) ? parsed : [parsed]).map(row => ({
    pid: row.ProcessId,
    ppid: row.ParentProcessId,
    command: row.CommandLine ?? ''
  }));
}

function posixProcessRows(): Array<{
  pid: number;
  ppid: number;
  command: string;
}> {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8'
  });
  return output
    .split(/\r?\n/)
    .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(match => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3] ?? ''
    }));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function directDaemonHealth(
  daemonPid: number
): Promise<{ status: number; body: unknown }> {
  const port = daemonListenPort(daemonPid);
  if (port === undefined) return { status: 0, body: null };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(2_000)
    });
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: 0, body: null };
  }
}

function daemonListenPort(pid: number): number | undefined {
  if (process.platform === 'win32') {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-NetTCPConnection -State Listen -OwningProcess ${pid} `
        + '| Where-Object { $_.LocalAddress -eq "127.0.0.1" } '
        + '| Select-Object -First 1 -ExpandProperty LocalPort'
    ], {
      encoding: 'utf8'
    }).trim();
    const port = Number(output);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  }
  const output = execFileSync('lsof', [
    '-nP',
    '-a',
    '-p',
    String(pid),
    '-iTCP',
    '-sTCP:LISTEN',
    '-Fn'
  ], {
    encoding: 'utf8'
  });
  const match = output.match(/^n127\.0\.0\.1:(\d+)$/m);
  return match === null ? undefined : Number(match[1]);
}

function requiredPid(pid: number | undefined): number {
  if (pid === undefined) throw new Error('Desktop process PID is unavailable');
  return pid;
}

function withoutElectronRunAsNode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.OPENCREATOR_UPDATE_URL;
  return next;
}
