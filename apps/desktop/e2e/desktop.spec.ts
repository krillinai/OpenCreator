import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  join,
  resolve
} from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type Page
} from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp,
  launchSecondInstance,
  relaunchPackagedApp,
  waitForProcessExit,
  type PackagedApp
} from './packaged-app.js';
import {
  FakeEnterpriseAuthServer,
  deleteEnterpriseE2ECredential,
  desktopE2EEnterpriseEmail,
  desktopE2EEnterprisePassword,
  writeEnterpriseE2EConfig
} from './fake-enterprise-auth-2026-08-06.js';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');

test.describe.configure({ mode: 'serial' });

const enterpriseServer = new FakeEnterpriseAuthServer();
let enterpriseOrigin = '';

test.beforeAll(async () => {
  enterpriseOrigin = await enterpriseServer.start();
});

test.afterAll(async () => {
  await enterpriseServer.close();
});

test('Finder 最小 PATH 下可发现 nvm 安装的 Codex', async () => {
  const fixture = await launchPackagedDesktop('success', {
    codexLocation: 'nvm',
    minimalPath: true
  });
  try {
    await waitForRuntimeReady(fixture.page);
    const state = await fixture.page.evaluate(
      () => window.claweeDesktop?.readBootstrapState()
    );
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: join(
        fixture.root,
        '.nvm',
        'versions',
        'node',
        'v22.14.0',
        'bin',
        process.platform === 'win32' ? 'codex.cmd' : 'codex'
      )
    });
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
  } finally {
    await closeFixture(fixture);
  }
});

test('Finder 最小 PATH 下可发现 ChatGPT 应用内置的 Codex', async () => {
  const fixture = await launchPackagedDesktop('success', {
    codexLocation: 'chatgpt-app',
    minimalPath: true,
    misleadingCodexWrapper: true
  });
  try {
    await waitForRuntimeReady(fixture.page);
    const state = await fixture.page.evaluate(
      () => window.claweeDesktop?.readBootstrapState()
    );
    expect(state).toMatchObject({
      phase: 'ready',
      codexBin: join(
        fixture.root,
        'Applications',
        'ChatGPT.app',
        'Contents',
        'Resources',
        process.platform === 'win32' ? 'codex.cmd' : 'codex'
      )
    });
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
  } finally {
    await closeFixture(fixture);
  }
});

test('成功 Probe 后进入工作台，刷新不重复 Probe，并代理 JSON、二进制和 SSE', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
    const startupMetrics = await fixture.page.evaluate(async () => (
      await window.claweeDesktop?.readBootstrapState()
    )?.startupMetrics);
    expect(startupMetrics).toMatchObject({
      appEntryAt: expect.any(Number),
      appReadyAt: expect.any(Number),
      windowCreatedAt: expect.any(Number),
      bootstrapDomReadyAt: expect.any(Number),
      bootstrapDidFinishLoadAt: expect.any(Number)
    });
    expect(
      (startupMetrics?.bootstrapDidFinishLoadAt ?? Number.POSITIVE_INFINITY)
      - (startupMetrics?.appEntryAt ?? 0)
    ).toBeLessThanOrEqual(1_000);

    const security = await fixture.page.evaluate(async () => ({
      requireType: typeof (window as Window & { require?: unknown }).require,
      processType: typeof (window as Window & { process?: unknown }).process,
      bridgeKind: window.claweeDesktop?.kind,
      windowChrome: window.claweeDesktop?.windowChrome,
      resolveDroppedFilePathType: typeof window.claweeDesktop?.resolveDroppedFilePath,
      connection: await window.claweeDesktop?.readConnectionConfig()
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
      baseUrl: '/.clawee/runtime'
    });
    if (process.platform === 'darwin') {
      const titleBarLayout = await fixture.page.evaluate(() => {
        const dragRegion = document.querySelector<HTMLElement>(
          '.desktop-titlebar-drag-region'
        )!;
        const sidebar = document.querySelector<HTMLElement>('.clawee-sidebar')!;
        const mainPane = document.querySelector<HTMLElement>('.clawee-main-pane')!;
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
        const response = await fetch('/.clawee/runtime/healthz', {
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
      const bytes = new TextEncoder().encode('clawee desktop binary proxy');
      const upload = await fetch(`/.clawee/runtime/attachments?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes
      });
      const uploaded = await upload.json() as {
        attachment: { id: string };
      };
      const content = await fetch(
        `/.clawee/runtime/attachments/${encodeURIComponent(uploaded.attachment.id)}/content?draftId=${encodeURIComponent(draftId)}`
      );

      const runResponse = await fetch('/.clawee/runtime/runs', {
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
        const current = await fetch(`/.clawee/runtime/runs/${encodeURIComponent(run.id)}`);
        const payload = await current.json() as { status: string };
        status = payload.status;
        if (['succeeded', 'failed', 'canceled'].includes(status)) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      const events = await fetch(
        `/.clawee/runtime/runs/${encodeURIComponent(run.id)}/events?fromSeq=0`
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
      contentText: 'clawee desktop binary proxy',
      runStatus: 'succeeded'
    });
    expect(proxyResult.eventContentType).toContain('text/event-stream');
    expect(proxyResult.eventText).toContain('event: done');

    await launchSecondInstance(fixture, ['clawee://tasks']);
    await expect.poll(() => fixture.page.evaluate(() => window.location.hash))
      .toBe('#/tasks');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fixture.page.reload({ waitUntil: 'domcontentloaded' });
      await waitForWorkspace(fixture.page);
    }
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);

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
      Object.defineProperty(window, '__claweeReleaseHistoryLoad', {
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
        window as Window & { __claweeReleaseHistoryLoad?: () => void }
      ).__claweeReleaseHistoryLoad?.();
    });
    await expect(fixture.page.getByRole('status', {
      name: '正在加载会话历史'
    })).toHaveCount(0);
    await expect(fixture.page.locator('.conversation-page')).toHaveClass(/is-empty/);

    const title = fixture.page.getByRole('heading', { name: 'hello' });
    const fileButton = fixture.page
      .locator('.clawee-main-titlebar')
      .getByRole('button', { name: '文件', exact: true });
    await expect(title).toBeVisible();
    await expect(fileButton).toBeVisible();

    if (process.platform === 'darwin') {
      const titlebarLayout = await fixture.page.evaluate(() => {
        const mainPane = document.querySelector<HTMLElement>('.clawee-main-pane')!;
        const titlebar = document.querySelector<HTMLElement>('.clawee-main-titlebar')!;
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
      () => frame.locator('html').getAttribute('data-clawee-preview-state')
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

test('packaged app persists Clawee projects when Codex app-server is unavailable', async ({
}, testInfo) => {
  let fixture = await launchPackagedDesktop('success');
  const projectDir = join(fixture.root, 'persistent-project');
  mkdirSync(projectDir);

  try {
    await waitForWorkspace(fixture.page);
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);
    await expect(fixture.page.getByRole('button', {
      name: '默认项目',
      exact: true
    })).toHaveAttribute('data-current-project', 'true');
    await expect(fixture.page.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    expect(existsSync(
      join(fixture.root, 'Documents', 'Clawee', 'Default Project')
    )).toBe(true);
    await fixture.page.getByRole('button', {
      name: '选择项目 默认项目'
    }).click();
    await expect(fixture.page.getByRole('dialog', { name: '选择项目' })).toBeVisible();
    await expect(fixture.page.getByRole('option', {
      name: '默认项目'
    })).toHaveAttribute('aria-selected', 'true');
    await fixture.page.getByRole('button', { name: '新建项目' }).click();
    await expect(fixture.page.getByRole('menuitem', {
      name: '新建空白项目'
    })).toBeVisible();
    await expect(fixture.page.getByRole('menuitem', {
      name: '使用现有文件夹'
    })).toBeVisible();
    await fixture.page.screenshot({
      path: testInfo.outputPath('project-selector-2026-07-21.png')
    });
    await fixture.page.keyboard.press('Escape');

    const initialCodexStatus = await runtimeRequest<{
      capabilities: { appServer?: boolean };
    }>(fixture.page, 'GET', '/codex/status');
    expect(initialCodexStatus.status).toBe(200);
    expect(initialCodexStatus.body.capabilities.appServer).toBe(false);

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

    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);
    const persistentProjectButton = fixture.page.getByRole('button', {
      name: '持久化项目',
      exact: true
    });
    await expect(persistentProjectButton).toBeVisible();
    await persistentProjectButton.click();
    await expect(fixture.page.getByRole('button', {
      name: /持久化会话.*刚刚/
    })).toBeVisible();
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);

    const previous = fixture;
    await closePackagedApp(previous);
    fixture = {
      ...await relaunchPackagedApp(previous),
      enterpriseRunId: previous.enterpriseRunId,
      root: previous.root,
      stateDir: previous.stateDir
    };

    await waitForWorkspace(fixture.page);
    const relaunchedPersistentProjectButton = fixture.page.getByRole('button', {
      name: '持久化项目',
      exact: true
    });
    await expect(relaunchedPersistentProjectButton).toBeVisible();
    await relaunchedPersistentProjectButton.click();
    await expect(fixture.page.getByRole('button', {
      name: /持久化会话.*刚刚/
    })).toBeVisible();
    await expect(fixture.page.getByText('本机目录')).toHaveCount(0);

    const persistedProjects = await runtimeRequest<{
      projects: Array<{ id: string; name: string }>;
    }>(fixture.page, 'GET', '/projects?status=all');
    expect(persistedProjects.status).toBe(200);
    expect(
      persistedProjects.body.projects.filter(project => project.name === '默认项目')
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
  const skillsDir = join(fixture.root, 'codex-home', 'skills');
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

  try {
    await waitForWorkspace(fixture.page);
    await fixture.page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(fixture.page);

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

test('后台 Probe 失败时仍进入工作台并暴露诊断状态', async () => {
  const fixture = await launchPackagedDesktop('probe-failure');
  try {
    await waitForWorkspace(fixture.page);
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const response = await fetch('/.clawee/runtime/codex/status');
      const payload = await response.json() as {
        availabilityProbe?: { status?: string; errorCode?: string };
        diagnostics?: string[];
      };
      return {
        status: payload.availabilityProbe?.status,
        errorCode: payload.availabilityProbe?.errorCode,
        hasDiagnostic: payload.diagnostics?.some(message =>
          message.includes('Codex 后台可用性验证失败')
        ) ?? false
      };
    }), { timeout: 15_000 }).toEqual({
      status: 'failed',
      errorCode: 'CODEX_PROBE_EXIT_NON_ZERO',
      hasDiagnostic: true
    });
    expect(fixture.page.url()).toContain('clawee-app://app/');
  } finally {
    await closeFixture(fixture);
  }
});

test('工作台握手超时后显示本地错误页并可无 Probe 重载', async () => {
  const fixture = await launchPackagedDesktop('workspace-failure');
  try {
    await expect(fixture.page.locator('#status-title')).toHaveText('工作台加载失败');
    await expect(fixture.page.locator('#reload-workspace')).toBeVisible();
    await expect(fixture.page.locator('#restart-runtime')).toBeVisible();
    await expect(fixture.page.locator('#failure-actions')).toBeHidden();
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);

    const mainPid = requiredPid(fixture.process.pid);
    const daemonPid = await waitForDaemonUtilityPid(mainPid);
    await fixture.page.locator('#reload-workspace').click();
    await waitForWorkspace(fixture.page);
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
    expect(findDaemonUtilityPid(mainPid)).toBe(daemonPid);
  } finally {
    await closeFixture(fixture);
  }
});

test('Daemon 异常退出后自动恢复且不重复 Probe', async () => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    const mainPid = requiredPid(fixture.process.pid);
    const firstDaemonPid = await waitForDaemonUtilityPid(mainPid);
    process.kill(firstDaemonPid, 'SIGKILL');

    const replacementPid = await waitForDaemonUtilityPid(mainPid, firstDaemonPid);
    expect(replacementPid).not.toBe(firstDaemonPid);
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const state = await window.claweeDesktop?.readBootstrapState();
      const response = await fetch('/.clawee/runtime/healthz').catch(() => undefined);
      return {
        phase: state?.phase,
        health: response?.status
      };
    }).catch(() => ({
      phase: undefined,
      health: undefined
    })), { timeout: 30_000 }).toEqual({ phase: 'ready', health: 200 });
    await expect.poll(() => readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);

    process.kill(replacementPid, 'SIGKILL');
    await expect.poll(async () => await fixture.page.evaluate(async () => {
      const state = await window.claweeDesktop?.readBootstrapState();
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
    expect(readCounter(fixture.stateDir, 'probe-count.txt')).toBe(1);
  } finally {
    await closeFixture(fixture);
  }
});

test('IPC 拒绝非 Clawee 页面来源', async () => {
  const fixture = await launchPackagedDesktop('success');
  try {
    await waitForWorkspace(fixture.page);
    await fixture.page.goto('data:text/html,<title>untrusted</title>');
    const result = await fixture.page.evaluate(async () => {
      if (!window.claweeDesktop) return 'bridge-missing';
      try {
        await window.claweeDesktop.readConnectionConfig();
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

test('启动页使用新版品牌图标', async ({}, testInfo) => {
  const fixture = await launchPackagedDesktop('probe-hang');
  try {
    await fixture.page.waitForURL(url => (
      url.protocol === 'clawee-app:'
      && url.hostname === 'bootstrap'
    ));
    const brandMark = fixture.page.locator('.brand-mark');
    await expect(brandMark).toBeVisible();
    await expect(brandMark).toHaveCSS('width', '72px');
    await expect(brandMark).toHaveCSS('height', '72px');

    const renderedAssetHash = await brandMark.evaluate(async image => {
      const response = await fetch((image as HTMLImageElement).currentSrc);
      const contents = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', contents);
      return Array.from(new Uint8Array(digest))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
    });
    expect(renderedAssetHash).toBe(
      '5025bac0dc2456a3da5b8850562446fed513ee7b0f71dec119efc33161574e8e'
    );

    await fixture.page.screenshot({
      path: testInfo.outputPath('clawee-startup-2026-07-27.png')
    });
  } finally {
    await closeFixture(fixture);
  }
});

test('退出期间会回收仍在 Probe 中的 Codex 子进程', async () => {
  const fixture = await launchPackagedDesktop('probe-hang');
  const pidPath = join(fixture.stateDir, 'probe-pid.txt');
  try {
    await expect.poll(() => existsSync(pidPath), { timeout: 15_000 }).toBe(true);
    const codexPid = Number(readFileSync(pidPath, 'utf8'));
    expect(isProcessAlive(codexPid)).toBe(true);

    await fixture.page.evaluate(() => {
      void window.claweeDesktop?.quit();
    });
    expect(await waitForProcessExit(fixture.process, 15_000)).toBe(true);
    await expect.poll(() => isProcessAlive(codexPid), { timeout: 15_000 }).toBe(false);
  } finally {
    await closeFixture(fixture);
  }
});

type DesktopFixture = PackagedApp & {
  enterpriseRunId: string;
  root: string;
  stateDir: string;
};

async function launchPackagedDesktop(
  mode: string,
  options: {
    codexLocation?: 'path' | 'nvm' | 'chatgpt-app';
    minimalPath?: boolean;
    misleadingCodexWrapper?: boolean;
  } = {}
): Promise<DesktopFixture> {
  const root = mkdtempSync(join(tmpdir(), 'clawee-desktop-e2e-'));
  const binDir = options.codexLocation === 'nvm'
    ? join(root, '.nvm', 'versions', 'node', 'v22.14.0', 'bin')
    : options.codexLocation === 'chatgpt-app'
      ? join(root, 'Applications', 'ChatGPT.app', 'Contents', 'Resources')
      : join(root, 'bin');
  const stateDir = join(root, 'fake-codex-state');
  const codexHome = join(root, 'codex-home');
  const userData = join(root, 'user-data');
  const enterpriseRunId = randomUUID();
  const enterpriseConfigPath = join(root, '.clawee', 'config.toml');
  writeCodexShim(binDir);
  writeEnterpriseE2EConfig(enterpriseConfigPath, enterpriseOrigin);
  if (options.misleadingCodexWrapper === true) {
    writeMisleadingCodexWrapper(join(root, '.local', 'bin'));
  }

  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [
      `--user-data-dir=${userData}`,
      '--disable-gpu',
      `--clawee-enterprise-e2e=${enterpriseRunId}`,
      `--clawee-enterprise-e2e-config=${enterpriseConfigPath}`
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
      CLAWEE_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
      CODEX_HOME: codexHome,
      CLAWEE_CODEX_APPLICATION_ROOTS: join(root, 'Applications'),
      CLAWEE_E2E_FAKE_CODEX_STATE_DIR: stateDir,
      CLAWEE_E2E_FAKE_CODEX_MODE: mode,
      CLAWEE_ENTERPRISE_E2E_RUN_ID: enterpriseRunId,
      ...(mode === 'workspace-failure'
        ? {
            CLAWEE_E2E_IGNORE_FIRST_WORKSPACE_READY: '1',
            CLAWEE_E2E_WORKSPACE_READY_TIMEOUT_MS: '300'
          }
        : {})
    },
    timeoutMs: 30_000
  });
  return { ...app, enterpriseRunId, root, stateDir };
}

function minimalSystemPath(): string {
  if (process.platform === 'win32') {
    return process.env.SystemRoot === undefined
      ? ''
      : join(process.env.SystemRoot, 'System32');
  }
  return '/usr/bin:/bin:/usr/sbin:/sbin';
}

async function waitForWorkspace(page: Page): Promise<void> {
  await waitForRuntimeReady(page);
  const workspace = page.locator('.clawee-shell');
  await expect.poll(async () => {
    const response = await runtimeRequest<{ status?: string }>(
      page,
      'GET',
      '/enterprise/session'
    );
    return response.body.status;
  }).toMatch(/^(signed_in|signed_out)$/);
  const session = await runtimeRequest<{ status?: string }>(
    page,
    'GET',
    '/enterprise/session'
  );
  if (session.body.status === 'signed_out') {
    await expect(page.getByRole('heading', {
      name: '欢迎使用 Clawee'
    })).toBeVisible();
    await page.getByLabel('邮箱').fill(desktopE2EEnterpriseEmail);
    await page.getByLabel('密码').fill(desktopE2EEnterprisePassword);
    await page.getByRole('checkbox').check();
    await page.locator('.enterprise-email-submit').click();
  }
  await expect(workspace).toBeVisible();
}

async function waitForRuntimeReady(page: Page): Promise<void> {
  await page.waitForURL(url => (
    url.protocol === 'clawee-app:'
    && url.hostname === 'app'
  ), { timeout: 45_000 });
  await expect.poll(async () => await page.evaluate(async () => {
    return (await window.claweeDesktop?.readBootstrapState())?.phase;
  })).toBe('ready');
}

async function runtimeRequest<T>(
  page: Page,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: T }> {
  return await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/.clawee/runtime${path}`, {
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
  const logoutCompleted = await fixture.page.evaluate(async () => {
    const response = await fetch('/.clawee/runtime/enterprise/logout', {
      method: 'POST',
      signal: AbortSignal.timeout(2_000)
    }).catch(() => undefined);
    return response !== undefined && (
      response.ok || response.status === 401
    );
  }).catch(() => false);
  await closePackagedApp(fixture);
  if (!logoutCompleted) {
    await deleteEnterpriseE2ECredential(fixture.enterpriseRunId).catch(() => {
      console.error(
        `Desktop E2E Keyring 最佳努力清理失败：`
        + `runId=${fixture.enterpriseRunId}`
      );
    });
  }
  if (process.env.CLAWEE_E2E_KEEP_TEMP !== '1') {
    rmSync(fixture.root, { recursive: true, force: true });
  }
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
  delete next.CLAWEE_UPDATE_URL;
  delete next.CLAWEE_ENTERPRISE_ORIGIN;
  delete next.CLAWEE_ENTERPRISE_E2E_AUTHORIZED;
  delete next.CLAWEE_ENTERPRISE_E2E_RUN_ID;
  delete next.CLAWEE_ENTERPRISE_KEYRING_SERVICE;
  delete next.CLAWEE_ENTERPRISE_KEYRING_ACCOUNT;
  return next;
}
