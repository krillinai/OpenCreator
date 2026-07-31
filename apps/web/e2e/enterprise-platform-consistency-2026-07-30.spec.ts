import type { Browser, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures/runtime.js';
import {
  FakeEnterpriseDaemon,
  type FakeEnterpriseRequest,
  type FakeEnterpriseState
} from './support/fake-enterprise-daemon-2026-07-30.js';

type Platform = 'browser' | 'desktop';

type Checkpoint = {
  text: string;
  boxes: Record<string, {
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  screenshot: Buffer;
};

type PlatformResult = {
  checkpoints: Record<string, Checkpoint>;
  requests: FakeEnterpriseRequest[];
  state: FakeEnterpriseState;
  nativeDirectorySelections: number;
  unknownRequests: string[];
};

test('企业账户与 Skill Hub 在 Browser/Desktop Bridge 下保持一致', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 1280x800 Chromium 上下文'
  );

  const fakeDaemon = new FakeEnterpriseDaemon();
  const browserResult = await runPlatform({
    browser,
    fakeDaemon,
    origin: runtime.origin,
    platform: 'browser',
    testInfo
  });
  const desktopResult = await runPlatform({
    browser,
    fakeDaemon,
    origin: runtime.origin,
    platform: 'desktop',
    testInfo
  });

  expect(browserResult.unknownRequests).toEqual([]);
  expect(desktopResult.unknownRequests).toEqual([]);
  expect(browserResult.state).toEqual({
    session: 'signed_in',
    installed: true,
    createdThread: true
  });
  expect(desktopResult.state).toEqual(browserResult.state);
  expect(requestInventory(desktopResult.requests)).toEqual(
    requestInventory(browserResult.requests)
  );
  expect(businessRequestSequence(desktopResult.requests)).toEqual(
    businessRequestSequence(browserResult.requests)
  );
  expect(browserResult.nativeDirectorySelections).toBe(0);
  expect(desktopResult.nativeDirectorySelections).toBe(1);

  for (const checkpointName of Object.keys(browserResult.checkpoints)) {
    const browserCheckpoint = browserResult.checkpoints[checkpointName]!;
    const desktopCheckpoint = desktopResult.checkpoints[checkpointName]!;
    expect(desktopCheckpoint.text, `${checkpointName} 可见文案`).toBe(browserCheckpoint.text);
    expect(desktopCheckpoint.boxes, `${checkpointName} 关键尺寸`).toEqual(
      browserCheckpoint.boxes
    );
    expect(
      desktopCheckpoint.screenshot.equals(browserCheckpoint.screenshot),
      `${checkpointName} 截图像素`
    ).toBe(true);
  }
});

async function runPlatform(input: {
  browser: Browser;
  fakeDaemon: FakeEnterpriseDaemon;
  origin: string;
  platform: Platform;
  testInfo: TestInfo;
}): Promise<PlatformResult> {
  input.fakeDaemon.reset();
  const context = await input.browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await input.fakeDaemon.attach(page);
  await installPlatformEnvironment(page, input.platform);

  try {
    await page.goto(input.origin);
    await expect(page.getByRole('status', { name: '本地运行内核正常' })).toBeVisible();
    await verifyNativeProjectCapability(page, input.platform);

    await page.getByRole('button', { name: '企业账户', exact: true }).click();
    await expect(page.getByRole('heading', { name: '登录企业账户' })).toBeVisible();
    const checkpoints: Record<string, Checkpoint> = {
      account: await captureCheckpoint(page, [
        '.clawee-sidebar-pane',
        '.clawee-main-pane',
        '.enterprise-account-page',
        '.enterprise-account-form-panel'
      ])
    };

    await page.getByLabel('邮箱').fill('member@example.com');
    await page.getByLabel('密码').fill('enterprise-secret');
    await page.locator('.enterprise-account-primary-action').click();
    await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();

    await page.getByRole('button', { name: '插件', exact: true }).click();
    await page.getByRole('tab', { name: '企业 Skill Hub' }).click();
    await expect(page.getByTestId('enterprise-skill-enterprise-skill')).toBeVisible();
    checkpoints.hub = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.enterprise-skill-hub',
      '[data-testid="enterprise-skill-enterprise-skill"]'
    ]);

    await page.getByRole('button', { name: '查看 enterprise-name 详情' }).click();
    await expect(page.getByRole('dialog', { name: 'enterprise-name 详情' })).toBeVisible();
    await expect(page.getByText('改进企业知识检索和输出格式。')).toBeVisible();
    checkpoints.detail = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.enterprise-skill-detail'
    ]);
    await page.getByRole('button', { name: '关闭详情' }).click();

    const skillRow = page.getByTestId('enterprise-skill-enterprise-skill');
    await skillRow.getByRole('button', { name: '安装' }).click();
    await expect(skillRow.getByRole('button', { name: '使用' })).toBeEnabled();
    await skillRow.getByRole('button', { name: '使用' }).click();
    const projectDialog = page.getByRole('dialog', { name: '选择使用项目' });
    await projectDialog.getByRole('button', { name: '在 企业项目 中使用' }).click();

    await expect(page.getByRole('heading', { name: 'enterprise-name' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '输入任务' }))
      .toHaveValue('$enterprise-name ');
    await expect(page).toHaveURL(/#\/thread\/thread-enterprise-skill$/);
    checkpoints.conversation = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.conversation-page',
      '.composer-wrap'
    ]);

    for (const [name, checkpoint] of Object.entries(checkpoints)) {
      await input.testInfo.attach(`${input.platform}-${name}.png`, {
        body: checkpoint.screenshot,
        contentType: 'image/png'
      });
    }

    return {
      checkpoints,
      requests: input.fakeDaemon.requestLog(),
      state: input.fakeDaemon.snapshot(),
      nativeDirectorySelections: await page.evaluate(() => (
        Number((window as Window & {
          __claweeConsistencyDirectorySelections?: number;
        }).__claweeConsistencyDirectorySelections ?? 0)
      )),
      unknownRequests: input.fakeDaemon.unknownRequestPaths()
    };
  } finally {
    await context.close();
  }
}

async function installPlatformEnvironment(page: Page, platform: Platform): Promise<void> {
  await page.addInitScript(({ currentPlatform }) => {
    if (sessionStorage.getItem('clawee.consistency.initialized') !== '1') {
      localStorage.clear();
      localStorage.setItem('clawee.preferences.dynamicBackground', 'false');
      localStorage.setItem('clawee.preferences.colorMode', 'dark');
      localStorage.setItem('clawee.preferences.defaultPermission', 'follow-project');
      sessionStorage.setItem('clawee.consistency.initialized', '1');
      sessionStorage.setItem('clawee.consistency.directorySelections', '0');
    }
    Object.defineProperty(window, '__claweeConsistencyDirectorySelections', {
      configurable: true,
      writable: true,
      value: Number(sessionStorage.getItem('clawee.consistency.directorySelections') ?? 0)
    });
    if (currentPlatform !== 'desktop') return;

    const success = { ok: true as const };
    Object.defineProperty(window, 'claweeDesktop', {
      configurable: true,
      value: {
        kind: 'desktop',
        readConnectionConfig: async () => ({ baseUrl: '/.clawee/runtime' }),
        subscribeConnectionConfig: () => () => undefined,
        restartRuntime: async () => success,
        reloadWorkspace: async () => success,
        workspaceReady: () => undefined,
        readDesktopPreferences: async () => ({ closeBehavior: 'hide' as const }),
        updateDesktopPreferences: async () => ({ closeBehavior: 'hide' as const }),
        selectProjectDirectory: async () => {
          const target = window as Window & {
            __claweeConsistencyDirectorySelections?: number;
          };
          target.__claweeConsistencyDirectorySelections =
            (target.__claweeConsistencyDirectorySelections ?? 0) + 1;
          sessionStorage.setItem(
            'clawee.consistency.directorySelections',
            String(target.__claweeConsistencyDirectorySelections)
          );
          return null;
        },
        resolveDroppedFilePath: () => null,
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
  platform: Platform
): Promise<void> {
  await page.getByRole('button', { name: '选择项目 企业项目' }).click();
  await page.getByRole('button', { name: '新建项目' }).click();
  const existingFolder = page.getByRole('menuitem', { name: '使用现有文件夹' });
  if (platform === 'desktop') {
    await expect(existingFolder).toBeVisible();
    await existingFolder.click();
    await expect.poll(() => page.evaluate(() => (
      Number((window as Window & {
        __claweeConsistencyDirectorySelections?: number;
      }).__claweeConsistencyDirectorySelections ?? 0)
    ))).toBe(1);
  } else {
    await expect(existingFolder).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
}

async function captureCheckpoint(
  page: Page,
  selectors: string[]
): Promise<Checkpoint> {
  await page.evaluate(() => document.fonts.ready);
  const text = normalizeText(await page.locator('.clawee-main-content').innerText());
  const boxes: Checkpoint['boxes'] = {};
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `缺少一致性尺寸目标 ${selector}`).not.toBeNull();
    boxes[selector] = {
      x: Math.round(box!.x),
      y: Math.round(box!.y),
      width: Math.round(box!.width),
      height: Math.round(box!.height)
    };
  }
  return {
    text,
    boxes,
    screenshot: await page.locator('.clawee-shell').screenshot({
      animations: 'disabled'
    })
  };
}

function normalizeText(value: string): string {
  return value
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

function requestInventory(requests: FakeEnterpriseRequest[]): string[] {
  return requests
    .map(request => (
      `${request.method} ${request.path} [${request.bodyKeys.join(',')}]`
    ))
    .sort();
}

function businessRequestSequence(requests: FakeEnterpriseRequest[]): string[] {
  return requests
    .filter(request => (
      request.path.startsWith('/enterprise/')
      || (request.method === 'POST' && request.path === '/threads')
    ))
    .map(request => (
      `${request.method} ${request.path} [${request.bodyKeys.join(',')}]`
    ));
}
