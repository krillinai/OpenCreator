import type { CreatorJob } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

const poster = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B2kAAAAASUVORK5CYII=',
  'base64'
);

test('字幕样式预览显示视频封面并按源比例或竖屏输出比例排版', async ({ page, runtime }) => {
  await page.route('**/video-metadata?*', route => route.fulfill({
    json: {
      platform: 'bilibili',
      title: '4:3 source',
      thumbnailUrl: 'https://images.example.test/source.png',
      width: 1024,
      height: 768
    }
  }));
  await page.route('https://images.example.test/source.png', route => route.fulfill({
    body: poster,
    contentType: 'image/png'
  }));
  const job = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-translation',
    templateVersion: 1,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.bilibili.com/video/BV1abc123',
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      currentStep: 2,
      furthestStep: 2,
      workspacePhase: 'configure'
    },
    creationKey: 'style-preview-ratio'
  }).then(response => response.job);

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${encodeURIComponent(job.id)}`);
  const preview = page.getByRole('region', { name: '字幕样式预览' });
  const image = preview.locator('img.video-translation-subtitle-preview-media');
  const frame = preview.locator(':scope > div');
  const settings = page.locator('.video-translation-wizard-main .video-translation-wizard-body');
  await expect(preview).toHaveAttribute('data-ratio', '4:3');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expect.poll(() => settings.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(720);
  expect(await frame.evaluate(element => {
    const overlay = getComputedStyle(element, '::after');
    const cues = element.querySelector('.video-translation-subtitle-preview-cues');
    return {
      background: overlay.backgroundColor,
      overlayLayer: overlay.zIndex,
      cueLayer: cues === null ? '' : getComputedStyle(cues).zIndex
    };
  })).toEqual({ background: 'rgba(0, 0, 0, 0.55)', overlayLayer: '1', cueLayer: '2' });
  const sourceBox = await frame.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(sourceBox!.width / sourceBox!.height).toBeCloseTo(4 / 3, 1);

  await page.setViewportSize({ width: 1100, height: 800 });
  expect(await settings.evaluate(element => {
    const container = element.closest('.video-translation-wizard-main');
    return container !== null && element.getBoundingClientRect().width <= container.getBoundingClientRect().width;
  })).toBe(true);

  await page.getByRole('button', { name: '继续' }).click();
  await page.getByRole('switch', { name: '合成字幕视频' }).click();
  await page.getByRole('radio', { name: /9:16/ }).click();
  await page.getByRole('navigation', { name: '翻译流程' }).getByRole('button', { name: /字幕样式$/ }).click();
  await expect(preview).toHaveAttribute('data-ratio', '9:16');
  await expect(preview).toHaveAttribute('data-converted', 'true');
  const verticalBox = await frame.boundingBox();
  expect(verticalBox).not.toBeNull();
  expect(verticalBox!.width / verticalBox!.height).toBeCloseTo(9 / 16, 1);
});
