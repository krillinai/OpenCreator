import type { CreatorJob, CreatorPreflightResponse, CreatorStageRun } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

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

  const workspace = page.getByRole('region', { name: '视频翻译操作区' });
  await expect(workspace.getByRole('heading', { name: '字幕读取失败' })).toBeVisible();
  const settings = workspace.getByRole('link', { name: '检查网络代理' });
  await expect(settings).toBeVisible();
  await expect(workspace.getByRole('button', { name: '重试当前阶段' })).toBeVisible();
  await expect(page.locator('.creator-resizable-layout')).toHaveAttribute('data-agent-panel', 'hidden');
  await expect(page.locator('.video-translation-collab-layout .creator-collaboration-panel')).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: '查看任务诊断' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '视频翻译项目产出' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目 V1' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('failure-workbench.png'), animations: 'disabled' });

  await settings.click();
  await expect(page).toHaveURL(/#\/settings\?tab=general/);
  await page.locator('.settings-back').click();
  await expect(workspace.getByRole('heading', { name: '字幕读取失败' })).toBeVisible();
  await workspace.getByRole('button', { name: '重试当前阶段' }).click();
  await expect(page).toHaveURL(/#\/projects$/);
});
