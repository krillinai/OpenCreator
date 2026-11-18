import type { CreatorActionResponse, CreatorJob, CreatorPreflightResponse, CreatorStageRun } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('a failed download deep link fills the workbench with recovery and Agent', async ({ page, runtime }, testInfo) => {
  const sourceUrl = 'https://www.youtube.com/watch?v=example-video';
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-download', templateVersion: 2,
    creationKey: 'download-failure-view', state: { sourceUrl }
  });
  const failedStage: CreatorStageRun = {
    id: 'failed-download-probe', jobId: job.id, stageId: 'probe', executor: 'download',
    status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
    attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
    progress: { phase: 'probing_source', percent: 20 },
    errorCode: 'network_unavailable', errorMessage: 'Unable to connect to the video platform.',
    startedAt: job.createdAt, finishedAt: job.updatedAt
  };
  let snapshot: CreatorJob = { ...job, status: 'failed', revision: job.revision + 1, stages: [failedStage] };
  await page.route(`**/creator/jobs/${job.id}`, route => route.fulfill({ json: { job: snapshot } }));
  await page.route(`**/creator/jobs/${job.id}/preflight?*`, route => route.fulfill({ json: {
    templateId: 'video-download', templateVersion: 2, stageId: 'probe',
    executionMode: 'local', canStart: true, ready: [], warning: [], blocked: [], checkedAt: job.updatedAt
  } satisfies CreatorPreflightResponse }));
  await page.route(`**/creator/jobs/${job.id}/actions`, route => {
    snapshot = { ...snapshot, status: 'running', revision: snapshot.revision + 1, stages: [failedStage, {
      ...failedStage, id: 'retrying-download-probe', attempt: 2, status: 'running', dispatchStatus: 'claimed',
      errorCode: null, errorMessage: null, finishedAt: null
    }] };
    return route.fulfill({ json: { job: snapshot, receipt: {
      actor: 'user', action: 'run-stage', summary: 'Retry probe', affectedArtifacts: [],
      newRevision: snapshot.revision, createdAt: job.updatedAt
    } } satisfies CreatorActionResponse });
  });
  await runtime.openApp(page);
  const workbenchPath = `#/workbench?tool=video-download&jobId=${job.id}`;
  await page.goto(`${runtime.origin}/${workbenchPath}`);
  await page.reload();

  const mobile = testInfo.project.name === 'chromium-mobile';
  const agent = page.getByRole('complementary', { name: 'OpenCreator', exact: true });
  if (mobile) await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await expect(agent).toBeVisible();
  await expect(agent.locator('.creator-collaboration-context')).toContainText('无法连接视频平台');
  await expect(page.locator('.opencreator-sidebar-pane')).toBeHidden();
  await expect(page.getByRole('button', { name: '生成记录' })).toBeHidden();
  if (mobile) await page.getByRole('tab', { name: '创作', exact: true }).click();

  const workspace = page.getByRole('region', { name: '视频下载 操作区' });
  const notice = workspace.getByRole('alert').filter({ hasText: '视频解析失败' });
  const settings = notice.getByRole('link', { name: '检查代理设置' });
  await expect(settings).toBeVisible();
  expect(new URLSearchParams((await settings.getAttribute('href'))?.split('?')[1]).get('returnPath')).toBe(workbenchPath);
  await expect(notice.getByRole('button')).toHaveCount(0);
  const retry = workspace.getByRole('list', { name: '视频链接列表' }).getByRole('button', { name: `重试 ${sourceUrl}`, exact: true });
  await expect(retry).toBeEnabled();
  await expect(workspace.getByRole('button', { name: `移除链接 ${sourceUrl}`, exact: true })).toBeEnabled();
  await expect(workspace.getByText('尚无可用规格')).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect.poll(async () => {
    const bounds = await page.locator('.video-download-workspace-page').boundingBox();
    return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
  }).toEqual([0, 0, viewport.width, viewport.height]);
  if (!mobile) {
    const left = (await workspace.boundingBox())!;
    const right = (await agent.boundingBox())!;
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    expect(Math.round(right.width)).toBe(420);
    expect([right.y, right.x + right.width, right.height].map(Math.round)).toEqual([0, viewport.width, viewport.height]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({ path: testInfo.outputPath('video-download-failure-workbench.png'), animations: 'disabled' });

  const request = page.waitForRequest(candidate => candidate.method() === 'POST' && candidate.url().endsWith(`/creator/jobs/${job.id}/actions`));
  await retry.click();
  expect((await request).postDataJSON()).toMatchObject({ action: 'run-stage', input: { stageId: 'probe' } });
  await expect(page).toHaveURL(`${runtime.origin}/${workbenchPath}`);
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
  await expect(agent).toHaveCount(0);
  await expect(page.getByRole('button', { name: '生成记录' })).toBeVisible();
});
