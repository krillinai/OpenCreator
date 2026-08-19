import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import {
  chromium,
  type Browser,
  type Page
} from '@playwright/test';

export type PackagedApp = {
  browser: Browser;
  page: Page;
  process: ChildProcess;
  executablePath: string;
  launchArgs: string[];
  env: NodeJS.ProcessEnv;
};

export async function launchPackagedApp(input: {
  executablePath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<PackagedApp> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const port = await reservePort();
  const launchArgs = [
    ...input.args,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`
  ];
  const child = spawn(input.executablePath, launchArgs, {
    env: input.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });
  const diagnostics = collectDiagnostics(child);

  try {
    await waitForCdp(port, child, timeoutMs, diagnostics);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (context === undefined) {
      throw new Error('Desktop CDP connection did not expose a browser context');
    }
    const page = context.pages()[0]
      ?? await context.waitForEvent('page', { timeout: timeoutMs });
    return {
      browser,
      page,
      process: child,
      executablePath: input.executablePath,
      launchArgs: input.args,
      env: input.env
    };
  } catch (error) {
    await terminateProcessTree(child);
    throw error;
  }
}

export async function launchSecondInstance(
  app: PackagedApp,
  extraArgs: string[] = []
): Promise<void> {
  const child = spawn(app.executablePath, [...app.launchArgs, ...extraArgs], {
    env: app.env,
    stdio: 'ignore',
    windowsHide: true
  });
  const exited = await waitForProcessExit(child, 10_000);
  if (!exited) {
    await terminateProcessTree(child);
    throw new Error('Desktop second instance did not exit after handing off');
  }
}

export async function relaunchPackagedApp(
  app: Pick<PackagedApp, 'executablePath' | 'launchArgs' | 'env'>,
  timeoutMs = 30_000
): Promise<PackagedApp> {
  return launchPackagedApp({
    executablePath: app.executablePath,
    args: app.launchArgs,
    env: app.env,
    timeoutMs
  });
}

export async function waitForPackagedPage(
  app: PackagedApp,
  timeoutMs = 15_000
): Promise<Page> {
  const context = app.browser.contexts()[0];
  if (context === undefined) {
    throw new Error('Desktop CDP browser context is unavailable');
  }
  const existing = context.pages().find(page => !page.isClosed());
  if (existing !== undefined) return existing;
  return await context.waitForEvent('page', { timeout: timeoutMs });
}

export async function closePackagedApp(app: PackagedApp): Promise<void> {
  await app.page.evaluate(() => {
    void window.opencreatorDesktop?.quit();
  }).catch(() => undefined);
  const exited = await waitForProcessExit(app.process, 8_000);
  if (!exited) await terminateProcessTree(app.process);
  await app.browser.close().catch(() => undefined);
}

export async function waitForProcessExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve a Desktop CDP port'));
        return;
      }
      server.close(error => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForCdp(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
  diagnostics: () => string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Desktop exited before CDP became ready: `
        + `exit=${String(child.exitCode)} signal=${String(child.signalCode)}\n`
        + diagnostics()
      );
    }
    const ready = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(response => response.ok)
      .catch(() => false);
    if (ready) return;
    await delay(100);
  }
  throw new Error(`Desktop CDP did not become ready within ${timeoutMs}ms\n${diagnostics()}`);
}

function collectDiagnostics(child: ChildProcess): () => string {
  let output = '';
  const append = (chunk: Buffer | string) => {
    output += chunk.toString();
    if (output.length > 64 * 1024) output = output.slice(-64 * 1024);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => output;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true }
      );
      killer.once('error', () => resolve(undefined));
      killer.once('exit', () => resolve(undefined));
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await waitForProcessExit(child, 2_000)) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The process group exited during the grace period.
  }
  await waitForProcessExit(child, 2_000);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
