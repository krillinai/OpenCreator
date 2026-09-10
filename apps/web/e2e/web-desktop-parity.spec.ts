import type { CreatorYtDlpStatusResponse } from '@opencreator/protocol';
import { test, expect } from './fixtures/runtime.js';

test('通用界面设置在 Browser/Desktop Bridge 下读取并写入相同 Runtime 配置', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    theme: string | undefined;
    accent: string | undefined;
    lightSelected: string | null;
    permission: string;
    language: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    await runtime.api('PATCH', '/settings/ui', {
      language: 'zh-CN',
      colorMode: 'light',
      accentColor: 'red',
      customAccentColor: '#3b82f6',
      defaultPermission: 'workspace-write'
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/settings/ui')) return;
      requests.push(
        `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
      );
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings`);

      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const lightButton = settings.getByRole('button', { name: '浅色' });
      const permission = settings.getByRole('combobox', { name: '默认权限' });
      const language = settings.getByRole('combobox', { name: '显示语言' });
      await expect(lightButton).toHaveAttribute('aria-pressed', 'true');
      await expect(permission).toHaveValue('workspace-write');
      await expect(language).toHaveValue('zh-CN');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'red');
      await settings.getByRole('button', { name: '深色' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect.poll(async () => (
        await runtime.api<{
          settings: { colorMode: string };
        }>('GET', '/settings/ui')
      ).settings.colorMode).toBe('dark');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['light-button', lightButton],
        ['permission', permission],
        ['language', language]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      results.push({
        theme: await page.locator('html').getAttribute('data-theme') ?? undefined,
        accent: await page.locator('html').getAttribute('data-accent') ?? undefined,
        lightSelected: await lightButton.getAttribute('aria-pressed'),
        permission: await permission.inputValue(),
        language: await language.inputValue(),
        boxes,
        requests
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]).toEqual(results[0]);
  expect(results[0]!.requests).toContain('GET /settings/ui');
  expect(results[0]!.requests).toContain('PATCH /settings/ui');
});

test('视频下载在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const created = await runtime.api<{
    job: { id: string; state: Record<string, unknown> };
  }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-download',
    creationKey: 'parity-video-download',
    state: {
      sourceUrl: 'https://www.youtube.com/watch?v=OpenCreatorParity'
    }
  });
  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=video-download`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '视频下载 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      await expect(workspace.getByRole('textbox', { name: '待下载视频链接' }))
        .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorParity');
      await expect(panel).toContainText('YouTube · 待解析');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['source-input', workspace.getByRole('textbox', { name: '待下载视频链接' })]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(results[1]!.requests).toEqual(results[0]!.requests);
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('视频生成在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const created = await runtime.api<{
      job: { id: string; state: Record<string, unknown> };
    }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId: 'video-generation',
      creationKey: `parity-video-generation-${platform}`,
      state: {
        prompt: '雨夜中的未来城市，镜头平稳向前推进',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        size: '1280x720',
        duration: 5,
        currentStep: 1,
        furthestStep: 1
      }
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname
            .replace('/.opencreator/runtime', '')
            .replace(created.job.id, '{jobId}')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=video-generation`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '视频生成 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      const provider = workspace.getByRole('combobox', { name: '视频服务' });
      const model = workspace.getByRole('combobox', { name: '模型版本' });
      const format = workspace.getByRole('combobox', { name: '画幅' });
      const duration = workspace.getByRole('combobox', { name: '视频时长' });
      await expect(provider).toHaveValue('seedance');
      await expect(model).toHaveValue('doubao-seedance-2-0-260128');
      await expect(format).toHaveValue('1280x720');
      await expect(duration).toHaveValue('5');
      await provider.selectOption('veo');
      await expect(model).toHaveValue('veo-3.1-generate-preview');
      await format.selectOption('720x1280');
      await duration.selectOption('8');

      await expect.poll(async () => (
        await runtime.api<{
          job: { state: Record<string, unknown> };
        }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`)
      ).job.state).toMatchObject({
        prompt: '雨夜中的未来城市，镜头平稳向前推进',
        provider: 'veo',
        model: 'veo-3.1-generate-preview',
        size: '720x1280',
        duration: 8,
        currentStep: 1,
        furthestStep: 1
      });
      await expect(panel).toContainText('竖屏 · 8s');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['provider', provider],
        ['model', model],
        ['format', format],
        ['duration', duration]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(results[1]!.requests).toEqual(results[0]!.requests);
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('第三方组件设置在 Browser/Desktop Bridge 下保持相同状态、尺寸和 Runtime 请求', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.includes('/creator/yt-dlp/')) return;
      requests.push(
        `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
      );
    });
    await page.route('**/.opencreator/runtime/creator/yt-dlp/status', route => route.fulfill({
      json: {
        ytDlp: {
          channel: 'nightly',
          source: 'bundled',
          currentVersion: '2026.08.29.232711',
          bundledVersion: '2026.08.29.232711',
          latestVersion: null,
          updateAvailable: false,
          checkDue: false,
          lastCheckedAt: null,
          lastCheckAttemptAt: null,
          installedAt: null
        }
      } satisfies CreatorYtDlpStatusResponse
    }));

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=local-components`);

      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const component = settings.locator('.runtime-component-item');
      await expect(settings.getByRole('heading', { name: '第三方组件' })).toBeVisible();
      await expect(component.getByRole('heading', { name: 'yt-dlp nightly' })).toBeVisible();
      await expect(component).toContainText('每 7 天自动检查更新，不会自动安装。');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['settings', settings],
        ['component', component],
        ['check-button', component.getByRole('button', { name: '检查更新' })]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      results.push({
        text: normalizeParityText(await settings.innerText()),
        boxes,
        requests
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(results[1]!.requests).toEqual(results[0]!.requests);
  expect(results[0]!.requests).toContain('GET /creator/yt-dlp/status');
});

test('工作台模块新建 Creator Job，刷新和最近项目精确恢复历史且不启动普通 Codex Run', async ({ page, runtime }) => {
  await page.route(
    /^https:\/\/i\.ytimg\.com\/vi\/OpenCreator(?:Demo|Second)\/maxresdefault\.jpg$/,
    route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
        'base64'
      )
    })
  );
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

  await page.getByRole('button', { name: /^视频下载/ }).click();
  const input = page.getByRole('textbox', { name: '待下载视频链接' });
  await expect(input).toBeVisible();
  await input.fill('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const firstJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(firstJobId).toBeTruthy();

  await expect(page.getByRole('complementary', { name: 'OpenCreator' }))
    .toContainText('YouTube');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ id: string; templateId: string; state: Record<string, unknown> }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.find(job => job.id === decodeURIComponent(firstJobId!))?.state.sourceUrl;
  }).toBe('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(1);
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '视频下载' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');

  await page.getByRole('region', { name: '视频下载 操作区' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await page.getByRole('button', { name: /^视频下载/ }).click();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' })).toHaveValue('');
  await page.getByRole('textbox', { name: '待下载视频链接' })
    .fill('https://www.youtube.com/watch?v=OpenCreatorSecond');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const secondJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(secondJobId).toBeTruthy();
  expect(decodeURIComponent(secondJobId!)).not.toBe(decodeURIComponent(firstJobId!));
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(2);

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('button', { name: '打开项目 youtube.com · OpenCreatorDemo' }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${firstJobId}`));
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');
});

test('图像生成在桌面和移动视口创建、持久化并从项目中心恢复 Creator Job', async ({
  page,
  runtime
}) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /^图像生成/ }).click();

  const prompt = '一间明亮的现代创意工作室，清晨自然光，真实摄影';
  await page.getByRole('textbox', { name: '提示词' }).fill(prompt);
  await expect(page).toHaveURL(/#\/workbench\?tool=image-generation&jobId=creator_job_/);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('radio', { name: /横向/ }).click();
  await page.getByRole('radio', { name: '高清', exact: true }).click();
  await page.getByRole('radio', { name: '4 张', exact: true }).click();

  const jobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(jobId).toBeTruthy();
  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${decodeURIComponent(jobId!)}`);
    return response.job.state;
  }).toMatchObject({
    prompt,
    provider: 'openai',
    size: '1536x1024',
    quality: 'high',
    candidateCount: 4,
    currentStep: 1,
    furthestStep: 1
  });
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  await page.getByRole('button', { name: `打开项目 ${prompt}` }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${jobId}`));
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();
});

test('封面生成在桌面和移动视口保持可操作并从项目中心恢复 Creator Job', async ({
  page,
  runtime
}) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /^封面生成/ }).click();

  const workspace = page.getByRole('region', { name: '封面生成 操作区' });
  const prompt = '人物主体清晰，明亮工作室，高对比构图，不生成文字';
  await workspace.getByRole('textbox', { name: '内容与补充要求' }).fill(prompt);
  await expect(page).toHaveURL(/#\/workbench\?tool=cover-generator&jobId=creator_job_/);
  await workspace.getByRole('button', { name: '继续', exact: true }).click();
  await workspace.getByRole('radio', { name: '9:16', exact: true }).click();
  await workspace.getByRole('radio', { name: '高清', exact: true }).click();

  const jobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(jobId).toBeTruthy();
  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { templateVersion: number; state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${decodeURIComponent(jobId!)}`);
    return {
      templateVersion: response.job.templateVersion,
      state: response.job.state
    };
  }).toMatchObject({
    templateVersion: 2,
    state: {
      prompt,
      ratio: '9:16',
      quality: 'high',
      currentStep: 1,
      furthestStep: 1
    }
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => window.innerWidth)
  );

  await page.reload();
  await expect(page.getByRole('heading', { name: '封面生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '9:16', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  await page.getByRole('button', { name: `打开项目 ${prompt}` }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${jobId}`));
  await expect(page.getByRole('heading', { name: '封面生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '9:16', exact: true })).toBeChecked();
});

test('Creator Preset 在 Browser/Desktop Bridge 下创建相同工作台状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    home: {
      text: string;
      boxes: Record<string, { width: number; height: number }>;
    };
    request: Record<string, unknown>;
    route: string;
    text: string;
    job: {
      templateId: string;
      templateVersion: number;
      status: string;
      state: Record<string, unknown>;
      presetOrigin: Record<string, unknown> | null;
      stages: unknown[];
    };
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    let createRequest: Record<string, unknown> | undefined;
    page.on('request', request => {
      const url = new URL(request.url());
      if (
        request.method() === 'POST'
        && url.pathname.endsWith('/creator/jobs')
      ) {
        createRequest = request.postDataJSON() as Record<string, unknown>;
      }
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/new`);
      await expect(page.getByRole('heading', { name: '创作模板' })).toBeVisible();
      await expect(page.getByText('需要帮你做点什么')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '输入任务' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: '推荐' }))
        .toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: '视频创作' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '图像设计' })).toBeVisible();
      const presetButton = page.getByRole('button', {
        name: '使用B站双语精翻模板'
      });
      await expect(presetButton).toHaveText('B站双语精翻');
      const cover = presetButton.locator('img');
      await expect.poll(async () => cover.evaluate(image => ({
        complete: image.complete,
        width: image.naturalWidth
      }))).toEqual({ complete: true, width: 1280 });
      const home = page.locator('.creator-home-wrap');
      const boxes: Record<string, { width: number; height: number }> = {};
      for (const [name, locator] of [
        ['categories', page.getByRole('tablist', { name: '创作模板分类' })],
        ['first-template', presetButton]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        boxes[name] = {
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const homeSnapshot = {
        text: normalizeParityText(await home.innerText()),
        boxes
      };

      await presetButton.click();
      await expect(page).toHaveURL(/#\/workbench\?tool=video-translation&jobId=/);
      const route = new URL(page.url()).hash.slice(1);
      const jobId = new URL(route, runtime.origin).searchParams.get('jobId');
      expect(jobId).not.toBeNull();
      await expect.poll(() => createRequest).toBeDefined();
      const response = await runtime.api<{
        job: {
          templateId: string;
          templateVersion: number;
          status: string;
          state: Record<string, unknown>;
          presetOrigin: Record<string, unknown> | null;
          stages: unknown[];
        };
      }>('GET', `/creator/jobs/${encodeURIComponent(jobId!)}`);
      const workspace = page.getByRole('region', { name: '视频翻译操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      await expect(workspace).toBeVisible();
      await expect(panel).toBeVisible();

      results.push({
        home: homeSnapshot,
        request: {
          ...createRequest!,
          creationKey: '{creationKey}'
        },
        route: route.replace(jobId!, '{jobId}'),
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        job: {
          templateId: response.job.templateId,
          templateVersion: response.job.templateVersion,
          status: response.job.status,
          state: response.job.state,
          presetOrigin: response.job.presetOrigin,
          stages: response.job.stages
        }
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.home).toEqual(results[0]!.home);
  expect(results[1]!.request).toEqual(results[0]!.request);
  expect(results[1]!.route).toBe(results[0]!.route);
  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.job).toEqual(results[0]!.job);
  expect(results[0]!.job).toMatchObject({
    templateId: 'video-translation',
    templateVersion: 2,
    status: 'draft',
    presetOrigin: {
      module: 'video-translation',
      id: 'bilibili-bilingual',
      version: 1,
      locale: 'zh-CN',
      title: 'B站双语精翻'
    },
    state: {
      bilingual: true,
      targetLanguage: 'zh_cn'
    },
    stages: []
  });
});

async function installDesktopBridge(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.addInitScript(() => {
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
          closeBehavior: 'hide' as const
        }),
        updateDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const
        }),
        selectProjectDirectory: async () => null,
        resolveDroppedFilePath: () => null,
        openExternal: async () => undefined,
        revealPath: async () => success,
        notify: async () => undefined,
        configureBackgroundNotifications: async () => success,
        subscribeNavigation: () => () => undefined
      }
    });
  });
}

function normalizeParityText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
