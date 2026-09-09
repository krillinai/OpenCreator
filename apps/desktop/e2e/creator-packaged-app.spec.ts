import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp,
  relaunchPackagedApp,
  type PackagedApp
} from './packaged-app.js';
const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');
const fakeCodexLauncherSource = join(e2eDir, 'fixtures', 'fake-codex-launcher.go');
const fakeYtDlpScript = join(e2eDir, 'fixtures', 'fake-yt-dlp.mjs');
const fakeYtDlpLauncherSource = join(
  e2eDir,
  'fixtures',
  'fake-yt-dlp-launcher.go'
);
const OVERSIZED_WAVE_PCM_BYTES = 10 * 1024 * 1024 + 4096;
const OVERSIZED_WAVE_FILE_BYTES = OVERSIZED_WAVE_PCM_BYTES + 44;
test.describe.configure({ mode: 'serial' });

test('实际 Desktop 包创建并重启恢复 Creator Job，且使用内嵌 Runtime', async () => {
  test.setTimeout(180_000);
  const fixture = await launchCreatorDesktop();
  let currentApp: PackagedApp = fixture.app;

  try {
    await waitForWorkspace(currentApp.page);
    expect(currentApp.page.url()).toContain('opencreator-app://app/');
    await expect.poll(async () => (
      await currentApp.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
    )?.codexHome).toBe(join(
      fixture.root,
      '.opencreator',
      'runtime',
      'external-codex'
    ));

    const runtimeRoot = packagedRuntimeRoot();
    const runtimeManifest = JSON.parse(
      readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')
    ) as {
      platform: string;
      arch: string;
      ytDlp: {
        mode: 'python';
        version: string;
        pythonVersion: string;
        executable: string;
        script: string;
        certificateBundle: string;
      };
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
        runtimeManifest.ytDlp.executable,
        runtimeManifest.ytDlp.script,
        runtimeManifest.ytDlp.certificateBundle
      ])
    );
    expect(runtimeManifest.ytDlp).toMatchObject({
      mode: 'python',
      version: '2026.08.29.232711',
      pythonVersion: '3.13.15'
    });
    expect(runtimeManifest.resources.some(resource => (
      resource.path.endsWith('.pyc')
      || resource.path.includes('/__pycache__/')
    ))).toBe(false);
    const ytDlpStartup = packagedYtDlpVersion(runtimeRoot, runtimeManifest.ytDlp);
    expect(ytDlpStartup.version).toBe(runtimeManifest.ytDlp.version);
    expect(ytDlpStartup.elapsedMs).toBeLessThan(10_000);
    expect(containsPythonBytecodeCache(
      join(runtimeRoot, 'yt-dlp-runtime', 'python')
    )).toBe(false);
    expect(runtimeManifest.resources.some(resource => resource.kind === 'model')).toBe(false);
    expect(runtimeManifest.resources.some(resource => /whisper/i.test(resource.path))).toBe(false);
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);
    expect(packagedCreatorAgentRuntimeFiles()).toEqual([
      'SKILL.md',
      'manifest.json'
    ]);

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
    const ytDlpStatus = await runtimeRequest<{
      ytDlp: {
        channel: string;
        source: string;
        currentVersion: string;
        bundledVersion: string;
        latestVersion: string | null;
        updateAvailable: boolean;
      };
    }>(currentApp.page, 'GET', '/creator/yt-dlp/status');
    expect(ytDlpStatus.status).toBe(200);
    expect(ytDlpStatus.body.ytDlp).toMatchObject({
      channel: 'nightly',
      source: 'bundled',
      currentVersion: '2026.08.29.232711',
      bundledVersion: '2026.08.29.232711'
    });
    expect(typeof ytDlpStatus.body.ytDlp.updateAvailable).toBe('boolean');
    if (ytDlpStatus.body.ytDlp.updateAvailable) {
      expect(ytDlpStatus.body.ytDlp.latestVersion).not.toBeNull();
      expect(ytDlpStatus.body.ytDlp.latestVersion)
        .not.toBe(ytDlpStatus.body.ytDlp.currentVersion);
    }

    const aliyunVoices = await runtimeRequest<{
      provider: string;
      model: string;
      voices: Array<{ id: string; name: string }>;
    }>(
      currentApp.page,
      'GET',
      '/creator-services/tts/voices?provider=aliyun&model=qwen3-tts-flash'
    );
    expect(aliyunVoices.status).toBe(200);
    expect(aliyunVoices.body).toMatchObject({
      provider: 'aliyun',
      model: 'qwen3-tts-flash'
    });
    expect(aliyunVoices.body.voices.map(voice => voice.id)).toEqual(
      expect.arrayContaining(['Cherry', 'Kiki'])
    );

    await currentApp.page.getByRole('button', { name: '设置' }).click();
    await currentApp.page.getByRole('button', { name: 'AI 服务' }).click();
    await expect(currentApp.page.getByRole('heading', { name: 'AI 服务' })).toBeVisible();
    await expect(currentApp.page.getByRole('button', { name: 'Codex Agent' })).toHaveCount(0);
    await expect(currentApp.page.getByRole('tab', { name: '模型服务' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(currentApp.page.getByRole('group', { name: '模型服务' })).toBeVisible();
    await currentApp.page.getByRole('tab', { name: '配音服务' }).click();
    const providerSelect = currentApp.page.getByRole('combobox', { name: '服务商' });
    await expect(providerSelect).toHaveText('OpenAI TTS');
    await expect(currentApp.page.getByRole('combobox', { name: '默认音色' }))
      .toHaveValue('marin');
    await providerSelect.click();
    await currentApp.page.getByRole('option', { name: '阿里云百炼' }).click();
    await expect(currentApp.page.getByLabel('Base URL'))
      .toHaveValue('https://dashscope.aliyuncs.com/api/v1');
    await expect(currentApp.page.getByLabel('模型')).toHaveValue('qwen3-tts-flash');
    await expect.poll(async () => (
      currentApp.page.getByRole('combobox', { name: '默认音色' })
        .locator('option')
        .allTextContents()
    )).toEqual(expect.arrayContaining([
      expect.stringContaining('Cherry'),
      expect.stringContaining('Kiki')
    ]));

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
      creationKey: 'packaged-video-translation',
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
    const agentTurn = await runtimeRequest<{
      turn: {
        role: string;
        status: string;
        content: string;
      };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/agent-turns`, {
      message: '合成横屏视频',
      sandbox: 'danger-full-access'
    });
    expect(agentTurn.status).toBe(200);
    expect(agentTurn.body.turn).toMatchObject({
      role: 'assistant',
      status: 'completed',
      content: 'desktop e2e run completed'
    });

    const localSourceJob = await runtimeRequest<{
      job: { id: string; revision: number };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'video-translation',
      creationKey: 'packaged-local-video-translation',
      state: {
        sourceType: 'file',
        sourceUrl: '',
        targetLanguage: 'en'
      }
    });
    expect(localSourceJob.status).toBe(201);
    const uploadedSource = await uploadOversizedWaveSource(currentApp.page, {
      jobId: localSourceJob.body.job.id,
      expectedRevision: localSourceJob.body.job.revision,
      pcmBytes: OVERSIZED_WAVE_PCM_BYTES
    });
    expect(uploadedSource.status).toBe(201);
    expect(uploadedSource.body).toMatchObject({
      job: { revision: 1 },
      artifact: {
        kind: 'source_video',
        status: 'completed',
        metadata: {
          fileName: 'oversized-runtime-proxy.wav',
          mimeType: 'audio/wav',
          size: OVERSIZED_WAVE_FILE_BYTES,
          hasAudio: true
        }
      },
      deduplicated: false
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
      creationKey: 'packaged-image-generation',
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
    const coverJob = await runtimeRequest<{
      job: {
        id: string;
        revision: number;
        templateVersion: number;
        state: Record<string, unknown>;
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'cover',
      creationKey: 'packaged-cover-generation',
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });
    expect(coverJob.status).toBe(201);
    expect(coverJob.body.job).toMatchObject({
      revision: 0,
      templateVersion: 2,
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });

    const relaunchInput = {
      executablePath: currentApp.executablePath,
      launchArgs: currentApp.launchArgs,
      env: {
        ...currentApp.env,
        OPENCREATOR_YT_DLP_PATH: fixture.ytDlpBin
      }
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
    const restoredCoverJob = await runtimeRequest<{
      job: { id: string; templateVersion: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${coverJob.body.job.id}`);
    expect(restoredCoverJob.status).toBe(200);
    expect(restoredCoverJob.body.job).toMatchObject({
      id: coverJob.body.job.id,
      templateVersion: 2,
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });
    const downloadJob = await runtimeRequest<{
      job: { id: string; revision: number };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'video-download',
      creationKey: 'packaged-video-download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=C4gJinSiuG4'
      }
    });
    expect(downloadJob.status).toBe(201);
    const probeStarted = await runtimeRequest<{
      job: { revision: number };
    }>(
      currentApp.page,
      'POST',
      `/creator/jobs/${downloadJob.body.job.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: downloadJob.body.job.revision,
        input: {
          stageId: 'probe'
        }
      }
    );
    expect(probeStarted.status).toBe(200);
    await expect.poll(async () => {
      const response = await runtimeRequest<{
        job: {
          stages: Array<{
            stageId: string;
            status: string;
            errorCode: string | null;
            errorMessage: string | null;
          }>;
        };
      }>(
        currentApp.page,
        'GET',
        `/creator/jobs/${downloadJob.body.job.id}`
      );
      const probe = response.body.job.stages.find(
        stage => stage.stageId === 'probe'
      );
      if (probe?.status === 'failed') {
        throw new Error(
          `Packaged video probe failed: ${probe.errorCode} ${probe.errorMessage}`
        );
      }
      return probe?.status;
    }, { timeout: 60_000 }).toBe('succeeded');
    const probedDownloadJob = await runtimeRequest<{
      job: {
        artifacts: Array<{
          kind: string;
          status: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>(
      currentApp.page,
      'GET',
      `/creator/jobs/${downloadJob.body.job.id}`
    );
    expect(probedDownloadJob.body.job.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'download_probe',
          status: 'completed',
          metadata: expect.objectContaining({
            id: 'C4gJinSiuG4'
          })
        })
      ])
    );
    expect(containsPythonBytecodeCache(
      join(runtimeRoot, 'yt-dlp-runtime', 'python')
    )).toBe(false);
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);
  } finally {
    await closePackagedApp(currentApp).catch(() => undefined);
    if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
      rmSync(fixture.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    }
  }
});

test('Creator Preset 在实际 Desktop 包中创建并重启恢复', async () => {
  test.setTimeout(180_000);
  const fixture = await launchCreatorDesktop();
  let currentApp: PackagedApp = fixture.app;

  try {
    await waitForWorkspace(currentApp.page);
    expect(currentApp.page.url()).toContain('opencreator-app://app/');
    const catalog = await runtimeRequest<{
      catalogHash: string;
      presets: Array<{
        module: string;
        id: string;
        version: number;
        title: string;
        coverUrl: string;
      }>;
    }>(currentApp.page, 'GET', '/creator/presets?locale=zh-CN');
    expect(catalog.status).toBe(200);
    expect(catalog.body.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    const preset = catalog.body.presets.find(item => (
      item.module === 'video-translation'
      && item.id === 'bilibili-bilingual'
      && item.version === 1
    ));
    expect(preset).toMatchObject({
      title: 'B站双语精翻',
      coverUrl: expect.stringMatching(/^\/creator-presets\/[a-f0-9]{64}\.webp$/)
    });

    const staticResources = await currentApp.page.evaluate(async coverUrl => {
      const [cover, font] = await Promise.all([
        fetch(coverUrl),
        fetch('/fonts/opencreator/OpenCreatorRounded-Bold.woff2')
      ]);
      return {
        cover: {
          status: cover.status,
          contentType: cover.headers.get('content-type'),
          bytes: (await cover.arrayBuffer()).byteLength
        },
        font: {
          status: font.status,
          contentType: font.headers.get('content-type'),
          bytes: (await font.arrayBuffer()).byteLength
        }
      };
    }, preset!.coverUrl);
    expect(staticResources.cover).toMatchObject({
      status: 200,
      contentType: 'image/webp'
    });
    expect(staticResources.cover.bytes).toBeGreaterThan(20_000);
    expect(staticResources.font.status).toBe(200);
    expect(staticResources.font.contentType).toContain('font/woff2');
    expect(staticResources.font.bytes).toBeGreaterThan(10_000);

    const projectDir = join(fixture.root, 'creator-preset-workspace');
    mkdirSync(projectDir, { recursive: true });
    const project = await runtimeRequest<{
      project: { id: string };
    }>(currentApp.page, 'POST', '/projects', {
      cwd: projectDir,
      name: 'Creator Preset 打包态验证',
      sandbox: 'workspace-write'
    });
    expect(project.status).toBe(201);
    const created = await runtimeRequest<{
      job: {
        id: string;
        templateId: string;
        templateVersion: number;
        state: Record<string, unknown>;
        presetOrigin: Record<string, unknown> | null;
        stages: unknown[];
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: project.body.project.id,
      preset: {
        module: 'video-translation',
        id: 'bilibili-bilingual',
        version: 1
      },
      locale: 'zh-CN',
      creationKey: 'packaged-creator-preset'
    });
    expect(created.status).toBe(201);
    expect(created.body.job).toMatchObject({
      templateId: 'video-translation',
      templateVersion: 2,
      state: {
        bilingual: true,
        targetLanguage: 'zh_cn'
      },
      presetOrigin: {
        module: 'video-translation',
        id: 'bilibili-bilingual',
        version: 1,
        locale: 'zh-CN',
        title: 'B站双语精翻'
      },
      stages: []
    });

    const relaunchInput = {
      executablePath: currentApp.executablePath,
      launchArgs: currentApp.launchArgs,
      env: currentApp.env
    };
    await closePackagedApp(currentApp);
    currentApp = await relaunchPackagedApp(relaunchInput, 45_000);
    await waitForWorkspace(currentApp.page);
    const restored = await runtimeRequest<{
      job: {
        id: string;
        state: Record<string, unknown>;
        presetOrigin: Record<string, unknown> | null;
      };
    }>(
      currentApp.page,
      'GET',
      `/creator/jobs/${encodeURIComponent(created.body.job.id)}`
    );
    expect(restored.status).toBe(200);
    expect(restored.body.job).toMatchObject({
      id: created.body.job.id,
      state: {
        bilingual: true,
        targetLanguage: 'zh_cn'
      },
      presetOrigin: created.body.job.presetOrigin
    });
  } finally {
    await closePackagedApp(currentApp).catch(() => undefined);
    if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
      rmSync(fixture.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    }
  }
});

test('Creator Preset verifier 拒绝损坏和陈旧的打包资源', () => {
  test.setTimeout(300_000);
  const sourceRoot = packagedPackageRoot();
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencreator-preset-verifier-'));
  const packageRoot = join(fixtureRoot, basename(sourceRoot));
  clonePackageRoot(sourceRoot, packageRoot);
  const resources = packagedResourcesRoot(packageRoot);
  const presetRoot = join(resources, 'daemon', 'runtime', 'creator-presets');
  const manifestPath = join(presetRoot, 'manifest.json');
  const catalogPath = join(presetRoot, 'catalog.json');
  const manifestBytes = readFileSync(manifestPath);
  const catalogBytes = readFileSync(catalogPath);
  const presetManifest = JSON.parse(manifestBytes.toString('utf8')) as {
    files: Array<{ path: string }>;
  };
  const coverName = basename(
    presetManifest.files.find(file => file.path.startsWith('assets/'))!.path
  );
  const coverPath = join(resources, 'web', 'creator-presets', coverName);
  const coverBytes = readFileSync(coverPath);
  const stalePath = join(resources, 'web', 'creator-presets', 'stale.webp');

  try {
    expect(runPackagedVerifier(packageRoot).status).toBe(0);

    rmSync(catalogPath);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'catalog.json'
    );
    writeFileSync(catalogPath, catalogBytes);

    const substitutedManifest = JSON.parse(manifestBytes.toString('utf8'));
    substitutedManifest.assetSetHash = '0'.repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(substitutedManifest)}\n`);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset asset set hash mismatch'
    );
    writeFileSync(manifestPath, manifestBytes);

    rmSync(coverPath);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset Web asset is missing'
    );
    writeFileSync(coverPath, coverBytes);

    writeFileSync(stalePath, coverBytes);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset Web assets contain a stale file'
    );
  } finally {
    rmSync(fixtureRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
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
  ytDlpBin: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-packaged-e2e-'));
  const binDir = join(root, 'bin');
  const stateDir = join(root, 'fake-codex-state');
  const codexHome = join(root, 'codex-home');
  const userData = join(root, 'user-data');
  const codexBin = writeCodexShim(binDir);
  const ytDlpBin = writeYtDlpShim(binDir);
  writeOpenCreatorConfig(join(root, '.opencreator'), codexBin);

  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [
      `--user-data-dir=${userData}`,
      '--disable-gpu'
    ],
    env: {
      ...withoutDesktopTestEnvironment(process.env),
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      SHELL: process.platform === 'win32' ? process.env.ComSpec : '/bin/false',
      HOME: root,
      USERPROFILE: root,
      OPENCREATOR_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
      OPENCREATOR_HOME: join(root, '.opencreator'),
      CODEX_HOME: codexHome,
      OPENCREATOR_CODEX_APPLICATION_ROOTS: join(root, 'Applications'),
      OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR: stateDir,
      OPENCREATOR_E2E_FAKE_CODEX_MODE: 'success',
      OPENCREATOR_E2E_NODE_BINARY: process.execPath,
      OPENCREATOR_E2E_FAKE_CODEX_SCRIPT: fakeCodexScript,
      OPENCREATOR_E2E_FAKE_YT_DLP_SCRIPT: fakeYtDlpScript
    },
    timeoutMs: 45_000
  });
  return { app, root, ytDlpBin };
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

async function uploadOversizedWaveSource(
  page: Page,
  input: {
    jobId: string;
    expectedRevision: number;
    pcmBytes: number;
  }
): Promise<{
  status: number;
  body: {
    job: { revision: number };
    artifact: {
      kind: string;
      status: string;
      metadata: Record<string, unknown>;
    };
    deduplicated: boolean;
  };
}> {
  return await page.evaluate(async ({ jobId, expectedRevision, pcmBytes }) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, pcmBytes + 36, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48_000, true);
    view.setUint32(28, 96_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, pcmBytes, true);

    const query = new URLSearchParams({
      expectedRevision: String(expectedRevision),
      fileName: 'oversized-runtime-proxy.wav',
      mime: 'audio/wav',
      lastModified: '0'
    });
    const response = await fetch(
      `/.opencreator/runtime/creator/jobs/${encodeURIComponent(jobId)}/source-video?${query}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/vnd.opencreator.creator-source'
        },
        body: new Blob([header, new Uint8Array(pcmBytes)])
      }
    );
    return {
      status: response.status,
      body: await response.json()
    };
  }, input);
}

function packagedRuntimeRoot(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'creator-runtime', 'krillinai')
    : join(packageRoot, 'resources', 'creator-runtime', 'krillinai');
}

function packagedPackageRoot(): string {
  const executable = packagedExecutable(desktopDir);
  return process.platform === 'darwin'
    ? resolve(dirname(executable), '../..')
    : dirname(executable);
}

function packagedResourcesRoot(packageRoot: string): string {
  return process.platform === 'darwin'
    ? join(packageRoot, 'Contents', 'Resources')
    : join(packageRoot, 'resources');
}

function clonePackageRoot(source: string, destination: string): void {
  if (process.platform === 'darwin') {
    const result = spawnSync('cp', ['-cR', source, destination], {
      encoding: 'utf8',
      timeout: 5 * 60_000
    });
    if (result.status === 0) return;
  } else if (process.platform === 'linux') {
    const result = spawnSync('cp', ['-a', '--reflink=auto', source, destination], {
      encoding: 'utf8',
      timeout: 5 * 60_000
    });
    if (result.status === 0) return;
  }
  cpSync(source, destination, { recursive: true });
}

function runPackagedVerifier(packageRoot: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [
    join(desktopDir, 'scripts', 'verify-package.mjs')
  ], {
    cwd: resolve(desktopDir, '../..'),
    env: {
      ...process.env,
      OPENCREATOR_DESKTOP_PACKAGE_ROOT: packageRoot
    },
    encoding: 'utf8',
    timeout: 5 * 60_000,
    maxBuffer: 20 * 1024 * 1024
  });
}

function expectVerifierFailure(
  result: ReturnType<typeof spawnSync>,
  message: string
): void {
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(message);
}

function executableResource(path: string): string {
  return process.platform === 'win32' ? `${path}.exe` : path;
}

function packagedYtDlpVersion(
  runtimeRoot: string,
  descriptor: {
    mode: 'python';
    executable: string;
    script: string;
    certificateBundle: string;
  }
): {
  version: string;
  elapsedMs: number;
} {
  const executable = join(runtimeRoot, descriptor.executable);
  const script = join(runtimeRoot, descriptor.script);
  const certificateBundle = join(runtimeRoot, descriptor.certificateBundle);
  const startedAt = performance.now();
  const result = spawnSync(executable, ['-I', '-B', script, '--version'], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      SSL_CERT_FILE: certificateBundle
    },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(
      `Packaged yt-dlp failed: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return {
    version: result.stdout.trim(),
    elapsedMs
  };
}

function containsPythonBytecodeCache(root: string): boolean {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) return true;
    if (
      entry.isDirectory()
      && containsPythonBytecodeCache(join(root, entry.name))
    ) {
      return true;
    }
  }
  return false;
}

function packagedCreatorAgentRuntimeFiles(): string[] {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  const runtimeRoot = process.platform === 'darwin'
    ? resolve(
        packageRoot,
        '..',
        'Resources',
        'daemon',
        'runtime',
        'opencreator-runtime'
      )
    : join(
        packageRoot,
        'resources',
        'daemon',
        'runtime',
        'opencreator-runtime'
      );
  return ['SKILL.md', 'manifest.json'].filter(name => existsSync(join(runtimeRoot, name)));
}

function writeCodexShim(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
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
    return scriptPath;
  }
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeYtDlpShim(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'yt-dlp.exe')
    : join(binDir, 'yt-dlp');
  if (process.platform === 'win32') {
    const cacheDir = join(desktopDir, '.cache', 'e2e');
    const cachedLauncher = join(cacheDir, 'fake-yt-dlp-launcher.exe');
    mkdirSync(cacheDir, { recursive: true });
    if (
      !existsSync(cachedLauncher)
      || statSync(cachedLauncher).mtimeMs < statSync(fakeYtDlpLauncherSource).mtimeMs
    ) {
      execFileSync('go', ['build', '-trimpath', '-o', cachedLauncher, fakeYtDlpLauncherSource], {
        cwd: desktopDir,
        stdio: 'inherit'
      });
    }
    copyFileSync(cachedLauncher, scriptPath);
    return scriptPath;
  }
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeYtDlpScript}" "$@"\n`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeOpenCreatorConfig(productHome: string, codexBin: string): void {
  mkdirSync(productHome, { recursive: true });
  writeFileSync(
    join(productHome, 'config.toml'),
    [
      'version = 1',
      '',
      '[desktop]',
      'close_behavior = "quit"',
      'notifications_enabled = false',
      '',
      '[runtime]',
      'codex_mode = "external"',
      `external_codex_bin = ${JSON.stringify(codexBin)}`,
      ''
    ].join('\n')
  );
}

function withoutDesktopTestEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'OPENCREATOR_UPDATE_URL',
    'OPENCREATOR_CREATOR_RUNTIME_ROOT'
  ]) {
    delete next[name];
  }
  return next;
}

if (!existsSync(fakeCodexScript)) {
  throw new Error(`Fake Codex fixture 不存在：${fakeCodexScript}`);
}
