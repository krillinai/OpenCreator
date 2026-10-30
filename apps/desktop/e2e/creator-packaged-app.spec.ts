import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  chmodSync,
  createReadStream,
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function selectChoice(control: Locator, value: string) {
  await control.click();
  await control.page().getByRole('option').and(control.page().locator(`[data-value="${value}"]`)).click();
}

test('@package-smoke 内嵌翻译运行时可用，组件页显示 yt-dlp', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop();
  try {
    await waitForWorkspace(fixture.app.page);
    const status = await runtimeRequest<{ ytDlp: { source: string; currentVersion: string } }>(
      fixture.app.page, 'GET', '/creator/yt-dlp/status');
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(status.body.ytDlp.source).toBe('bundled');

    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(
      fixture.app.page, 'GET', '/projects?status=all');
    const created = await runtimeRequest<{ job: { id: string } }>(
      fixture.app.page, 'POST', '/creator/jobs', {
        projectId: projects.body.projects[0]!.id, templateId: 'video-translation',
        creationKey: 'packaged-runtime-preflight',
        state: { sourceType: 'url', sourceUrl: 'https://www.youtube.com/watch?v=QaBOfzyj0tI',
          sourceLanguage: 'en', targetLanguage: 'zh_cn', preferPlatformCaptions: true }
      });
    expect(created.status).toBe(201);
    const preflight = await runtimeRequest<{ ready: Array<{ id: string }>; blocked: Array<{ id: string }> }>(
      fixture.app.page, 'GET', `/creator/jobs/${created.body.job.id}/preflight?stageId=subtitle`);
    expect(preflight.status, JSON.stringify(preflight.body)).toBe(200);
    expect(preflight.body.ready.map(check => check.id)).toEqual(
      expect.arrayContaining(['executor', 'ffmpeg', 'ffprobe', 'yt-dlp', 'krillin-runtime']));
    expect(preflight.body.blocked.filter(check =>
      ['executor', 'ffmpeg', 'ffprobe', 'yt-dlp', 'krillin-runtime'].includes(check.id))).toEqual([]);

    await fixture.app.page.evaluate(() => { window.location.hash = '#/settings?tab=local-components'; });
    await expect(fixture.app.page.getByRole('heading', { name: 'yt-dlp nightly' })).toBeVisible();
    await expect(fixture.app.page.getByText(status.body.ytDlp.currentVersion, { exact: true }).first()).toBeVisible();
    await fixture.app.page.screenshot({ path: testInfo.outputPath('runtime-components.png') });
  } finally {
    await closePackagedApp(fixture.app);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('Remotion 组件不随 App 内嵌，首次渲染按需下载后自动继续，更新不重复下载', async () => {
  test.setTimeout(180_000);
  const release = JSON.parse(readFileSync(join(desktopDir, '.pack', 'components', 'remotion-component.json'), 'utf8'));
  const archivePath = join(desktopDir, '.pack', 'components', release.fileName);
  const metadataRoot = mkdtempSync(join(tmpdir(), 'remotion-release-e2e-'));
  let downloads = 0;
  const server = createServer((_request, response) => {
    downloads += 1;
    response.writeHead(200, { 'Content-Length': statSync(archivePath).size });
    createReadStream(archivePath).pipe(response);
  });
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected component HTTP server');
  const descriptorPath = join(metadataRoot, 'component.json');
  writeFileSync(descriptorPath, JSON.stringify({ ...release, archiveUrl: `http://127.0.0.1:${address.port}/${release.fileName}` }));
  let fixture: Awaited<ReturnType<typeof launchCreatorDesktop>> | undefined;
  try {
    fixture = await launchCreatorDesktop(undefined, { OPENCREATOR_REMOTION_COMPONENT_MANIFEST: descriptorPath, OPENCREATOR_REMOTION_COMPONENT_ARCHIVE: '' });
    await waitForWorkspace(fixture.app.page);
    expect(existsSync(packagedStickmanRuntimeRoot())).toBe(false);
    const before = await runtimeRequest<{ components: Array<{ id: string; state: string }> }>(fixture.app.page, 'GET', '/creator/components/status');
    expect(before.body.components.find(component => component.id === 'remotion')?.state).toBe('not_installed');
    const catalog = await runtimeRequest<{ assets: unknown[] }>(fixture.app.page, 'GET', '/creator/visual-assets?templateId=stickman-video');
    expect(catalog.status).toBe(200);
    expect(catalog.body.assets.length).toBeGreaterThan(0);
    expect(downloads).toBe(0);
    await fixture.app.page.evaluate(() => { window.location.hash = '#/settings?tab=local-components&component=remotion'; });
    const card = fixture.app.page.locator('#component-remotion');
    await expect(card.getByRole('heading', { name: 'Remotion' })).toBeVisible();
    await expect(card.getByRole('button', { name: '下载组件' })).toBeVisible();

    const projectRoot = join(fixture.root, 'render-project');
    mkdirSync(projectRoot, { recursive: true });
    const project = await runtimeRequest<{ project: { id: string } }>(fixture.app.page, 'POST', '/projects', { cwd: projectRoot, name: 'Remotion E2E', sandbox: 'workspace-write' });
    const created = await runtimeRequest<{ job: { id: string; revision: number } }>(fixture.app.page, 'POST', '/creator/jobs', { projectId: project.body.project.id, templateId: 'stickman-video', state: { sourceMode: 'text', sourceText: 'Render component fixture', ratio: '16:9' } });
    expect(created.status).toBe(201);
    const jobId = created.body.job.id;
    const dataDir = join(fixture.root, '.opencreator', 'data');
    const workRoot = join(fixture.root, '.opencreator', 'creator', 'jobs', jobId, 'fixtures');
    mkdirSync(workRoot, { recursive: true });
    const imagePath = join(workRoot, 'image.png');
    const audioPath = join(workRoot, 'audio.wav');
    const ffmpeg = join(packagedRuntimeRoot(), 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=1280x720', '-frames:v', '1', imagePath], { stdio: 'ignore', windowsHide: true });
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audioPath], { stdio: 'ignore', windowsHide: true });
    const timelinePath = join(workRoot, 'timeline.json');
    writeFileSync(timelinePath, JSON.stringify({ ratio: '16:9', fps: 30, width: 1280, height: 720, totalFrames: 30,
      shots: [{ shotId: 'shot-1', startFrame: 0, endFrame: 30, imageArtifactId: 'image-1', audioArtifactId: 'audio-1', imagePath, audioPath, motion: 'static', imageSha256: '1'.repeat(64), audioSha256: '2'.repeat(64) }],
      captions: [{ segmentId: 'segment-1', startFrame: 0, endFrame: 30, text: 'Remotion component' }] }));
    const databaseModule = pathToFileURL(resolve(desktopDir, '../daemon/src/storage/database.ts')).href;
    const repositoryModule = pathToFileURL(resolve(desktopDir, '../daemon/src/creator/repository.ts')).href;
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      const { openRuntimeDatabase } = await import(${JSON.stringify(databaseModule)});
      const { createCreatorRepository } = await import(${JSON.stringify(repositoryModule)});
      const db = openRuntimeDatabase(${JSON.stringify(join(dataDir, 'app.sqlite'))});
      const repository = createCreatorRepository(db);
      const job = repository.getJob(${JSON.stringify(jobId)});
      const script = repository.insertArtifact({ jobId: job.id, kind: 'script_manifest', status: 'completed', path: null, sourceArtifactIds: [], metadata: {} });
      repository.insertArtifact({ jobId: job.id, kind: 'shot_spec', status: 'completed', path: null, sourceArtifactIds: [], metadata: {} });
      repository.insertArtifact({ jobId: job.id, kind: 'timeline_manifest', status: 'completed', path: ${JSON.stringify(timelinePath)}, sourceArtifactIds: [], metadata: {} });
      repository.createStageRun({ jobId: job.id, stageId: 'timeline', executor: 'stickman-timeline', status: 'succeeded' });
      repository.updateJob({ id: job.id, status: job.status, revision: job.revision + 1, state: { ...job.state, workflowTarget: 'delivery_ready', approvedScriptArtifactId: script.id } });
      db.close();
    `], { cwd: rootDirForFixture(), stdio: 'pipe', windowsHide: true });
    const current = await runtimeRequest<{ job: { revision: number } }>(fixture.app.page, 'GET', `/creator/jobs/${jobId}`);
    const started = await runtimeRequest<{ error?: unknown }>(fixture.app.page, 'POST', `/creator/jobs/${jobId}/actions`, { action: 'run-stage', expectedRevision: current.body.job.revision, input: { stageId: 'render-clean' } });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    await expect.poll(async () => {
      const response = await runtimeRequest<{ job: { stages: Array<{ stageId: string; status: string; error?: unknown }> } }>(fixture.app.page, 'GET', `/creator/jobs/${jobId}`);
      const stage = response.body.job.stages.find(candidate => candidate.stageId === 'render-clean');
      if (stage?.status === 'failed') throw new Error(JSON.stringify(stage));
      return stage?.status;
    }, { timeout: 120_000 }).toBe('succeeded');
    expect(downloads).toBe(1);
    const result = await runtimeRequest<{ job: { artifacts: Array<{ kind: string; path: string; metadata: { hasVideo?: boolean; hasAudio?: boolean } }> } }>(fixture.app.page, 'GET', `/creator/jobs/${jobId}`);
    const video = result.body.job.artifacts.find(artifact => artifact.kind === 'clean_video');
    expect(video).toBeDefined();
    expect(existsSync(video!.path)).toBe(true);
    const ffprobe = join(packagedRuntimeRoot(), 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    const media = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', video!.path], { encoding: 'utf8', windowsHide: true }));
    expect(media.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(expect.arrayContaining(['video', 'audio']));
    await expect(card.locator('.settings-primary-button')).toHaveCount(0);
    await card.getByRole('button', { name: '检查更新' }).click();
    await expect(card.locator('.settings-primary-button')).toHaveCount(0);
    expect(downloads).toBe(1);
  } finally {
    if (fixture) await closePackagedApp(fixture.app).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
    if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    rmSync(metadataRoot, { recursive: true, force: true });
  }
});

function rootDirForFixture(): string { return resolve(desktopDir, '../..'); }

test('打包 App 的视频翻译支持多语言检索、保存和内置字体', async () => {
  const fixture = await launchCreatorDesktop({ width: 1180, height: 850 });
  let currentApp = fixture.app;
  try {
    await waitForWorkspace(fixture.app.page);
    const page = fixture.app.page;
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(page, 'GET', '/projects');
    const created = await runtimeRequest<{ job: { id: string } }>(page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id, templateId: 'video-translation',
      state: { sourceLanguage: 'hi', targetLanguage: 'zh_cn', currentStep: 1, furthestStep: 1, workspacePhase: 'configure' }
    });
    expect(created.status).toBe(201);
    await page.evaluate(jobId => { window.location.hash = `#/workbench?tool=video-translation&jobId=${jobId}`; }, created.body.job.id);
    const source = page.getByRole('combobox', { name: '源语言', exact: true });
    await expect(source).toHaveAttribute('data-value', 'hi');
    await source.click();
    await expect(page.getByRole('option')).toHaveCount(123);
    await source.press('Escape');
    const target = page.getByRole('combobox', { name: '翻译为', exact: true });
    await target.click();
    await expect(page.getByRole('option')).toHaveCount(124);
    await target.press('Escape');
    await source.click();
    const search = page.getByRole('searchbox', { name: '搜索选项' });
    await search.fill('阿拉伯');
    await expect(source).toHaveAttribute('data-value', 'hi');
    const arabic = page.getByRole('option', { name: 'العربية', exact: true });
    await expect(arabic).toBeVisible();
    await arabic.click();
    await expect.poll(async () => (await runtimeRequest<{ job: { state: { sourceLanguage: string } } }>(page, 'GET', `/creator/jobs/${created.body.job.id}`)).body.job.state.sourceLanguage).toBe('ar');
    await page.reload();
    await expect(source).toHaveAttribute('data-value', 'ar');
    const font = await page.evaluate(async () => {
      const response = await fetch('/fonts/opencreator/NotoSansArabic-Regular.woff2');
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    });
    expect(font.status).toBe(200);
    expect(font.bytes).toBeGreaterThan(10_000);
    await closePackagedApp(currentApp);
    currentApp = await relaunchPackagedApp(currentApp, 45_000);
    await waitForWorkspace(currentApp.page);
    const restored = await runtimeRequest<{ job: { state: { sourceLanguage: string } } }>(currentApp.page, 'GET', `/creator/jobs/${created.body.job.id}`);
    expect(restored.body.job.state.sourceLanguage).toBe('ar');
    await currentApp.page.evaluate(jobId => { window.location.hash = `#/workbench?tool=video-translation&jobId=${jobId}`; }, created.body.job.id);
    await expect(currentApp.page.getByRole('combobox', { name: '源语言', exact: true })).toHaveAttribute('data-value', 'ar');
  } finally {
    await closePackagedApp(currentApp).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的 YouTube 视频嵌入请求带有有效 HTTP 来源标识', async () => {
  const fixture = await launchCreatorDesktop({ width: 1180, height: 850 });
  try {
    await waitForWorkspace(fixture.app.page);
    const cdp = await fixture.app.page.context().newCDPSession(fixture.app.page);
    await cdp.send('Network.enable');
    const embedRequests = new Set<string>();
    let referer = '';
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.startsWith('https://www.youtube-nocookie.com/embed/')) {
        embedRequests.add(event.requestId);
      }
    });
    cdp.on('Network.requestWillBeSentExtraInfo', event => {
      if (embedRequests.has(event.requestId)) {
        referer = String(event.headers.Referer ?? event.headers.referer ?? '');
      }
    });
    await fixture.app.page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.title = 'YouTube embed verification';
      frame.src = 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE';
      document.body.append(frame);
    });
    await expect.poll(() => referer).toBe('https://github.com/krillinai/OpenCreator/');
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('工作台与滚动中的项目页保持相同内容边界', async () => {
  const fixture = await launchCreatorDesktop({ width: 1273, height: 985 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '工作台', exact: true }).click();
    await expect(fixture.app.page.locator('.creator-tools-page')).toBeVisible();
    const workbench = await fixture.app.page.locator('.creator-tools-page').evaluate(scroller => ({
      right: Math.round(scroller.querySelector('.creator-tools-page-inner')!.getBoundingClientRect().right),
      gutter: scroller.offsetWidth - scroller.clientWidth
    }));
    await fixture.app.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await expect(fixture.app.page.locator('.projects-page-inner')).toBeVisible();
    const projects = await fixture.app.page.locator('.projects-page').evaluate(scroller => {
      const filler = document.createElement('div');
      filler.style.height = '1600px';
      scroller.querySelector('.projects-page-inner')!.append(filler);
      return {
        right: Math.round(scroller.querySelector('.projects-page-inner')!.getBoundingClientRect().right),
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        gutter: scroller.offsetWidth - scroller.clientWidth
      };
    });
    expect(projects.scrollable).toBe(true);
    expect(projects.gutter).toBe(workbench.gutter);
    expect(projects.right).toBe(workbench.right);
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的每个设置 Tab 与主页面保持相同右侧留白', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1181, height: 985 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '设置', exact: true }).click();
    const nav = fixture.app.page.locator('.settings-nav > button');
    await expect(nav).toHaveCount(10);
    const boundsByTab = [];
    for (let index = 0; index < 10; index += 1) {
      await nav.nth(index).click();
      const section = fixture.app.page.locator('.settings-content > .settings-section');
      await expect(section).toBeVisible();
      const bounds = await section.evaluate(element => {
        const content = element.parentElement!;
        const sectionBox = element.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        return {
          left: Math.round(sectionBox.left - contentBox.left),
          right: Math.round(contentBox.right - sectionBox.right),
          gutter: content.offsetWidth - content.clientWidth,
          width: Math.round(sectionBox.width)
        };
      });
      expect(bounds.left, `Tab ${index + 1}`).toBe(24);
      expect(
        Math.abs(bounds.right - bounds.gutter - 24),
        `Tab ${index + 1}`
      ).toBeLessThanOrEqual(1);
      boundsByTab.push(bounds);
      if (index < 2) {
        await fixture.app.page.screenshot({
          path: testInfo.outputPath(`settings-layout-${index + 1}.png`),
          animations: 'disabled'
        });
      }
    }
    expect(boundsByTab.every(bounds => JSON.stringify(bounds) === JSON.stringify(boundsByTab[0]))).toBe(true);
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的浅色窗口按钮区域与设置侧栏连续且保留标题栏拖拽', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', '仅 macOS 使用集成原生标题栏');
  const fixture = await launchCreatorDesktop({ width: 980, height: 800 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '工作台', exact: true }).click();
    await expect(fixture.app.page.locator('.creator-tools-page')).toBeVisible();
    expect(await fixture.app.page.evaluate(() => (
      typeof window.opencreatorDesktop?.setWindowColorMode
    ))).toBe('function');
    await expect(fixture.app.page.getByRole('group', { name: '窗口控制' }).getByRole('button')).toHaveCount(3);
    for (const action of ['close', 'minimize', 'zoom']) {
      const background = await fixture.app.page.locator(`.desktop-window-control-${action}`).evaluate(element =>
        getComputedStyle(element).backgroundColor
      );
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
    }
    await expect.poll(() => fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.creator-tools-page-header h1')!.getBoundingClientRect();
      return Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2);
    })).toBeGreaterThanOrEqual(-3);
    expect(await fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.creator-tools-page-header h1')!.getBoundingClientRect();
      return Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2);
    })).toBeLessThanOrEqual(3);
    await fixture.app.page.getByRole('button', { name: '缩放窗口' }).click();
    await expect.poll(() => fixture.app.page.evaluate(() => window.innerWidth)).toBeGreaterThan(980);
    await fixture.app.page.getByRole('button', { name: '缩放窗口' }).click();
    await expect.poll(() => fixture.app.page.evaluate(() => window.innerWidth)).toBe(980);
    await fixture.app.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await expect(fixture.app.page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    await expect.poll(() => fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.projects-page-header h1')!.getBoundingClientRect();
      return Math.abs(Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2));
    })).toBeLessThanOrEqual(3);
    await fixture.app.page.screenshot({
      path: testInfo.outputPath('projects-titlebar.png'),
      animations: 'disabled'
    });
    await fixture.app.page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(fixture.app.page.getByRole('button', { name: '返回应用' })).toBeVisible();

    for (const [theme, label] of [['light', '浅色'], ['dark', '深色']] as const) {
      const diagnostics = fixture.app.page.getByRole('complementary', { name: 'Agent 诊断' });
      if (await diagnostics.isVisible()) {
        await diagnostics.getByRole('button', { name: '收起诊断' }).click();
      }
      await fixture.app.page.getByRole('button', { name: label, exact: true }).click();
      await expect(fixture.app.page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await fixture.app.page.evaluate(() => {
        const pane = document.querySelector('.opencreator-main-pane')!;
        const settings = document.querySelector('.settings-page')!;
        const sidebar = document.querySelector('.settings-sidebar')!;
        const back = document.querySelector('.settings-back')!;
        const drag = document.querySelector('.desktop-titlebar-drag-region')!;
        return {
          panePaddingTop: getComputedStyle(pane).paddingTop,
          sidebarTop: Math.round(sidebar.getBoundingClientRect().top - settings.getBoundingClientRect().top),
          sidebarPaddingTop: getComputedStyle(sidebar).paddingTop,
          backTop: Math.round(back.getBoundingClientRect().top - settings.getBoundingClientRect().top),
          dragHeight: Math.round(drag.getBoundingClientRect().height)
        };
      })).toEqual({
        panePaddingTop: '0px',
        sidebarTop: 0,
        sidebarPaddingTop: '51px',
        backTop: 51,
        dragHeight: 38
      });
      await fixture.app.page.screenshot({
        path: testInfo.outputPath(`settings-titlebar-${theme}.png`),
        animations: 'disabled'
      });
    }
    await fixture.app.page.getByRole('button', { name: '返回应用' }).click();
    await expect(fixture.app.page.getByRole('button', { name: '工作台' })).toBeVisible();
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的黑白基准色固定且灰色不随强调色变化', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1280, height: 800 });
  try {
    await waitForWorkspace(fixture.app.page);
    for (const theme of ['dark', 'light'] as const) {
      const colors = [];
      for (const accent of ['red', 'blue', 'custom'] as const) {
        const values = await fixture.app.page.evaluate(({ theme, accent }) => {
          const root = document.documentElement;
          root.dataset.theme = theme;
          root.dataset.accent = accent;
          root.style.setProperty('--custom-accent-value', '#3b82f6');
          const surface = document.createElement('div');
          surface.style.backgroundColor = 'var(--surface-2)';
          document.body.append(surface);
          const result = {
            page: getComputedStyle(document.body).backgroundColor,
            text: getComputedStyle(document.body).color,
            sidebar: getComputedStyle(document.querySelector('.opencreator-sidebar-pane')!).backgroundColor,
            surface: getComputedStyle(surface).backgroundColor
          };
          surface.remove();
          return result;
        }, { theme, accent });
        expect(values.page).toBe(theme === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(229, 229, 229)');
        expect(values.text).toBe(theme === 'dark' ? 'rgb(229, 229, 229)' : 'rgb(10, 10, 10)');
        colors.push(values);
        if (accent === 'red') {
          await fixture.app.page.screenshot({
            path: testInfo.outputPath(`accent-red-${theme}.png`),
            animations: 'disabled'
          });
        }
      }
      expect(colors[0]!.sidebar).toBe(colors[1]!.sidebar);
      expect(colors[0]!.surface).toBe(colors[1]!.surface);
      expect(colors[1]!.surface).toBe(colors[2]!.surface);
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 导航和文章模板图标只保留外层容器', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1440, height: 900 });
  try {
    await waitForWorkspace(fixture.app.page);
    const sidebar = fixture.app.page.locator('.opencreator-sidebar');
    for (const collapsed of [false, true]) {
      if (collapsed) await sidebar.locator('.sidebar-collapse-button').click();
      await expect(sidebar).toHaveAttribute('data-collapsed', String(collapsed));
      for (const label of ['工作台', '我的项目', '设置']) {
        const button = sidebar.getByRole('button', { name: label, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-current', 'page');
        await button.hover();
        expect(await button.locator('.sidebar-nav-icon').evaluate(icon => {
          const style = getComputedStyle(icon);
          return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
        })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
      }
      await fixture.app.page.screenshot({ path: testInfo.outputPath(`single-nav-container-${collapsed}.png`) });
    }
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects');
    const created = await runtimeRequest<{ job: { id: string } }>(fixture.app.page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id,
      templateId: 'wechat-article',
      state: { currentStep: 1, furthestStep: 1 }
    });
    expect(created.status).toBe(201);
    await fixture.app.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=wechat-article&jobId=${jobId}`;
    }, created.body.job.id);
    await expect(fixture.app.page.locator('.wechat-template-inline-list > button').first()).toBeVisible();
    await fixture.app.page.getByRole('button', { name: '查看全部模板', exact: true }).click();
    await expect(fixture.app.page.getByRole('dialog', { name: '文章模板库' })).toBeVisible();
    await fixture.app.page.locator('.wechat-template-grid > button').first().click();
    const icons = fixture.app.page.locator('.wechat-template-grid > button > span');
    expect(await icons.count()).toBeGreaterThan(0);
    for (const style of await icons.evaluateAll(icons => icons.map(icon => {
      const style = getComputedStyle(icon);
      return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
    }))) {
      expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的 Creator 设置页保留组件间距和下拉箭头内边距', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 980, height: 1014 });
  try {
    await waitForWorkspace(fixture.app.page);
    await expect.poll(async () => (
      await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects')
    ).body.projects.length).toBeGreaterThan(0);
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects');
    const created = await runtimeRequest<{ job: { id: string } }>(fixture.app.page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id,
      templateId: 'stickman-video',
      state: { sourceType: 'url' }
    });
    expect(created.status).toBe(201);
    await fixture.app.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=stickman-video&jobId=${jobId}`;
    }, created.body.job.id);
    await expect(fixture.app.page.locator('.stickman-style-summary')).toBeVisible();
    await expect.poll(() => fixture.app.page.locator('.stickman-story-panel').evaluate(panel => {
      const source = panel.querySelector(':scope > .creator-tool-field')!.getBoundingClientRect();
      const characters = panel.querySelector('.stickman-character-picker')!.getBoundingClientRect();
      const controls = [panel.querySelector('#stickman-visual-style')!, panel.querySelector('.stickman-duration-control [role="combobox"]')!];
      const [style, duration] = controls.map(control => control.getBoundingClientRect());
      return {
        sourceCharacterGap: Math.round(characters.top - source.bottom),
        selectTopDelta: Math.round(duration.top - style.top),
        arrowInsets: controls.map(control => (
          Math.round(control.getBoundingClientRect().right - control.querySelector('svg')!.getBoundingClientRect().right)
        )),
        textArrowGaps: controls.map(control => Math.round(control.querySelector('svg')!.getBoundingClientRect().left
          - control.querySelector('.app-select-value')!.getBoundingClientRect().right))
      };
    })).toEqual({ sourceCharacterGap: 16, selectTopDelta: 0, arrowInsets: [12, 12], textArrowGaps: [10, 10] });
    await fixture.app.page.getByRole('combobox', { name: '目标时长' }).scrollIntoViewIfNeeded();
    await fixture.app.page.screenshot({ path: testInfo.outputPath('creator-settings-spacing-980.png') });
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 在最小窗口宽度下保持 Creator 对话输入区贴底', async ({}, testInfo) => {
  test.setTimeout(90_000);
  for (const height of [1014, 680]) {
    const fixture = await launchCreatorDesktop({ width: 980, height });
    try {
      await waitForWorkspace(fixture.app.page);
      await expect.poll(async () => (
        await runtimeRequest<{ projects: Array<{ id: string }> }>(
          fixture.app.page, 'GET', '/projects'
        )
      ).body.projects.length).toBeGreaterThan(0);
      const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(
        fixture.app.page, 'GET', '/projects'
      );
      expect(projects.status).toBe(200);
      expect(projects.body.projects.length).toBeGreaterThan(0);
      const created = await runtimeRequest<{ job: { id: string } }>(
        fixture.app.page, 'POST', '/creator/jobs', {
          projectId: projects.body.projects[0]!.id,
          templateId: 'stickman-video',
          state: { sourceType: 'text' }
        }
      );
      expect(created.status).toBe(201);
      await fixture.app.page.evaluate(jobId => {
        window.location.hash = `#/workbench?tool=stickman-video&jobId=${jobId}`;
      }, created.body.job.id);
      await expect(fixture.app.page.getByRole('heading', { name: '火柴人动画' })).toBeVisible();
      await expect(fixture.app.page.getByRole('textbox', { name: '告诉 Agent 你的要求' })).toBeVisible();
      const preflightLayout = await fixture.app.page.evaluate(() => {
        const panel = document.querySelector('.creator-collaboration-panel')!;
        const list = panel.querySelector('.creator-collaboration-messages')!;
        const preflight = document.createElement('section');
        preflight.className = 'creator-collaboration-preflight';
        preflight.textContent = '启动前体检已通过，可以启动阶段。';
        panel.insertBefore(preflight, list);
        const gap = Math.round(list.getBoundingClientRect().top - preflight.getBoundingClientRect().bottom);
        const entryOffset = Math.round(list.firstElementChild!.getBoundingClientRect().top - list.getBoundingClientRect().top);
        preflight.remove();
        const message = document.createElement('article');
        message.className = 'creator-collaboration-message';
        message.dataset.role = 'user';
        const bubble = document.createElement('div');
        bubble.className = 'creator-collaboration-bubble';
        bubble.textContent = '测试消息';
        message.append(bubble);
        list.append(message);
        const outerBackground = getComputedStyle(message).backgroundColor;
        const outerPadding = getComputedStyle(message).padding;
        const bubbleBorder = getComputedStyle(bubble).borderStyle;
        message.remove();
        return { gap, entryOffset, outerBackground, outerPadding, bubbleBorder };
      });
      expect(preflightLayout.gap).toBeLessThanOrEqual(1);
      expect(preflightLayout.entryOffset).toBeLessThanOrEqual(24);
      expect(preflightLayout.outerBackground).toBe('rgba(0, 0, 0, 0)');
      expect(preflightLayout.outerPadding).toBe('0px');
      expect(preflightLayout.bubbleBorder).toBe('solid');
      await fixture.app.page.locator('.stickman-step-scroll').evaluate(element => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => fixture.app.page.evaluate(() => {
        const workspace = document.querySelector('.creator-workspace-layout')!.getBoundingClientRect();
        const main = document.querySelector('.creator-workspace-main')!.getBoundingClientRect();
        const panel = document.querySelector('.creator-collaboration-panel')!.getBoundingClientRect();
        const composer = document.querySelector('.creator-collaboration-panel .tool-agent-composer')!;
        return {
          width: window.innerWidth,
          panelRightOfMain: panel.left >= main.right - 1,
          panelVisible: panel.right <= window.innerWidth + 1,
          panelBottomDelta: Math.round(Math.abs(panel.bottom - window.innerHeight)),
          panelHeightDelta: Math.round(panel.height - workspace.height),
          composerBottomDelta: Math.round(Math.abs(
            composer.getBoundingClientRect().bottom
            + parseFloat(getComputedStyle(composer).marginBottom) - panel.bottom
          ))
        };
      })).toEqual({ width: 980, panelRightOfMain: true, panelVisible: true, panelBottomDelta: 0, panelHeightDelta: 0, composerBottomDelta: 0 });
      await fixture.app.page.screenshot({
        path: testInfo.outputPath(`creator-min-width-980-${height}.png`)
      });
    } finally {
      await closePackagedApp(fixture.app).catch(() => undefined);
      rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test('打包 App 在窄窗口下各 Creator 内页保持对话栏在右侧', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await launchCreatorDesktop({ width: 980, height: 680 });
  try {
    await waitForWorkspace(fixture.app.page);
    await expect.poll(async () => (
      await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects')
    ).body.projects.length).toBeGreaterThan(0);
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(
      fixture.app.page, 'GET', '/projects'
    );

    for (const [tool, templateId] of [
      ['video-translation', 'video-translation'],
      ['image-generation', 'image-generation'],
      ['cover-generator', 'cover'],
      ['video-generation', 'video-generation'],
      ['short-video-script', 'short-video-script']
    ] as const) {
      const created = await runtimeRequest<{ job: { id: string } }>(
        fixture.app.page, 'POST', '/creator/jobs', {
          projectId: projects.body.projects[0]!.id,
          templateId,
          state: {}
        }
      );
      expect(created.status).toBe(201);
      await fixture.app.page.evaluate(({ tool, jobId }) => {
        window.location.hash = `#/workbench?tool=${tool}&jobId=${jobId}`;
      }, { tool, jobId: created.body.job.id });
      await expect(fixture.app.page.locator('.creator-collaboration-panel')).toBeVisible();
      await expect.poll(() => fixture.app.page.evaluate(() => {
        const main = document.querySelector('.creator-workspace-main, .video-translation-wizard-main')!.getBoundingClientRect();
        const panel = document.querySelector('.creator-collaboration-panel')!.getBoundingClientRect();
        return {
          beside: panel.left >= main.right - 1,
          visible: panel.right <= window.innerWidth + 1,
          fullHeight: Math.abs(panel.bottom - window.innerHeight) <= 1
        };
      })).toEqual({ beside: true, visible: true, fullHeight: true });
      await fixture.app.page.screenshot({ path: testInfo.outputPath(`creator-right-panel-${tool}.png`) });
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('@package-smoke 实际 Desktop 包创建并重启恢复 Creator Job，且使用内嵌 Runtime', async () => {
  test.setTimeout(240_000);
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
        javascriptRuntime: { name: 'node'; version: string; executable: string };
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
        runtimeManifest.ytDlp.javascriptRuntime.executable,
        runtimeManifest.ytDlp.executable,
        runtimeManifest.ytDlp.script,
        runtimeManifest.ytDlp.certificateBundle
      ])
    );
    const buildManifest = JSON.parse(readFileSync(
      process.env.OPENCREATOR_DESKTOP_BUILD_MANIFEST
        ?? join(desktopDir, 'release', 'opencreator-desktop-build-manifest.json'),
      'utf8'
    )) as { ytDlpVersion: string };
    expect(buildManifest.ytDlpVersion).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{6}$/);
    expect(runtimeManifest.ytDlp).toMatchObject({
      mode: 'python',
      version: buildManifest.ytDlpVersion,
      pythonVersion: '3.13.15',
      javascriptRuntime: { name: 'node', version: '22.23.2' }
    });
    expect(execFileSync(join(runtimeRoot, runtimeManifest.ytDlp.javascriptRuntime.executable),
      ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim()).toBe('v22.23.2');
    expect(execFileSync(join(runtimeRoot, runtimeManifest.ytDlp.javascriptRuntime.executable),
      ['-e', 'let sum = 0; for (let i = 0; i < 100000; i++) sum += i; process.stdout.write(String(sum))'],
      { encoding: 'utf8', timeout: 10_000 }).trim()).toBe('4999950000');
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
    expect(existsSync(packagedStickmanRuntimeRoot())).toBe(false);
    const resourcesRoot = dirname(packagedStickmanRuntimeRoot());
    const component = JSON.parse(readFileSync(join(resourcesRoot, 'daemon', 'runtime', 'remotion-component.json'), 'utf8'));
    expect(component).toMatchObject({ id: 'remotion', platform: process.platform, arch: process.arch, remotionVersion: '4.0.473' });
    expect(component.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(resourcesRoot, 'daemon', 'runtime', 'stickman-assets', 'visual-assets', 'catalog.json'))).toBe(true);

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
    const presets = await runtimeRequest<{
      presets: Array<{ previewVideoUrl?: string }>;
    }>(currentApp.page, 'GET', '/creator/presets?locale=zh-CN');
    const previewVideoUrl = presets.body.presets.find(
      preset => preset.previewVideoUrl !== undefined
    )?.previewVideoUrl;
    expect(previewVideoUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.mp4$/);
    const packagedVideo = await currentApp.page.evaluate(async videoUrl => {
      const rangeResponse = await fetch(videoUrl, {
        headers: { Range: 'bytes=0-31' }
      });
      const range = {
        status: rangeResponse.status,
        contentType: rangeResponse.headers.get('content-type'),
        acceptRanges: rangeResponse.headers.get('accept-ranges'),
        contentRange: rangeResponse.headers.get('content-range'),
        bytes: (await rangeResponse.arrayBuffer()).byteLength
      };
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = videoUrl;
      document.body.append(video);
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error('Timed out loading packaged preset video')),
            15_000
          );
          video.addEventListener('canplay', () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
          video.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error(`Packaged preset video failed with code ${video.error?.code ?? 0}`));
          }, { once: true });
          video.load();
        });
        await video.play();
        await new Promise(resolve => window.setTimeout(resolve, 250));
        return {
          range,
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused
        };
      } finally {
        video.pause();
        video.remove();
      }
    }, previewVideoUrl!);
    expect(packagedVideo.range).toMatchObject({
      status: 206,
      contentType: 'video/mp4',
      acceptRanges: 'bytes',
      bytes: 32
    });
    expect(packagedVideo.range.contentRange).toMatch(/^bytes 0-31\/\d+$/);
    expect(packagedVideo.duration).toBeGreaterThan(0);
    expect(packagedVideo.currentTime).toBeGreaterThan(0);
    expect(packagedVideo.paused).toBe(false);
    const creatorCapabilities = await runtimeRequest<{
      platform: string;
      arch: string;
      transcription: {
        providers: Array<{
          provider: string;
          kind: 'cloud' | 'local';
          available: boolean;
          models: string[];
        }>;
      };
    }>(currentApp.page, 'GET', '/creator-services/capabilities');
    expect(creatorCapabilities.status).toBe(200);
    expect(creatorCapabilities.body).toMatchObject({
      platform: process.platform,
      arch: process.arch
    });
    const expectedLocalProviders = process.platform === 'darwin' && process.arch === 'arm64'
      ? ['whisperkit']
      : process.platform === 'win32' && process.arch === 'x64'
        ? ['whisper.cpp']
        : [];
    expect(creatorCapabilities.body.transcription.providers
      .filter(provider => provider.kind === 'local' && provider.available)
      .map(provider => provider.provider)).toEqual(expectedLocalProviders);
    const availableLocalProvider = creatorCapabilities.body.transcription.providers.find(
      provider => provider.kind === 'local' && provider.available
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
      currentVersion: buildManifest.ytDlpVersion,
      bundledVersion: buildManifest.ytDlpVersion
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
    await currentApp.page.getByRole('tab', { name: '语音识别' }).click();
    const localWhisper = currentApp.page.getByRole('button', { name: '本地 Whisper' });
    if (availableLocalProvider === undefined) {
      await expect(localWhisper).toBeDisabled();
    } else {
      await expect(localWhisper).toBeEnabled();
      await localWhisper.click();
      const providerLabel = availableLocalProvider.provider === 'whisperkit'
        ? 'WhisperKit'
        : 'Whisper.cpp';
      await expect(currentApp.page.getByRole('combobox', { name: '语音识别服务' }))
        .toHaveText(providerLabel);
      const expectedModel = availableLocalProvider.models[0];
      if (availableLocalProvider.provider === 'whisperkit') {
        await expect(currentApp.page.getByText(expectedModel, { exact: true })).toBeVisible();
      } else {
        await expect(currentApp.page.getByRole('combobox', { name: '本地模型' }))
          .toHaveText(expectedModel);
      }
    }
    await currentApp.page.getByRole('tab', { name: '配音服务' }).click();
    const providerSelect = currentApp.page.getByRole('combobox', { name: '服务商' });
    await expect(providerSelect).toHaveText('OpenAI TTS');
    await expect(currentApp.page.getByRole('combobox', { name: '默认音色' }))
      .toHaveAttribute('data-value', 'marin');
    await providerSelect.click();
    await currentApp.page.getByRole('option', { name: '阿里云百炼' }).click();
    await expect(currentApp.page.getByLabel('Base URL'))
      .toHaveValue('https://dashscope.aliyuncs.com/api/v1');
    await expect(currentApp.page.getByRole('combobox', { name: '模型', exact: true })).toHaveAttribute('data-value', 'qwen3-tts-flash');
    const defaultVoice = currentApp.page.getByRole('combobox', { name: '默认音色' });
    await expect(defaultVoice).toBeEnabled();
    await defaultVoice.click();
    await expect(currentApp.page.getByRole('option', { name: /Cherry/ })).toBeVisible();
    await expect(currentApp.page.getByRole('option', { name: /Kiki/ })).toBeVisible();
    await defaultVoice.press('Escape');

    await currentApp.page.getByRole('button', { name: '工作台' }).click();
    await expect(currentApp.page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await currentApp.page.getByRole('button', { name: /^图像生成/ }).click();
    await expect(currentApp.page.getByRole('heading', { name: '图像生成' })).toBeVisible();
    await expect(currentApp.page.getByRole('textbox', { name: '提示词' })).toBeVisible();

    await currentApp.page.locator('.creator-workspace-header').getByRole('button', { name: '返回' }).click();
    await expect(currentApp.page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await currentApp.page.getByRole('tab', { name: '全部', exact: true }).click();
    await currentApp.page.getByRole('button', { name: /^视频切片/ }).click();
    const clipWorkspace = currentApp.page.getByRole('region', { name: '视频切片 操作区' });
    await expect(clipWorkspace.getByRole('textbox', { name: '视频链接' })).toBeVisible();
    await clipWorkspace.getByRole('textbox', { name: '视频链接' })
      .fill('https://example.com/watch/packaged-auto-clip');
    await clipWorkspace.getByRole('button', { name: '下一步：切片设置' }).click();
    await selectChoice(clipWorkspace.getByRole('combobox', { name: '内容重点' }), 'knowledge');
    await selectChoice(clipWorkspace.getByRole('combobox', { name: '目标时长' }), '30-60');
    await clipWorkspace.getByRole('spinbutton', { name: '切片数量' }).fill('8');
    await selectChoice(clipWorkspace.getByRole('combobox', { name: '输出画幅' }), '9:16');
    await expect(clipWorkspace.getByRole('combobox', { name: '内容重点' }))
      .toHaveAttribute('data-value', 'knowledge');
    await expect(clipWorkspace.getByRole('combobox', { name: '目标时长' }))
      .toHaveAttribute('data-value', '30-60');
    await expect(clipWorkspace.getByRole('spinbutton', { name: '切片数量' }))
      .toHaveValue('8');
    await expect(clipWorkspace.getByRole('combobox', { name: '输出画幅' }))
      .toHaveAttribute('data-value', '9:16');
    await expect.poll(() => new URL(currentApp.page.url()).hash.match(/jobId=([^&]+)/)?.[1]).toBeTruthy();
    const clipJobId = new URL(currentApp.page.url()).hash.match(/jobId=([^&]+)/)?.[1];
    expect(clipJobId).toBeTruthy();
    await expect.poll(async () => (
      await runtimeRequest<{
        job: { state: Record<string, unknown> };
      }>(
        currentApp.page,
        'GET',
        `/creator/jobs/${decodeURIComponent(clipJobId!)}`
      )
    ).body.job.state).toMatchObject({
      sourceUrl: 'https://example.com/watch/packaged-auto-clip',
      focus: 'knowledge',
      duration: '30-60',
      clipCount: 8,
      aspectRatio: '9:16'
    });

    const currentProjectId = await currentApp.page.evaluate(() => {
      const stored = localStorage.getItem('opencreator.navigation.v3');
      if (stored === null) return undefined;
      const parsed = JSON.parse(stored) as { currentProjectId?: unknown };
      return typeof parsed.currentProjectId === 'string' ? parsed.currentProjectId : undefined;
    });
    expect(currentProjectId).toBeTruthy();
    const createdJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: currentProjectId,
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
    expect(agentTurn.status, JSON.stringify(agentTurn.body)).toBe(200);
    expect(agentTurn.body.turn).toMatchObject({
      role: 'assistant',
      status: 'completed',
      content: 'desktop e2e run completed'
    });
    const reportedIssue = await runtimeRequest<{
      clientIssueId: string;
      issue: {
        id: string;
        diagnosticId: string;
        fallbackMessage: string;
        status: string;
      };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/issues/report`, {
      clientIssueId: 'packaged-creator-issue',
      code: 'creator_packaged_e2e_failure',
      source: 'client',
      operation: 'creator.packaged-e2e',
      fallbackMessage: '操作未完成，请在 Agent 区域查看诊断。'
    });
    expect(reportedIssue.status).toBe(201);
    expect(reportedIssue.body.issue).toMatchObject({
      status: 'open',
      fallbackMessage: '操作未完成，请在 Agent 区域查看诊断。'
    });
    await currentApp.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=video-translation&jobId=${encodeURIComponent(jobId)}`;
    }, createdJob.body.job.id);
    const issueCard = currentApp.page.locator(
      `.creator-collaboration-issue[data-issue-id="${reportedIssue.body.issue.id}"]`
    );
    await expect(issueCard).toContainText('操作未完成，请在 Agent 区域查看诊断。');
    await expect(issueCard).toContainText('错误码：creator_packaged_e2e_failure');
    await issueCard.getByRole('button', { name: '询问这个问题' }).click();
    const issueComposer = currentApp.page.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    await issueComposer.fill('请说明这个问题的已确认事实、可能原因和下一步修复方法。');
    const focusedAgentResponse = currentApp.page.waitForResponse(response => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(
        `/creator/jobs/${createdJob.body.job.id}/agent-turns`
      )
    ), { timeout: 45_000 });
    await currentApp.page.getByRole('button', { name: '发送给 Agent' }).click();
    const focusedAgentRequest = (await focusedAgentResponse).request().postDataJSON() as {
      focusedIssueId?: string;
      message?: string;
    };
    expect(focusedAgentRequest).toMatchObject({
      focusedIssueId: reportedIssue.body.issue.id,
      message: '请说明这个问题的已确认事实、可能原因和下一步修复方法。'
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

    const jobBeforeUpdate = await runtimeRequest<{
      job: { revision: number };
    }>(currentApp.page, 'GET', `/creator/jobs/${createdJob.body.job.id}`);
    expect(jobBeforeUpdate.status).toBe(200);
    const updatedJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: jobBeforeUpdate.body.job.revision,
      input: { patch: { targetLanguage: 'ja', dubbing: true } }
    });
    expect(updatedJob.status).toBe(200);
    expect(updatedJob.body.job).toMatchObject({
      revision: jobBeforeUpdate.body.job.revision + 1,
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
    const stickmanJob = await runtimeRequest<{
      job: {
        id: string;
        revision: number;
        templateVersion: number;
        state: Record<string, unknown>;
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'stickman-video',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.default', revision: 1 },
        styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 },
        ratio: '16:9',
        targetDurationSeconds: 30,
        targetLanguage: 'zh-CN',
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'marin',
        voiceName: 'Marin'
      }
    });
    expect(stickmanJob.status).toBe(201);
    expect(stickmanJob.body.job).toMatchObject({
      revision: 0,
      templateVersion: 2,
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.default', revision: 1 }
      }
    });
    const updatedStickmanJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', `/creator/jobs/${stickmanJob.body.job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: stickmanJob.body.job.revision,
      input: {
        patch: {
          characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
          styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
          targetDurationSeconds: 125,
          voiceCode: 'nova',
          voiceName: 'Nova'
        }
      }
    });
    expect(updatedStickmanJob.status).toBe(200);
    expect(updatedStickmanJob.body.job).toMatchObject({
      revision: 1,
      state: {
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
        targetDurationSeconds: 125,
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'nova',
        voiceName: 'Nova'
      }
    });
    expect(updatedStickmanJob.body.job.state).not.toHaveProperty('characterPrompt');
    expect(updatedStickmanJob.body.job.state).not.toHaveProperty('voice');

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
      job: {
        id: string;
        revision: number;
        state: Record<string, unknown>;
        issues: Array<{ id: string; diagnosticId: string; status: string }>;
      };
    }>(currentApp.page, 'GET', `/creator/jobs/${createdJob.body.job.id}`);
    expect(restoredJob.status).toBe(200);
    expect(restoredJob.body.job).toMatchObject({
      id: createdJob.body.job.id,
      revision: updatedJob.body.job.revision,
      state: { targetLanguage: 'ja', dubbing: true }
    });
    expect(restoredJob.body.job.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: reportedIssue.body.issue.id,
        diagnosticId: reportedIssue.body.issue.diagnosticId,
        status: 'open'
      })
    ]));
    await currentApp.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=video-translation&jobId=${encodeURIComponent(jobId)}`;
    }, createdJob.body.job.id);
    const restoredIssueCard = currentApp.page.locator(
      `.creator-collaboration-issue[data-issue-id="${reportedIssue.body.issue.id}"]`
    );
    await expect(restoredIssueCard).toContainText('操作未完成，请在 Agent 区域查看诊断。');
    await expect(restoredIssueCard).toContainText('错误码：creator_packaged_e2e_failure');
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
    const restoredStickmanJob = await runtimeRequest<{
      job: { id: string; revision: number; templateVersion: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${stickmanJob.body.job.id}`);
    expect(restoredStickmanJob.status).toBe(200);
    expect(restoredStickmanJob.body.job).toMatchObject({
      id: stickmanJob.body.job.id,
      templateVersion: 2,
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
        targetDurationSeconds: 125,
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'nova',
        voiceName: 'Nova'
      }
    });
    expect(restoredStickmanJob.body.job.state).not.toHaveProperty('characterPrompt');
    expect(restoredStickmanJob.body.job.state).not.toHaveProperty('voice');
    expect(restoredStickmanJob.body.job.revision)
      .toBeGreaterThanOrEqual(updatedStickmanJob.body.job.revision);
    await currentApp.page.getByRole('button', { name: '返回', exact: true }).click();
    await currentApp.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await currentApp.page.getByRole('button', {
      name: '打开项目 youtube.com · creator-stickman-package-smoke'
    }).click();
    await expect(currentApp.page.getByRole('heading', { name: '火柴人动画' })).toBeVisible();
    await expect(currentApp.page.getByRole('radio', { name: '科技男' })).toBeChecked();
    await expect(currentApp.page.getByRole('textbox', { name: '角色描述' })).toHaveCount(0);
    await expect(currentApp.page.getByRole('combobox', { name: '视觉风格' }))
      .toHaveAttribute('data-value', 'stickman.style.whiteboard-marker@1');
    await expect(currentApp.page.getByRole('combobox', { name: '目标时长' }))
      .toHaveAttribute('data-value', 'custom');
    await expect(currentApp.page.getByRole('spinbutton', { name: '自定义时长（秒）' }))
      .toHaveValue('125');
    await expect(currentApp.page.getByRole('combobox', { name: '配音音色' }))
      .toHaveCount(0);
    await expect(currentApp.page.getByText('尚未配置配音服务', { exact: true }))
      .toBeVisible();
    await expect(currentApp.page.getByRole('link', { name: '前往配音服务配置' }))
      .toHaveAttribute('href', '#/settings?tab=ai-services&section=tts');
    await expect(currentApp.page.getByLabel('任务摘要')).toHaveCount(0);
    await expect(currentApp.page.locator('.creator-collaboration-panel')).toHaveCount(1);
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
      item.module === 'image-generation'
      && item.id === 'exploded-food-infographic'
      && item.version === 1
    ));
    expect(preset).toMatchObject({
      title: '食物爆炸拆解信息图',
      coverUrl: expect.stringMatching(/^\/creator-presets\/[a-f0-9]{64}\.jpg$/)
    });
    expect(catalog.body.presets.some(item => (
      item.module === 'video-translation' || item.module === 'video-download'
    ))).toBe(false);

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
      contentType: 'image/jpeg'
    });
    expect(staticResources.cover.bytes).toBeGreaterThan(20_000);
    expect(staticResources.font.status).toBe(200);
    expect(staticResources.font.contentType).toContain('font/woff2');
    expect(staticResources.font.bytes).toBeGreaterThan(10_000);
    const daemonCover = await currentApp.page.evaluate(async coverUrl => {
      const response = await fetch(`/.opencreator/runtime${coverUrl}`);
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: (await response.arrayBuffer()).byteLength
      };
    }, preset!.coverUrl);
    expect(daemonCover).toMatchObject({
      status: 200,
      contentType: 'image/jpeg',
      bytes: staticResources.cover.bytes
    });

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
        module: 'image-generation',
        id: 'exploded-food-infographic',
        version: 1
      },
      locale: 'zh-CN',
      creationKey: 'packaged-creator-preset'
    });
    expect(created.status).toBe(201);
    expect(created.body.job).toMatchObject({
      templateId: 'image-generation',
      templateVersion: 2,
      state: {
        prompt: expect.stringContaining('创建超写实的塔可'),
        size: '1024x1024'
      },
      presetOrigin: {
        module: 'image-generation',
        id: 'exploded-food-infographic',
        version: 1,
        locale: 'zh-CN',
        title: '食物爆炸拆解信息图'
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
        prompt: expect.stringContaining('创建超写实的塔可'),
        size: '1024x1024'
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

  try {
    const baseline = runPackagedVerifier(sourceRoot);
    expect(
      baseline.status,
      `Packaged verifier failed:\n${baseline.stdout}\n${baseline.stderr}`
    ).toBe(0);

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

async function launchCreatorDesktop(windowBounds?: { width: number; height: number }, overrides: NodeJS.ProcessEnv = {}): Promise<{
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
  writeOpenCreatorConfig(join(root, '.opencreator'), codexBin, windowBounds);

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
      OPENCREATOR_E2E_FAKE_YT_DLP_SCRIPT: fakeYtDlpScript,
      ...overrides
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
  const confirmed = await page.evaluate(() => window.localStorage.getItem('opencreator.agent-setup-confirmed.v1') !== null);
  if (!confirmed) {
    const setup = page.getByRole('region', { name: /^(开始使用 Agent|Get started with Agent)$/ });
    await setup.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    if (await setup.isVisible()) {
      await page.getByRole('button', { name: /^(本地模式|Local mode)$/ }).click();
      await page.getByRole('button', { name: /^(使用本机 Codex，继续|Continue locally and set up later)$/ }).click();
      await expect(setup).toBeHidden();
    }
  }
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

function packagedStickmanRuntimeRoot(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'stickman-runtime')
    : join(packageRoot, 'resources', 'stickman-runtime');
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

function writeOpenCreatorConfig(
  productHome: string,
  codexBin: string,
  windowBounds?: { width: number; height: number }
): void {
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
      ...(windowBounds === undefined ? [] : [
        '[desktop.window]',
        `width = ${windowBounds.width}`,
        `height = ${windowBounds.height}`,
        ''
      ]),
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
