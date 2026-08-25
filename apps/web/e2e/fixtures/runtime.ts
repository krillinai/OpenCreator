import { expect, test as base, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type FakeCodexInvocation = {
  threadId?: string;
  message?: string;
  initialDelayMs?: number;
  completionDelayMs?: number;
  turnStatus?: 'completed' | 'failed';
  approval?: boolean;
  command?: string;
  agentSchedule?: Record<string, unknown>;
  files?: Record<string, string>;
};

export type FakeCodexThread = {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  cwd: string;
};

export type FakeCodexConfig = {
  invocations?: FakeCodexInvocation[];
  threads?: FakeCodexThread[];
  searchResults?: Array<{
    thread: FakeCodexThread;
    snippet: string;
  }>;
};

export type OpenAppOptions = {
  legacyProjects?: unknown[];
  currentProjectId?: string;
  selectedThreadId?: string;
};

export type RuntimeFixture = {
  origin: string;
  projectDir: string;
  projectId: string;
  ordinaryThreadId: string;
  configureInvocations(invocations: FakeCodexInvocation[]): void;
  configureCodex(config: FakeCodexConfig): void;
  openApp(page: Page, options?: OpenAppOptions): Promise<void>;
  api<T>(method: string, path: string, body?: unknown): Promise<T>;
  apiResult(method: string, path: string, body?: unknown): Promise<{
    status: number;
    body: unknown;
  }>;
  createSchedule(overrides?: Record<string, unknown>): Promise<ScheduleFixture>;
  runScheduleNow(scheduleId: string): Promise<RunNowFixture>;
  waitForRunStatus(
    runId: string,
    statuses: string | string[],
    timeoutMs?: number
  ): Promise<Record<string, unknown>>;
  readInvocationCount(): number;
  readCodexMethods(): string[];
};

type ScheduleFixture = {
  id: string;
  threadId: string;
  name: string;
};

type RunNowFixture = {
  run: null | { id: string; threadId?: string; status: string };
  queued: boolean;
  skipped: boolean;
};

type RuntimeConfig = {
  baseUrl: string;
  token: string;
};

type TestFixtures = {
  runtime: RuntimeFixture;
  browserGuard: void;
};

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const fakeCodexScript = join(repoRoot, 'apps/web/e2e/support/fake-codex.mjs');
const fakeCodexLauncherSource = join(
  repoRoot,
  'apps/desktop/e2e/fixtures/fake-codex-launcher.go'
);
let daemonDevelopmentPrepared = false;

export const test = base.extend<TestFixtures>({
  runtime: async ({}, use, testInfo) => {
    const rootDir = mkdtempSync(join(tmpdir(), 'opencreator-web-e2e-'));
    const dataDir = join(rootDir, 'runtime');
    const codexHome = join(rootDir, 'codex-home');
    const stateDir = join(rootDir, 'fake-codex-state');
    const projectDir = join(rootDir, 'workspace');
    const configPath = join(rootDir, 'fake-codex-config.json');
    const wrapperPath = join(rootDir, process.platform === 'win32' ? 'fake-codex.exe' : 'fake-codex');
    const serverLogPath = join(rootDir, 'server.log');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      invocations: [{ message: 'E2E 默认结果' }],
      threads: [],
      searchResults: []
    }));
    writeFakeCodexLauncher(wrapperPath);

    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    let serverLog = '';
    const packageManagerArgs = [
      '--filter',
      '@opencreator/web',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort'
    ];
    const packageManagerScript = [
      process.env.npm_execpath,
      process.platform === 'win32' && process.env.APPDATA !== undefined
        ? join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
        : undefined
    ].find(candidate => candidate !== undefined && existsSync(candidate));
    prepareDaemonDevelopment(packageManagerScript);
    const child = spawn(
      packageManagerScript === undefined ? 'pnpm' : process.execPath,
      packageManagerScript === undefined
        ? packageManagerArgs
        : [packageManagerScript, ...packageManagerArgs],
      {
        cwd: repoRoot,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          CLAWEE_DATA_DIR: dataDir,
          CLAWEE_CODEX_BIN: wrapperPath,
          CLAWEE_CODEX_HOME: codexHome,
          CLAWEE_CODEX_THREAD_ROTATION_RUN_THRESHOLD: '0',
          CLAWEE_RUNTIME_DEV_PREPARED: '1',
          CLAWEE_E2E_FAKE_CODEX_CONFIG: configPath,
          CLAWEE_E2E_FAKE_CODEX_STATE_DIR: stateDir,
          CLAWEE_E2E_NODE_BINARY: process.execPath,
          CLAWEE_E2E_FAKE_CODEX_SCRIPT: fakeCodexScript
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    child.stdout?.on('data', chunk => {
      serverLog += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      serverLog += chunk.toString();
    });

    try {
      const runtimeConfig = await waitForRuntime(origin, child, () => serverLog);
      const runtimeBaseUrl = new URL(runtimeConfig.baseUrl, origin).toString().replace(/\/+$/, '');
      const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        const response = await fetch(`${runtimeBaseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${runtimeConfig.token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        if (!response.ok) {
          throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
        }
        return await response.json() as T;
      };
      const apiResult = async (
        method: string,
        path: string,
        body?: unknown
      ): Promise<{ status: number; body: unknown }> => {
        const response = await fetch(`${runtimeBaseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${runtimeConfig.token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text.length === 0 ? {} : JSON.parse(text) as unknown
        };
      };
      const project = await api<{ project: { id: string } }>('POST', '/projects', {
        cwd: projectDir,
        name: 'workspace'
      });
      const ordinary = await api<{ thread: { id: string } }>('POST', '/threads', {
        title: '普通会话',
        projectId: project.project.id,
        profile: 'default',
        sandbox: 'workspace-write'
      });
      const writeCodexConfig = (update: FakeCodexConfig) => {
        const current = JSON.parse(readFileSync(configPath, 'utf8')) as FakeCodexConfig;
        const temporaryPath = `${configPath}.tmp`;
        writeFileSync(temporaryPath, JSON.stringify({ ...current, ...update }));
        renameSync(temporaryPath, configPath);
      };

      const fixture: RuntimeFixture = {
        origin,
        projectDir,
        projectId: project.project.id,
        ordinaryThreadId: ordinary.thread.id,
        configureInvocations(invocations) {
          writeCodexConfig({ invocations });
        },
        configureCodex(config) {
          writeCodexConfig(config);
        },
        async openApp(page, options = {}) {
          const projectId = options.currentProjectId ?? project.project.id;
          const ordinaryThreadId = ordinary.thread.id;
          const selectedThreadId = options.selectedThreadId ?? ordinaryThreadId;
          await page.addInitScript(({
            projectId: storedProjectId,
            selectedThreadId: storedThreadId,
            legacyProjects
          }) => {
            if (window.top !== window) return;
            localStorage.setItem('clawee.preferences.dynamicBackground', 'false');
            localStorage.setItem('opencreator.preferences.language', 'zh-CN');
            localStorage.setItem('clawee.tasks.notifications.v1', JSON.stringify({
              enabled: true,
              permission: 'granted'
            }));
            localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
              currentProjectId: storedProjectId,
              selectedThreadId: storedThreadId
            }));
            if (legacyProjects !== undefined) {
              localStorage.setItem('opencreator.projects.v1', JSON.stringify(legacyProjects));
            }
            const notifications: Array<{
              title: string;
              body?: string;
              click(): void;
            }> = [];
            Object.defineProperty(window, '__opencreatorE2eNotifications', {
              configurable: true,
              value: notifications
            });
            class E2ENotification {
              static permission = 'granted';
              static requestPermission = async () => 'granted';
              onclick: null | (() => void) = null;
              constructor(title: string, options?: NotificationOptions) {
                notifications.push({
                  title,
                  body: options?.body,
                  click: () => this.onclick?.()
                });
              }
              close() {}
            }
            Object.defineProperty(window, 'Notification', {
              configurable: true,
              value: E2ENotification
            });
          }, {
            projectId,
            selectedThreadId,
            legacyProjects: options.legacyProjects
          });
          await page.goto(`${origin}/#/thread/${encodeURIComponent(selectedThreadId)}`);
          await expect(page.getByRole('status', { name: '本地运行内核正常' })).toBeVisible();
        },
        api,
        apiResult,
        createSchedule(overrides = {}) {
          return api<ScheduleFixture>('POST', '/schedules', {
            name: 'E2E 计划任务',
            cron: '0 * * * *',
            timezone: 'Asia/Shanghai',
            enabled: true,
            prompt: '生成 E2E 测试结果',
            profile: 'default',
            cwd: projectDir,
            sandbox: 'workspace-write',
            concurrencyPolicy: 'queue',
            misfirePolicy: 'skip',
            ...overrides
          });
        },
        runScheduleNow(scheduleId) {
          return api<RunNowFixture>('POST', `/schedules/${encodeURIComponent(scheduleId)}/run-now`);
        },
        async waitForRunStatus(runId, statuses, timeoutMs = 15_000) {
          const accepted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
          const deadline = Date.now() + timeoutMs;
          let latest: Record<string, unknown> = {};
          while (Date.now() < deadline) {
            latest = await api<Record<string, unknown>>(
              'GET',
              `/runs/${encodeURIComponent(runId)}`
            );
            if (accepted.has(String(latest.status))) return latest;
            await delay(50);
          }
          throw new Error(`Run ${runId} did not reach ${[...accepted].join(', ')}: ${JSON.stringify(latest)}`);
        },
        readInvocationCount() {
          try {
            return Number(readFileSync(join(stateDir, 'invocation-count.txt'), 'utf8'));
          } catch {
            return 0;
          }
        },
        readCodexMethods() {
          try {
            return readFileSync(join(stateDir, 'messages.ndjson'), 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .flatMap(line => {
                const parsed = JSON.parse(line) as {
                  message?: { method?: unknown };
                };
                return typeof parsed.message?.method === 'string'
                  ? [parsed.message.method]
                  : [];
              });
          } catch {
            return [];
          }
        }
      };

      await use(fixture);
    } finally {
      writeFileSync(serverLogPath, serverLog);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('vite-daemon.log', {
          path: serverLogPath,
          contentType: 'text/plain'
        });
      }
      await stopProcessTree(child);
      terminateRecordedFakeCodexProcesses(stateDir);
      if (process.env.CLAWEE_E2E_KEEP_TEMP !== '1') {
        rmSync(rootDir, {
          recursive: true,
          force: true,
          maxRetries: 30,
          retryDelay: 200
        });
      }
    }
  },

  browserGuard: [async ({ page, runtime: _runtime }, use, testInfo) => {
    const issues: string[] = [];
    page.on('pageerror', error => {
      if (error.message.includes("document is sandboxed and lacks the 'allow-same-origin' flag")) {
        return;
      }
      issues.push(`pageerror: ${error.message}`);
    });
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const location = message.location().url;
      if (
        message.text().includes("Blocked script execution in 'about:srcdoc'")
        && message.text().includes("'allow-scripts'")
      ) {
        return;
      }
      if (
        message.text().includes('Failed to load resource')
        && location.includes('/.clawee/runtime/enterprise/mcp')
      ) {
        return;
      }
      issues.push(`console: ${message.text()}${location.length > 0 ? ` (${location})` : ''}`);
    });
    page.on('response', response => {
      if (response.status() >= 500) {
        issues.push(`http ${response.status()}: ${response.url()}`);
      }
    });

    await use();

    if (issues.length > 0) {
      await testInfo.attach('browser-errors.txt', {
        body: Buffer.from(issues.join('\n')),
        contentType: 'text/plain'
      });
    }
    expect(issues, '浏览器控制台或网络不应出现未处理错误').toEqual([]);
  }, { auto: true }]
});

export { expect };

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a local port'));
        return;
      }
      const port = address.port;
      server.close(error => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

function writeFakeCodexLauncher(targetPath: string): void {
  if (process.platform !== 'win32') {
    writeFileSync(
      targetPath,
      `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`,
      { mode: 0o755 }
    );
    return;
  }

  const cacheDir = join(repoRoot, 'apps/web/.cache/e2e');
  const cachedLauncher = join(cacheDir, 'fake-codex-launcher.exe');
  mkdirSync(cacheDir, { recursive: true });
  if (
    !existsSync(cachedLauncher)
    || statSync(cachedLauncher).mtimeMs < statSync(fakeCodexLauncherSource).mtimeMs
  ) {
    execFileSync('go', ['build', '-trimpath', '-o', cachedLauncher, fakeCodexLauncherSource], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  }
  copyFileSync(cachedLauncher, targetPath);
}

function prepareDaemonDevelopment(packageManagerScript: string | undefined): void {
  if (daemonDevelopmentPrepared) return;
  const args = ['--filter', '@opencreator/daemon', 'run', 'predev'];
  if (packageManagerScript !== undefined) {
    execFileSync(process.execPath, [packageManagerScript, ...args], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  } else {
    execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
      cwd: repoRoot,
      stdio: 'inherit'
    });
  }
  daemonDevelopmentPrepared = true;
}

function terminateRecordedFakeCodexProcesses(stateDir: string): void {
  const path = join(stateDir, 'app-server-pids.txt');
  if (!existsSync(path)) return;
  const pids = [...new Set(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))].reverse();
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true
        });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // The process may already have exited with the Daemon tree.
    }
  }
}

async function waitForRuntime(
  origin: string,
  child: ChildProcess,
  readLog: () => string
): Promise<RuntimeConfig> {
  const deadline = Date.now() + 45_000;
  let latestError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited with code ${child.exitCode}.\n${readLog()}`);
    }
    try {
      const response = await fetch(`${origin}/.opencreator/runtime-config`);
      if (response.ok) return await response.json() as RuntimeConfig;
      latestError = `${response.status} ${await response.text()}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Runtime did not become ready: ${latestError}\n${readLog()}`);
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>(resolveExit => {
    child.once('exit', () => resolveExit());
  });
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, delay(3_000)]);
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await Promise.race([exited, delay(3_000)]);
}
