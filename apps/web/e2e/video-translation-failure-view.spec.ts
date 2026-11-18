import type { CreatorJob, CreatorPreflightResponse, CreatorStageRun } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('failed video generation reference workbench', async ({ page, runtime }, testInfo) => {
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-generation', templateVersion: 1,
    creationKey: 'video-failure-reference', state: {
      prompt: 'A red car driving along the coast', provider: 'seedance',
      size: '1280x720', duration: 5, currentStage: 'generate'
    }
  });
  const failedStage: CreatorStageRun = {
    id: 'failed-video-generation', jobId: job.id, stageId: 'generate', executor: 'video',
    status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
    attempt: 1, idempotencyKey: 'failed-video-generation', scopeKey: null, inputFingerprint: null,
    progress: { phase: 'provider_failed', percent: 8 },
    errorCode: 'creator_video_generation_failed', errorMessage: 'The provider rejected the request',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString()
  };
  const failed: CreatorJob = {
    ...job, status: 'failed', revision: job.revision + 1, stages: [failedStage]
  };
  await page.route(`**/creator/jobs/${job.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { job: failed } }) : route.continue());
  await page.route('**/gateway/models/catalog*', route => route.fulfill({ json: { models: [] } }));
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-generation&jobId=${job.id}&returnTo=projects`);
  const dismiss = page.getByRole('button', { name: '稍后配置，进入本地模式' });
  if (await dismiss.isVisible()) await dismiss.click();

  await expect(page.getByRole('textbox', { name: '提示词' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible();
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: 'Agent' }).click();
  await expect(page.getByRole('complementary', { name: 'OpenCreator' })).toBeVisible();
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: '创作' }).click();
  await page.screenshot({ path: testInfo.outputPath('video-generation-failure-reference.png'), animations: 'disabled' });
});

test('failed video translation opens recovery in the actual workbench', async ({ page, runtime }, testInfo) => {
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-translation', templateVersion: 2,
    creationKey: 'failure-view', state: {
      sourceType: 'url', sourceUrl: 'https://www.youtube.com/watch?v=example-video'
    }
  });
  const failedStage: CreatorStageRun = {
    id: 'failed-subtitles', jobId: job.id, stageId: 'subtitle', executor: 'krillinai',
    status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
    attempt: 1, idempotencyKey: 'failed-subtitles', scopeKey: null, inputFingerprint: null,
    progress: { phase: 'failed', workflow: true, percent: 1 },
    errorCode: 'platform_caption_access_failed',
    errorMessage: 'yt-dlp subtitle metadata: Operation timed out',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString()
  };
  const failed: CreatorJob = {
    ...job, status: 'failed', revision: job.revision + 1, stages: [failedStage],
    state: { ...job.state, workspacePhase: 'result', sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=example-video' }
  };
  const retrying: CreatorJob = {
    ...failed, status: 'running', revision: failed.revision + 1, stages: [failedStage, {
      ...failedStage, id: 'retrying-subtitles', status: 'running', dispatchStatus: 'claimed',
      progress: { phase: 'reading_captions', workflow: true, percent: 0 },
      errorCode: null, errorMessage: null, finishedAt: null
    }]
  };
  await page.route(`**/creator/jobs/${job.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { job: failed } }) : route.continue());
  await page.route(`**/creator/jobs/${job.id}/actions`, route => route.fulfill({ json: {
    job: route.request().postDataJSON()?.action === 'run-stage' ? retrying : failed
  } }));
  await page.route(`**/creator/jobs/${job.id}/preflight?*`, route => route.fulfill({ json: {
    templateId: 'video-translation', templateVersion: 2, stageId: 'subtitle',
    executionMode: 'local', canStart: true, ready: [], warning: [], blocked: [],
    checkedAt: new Date().toISOString()
  } satisfies CreatorPreflightResponse }));
  await page.route('**/gateway/models/catalog*', route => route.fulfill({ json: { models: [] } }));
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${job.id}&returnTo=projects`);
  const dismiss = page.getByRole('button', { name: '稍后配置，进入本地模式' });
  if (await dismiss.isVisible()) await dismiss.click();

  const workspace = page.getByRole('region', { name: '视频翻译 操作区' });
  await expect(workspace.locator('.dashboard-translation-composer')).toBeVisible();
  await expect(workspace.getByRole('alert')).toContainText('视频平台连接超时');
  await expect(workspace.getByRole('textbox', { name: '视频链接' })).toHaveValue('https://www.youtube.com/watch?v=example-video');
  await expect(workspace.getByRole('alert').getByRole('button', { name: '重试当前阶段' })).toHaveCount(0);
  await expect(workspace.getByRole('form', { name: '视频翻译' }).getByRole('button', { name: '重试当前阶段' })).toBeEnabled();
  await expect(workspace.getByRole('heading', { name: '字幕读取失败' })).toHaveCount(0);
  const agent = page.getByRole('complementary', { name: 'OpenCreator' });
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: 'Agent' }).click();
  await expect(agent.locator('.creator-collaboration-context')).toContainText('字幕读取失败');
  await expect(agent.locator('.creator-collaboration-stage')).not.toContainText('1%');
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: '创作' }).click();
  const settings = workspace.getByRole('link', { name: '检查代理设置' });
  await expect(settings).toBeVisible();
  await expect(workspace.locator('.creator-workspace-local-issue').getByRole('link', { name: '检查代理设置' })).toBeVisible();
  await expect(workspace.locator('.image-generation-submit-row a')).toHaveCount(0);
  await expect(workspace.locator('.dashboard-translation-source-divider')).toBeHidden();
  await expect(workspace.getByRole('button', { name: '重试当前阶段' })).toBeVisible();
  await expect(page.locator('.creator-resizable-layout')).not.toHaveAttribute('data-agent-panel', 'hidden');
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: 'Agent' }).click();
  await expect(page.locator('.creator-workspace-layout .creator-collaboration-panel')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '告诉 Agent 你的要求' })).toBeEnabled();
  if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: '创作' }).click();
  await expect(page.locator('.opencreator-shell')).toHaveClass(/is-immersive/);
  await expect(page.getByRole('complementary', { name: 'OpenCreator 导航' })).toHaveCount(0);
  const expectCompactActions = async () => {
    await expect(workspace.getByRole('button', { name: '重试当前阶段' })).toBeInViewport();
    await expect.poll(async () => {
      const composer = await workspace.locator('.dashboard-translation-composer').boundingBox();
      const actions = await workspace.locator('.dashboard-translation-action-bar').boundingBox();
      return composer && actions ? Math.round(actions.y + actions.height - composer.y) : Infinity;
    }).toBeLessThanOrEqual(304);
  };
  const expectFullWidthControls = async () => {
    await expect.poll(() => workspace.evaluate(section => {
      const content = section.querySelector('.creator-workspace-content')!;
      const { paddingLeft, paddingRight } = getComputedStyle(content);
      const available = content.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight);
      return ['.creator-workspace-local-issue [role="alert"]', '.dashboard-translation-composer'].map(selector => {
        const width = section.querySelector(selector)?.getBoundingClientRect().width;
        return width === undefined ? null : Math.round(available - width);
      });
    })).toEqual([0, 0]);
  };
  if (testInfo.project.name === 'chromium-desktop') {
    await expect.poll(async () => {
      const bounds = await page.locator('.video-translation-failure-page').boundingBox();
      return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
    }).toEqual([0, 0, 1440, 900]);
    await expect.poll(async () => {
      const bounds = await agent.boundingBox();
      return bounds && [bounds.y, bounds.height].map(Math.round);
    }).toEqual([0, 900]);
    await expect.poll(async () => Math.round((await agent.boundingBox())?.width ?? 0)).toBe(420);
    await expectCompactActions();
  }
  await expect(workspace.getByRole('button', { name: '查看任务诊断' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '视频翻译项目产出' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目 V1' })).toHaveCount(0);
  if (testInfo.project.name === 'chromium-mobile') {
    await page.setViewportSize({ width: 390, height: 600 });
    const retry = workspace.getByRole('button', { name: '重试当前阶段' });
    await retry.click({ trial: true });
    const bounds = (await retry.boundingBox())!;
    expect(Math.round(bounds.y + bounds.height)).toBeLessThanOrEqual(600);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('failure-workbench.png'), animations: 'disabled' });

  if (testInfo.project.name === 'chromium-desktop') {
    const initialAgentWidth = Math.round((await agent.boundingBox())!.width);
    const resizeHandle = page.getByRole('separator', { name: '调整操作区和对话区宽度' });
    await resizeHandle.focus();
    await resizeHandle.press('ArrowLeft');
    await expect.poll(async () => Math.round((await agent.boundingBox())?.width ?? 0)).toBe(initialAgentWidth + 32);
    await resizeHandle.dblclick();
    await expect.poll(async () => Math.round((await agent.boundingBox())?.width ?? 0)).toBe(initialAgentWidth);
    await page.setViewportSize({ width: 2540, height: 1230 });
    await expect.poll(async () => Math.round((await agent.boundingBox())?.width ?? 0)).toBe(520);
    await expectFullWidthControls();
    await expectCompactActions();
    await page.locator('.creator-workspace-local-issue').click();
    await page.screenshot({ path: testInfo.outputPath('failure-workbench-wide.png'), animations: 'disabled' });
  }
  await settings.click();
  await expect(page).toHaveURL(/#\/settings\?tab=general/);
  await page.locator('.settings-back').click();
  await expect(workspace.locator('.dashboard-translation-composer')).toBeVisible();
  await workspace.getByRole('button', { name: '重试当前阶段' }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('tab', { name: '生成记录' })).toBeVisible();
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);

  await test.step('directly opening the failed task also fills the workbench', async () => {
    const viewport = testInfo.project.name === 'chromium-mobile'
      ? { width: 390, height: 600 }
      : { width: 1207, height: 1004 };
    await page.setViewportSize(viewport);
    await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${job.id}`);
    await expect(workspace.getByRole('alert')).toContainText('视频平台连接超时');
    await expect.poll(async () => {
      const bounds = await page.locator('.video-translation-failure-page').boundingBox();
      return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
    }).toEqual([0, 0, viewport.width, viewport.height]);
    await expect(page.locator('.dashboard-generation-history-trigger')).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(workspace.getByRole('button', { name: '重试当前阶段' })).toBeEnabled();
    if (testInfo.project.name === 'chromium-mobile') await page.getByRole('tab', { name: 'Agent' }).click();
    await expect(agent).toBeVisible();
    if (testInfo.project.name === 'chromium-desktop') {
      await expectCompactActions();
      const bounds = (await agent.boundingBox())!;
      expect([bounds.y, bounds.x + bounds.width, bounds.height].map(Math.round)).toEqual([0, viewport.width, viewport.height]);
    }
  });
});
