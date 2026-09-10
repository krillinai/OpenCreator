import { test, expect } from './fixtures/runtime.js';

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

test('Windows 本地 Whisper 在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
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
    transcription: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    await runtime.api('DELETE', '/creator-services/config');
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
      if (!url.pathname.includes('/creator-services/')) return;
      requests.push(`${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`);
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=ai-services&section=transcription`);
      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const localMode = settings.getByRole('button', { name: '本地 Whisper' });
      await expect(settings.getByText('Windows · x64')).toBeVisible();
      await expect(localMode).toBeEnabled();
      await localMode.click();

      const provider = settings.getByRole('combobox', { name: '语音识别服务' });
      const model = settings.getByRole('combobox', { name: '本地模型' });
      await expect(provider).toHaveText('Whisper.cpp');
      await expect(model).toHaveText('tiny');
      await model.click();
      await settings.getByRole('option', { name: 'medium' }).click();
      await settings.getByRole('button', { name: '保存配置' }).click();
      await page.getByRole('button', { name: '保存并启用' }).click();
      await expect(settings.getByText('配置已安全保存')).toBeVisible();

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['settings', settings],
        ['local-mode', localMode],
        ['provider', provider],
        ['model', model]
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
        config: { transcription: Record<string, unknown> };
      }>('GET', '/creator-services/config');
      results.push({
        text: normalizeParityText(await settings.innerText()),
        boxes,
        requests,
        transcription: persisted.config.transcription
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(results[1]!.requests).toEqual(results[0]!.requests);
  expect(results[1]!.transcription).toEqual(results[0]!.transcription);
  expect(results[0]!.transcription).toMatchObject({
    provider: 'whisper.cpp',
    whisperCpp: { model: 'medium' }
  });
  expect(results[0]!.requests).toContain('PATCH /creator-services/config');
});

test('本机组件设置在 Browser/Desktop Bridge 下保持相同状态、尺寸和 Runtime 请求', async ({
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

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=local-components`);

      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const component = settings.locator('.runtime-component-item');
      await expect(settings.getByRole('heading', { name: '本机组件' })).toBeVisible();
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

test('工作台模板新建 Creator Job，刷新和最近项目精确恢复历史且不启动普通 Codex Run', async ({ page, runtime }) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

  await page.getByRole('button', { name: /视频下载/ }).last().click();
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

  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: /视频下载/ }).last().click();
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
  await workspace.getByRole('textbox', { name: '封面提示词' }).fill(prompt);
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
          closeBehavior: 'hide' as const,
          telemetryEnabled: false
        }),
        updateDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const,
          telemetryEnabled: false
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
