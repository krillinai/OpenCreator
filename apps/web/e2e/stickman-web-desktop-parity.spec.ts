import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, test, type RuntimeFixture } from './fixtures/runtime.js';
import {
  FakeStickmanDaemon,
  type FakeStickmanMutation,
  type FakeStickmanSnapshot
} from './support/fake-stickman-daemon.js';

type Platform = 'browser' | 'desktop';

type Checkpoint = {
  text: string;
  boxes: Record<string, { x: number; y: number; width: number; height: number }>;
  screenshot: Buffer;
};

type PlatformResult = {
  checkpoint: Checkpoint;
  mutations: FakeStickmanMutation[];
  snapshot: FakeStickmanSnapshot;
  nativeDirectorySelections: number;
  unknownRequests: string[];
};

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
] as const;

test('火柴人工作台在 Browser/Desktop Bridge 下保持同构并持久化同一结果', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '本规格内部固定创建桌面和移动内容视口，避免重复执行'
  );

  for (const viewport of viewports) {
    const browserResult = await runPlatform({
      browser,
      runtime,
      platform: 'browser',
      viewport,
      testInfo
    });
    const desktopResult = await runPlatform({
      browser,
      runtime,
      platform: 'desktop',
      viewport,
      testInfo
    });

    expect(browserResult.unknownRequests, `${viewport.name} Browser 未知请求`).toEqual([]);
    expect(desktopResult.unknownRequests, `${viewport.name} Desktop 未知请求`).toEqual([]);
    expect(desktopResult.mutations, `${viewport.name} Action 请求`).toEqual(
      browserResult.mutations
    );
    expect(desktopResult.snapshot, `${viewport.name} 持久化快照`).toEqual(
      browserResult.snapshot
    );
    expect(desktopResult.checkpoint.text, `${viewport.name} 可见文案`).toBe(
      browserResult.checkpoint.text
    );
    expect(desktopResult.checkpoint.boxes, `${viewport.name} 关键尺寸`).toEqual(
      browserResult.checkpoint.boxes
    );
    expect(
      desktopResult.checkpoint.screenshot.equals(browserResult.checkpoint.screenshot),
      `${viewport.name} 工作台截图应逐像素一致`
    ).toBe(true);
    expect(browserResult.nativeDirectorySelections).toBe(0);
    expect(desktopResult.nativeDirectorySelections).toBe(viewport.name === 'desktop' ? 1 : 0);
  }
});

async function runPlatform(input: {
  browser: Browser;
  runtime: RuntimeFixture;
  platform: Platform;
  viewport: { name: string; width: number; height: number };
  testInfo: TestInfo;
}): Promise<PlatformResult> {
  const fakeDaemon = new FakeStickmanDaemon(input.runtime.projectId);
  const context = await input.browser.newContext({
    viewport: { width: input.viewport.width, height: input.viewport.height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'zh-CN',
    acceptDownloads: true
  });
  const page = await context.newPage();
  await fakeDaemon.attach(page);
  await installPlatformEnvironment(page, input.platform);

  try {
    await input.runtime.openApp(page, { currentProjectId: fakeDaemon.projectId });
    await page.goto(
      `${input.runtime.origin}/#/workbench?tool=stickman-video&jobId=${fakeDaemon.jobId}`
    );
    await expect(page.getByRole('heading', { name: '火柴人动画' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '用火柴人理解复利' })).toBeVisible();
    await expect(page.locator('.creator-collaboration-panel')).toHaveCount(1);

    await page.getByRole('button', { name: '审核通过', exact: true }).click();
    await expect(page.getByRole('button', { name: '审核分镜并生成画面' })).toBeVisible();
    await expect(page.getByText('2 个镜头，进度来自持久化 StageRun 与 Artifact')).toBeVisible();

    await page.getByRole('button', { name: '审核分镜并生成画面' }).click();
    await expect(page.getByRole('button', { name: '确认画面并继续成片' })).toBeVisible();
    await expect(page.getByTitle('重新生成图片')).toHaveCount(2);
    await page.getByTitle('重新生成图片').first().click();
    await expect.poll(() => fakeDaemon.mutationLog().map(item => (
      isAction(item.body) ? item.body.action : null
    ))).toContain('regenerate-shot');

    await page.getByRole('button', { name: '确认画面并继续成片' }).click();
    await expect(page.getByRole('heading', { name: '固定五项交付' })).toBeVisible();
    for (const label of ['纯净视频', 'YouTube 封面', '发布文案', '双语视频', '双语字幕']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.creator-result-files article[data-ready="true"]')).toHaveCount(5);
    await expect(page.locator('.creator-collaboration-panel')).toHaveCount(1);

    let nativeDirectorySelections = 0;
    if (input.viewport.name === 'desktop') {
      nativeDirectorySelections = await verifyNativeProjectCapability(
        page,
        input.platform,
        input.runtime.origin,
        input.runtime.ordinaryThreadId
      );
      await page.goto(
        `${input.runtime.origin}/#/workbench?tool=stickman-video&jobId=${fakeDaemon.jobId}`
      );
      await expect(page.getByRole('heading', { name: '固定五项交付' })).toBeVisible();
    }

    const checkpoint = await captureCheckpoint(page);
    await input.testInfo.attach(
      `stickman-${input.viewport.name}-${input.platform}.png`,
      { body: checkpoint.screenshot, contentType: 'image/png' }
    );
    return {
      checkpoint,
      mutations: fakeDaemon.mutationLog(),
      snapshot: fakeDaemon.snapshot(),
      nativeDirectorySelections,
      unknownRequests: fakeDaemon.unknownRequestPaths()
    };
  } finally {
    await context.close();
  }
}

async function installPlatformEnvironment(page: Page, platform: Platform): Promise<void> {
  await page.addInitScript(({ currentPlatform }) => {
    localStorage.setItem('clawee.preferences.dynamicBackground', 'false');
    localStorage.setItem('opencreator.preferences.colorMode', 'dark');
    localStorage.setItem('opencreator.preferences.language', 'zh-CN');
    Object.defineProperty(window, '__opencreatorStickmanDirectorySelections', {
      configurable: true,
      writable: true,
      value: 0
    });
    if (currentPlatform !== 'desktop') return;
    const success = { ok: true as const };
    Object.defineProperty(window, 'opencreatorDesktop', {
      configurable: true,
      value: {
        kind: 'desktop',
        readConnectionConfig: async () => ({ baseUrl: '/.opencreator/runtime' }),
        subscribeConnectionConfig: () => () => undefined,
        restartRuntime: async () => success,
        selectCodexPath: async () => success,
        reloadWorkspace: async () => success,
        workspaceReady: () => undefined,
        readDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const,
          telemetryEnabled: false
        }),
        updateDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const,
          telemetryEnabled: false
        }),
        selectProjectDirectory: async () => {
          const target = window as Window & {
            __opencreatorStickmanDirectorySelections?: number;
          };
          target.__opencreatorStickmanDirectorySelections =
            (target.__opencreatorStickmanDirectorySelections ?? 0) + 1;
          return null;
        },
        resolveDroppedFilePath: () => {
          const target = window as Window & {
            __opencreatorStickmanDirectorySelections?: number;
          };
          target.__opencreatorStickmanDirectorySelections =
            (target.__opencreatorStickmanDirectorySelections ?? 0) + 1;
          return null;
        },
        openExternal: async () => undefined,
        revealPath: async () => success,
        notify: async () => undefined,
        configureBackgroundNotifications: async () => success,
        subscribeNavigation: () => () => undefined
      }
    });
  }, { currentPlatform: platform });
}

async function verifyNativeProjectCapability(
  page: Page,
  platform: Platform,
  origin: string,
  threadId: string
): Promise<number> {
  await page.goto(`${origin}/#/thread/${encodeURIComponent(threadId)}`);
  await expect(page.getByRole('textbox', { name: '输入任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用现有文件夹' })).toHaveCount(0);
  const dropRoot = page.locator('[data-project-drop-root="true"]');
  await expect(dropRoot).toBeVisible();
  await dropRoot.evaluate(element => {
    const file = new File([], 'stickman-parity-project');
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'all',
      files: [file],
      items: [{
        kind: 'file',
        type: '',
        getAsFile: () => file,
        webkitGetAsEntry: () => ({
          fullPath: `/${file.name}`,
          isDirectory: true,
          isFile: false,
          name: file.name
        })
      }],
      types: ['Files']
    };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      element.dispatchEvent(event);
    }
  });
  if (platform === 'desktop') {
    await expect.poll(() => page.evaluate(() => Number((window as Window & {
      __opencreatorStickmanDirectorySelections?: number;
    }).__opencreatorStickmanDirectorySelections ?? 0))).toBe(1);
  }
  return await page.evaluate(() => Number((window as Window & {
    __opencreatorStickmanDirectorySelections?: number;
  }).__opencreatorStickmanDirectorySelections ?? 0));
}

async function captureCheckpoint(page: Page): Promise<Checkpoint> {
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('.stickman-workspace-page');
  await expect(root).toBeVisible();
  const text = normalizeText(await root.innerText());
  const boxes: Checkpoint['boxes'] = {};
  for (const selector of [
    '.stickman-workspace-content',
    '.creator-task-workspace',
    '.creator-task-summary',
    '.creator-collaboration-panel',
    '.creator-result-files'
  ]) {
    const box = await page.locator(selector).first().boundingBox();
    if (box !== null) {
      boxes[selector] = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    }
  }
  return {
    text,
    boxes,
    screenshot: await root.screenshot({ animations: 'disabled' })
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isAction(value: unknown): value is { action: string } {
  return value !== null
    && typeof value === 'object'
    && 'action' in value
    && typeof (value as { action?: unknown }).action === 'string';
}
