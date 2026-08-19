import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  dirname,
  join,
  resolve
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type Page
} from '@playwright/test';
import type { DesktopBootstrapState } from '../src/shared/types.js';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp
} from './packaged-app.js';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const bundledCodex = [
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex'
].find(existsSync);

test('Finder 环境使用 macOS 应用内置 Codex 完成真实 Probe', async () => {
  test.skip(
    process.env.OPENCREATOR_RUN_REAL_CODEX_SMOKE !== '1',
    '真实 Codex smoke 只在显式发布验收时运行'
  );
  test.skip(
    process.platform !== 'darwin' || bundledCodex === undefined,
    '当前机器没有可用于验收的 macOS 应用内置 Codex'
  );
  const root = mkdtempSync(join(tmpdir(), 'opencreator-bundled-codex-smoke-'));
  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [`--user-data-dir=${join(root, 'user-data')}`, '--disable-gpu'],
    env: {
      ...finderLikeEnvironment(process.env),
      HOME: root,
      CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
      SHELL: '/bin/false'
    },
    timeoutMs: 30_000
  });

  try {
    const state = await waitForBootstrapOutcome(app.page, 60_000);
    if (state.phase === 'failed') {
      throw new Error(
        `应用内置 Codex Probe 失败：${state.error?.code ?? 'UNKNOWN'} `
        + `${state.error?.message ?? ''} `
        + `${JSON.stringify(state.error?.details ?? {})}`
      );
    }
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: bundledCodex
    });
  } finally {
    await closePackagedApp(app);
    rmSync(root, { recursive: true, force: true });
  }
});

test('使用本机真实 Codex 完成冷启动 Probe 和真实会话', async () => {
  test.skip(
    process.env.OPENCREATOR_RUN_REAL_CODEX_SMOKE !== '1',
    '真实 Codex smoke 只在显式发布验收时运行'
  );
  const root = mkdtempSync(join(tmpdir(), 'opencreator-real-codex-smoke-'));
  const userData = join(root, 'user-data');
  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [`--user-data-dir=${userData}`, '--disable-gpu'],
    env: finderLikeEnvironment(process.env),
    timeoutMs: 30_000
  });

  try {
    const page = app.page;
    const bootstrapState = await waitForBootstrapOutcome(page, 60_000);
    if (bootstrapState.phase === 'failed') {
      throw new Error(
        `真实 Codex Probe 失败：${bootstrapState.error?.code ?? 'UNKNOWN'} `
        + `${bootstrapState.error?.message ?? ''} `
        + `${JSON.stringify(bootstrapState.error?.details ?? {})}`
      );
    }
    await page.waitForURL(url => (
      url.protocol === 'opencreator-app:'
      && url.hostname === 'app'
    ), { timeout: 15_000 });
    const initial = await page.evaluate(async () => {
      const state = await window.opencreatorDesktop?.readBootstrapState();
      const health = await fetch('/.opencreator/runtime/healthz');
      return {
        state,
        healthStatus: health.status,
        healthBody: await health.json()
      };
    });
    expect(initial).toMatchObject({
      state: {
        phase: 'ready',
        attempt: 1
      },
      healthStatus: 200,
      healthBody: { ok: true }
    });
    const availabilityProbe = await waitForAvailabilityProbe(page, 60_000);
    expect(availabilityProbe).toMatchObject({
      status: 'succeeded',
      responseReceived: true,
      markerMatched: true
    });
    expect(availabilityProbe.durationMs).toEqual(expect.any(Number));

    const conversation = await runRealHello(page, root);
    if (conversation.status !== 'succeeded') {
      throw new Error(
        `真实 Codex 会话失败：${JSON.stringify(conversation)}`
      );
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL(url => url.hostname === 'app');
    }
    const refreshedState = await page.evaluate(
      () => window.opencreatorDesktop?.readBootstrapState()
    );
    expect(refreshedState).toMatchObject({
      phase: 'ready',
      attempt: 1
    });

    const reportDir = resolve(desktopDir, '../../test-results');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, 'opencreator-desktop-real-codex-smoke.json'),
      `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        codexBin: initial.state?.codexBin,
        codexHome: initial.state?.codexHome,
        probeDurationMs: availabilityProbe.durationMs,
        availabilityProbe,
        threadId: conversation.threadId,
        runId: conversation.runId,
        runStatus: conversation.status,
        bootstrapAttempt: initial.state?.attempt,
        refreshCount: 5,
        refreshAttempt: refreshedState?.attempt,
        result: 'PASS'
      }, null, 2)}\n`
    );
  } finally {
    await closePackagedApp(app);
    rmSync(root, { recursive: true, force: true });
  }
});

async function runRealHello(
  page: Page,
  cwd: string
): Promise<{
  threadId: string;
  runId: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}> {
  return await page.evaluate(async ({ cwd }) => {
    const runtimeRequest = async (
      method: string,
      path: string,
      body?: Record<string, unknown>
    ) => {
      const response = await fetch(`/.opencreator/runtime${path}`, {
        method,
        headers: body === undefined
          ? undefined
          : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          `${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`
        );
      }
      return payload as Record<string, any>;
    };

    const createdProject = await runtimeRequest('POST', '/projects', {
      cwd,
      name: '真实 Codex 验收项目',
      profile: 'default',
      sandbox: 'read-only'
    });
    const createdThread = await runtimeRequest('POST', '/threads', {
      projectId: createdProject.project.id,
      title: '真实 Codex 验收会话'
    });
    const threadId = createdThread.thread.id as string;
    const createdRun = await runtimeRequest('POST', '/runs', {
      threadId,
      prompt: 'hello'
    });
    const runId = createdRun.id as string;
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
      const run = await runtimeRequest('GET', `/runs/${encodeURIComponent(runId)}`);
      if (
        run.status === 'succeeded'
        || run.status === 'failed'
        || run.status === 'canceled'
      ) {
        return {
          threadId,
          runId,
          status: run.status as string,
          errorCode: run.errorCode as string | null | undefined,
          errorMessage: run.errorMessage as string | null | undefined
        };
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
    throw new Error(`等待真实 Codex 会话完成超时：${runId}`);
  }, { cwd });
}

async function waitForBootstrapOutcome(
  page: Page,
  timeoutMs: number
): Promise<DesktopBootstrapState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      () => window.opencreatorDesktop?.readBootstrapState()
    ).catch(() => undefined);
    const resolved = await state;
    if (resolved?.phase === 'ready' || resolved?.phase === 'failed') {
      return resolved;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`等待 Desktop 启动状态超时（${timeoutMs}ms）`);
}

async function waitForAvailabilityProbe(
  page: Page,
  timeoutMs: number
): Promise<{
  status: string;
  durationMs?: number;
  responseReceived?: boolean;
  markerMatched?: boolean;
  errorCode?: string;
  message?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await page.evaluate(async () => {
      const response = await fetch('/.opencreator/runtime/codex/status');
      if (!response.ok) {
        throw new Error(`Codex status failed with ${response.status}`);
      }
      const status = await response.json() as {
        availabilityProbe?: {
          status: string;
          durationMs?: number;
          responseReceived?: boolean;
          markerMatched?: boolean;
          errorCode?: string;
          message?: string;
        };
      };
      return status.availabilityProbe;
    });
    if (probe !== undefined && probe.status !== 'pending') return probe;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待 Codex 后台可用性验证超时（${timeoutMs}ms）`);
}

function finderLikeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR;
  delete next.OPENCREATOR_E2E_FAKE_CODEX_MODE;
  delete next.OPENCREATOR_UPDATE_URL;
  if (process.platform !== 'win32') {
    next.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
    delete next.SHELL;
  }
  return next;
}
