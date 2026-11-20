import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures/runtime.js';

test('completed clip tasks have one player, a visible clip strip, and a fresh-start action', async ({ page, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'This test checks desktop and narrow layouts in one session.');
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'auto-clip', templateVersion: 3,
    state: { sourceType: 'url', sourceUrl: 'https://www.youtube.com/watch?v=example-video' }
  });
  const artifacts: CreatorArtifact[] = [1, 2, 3].map(number => ({
    id: `clip-${number}`, jobId: job.id, kind: 'auto_clip_video', version: number, status: 'completed',
    path: null, scopeKey: null, inputFingerprint: null, sha256: null, sourceArtifactIds: [], createdAt: job.createdAt,
    metadata: {
      resultVersion: 1, start: (number - 1) * 90, end: number * 90, fileName: `clip-${number}.mp4`,
      ...(number === 1 ? { score: 0.72 } : {}),
      ...(number === 2 ? { score: 0.86, selectionReason: { text: '这个例子说明了为什么要检查原片。', offsetMs: 600, locale: 'zh-CN' } } : {})
    }
  }));
  const completed: CreatorJob = { ...job, status: 'completed', artifacts };
  await page.route(`**/creator/jobs/${job.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { job: completed } }) : route.continue());
  const media = readFileSync(new URL('./fixtures/online-preview.mp4', import.meta.url));
  await page.route(`**/creator/jobs/${job.id}/artifacts/*/content`, route => route.fulfill({ contentType: 'video/mp4', body: media }));
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=auto-clips&jobId=${job.id}`);
  await page.reload();

  const workspace = page.locator('.creator-workspace-page');
  const results = page.getByRole('region', { name: '切片结果' });
  const strip = results.getByRole('group', { name: '片段列表' });
  const choices = strip.getByRole('button');
  const player = results.locator('video');
  const agent = page.getByRole('complementary', { name: 'OpenCreator' });
  await expect(workspace).toHaveAttribute('data-fill-workspace', 'true');
  await expect(results.getByText('视频来源: https://www.youtube.com/watch?v=example-video')).toBeVisible();
  await expect(choices).toHaveCount(3);
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  const reasonEmpty = results.getByText('此片段暂无选段理由。');
  await expect(reasonEmpty).toBeVisible();
  await expect(player).toHaveCount(1);
  const firstUrl = await player.getAttribute('src');
  await choices.nth(1).click();
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(player).toHaveCount(1);
  await expect(player).not.toHaveAttribute('src', firstUrl!);
  await expect(results.getByText('选段理由', { exact: true })).toBeVisible();
  await expect(results.getByText('这个例子说明了为什么要检查原片。')).toBeVisible();
  await expect(reasonEmpty).toHaveCount(0);
  const marker = results.getByRole('button', { name: '跳转到 00:00' });
  await expect(marker).toBeEnabled();
  await marker.click();
  await expect.poll(async () => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(0.6, 1);
  expect(await player.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await results.getByRole('combobox', { name: '排序' }).click();
  await page.getByRole('option', { name: '按评分排序' }).click();
  await expect(choices.first()).toHaveAccessibleName(/^片段 2/);
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(0.6, 1);
  const download = page.waitForEvent('download');
  await results.getByRole('button', { name: '下载片段' }).click();
  expect((await download).suggestedFilename()).toBe('clip-2.mp4');

  for (const [width, height, agentWidth] of [[2560, 1184, 520], [1440, 900, 420], [390, 900, 0]]) {
    await test.step(`${width}px window keeps the player and selection accessible`, async () => {
      await page.setViewportSize({ width, height });
      if (agentWidth > 0) await expect.poll(async () => Math.round((await agent.boundingBox())?.width ?? 0)).toBe(agentWidth);
      await expect(player).toBeInViewport({ ratio: 1 });
      await expect(choices.nth(1)).toBeInViewport({ ratio: 1 });
      if (agentWidth > 0) await expect(choices.last()).toBeInViewport({ ratio: 1 });
      const playerBounds = await player.boundingBox();
      const listBounds = await strip.boundingBox();
      const downloadBounds = await results.getByRole('button', { name: '下载片段' }).boundingBox();
      expect(playerBounds).not.toBeNull();
      expect(listBounds).not.toBeNull();
      expect(downloadBounds).not.toBeNull();
      const playerRight = playerBounds!.x + playerBounds!.width;
      expect(Math.abs(downloadBounds!.x + downloadBounds!.width - playerRight)).toBeLessThanOrEqual(2);
      if (agentWidth > 0) {
        expect(listBounds!.x - playerRight).toBeGreaterThan(0);
        expect(listBounds!.x - playerRight).toBeLessThanOrEqual(40);
        await expect(marker).toBeInViewport({ ratio: 1 });
      } else {
        expect(listBounds!.y).toBeGreaterThan(playerBounds!.y + playerBounds!.height);
      }
    });
  }

  await results.getByRole('button', { name: '新建切片' }).click();
  await expect(page).toHaveURL(/#\/workbench\?tool=auto-clips$/);
  await expect(page.getByRole('textbox', { name: '视频链接' })).toHaveValue('');
  await expect(page.getByRole('button', { name: '开始切片' })).toBeDisabled();
  await page.goBack();
  await expect(results.getByRole('button', { name: /^片段 1/ })).toHaveAttribute('aria-pressed', 'true');
});
