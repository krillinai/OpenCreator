import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp,
  relaunchPackagedApp,
  type PackagedApp
} from './packaged-app.js';
import {
  FakeEnterpriseAuthServer,
  writeEnterpriseE2EConfig
} from './fake-enterprise-auth-2026-08-06.js';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');
const enterpriseServer = new FakeEnterpriseAuthServer();
let enterpriseOrigin = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  enterpriseOrigin = await enterpriseServer.start();
});

test.afterAll(async () => {
  await enterpriseServer.close();
});

test('实际 Desktop 包创建并重启恢复 Creator Job，且使用内嵌 Runtime', async () => {
  const fixture = await launchCreatorDesktop();
  let currentApp: PackagedApp = fixture.app;

  try {
    await waitForWorkspace(currentApp.page);
    expect(currentApp.page.url()).toContain('opencreator-app://app/');

    const runtimeRoot = packagedRuntimeRoot();
    const runtimeManifest = JSON.parse(
      readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')
    ) as {
      platform: string;
      arch: string;
      resources: Array<{ path: string; kind: string }>;
    };
    expect(runtimeManifest).toMatchObject({
      platform: process.platform,
      arch: process.arch
    });
    expect(runtimeManifest.resources.map(resource => resource.path)).toEqual(
      expect.arrayContaining([
        executableResource('bin/krillinai-cli'),
        executableResource('bin/ffmpeg'),
        executableResource('bin/ffprobe'),
        executableResource('bin/yt-dlp')
      ])
    );
    expect(runtimeManifest.resources.some(resource => resource.kind === 'model')).toBe(false);
    expect(runtimeManifest.resources.some(resource => /whisper/i.test(resource.path))).toBe(false);
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);

    const projectDir = join(fixture.root, 'creator-workspace');
    mkdirSync(projectDir, { recursive: true });
    const createdProject = await runtimeRequest<{
      project: { id: string };
    }>(currentApp.page, 'POST', '/projects', {
      cwd: projectDir,
      name: 'Creator 打包态验证',
      sandbox: 'workspace-write'
    });
    expect(createdProject.status).toBe(201);

    const templates = await runtimeRequest<{
      templates: Array<{ id: string }>;
    }>(currentApp.page, 'GET', '/creator/templates');
    expect(templates.status).toBe(200);
    expect(templates.body.templates.map(template => template.id)).toEqual(
      expect.arrayContaining([
        'video-translation',
        'video-download',
        'cover',
        'image-generation',
        'auto-clip',
        'stickman-video'
      ])
    );

    await currentApp.page.getByRole('button', { name: '工作台' }).click();
    await expect(currentApp.page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await currentApp.page.getByRole('button', { name: /^图像生成/ }).click();
    await expect(currentApp.page.getByRole('heading', { name: '图像生成' })).toBeVisible();
    await expect(currentApp.page.getByRole('textbox', { name: '提示词' })).toBeVisible();

    const createdJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-package-smoke',
        targetLanguage: 'en'
      }
    });
    expect(createdJob.status).toBe(201);
    expect(createdJob.body.job).toMatchObject({
      revision: 0,
      state: { targetLanguage: 'en' }
    });

    const updatedJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'ja', dubbing: true } }
    });
    expect(updatedJob.status).toBe(200);
    expect(updatedJob.body.job).toMatchObject({
      revision: 1,
      state: { targetLanguage: 'ja', dubbing: true }
    });
    const imageJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'image-generation',
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });
    expect(imageJob.status).toBe(201);
    expect(imageJob.body.job).toMatchObject({
      revision: 0,
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });

    const relaunchInput = {
      executablePath: currentApp.executablePath,
      launchArgs: currentApp.launchArgs,
      env: currentApp.env
    };
    await closePackagedApp(currentApp);
    currentApp = await relaunchPackagedApp(relaunchInput, 45_000);
    await waitForWorkspace(currentApp.page);

    const restoredJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${createdJob.body.job.id}`);
    expect(restoredJob.status).toBe(200);
    expect(restoredJob.body.job).toMatchObject({
      id: createdJob.body.job.id,
      revision: 1,
      state: { targetLanguage: 'ja', dubbing: true }
    });
    const restoredImageJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${imageJob.body.job.id}`);
    expect(restoredImageJob.status).toBe(200);
    expect(restoredImageJob.body.job).toMatchObject({
      id: imageJob.body.job.id,
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);
  } finally {
    await currentApp.page.evaluate(async () => {
      await fetch('/.opencreator/runtime/enterprise/logout', {
        method: 'POST',
        signal: AbortSignal.timeout(2_000)
      }).catch(() => undefined);
    }).catch(() => undefined);
    await closePackagedApp(currentApp).catch(() => undefined);
    if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

function hasWhisperKitDependency(root: string): boolean {
  const dependencyRoot = join(
    root,
    'user-data',
    'daemon',
    'creator-runtime',
    'dependencies',
    'krillinai'
  );
  return existsSync(join(dependencyRoot, 'bin', 'whisperkit-cli'))
    || existsSync(join(
      dependencyRoot,
      'models',
      'whisperkit',
      'openai_whisper-large-v2'
    ));
}

async function launchCreatorDesktop(): Promise<{
  app: PackagedApp;
  root: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-packaged-e2e-'));
  const binDir = join(root, 'bin');
  const stateDir = join(root, 'fake-codex-state');
  const codexHome = join(root, 'codex-home');
  const enterpriseRunId = randomUUID();
  const enterpriseConfigPath = join(root, '.opencreator', 'config.toml');
  writeCodexShim(binDir);
  writeEnterpriseE2EConfig(enterpriseConfigPath, enterpriseOrigin);

  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [
      `--user-data-dir=${join(root, 'user-data')}`,
      '--disable-gpu',
      `--opencreator-enterprise-e2e=${enterpriseRunId}`,
      `--opencreator-enterprise-e2e-config=${enterpriseConfigPath}`
    ],
    env: {
      ...withoutDesktopTestEnvironment(process.env),
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      SHELL: process.platform === 'win32' ? process.env.ComSpec : '/bin/false',
      HOME: root,
      USERPROFILE: root,
      OPENCREATOR_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
      CODEX_HOME: codexHome,
      OPENCREATOR_CODEX_APPLICATION_ROOTS: join(root, 'Applications'),
      OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR: stateDir,
      OPENCREATOR_E2E_FAKE_CODEX_MODE: 'success',
      OPENCREATOR_ENTERPRISE_E2E_RUN_ID: enterpriseRunId
    },
    timeoutMs: 45_000
  });
  return { app, root };
}

async function waitForWorkspace(page: Page): Promise<void> {
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
      .catch(() => undefined);
    if (state?.phase === 'failed' || state?.phase === 'workspace_failed') {
      throw new Error(
        `Desktop 启动失败：${state.phase} ${state.error?.code ?? ''} `
        + `${state.error?.message ?? ''}`
      );
    }
    return new URL(page.url()).hostname;
  }, { timeout: 45_000 }).toBe('app');
  await expect.poll(async () => (
    await page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
  )?.phase).toBe('ready');
  await expect(page.locator('.opencreator-shell')).toBeVisible();
}

async function runtimeRequest<T>(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; body: T }> {
  return await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/.opencreator/runtime${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as T };
  }, { method, path, body });
}

function packagedRuntimeRoot(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'creator-runtime', 'krillinai')
    : join(packageRoot, 'resources', 'creator-runtime', 'krillinai');
}

function executableResource(path: string): string {
  return process.platform === 'win32' ? `${path}.exe` : path;
}

function writeCodexShim(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'codex.cmd')
    : join(binDir, 'codex');
  writeFileSync(
    scriptPath,
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${fakeCodexScript}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`
  );
  if (process.platform !== 'win32') chmodSync(scriptPath, 0o755);
}

function withoutDesktopTestEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'OPENCREATOR_UPDATE_URL',
    'OPENCREATOR_ENTERPRISE_ORIGIN',
    'OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED',
    'OPENCREATOR_ENTERPRISE_E2E_RUN_ID',
    'OPENCREATOR_CREATOR_RUNTIME_ROOT'
  ]) {
    delete next[name];
  }
  return next;
}

if (!existsSync(fakeCodexScript)) {
  throw new Error(`Fake Codex fixture 不存在：${fakeCodexScript}`);
}
