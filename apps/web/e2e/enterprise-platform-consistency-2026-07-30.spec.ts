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

test('未勾选协议时 Browser/Desktop 登录均先确认再提交', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const fakeDaemon = new FakeEnterpriseDaemon();
  const loginRequests: FakeEnterpriseRequest[][] = [];

  for (const platform of ['browser', 'desktop'] satisfies Platform[]) {
    fakeDaemon.reset();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    await fakeDaemon.attach(page);
    await installPlatformEnvironment(page, platform);

    try {
      await page.goto(runtime.origin);
      await expect(page.getByRole('heading', { name: '欢迎使用 Clawee' })).toBeVisible();

      const submit = page.locator('.enterprise-email-submit');
      await expect(submit).toBeDisabled();
      await page.getByLabel('邮箱').fill('member@example.com');
      await expect(submit).toBeDisabled();
      await page.getByLabel('密码').fill('password-123');
      await expect(submit).toBeEnabled();
      await submit.click();
      const dialog = page.getByRole('alertdialog', { name: '服务协议及隐私政策' });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      expect(fakeDaemon.requestLog().filter(request => (
        request.method === 'POST' && request.path === '/enterprise/login'
      ))).toHaveLength(0);

      await dialog.getByRole('button', { name: '取消' }).click();
      await expect(dialog).toBeHidden();
      await submit.click();
      await dialog.getByRole('button', { name: '同意并继续' }).click();

      await expect(page.getByRole('button', {
        name: 'Enterprise Member',
        exact: true
      })).toBeVisible();
      const submitted = fakeDaemon.requestLog().filter(request => (
        request.method === 'POST' && request.path === '/enterprise/login'
      ));
      expect(submitted).toHaveLength(1);
      loginRequests.push(submitted);
      expect(fakeDaemon.unknownRequestPaths()).toEqual([]);
    } finally {
      await context.close();
    }
  }

  expect(loginRequests[1]).toEqual(loginRequests[0]);
});

test('企业账户、连接器、知识库、共享网盘与 Skill Hub 在 Browser/Desktop Bridge 下保持一致', async ({
  browser,
  page,
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
    mcpInstalled: true,
    mcpEnabled: true,
    createdThread: true,
    uploadedKnowledgeDocument: true,
    savedSharedFile: true
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
    const screenshotDifference = await compareScreenshotPixels(
      page,
      browserCheckpoint.screenshot,
      desktopCheckpoint.screenshot
    );
    expect(
      screenshotDifference.differentPixels,
      `${checkpointName} 截图差异像素`
    ).toBeLessThanOrEqual(50);
    expect(
      screenshotDifference.maxChannelDelta,
      `${checkpointName} 截图最大通道差值`
    ).toBeLessThanOrEqual(50);
  }
});

test('会话 MCP 图标直达的连接器快捷开关在 Browser/Desktop Bridge 下保持一致', async ({
  browser,
  page: comparisonPage,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 1280x800 Chromium 上下文'
  );

  const fakeDaemon = new FakeEnterpriseDaemon();
  const results: Array<{
    platform: Platform;
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    screenshot: Buffer;
    mcpRequests: FakeEnterpriseRequest[];
  }> = [];

  for (const platform of ['browser', 'desktop'] satisfies Platform[]) {
    fakeDaemon.reset();
    fakeDaemon.setMcpPreference({ installed: true, enabled: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    await fakeDaemon.attach(page);
    await installPlatformEnvironment(page, platform);

    try {
      await page.goto(runtime.origin);
      await loginWithEmail(page);
      await expect(page.getByRole('button', {
        name: 'Enterprise Member',
        exact: true
      })).toBeVisible();
      const connectorIcon = page.getByRole('button', {
        name: '打开连接器列表，客户关系管理 MCP'
      });
      await expect(connectorIcon).toBeVisible();
      await connectorIcon.click();
      await expect(page.getByRole('switch', {
        name: '客户关系管理 MCP'
      })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('button', {
        name: '选择更多连接器'
      })).toBeVisible();

      const selectors = [
        '.composer-enabled-connectors',
        '.composer-connector-card',
        '.composer-connector-quick-list'
      ];
      const boxes: Record<string, {
        x: number;
        y: number;
        width: number;
        height: number;
      }> = {};
      for (const selector of selectors) {
        const box = await page.locator(selector).boundingBox();
        expect(box, `缺少连接器目录尺寸目标 ${selector}`).not.toBeNull();
        boxes[selector] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const submenu = page.locator('.composer-connector-card');
      const screenshot = await submenu.screenshot({ animations: 'disabled' });
      await testInfo.attach(`${platform}-composer-connector-catalog.png`, {
        body: screenshot,
        contentType: 'image/png'
      });
      results.push({
        platform,
        text: normalizeText(await submenu.innerText()),
        boxes,
        screenshot,
        mcpRequests: fakeDaemon.requestLog().filter(request => (
          request.method === 'GET' && request.path === '/enterprise/mcp'
        ))
      });
    } finally {
      await context.close();
    }
  }

  const browserResult = results.find(result => result.platform === 'browser')!;
  const desktopResult = results.find(result => result.platform === 'desktop')!;
  expect(browserResult.mcpRequests).toHaveLength(1);
  expect(desktopResult.mcpRequests).toEqual(browserResult.mcpRequests);
  expect(desktopResult.text).toBe(browserResult.text);
  expect(desktopResult.boxes).toEqual(browserResult.boxes);
  const screenshotDifference = await compareScreenshotPixels(
    comparisonPage,
    browserResult.screenshot,
    desktopResult.screenshot
  );
  expect(screenshotDifference.differentPixels).toBeLessThanOrEqual(50);
  expect(screenshotDifference.maxChannelDelta).toBeLessThanOrEqual(50);
});

test('会话 MCP 图标直达的连接器快捷开关在 390px 视口下不溢出', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '移动端连接器目录规格固定使用 390x844 Chromium 视口'
  );
  const fakeDaemon = new FakeEnterpriseDaemon();
  fakeDaemon.reset();
  fakeDaemon.setMcpPreference({ installed: true, enabled: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await fakeDaemon.attach(page);
  await installPlatformEnvironment(page, 'browser');

  try {
    await page.goto(runtime.origin);
    await loginWithEmail(page);
    await expect(page.getByRole('textbox', { name: '输入任务' })).toBeVisible();
    await page.getByRole('button', {
      name: '打开连接器列表，客户关系管理 MCP'
    }).click();
    await expect(page.getByRole('switch', {
      name: '客户关系管理 MCP'
    })).toHaveAttribute('aria-checked', 'true');

    const layout = await page.evaluate(() => {
      const submenu = document.querySelector<HTMLElement>('.composer-connector-card')!;
      const list = document.querySelector<HTMLElement>('.composer-connector-quick-list')!;
      const connector = document.querySelector<HTMLElement>('.composer-connector-quick-item')!;
      const title = document.querySelector<HTMLElement>('.composer-connector-quick-name')!;
      const status = document.querySelector<HTMLElement>('.composer-connector-switch')!;
      const rect = (element: HTMLElement) => {
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          right: value.right,
          top: value.top,
          bottom: value.bottom
        };
      };
      return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        submenuClientWidth: submenu.clientWidth,
        submenuScrollWidth: submenu.scrollWidth,
        listClientWidth: list.clientWidth,
        listScrollWidth: list.scrollWidth,
        connectorClientWidth: connector.clientWidth,
        connectorScrollWidth: connector.scrollWidth,
        title: rect(title),
        status: rect(status)
      };
    });
    expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.submenuScrollWidth).toBeLessThanOrEqual(layout.submenuClientWidth);
    expect(layout.listScrollWidth).toBeLessThanOrEqual(layout.listClientWidth);
    expect(layout.connectorScrollWidth).toBeLessThanOrEqual(layout.connectorClientWidth);
    expect(rectanglesOverlap(layout.title, layout.status)).toBe(false);

    await testInfo.attach('mobile-composer-connector-catalog.png', {
      body: await page.locator('.composer-connector-card').screenshot({
        animations: 'disabled'
      }),
      contentType: 'image/png'
    });
    expect(fakeDaemon.unknownRequestPaths()).toEqual([]);
  } finally {
    await context.close();
  }
});

test('企业知识库在 390px 视口下逐级浏览且不产生页面级溢出', async ({
  page,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    '移动端知识库规格固定使用 390x844 Chromium 视口'
  );

  const fakeDaemon = new FakeEnterpriseDaemon();
  await fakeDaemon.attach(page);
  await installPlatformEnvironment(page, 'browser');
  await page.goto(`${runtime.origin}/#/account`);
  await expect(page.getByRole('heading', { name: '欢迎使用 Clawee' })).toBeVisible();
  await loginWithEmail(page);
  await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = '#/knowledge';
  });
  await expect(page.getByRole('heading', { name: '企业知识库' })).toBeVisible();
  await expect(page.locator('.knowledge-library-pane')).toBeVisible();
  await expect(page.locator('.knowledge-documents-pane')).toBeHidden();

  await page.locator('.knowledge-library-list button').click();
  await expect(page.locator('.knowledge-library-pane')).toBeHidden();
  await expect(page.locator('.knowledge-documents-pane')).toBeVisible();
  await expect(page.getByText('员工手册.pdf')).toBeVisible();
  await page.getByLabel('选择知识库文档').setInputFiles({
    name: '发布流程.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 发布流程')
  });
  await expect(page.getByText('发布流程.md 已提交处理，请关注文档状态'))
    .toBeVisible();

  const layout = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>('.knowledge-page')!;
    const header = document.querySelector<HTMLElement>('.knowledge-documents-header')!;
    const back = document.querySelector<HTMLElement>('.knowledge-mobile-back')!;
    const heading = document.querySelector<HTMLElement>('.knowledge-documents-heading')!;
    const upload = document.querySelector<HTMLElement>('.knowledge-upload-button')!;
    const content = document.querySelector<HTMLElement>('.knowledge-document-content')!;
    const rect = (element: HTMLElement) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom
      };
    };
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
      contentClientWidth: content.clientWidth,
      contentScrollWidth: content.scrollWidth,
      back: rect(back),
      heading: rect(heading),
      upload: rect(upload)
    };
  });

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth);
  expect(layout.headerScrollWidth).toBeLessThanOrEqual(layout.headerClientWidth);
  expect(layout.contentScrollWidth).toBeGreaterThan(layout.contentClientWidth);
  expect(rectanglesOverlap(layout.back, layout.heading)).toBe(false);
  expect(rectanglesOverlap(layout.heading, layout.upload)).toBe(false);

  await testInfo.attach('mobile-knowledge.png', {
    body: await page.locator('.clawee-shell').screenshot({
      animations: 'disabled'
    }),
    contentType: 'image/png'
  });

  await page.getByRole('button', { name: '返回知识库列表' }).click();
  await expect(page.locator('.knowledge-library-pane')).toBeVisible();
  await expect(page.locator('.knowledge-documents-pane')).toBeHidden();
  expect(fakeDaemon.unknownRequestPaths()).toEqual([]);
});

test('连接器在 390px 视口下可安装和开启且不产生溢出或重叠', async ({
  page,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    '移动端连接器规格固定使用 390x844 Chromium 视口'
  );

  const fakeDaemon = new FakeEnterpriseDaemon();
  await fakeDaemon.attach(page);
  await installPlatformEnvironment(page, 'browser');
  await page.goto(`${runtime.origin}/#/account`);
  await page.getByLabel('邮箱').fill('member@example.com');
  await page.getByLabel('密码').fill('enterprise-secret');
  await page.locator('.enterprise-account-primary-action').click();
  await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = '#/connections';
  });
  await expect(page.getByRole('heading', { name: '连接器' })).toBeVisible();
  const card = page.locator(
    '[data-testid="enterprise-mcp-card"][data-upstream-id="crm-main"]'
  );
  await card.getByRole('button', { name: '安装' }).click();
  const toggle = card.getByRole('switch', { name: '客户关系管理 MCP' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  const layout = await page.evaluate(() => {
    const pageElement = document.querySelector<HTMLElement>('.connections-page')!;
    const inner = document.querySelector<HTMLElement>('.connections-page__inner')!;
    const header = document.querySelector<HTMLElement>('.connections-header')!;
    const actions = document.querySelector<HTMLElement>('.connections-header__actions')!;
    const cardElement = document.querySelector<HTMLElement>(
      '[data-testid="enterprise-mcp-card"][data-upstream-id="crm-main"]'
    )!;
    const footer = cardElement.querySelector<HTMLElement>('footer')!;
    const label = footer.querySelector<HTMLElement>('.connection-toggle-label')!;
    const toggleElement = footer.querySelector<HTMLElement>('.connection-switch')!;
    const rect = (element: HTMLElement) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom
      };
    };
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: pageElement.clientWidth,
      pageScrollWidth: pageElement.scrollWidth,
      innerClientWidth: inner.clientWidth,
      innerScrollWidth: inner.scrollWidth,
      headerClientWidth: header.clientWidth,
      headerScrollWidth: header.scrollWidth,
      actionsClientWidth: actions.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      cardClientWidth: cardElement.clientWidth,
      cardScrollWidth: cardElement.scrollWidth,
      label: rect(label),
      toggle: rect(toggleElement)
    };
  });

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth);
  expect(layout.innerScrollWidth).toBeLessThanOrEqual(layout.innerClientWidth);
  expect(layout.headerScrollWidth).toBeLessThanOrEqual(layout.headerClientWidth);
  expect(layout.actionsScrollWidth).toBeLessThanOrEqual(layout.actionsClientWidth);
  expect(layout.cardScrollWidth).toBeLessThanOrEqual(layout.cardClientWidth);
  expect(rectanglesOverlap(layout.label, layout.toggle)).toBe(false);
  expect(fakeDaemon.snapshot()).toMatchObject({
    mcpInstalled: true,
    mcpEnabled: true
  });
  expect(fakeDaemon.unknownRequestPaths()).toEqual([]);

  await testInfo.attach('mobile-connections.png', {
    body: await page.locator('.clawee-shell').screenshot({
      animations: 'disabled'
    }),
    contentType: 'image/png'
  });
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
    await expect(page.getByRole('heading', { name: '欢迎使用 Clawee' })).toBeVisible();
    const checkpoints: Record<string, Checkpoint> = {
      account: await captureCheckpoint(page, [
        '.enterprise-access-gate',
        '.enterprise-account-page',
        '.enterprise-auth-card'
      ])
    };

    await loginWithEmail(page);
    await expect(page.getByRole('button', {
      name: 'Enterprise Member',
      exact: true
    })).toBeVisible();
    await verifyNativeProjectCapability(page, input.platform);
    await page.getByRole('button', {
      name: 'Enterprise Member',
      exact: true
    }).click();
    await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Enterprise Member' })).toBeVisible();

    await page.getByRole('button', { name: '连接器', exact: true }).click();
    await expect(page.getByRole('heading', { name: '连接器' })).toBeVisible();
    const mcpCard = page.locator(
      '[data-testid="enterprise-mcp-card"][data-upstream-id="crm-main"]'
    );
    await expect(mcpCard.getByRole('heading', { name: '客户关系管理' })).toBeVisible();
    await expect(mcpCard.getByText('sales', { exact: true })).toBeVisible();
    await expect(mcpCard.getByText('按条件查询客户资料', { exact: true })).toBeVisible();
    await expect(mcpCard.getByText('服务正常')).toHaveCount(0);
    await mcpCard.getByRole('button', { name: '安装' }).click();
    const mcpSwitch = mcpCard.getByRole('switch', { name: '客户关系管理 MCP' });
    await expect(mcpSwitch).toHaveAttribute('aria-checked', 'false');
    await mcpSwitch.click();
    await expect(mcpSwitch).toHaveAttribute('aria-checked', 'true');
    checkpoints.connections = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.connections-page',
      '.connections-summary',
      '[data-testid="enterprise-mcp-card"][data-upstream-id="crm-main"]'
    ]);

    await page.getByRole('button', { name: '企业知识库', exact: true }).click();
    await expect(page.getByRole('heading', { name: '企业制度' })).toBeVisible();
    await expect(page.getByText('员工手册.pdf')).toBeVisible();
    await page.getByLabel('选择知识库文档').setInputFiles({
      name: '发布流程.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 发布流程')
    });
    await expect(page.getByText('发布流程.md 已提交处理，请关注文档状态'))
      .toBeVisible();
    await expect(page.getByText('发布流程.md', { exact: true })).toBeVisible();
    checkpoints.knowledge = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.knowledge-page',
      '.knowledge-workbench',
      '.knowledge-document-table'
    ]);

    await page.getByRole('button', { name: '共享网盘', exact: true }).click();
    await expect(page.getByRole('heading', { name: '共享网盘' })).toBeVisible();
    await expect(page.getByText('design.md', { exact: true })).toBeVisible();
    await expect(page.getByText('当前项目：企业项目')).toBeVisible();
    await expect(page.getByRole('button', { name: '上传文件' })).toHaveCount(0);
    await page.getByRole('button', {
      name: '保存 design.md 到当前项目'
    }).click();
    await expect(page.getByRole('button', {
      name: '覆盖保存 design.md'
    })).toBeVisible();
    await page.getByRole('button', {
      name: '覆盖保存 design.md'
    }).click();
    await expect(page.getByText(
      'docs/design.md 已覆盖保存到项目“企业项目”'
    )).toBeVisible();
    checkpoints.drive = await captureCheckpoint(page, [
      '.clawee-sidebar-pane',
      '.clawee-main-pane',
      '.shared-drive-page',
      '.shared-drive-workbench',
      '.shared-drive-table'
    ]);

    await page.getByRole('button', { name: '企业Skill中心', exact: true }).click();
    await expect(page.getByRole('tab', {
      name: '企业Skills',
      selected: true
    })).toBeVisible();
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
    await expect(page.getByLabel('已选择 Skill enterprise-name')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '输入任务' }))
      .toHaveValue('');
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

async function loginWithEmail(page: Page): Promise<void> {
  await page.getByLabel('邮箱').fill('member@example.com');
  await page.getByLabel('密码').fill('password-123');
  await page.getByRole('checkbox').check();
  await page.locator('.enterprise-email-submit').click();
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
  const existingFolder = page.getByRole('button', { name: '使用现有文件夹' });
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
  const text = normalizeText(
    await page.locator(
      '.clawee-main-content, .enterprise-access-gate'
    ).first().innerText()
  );
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
    screenshot: await page.locator(
      '.clawee-shell, .enterprise-access-gate'
    ).first().screenshot({ animations: 'disabled' })
  };
}

function normalizeText(value: string): string {
  return value
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

async function compareScreenshotPixels(
  page: Page,
  left: Buffer,
  right: Buffer
): Promise<{
  differentPixels: number;
  maxChannelDelta: number;
}> {
  return page.evaluate(async ({ leftBase64, rightBase64 }) => {
    const decode = async (value: string) => {
      const response = await fetch(`data:image/png;base64,${value}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('无法创建截图比较画布');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        data: context.getImageData(0, 0, canvas.width, canvas.height).data
      };
    };
    const leftImage = await decode(leftBase64);
    const rightImage = await decode(rightBase64);
    if (
      leftImage.width !== rightImage.width
      || leftImage.height !== rightImage.height
    ) {
      throw new Error(
        `截图尺寸不同：${leftImage.width}x${leftImage.height} / `
        + `${rightImage.width}x${rightImage.height}`
      );
    }

    let differentPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < leftImage.data.length; offset += 4) {
      let pixelDifferent = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          leftImage.data[offset + channel]!
          - rightImage.data[offset + channel]!
        );
        if (delta > 0) pixelDifferent = true;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
      }
      if (pixelDifferent) differentPixels += 1;
    }
    return { differentPixels, maxChannelDelta };
  }, {
    leftBase64: left.toString('base64'),
    rightBase64: right.toString('base64')
  });
}

function rectanglesOverlap(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number }
): boolean {
  return !(
    left.right <= right.left
    || right.right <= left.left
    || left.bottom <= right.top
    || right.bottom <= left.top
  );
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
