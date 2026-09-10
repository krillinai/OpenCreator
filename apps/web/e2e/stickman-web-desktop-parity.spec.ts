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

type PixelDiff = {
  width: number;
  height: number;
  differentPixels: number;
  maxChannelDelta: number;
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
    const pixelDiff = await compareScreenshots(
      browser,
      browserResult.checkpoint.screenshot,
      desktopResult.checkpoint.screenshot
    );
    expect(pixelDiff.width, `${viewport.name} 截图宽度`).toBe(viewport.width);
    expect(pixelDiff.height, `${viewport.name} 截图高度`).toBe(viewport.height);
    expect(pixelDiff.maxChannelDelta, `${viewport.name} 最大像素通道差`).toBeLessThanOrEqual(1);
    expect(pixelDiff.differentPixels, `${viewport.name} 抗锯齿差异像素`).toBeLessThanOrEqual(100);
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
    await expect(page.getByRole('textbox', { name: '脚本标题' })).toHaveValue(
      '用火柴人理解复利'
    );
    await expect(page.locator('.creator-collaboration-panel')).toHaveCount(1);

    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('heading', { name: '配音与节奏' })).toBeVisible();
    await expect(page.locator('.stickman-audio-row')).toHaveCount(2);
    await expect(page.locator('.stickman-audio-control audio')).toHaveCount(2);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('2 个镜头 · 画面已生成 2/2')).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
    await expect(page.getByTitle('重新生成图片')).toHaveCount(2);
    await page.getByTitle('重新生成图片').first().click();
    await expect.poll(() => fakeDaemon.mutationLog().map(item => (
      isAction(item.body) ? item.body.action : null
    ))).toContain('regenerate-shot');

    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('heading', { name: '动画合成' })).toBeVisible();
    await page.getByRole('button', { name: '查看成片' }).click();
    await expect(page.getByRole('heading', { name: '成片交付' })).toBeVisible();
    await expect(page.getByText('成片已生成，部分发布检查尚未通过')).toBeVisible();
    const deliveryFiles = page.locator('.creator-result-files');
    for (const label of ['火柴人动画', '旁白字幕']) {
      await expect(deliveryFiles.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(deliveryFiles.locator('article[data-ready="true"]')).toHaveCount(2);
    await expect(page.locator('.creator-collaboration-panel')).toHaveCount(1);
    await expect(page.locator('.creator-collaboration-stage')).toHaveCount(1);
    expect(fakeDaemon.mutationLog().map(item => (
      isAction(item.body) ? item.body.action : null
    ))).not.toContain('approve-visuals');

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
      await expect(page.getByRole('heading', { name: '成片交付' })).toBeVisible();
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

async function compareScreenshots(
  browser: Browser,
  left: Buffer,
  right: Buffer
): Promise<PixelDiff> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await page.evaluate(async ({ leftUrl, rightUrl }) => {
      const decode = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const renderingContext = canvas.getContext('2d', { willReadFrequently: true });
        if (renderingContext === null) throw new Error('截图像素解码失败');
        renderingContext.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: renderingContext.getImageData(0, 0, canvas.width, canvas.height).data
        };
      };
      const [leftImage, rightImage] = await Promise.all([decode(leftUrl), decode(rightUrl)]);
      if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
        throw new Error(
          `截图尺寸不同：${leftImage.width}x${leftImage.height} / ${rightImage.width}x${rightImage.height}`
        );
      }
      let differentPixels = 0;
      let maxChannelDelta = 0;
      for (let offset = 0; offset < leftImage.pixels.length; offset += 4) {
        let pixelDifferent = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(
            leftImage.pixels[offset + channel]! - rightImage.pixels[offset + channel]!
          );
          if (delta > 0) pixelDifferent = true;
          if (delta > maxChannelDelta) maxChannelDelta = delta;
        }
        if (pixelDifferent) differentPixels += 1;
      }
      return {
        width: leftImage.width,
        height: leftImage.height,
        differentPixels,
        maxChannelDelta
      };
    }, {
      leftUrl: `data:image/png;base64,${left.toString('base64')}`,
      rightUrl: `data:image/png;base64,${right.toString('base64')}`
    });
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
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const text = normalizeText(await root.innerText());
  const boxes: Checkpoint['boxes'] = {};
  for (const selector of [
    '.stickman-workspace-content',
    '.creator-task-workspace',
    '.stickman-delivery-content',
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
    screenshot: await page.screenshot({
      animations: 'disabled',
      mask: [root.locator('video'), root.locator('audio')],
      maskColor: '#17191d'
    })
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
