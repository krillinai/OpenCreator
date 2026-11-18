import type { CreatorJob } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('download formats fill the workbench from both a direct link and generation history', async ({ page, runtime }, testInfo) => {
  const sourceUrl = 'https://www.youtube.com/watch?v=subtitle-demo';
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-download', creationKey: 'subtitle-layout', state: { sourceUrl }
  });
  const probe: CreatorJob['artifacts'][number] = {
    id: 'subtitle-probe', jobId: job.id, kind: 'download_probe', status: 'completed', version: 1,
    path: null, scopeKey: null, inputFingerprint: null, sha256: null, sourceArtifactIds: [], createdAt: new Date().toISOString(),
    metadata: {
      id: 'subtitle-demo', title: 'YouTube subtitle demo', requestedUrl: sourceUrl, url: sourceUrl, platform: 'youtube',
      uploader: 'OpenCreator', thumbnailUrl: null, duration: 90, width: 1920, height: 1080, formats: [],
      options: [
        { id: 'video-1080', mediaType: 'video', container: 'mp4', height: 1080 },
        { id: 'audio-mp3', mediaType: 'audio', container: 'mp3', bitrateKbps: 192 },
        { id: 'subtitle-manual-en', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'en', subtitleName: 'English', subtitleSource: 'manual' },
        { id: 'subtitle-automatic-zh-Hans', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'zh-Hans', subtitleName: 'Chinese (Simplified)', subtitleSource: 'automatic' }
      ]
    }
  };
  const snapshot: CreatorJob = { ...job, status: 'needs_input', artifacts: [probe] };
  await page.route(/\/creator\/jobs(?:\?.*)?$/, async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { jobs: [snapshot] } });
    else await route.continue();
  });
  await page.route(`**/creator/jobs/${job.id}`, async route => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { job: snapshot } });
    else await route.continue();
  });
  await page.addInitScript(({ projectId, threadId }) => {
    localStorage.setItem('opencreator.preferences.dynamicBackground', 'false');
    localStorage.setItem('opencreator.preferences.language', 'zh-CN');
    localStorage.setItem('opencreator.navigation.v3', JSON.stringify({ currentProjectId: projectId, selectedThreadId: threadId }));
  }, { projectId: runtime.projectId, threadId: runtime.ordinaryThreadId });
  await page.goto(`${runtime.origin}/#/workbench?tool=video-download&jobId=${encodeURIComponent(job.id)}`);
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'MP4 视频' })).toBeVisible();
  const workspace = page.locator('.video-download-workspace-page');
  const shell = page.locator('.opencreator-shell');
  const workbenchBounds = async () => {
    const bounds = await workspace.boundingBox();
    return bounds && [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
  };
  const bounds = (await shell.boundingBox())!;
  const fullWidthBounds = [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round);
  await expect.poll(workbenchBounds).toEqual(fullWidthBounds);
  await expect(page.getByRole('button', { name: '生成记录' })).toBeHidden();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('link', { name: '待配置 YouTube subtitle demo' }).click();
  await expect(page.getByRole('tab', { name: 'MP4 视频' })).toBeVisible();
  await expect.poll(workbenchBounds).toEqual(fullWidthBounds);
  await expect(page.getByRole('button', { name: '生成记录' })).toBeHidden();

  await expect(page.getByRole('tab', { name: 'MP3 音频' })).toBeVisible();
  const subtitles = page.getByRole('tab', { name: 'SRT 字幕' });
  await subtitles.click();
  await expect(subtitles).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('SRT · 人工字幕 · en')).toBeVisible();
  await expect(page.getByText('SRT · 自动字幕 · zh-Hans')).toBeVisible();
  await expect(page.getByRole('button', { name: '下载 English' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '下载 Chinese (Simplified)' })).toBeEnabled();
  await expect(page.getByRole('tab', { name: 'MP4 视频' })).toHaveAttribute('aria-selected', 'false');
  const tabStyles = await page.getByRole('tablist', { name: '下载格式' }).evaluate(element => [...element.querySelectorAll('button')].map(button => ({
    label: button.textContent, selected: button.getAttribute('aria-selected'), background: getComputedStyle(button).backgroundColor
  })));
  await testInfo.attach('download-tab-styles', { body: JSON.stringify(tabStyles, null, 2), contentType: 'application/json' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('video-download-subtitles.png'), fullPage: true, animations: 'disabled' });
});

test('video download platforms stay centered and wrap within the full workspace width', async ({ page, runtime }, testInfo) => {
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-download',
    creationKey: 'video-download-layout'
  });

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-download&jobId=${encodeURIComponent(job.id)}`);

  const stack = page.locator('.video-download-workspace-page .creator-tool-stack');
  const platforms = page.getByRole('list', { name: '支持的平台' });
  const items = platforms.locator('li');
  await expect(items).toHaveCount(10);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('video-download-layout.png'), fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1000 });
  const wide = await platforms.evaluate(element => {
    const list = element.getBoundingClientRect();
    const itemBoxes = [...element.querySelectorAll('li')].map(item => item.getBoundingClientRect());
    return {
      listCenter: list.x + list.width / 2,
      itemsCenter: (itemBoxes[0]!.left + itemBoxes.at(-1)!.right) / 2,
      rowTops: [...new Set(itemBoxes.map(box => Math.round(box.top)))],
      loadedIcons: [...element.querySelectorAll<HTMLImageElement>('img')].every(image => image.naturalWidth > 0)
    };
  });
  const contentWidth = await page.locator('.video-download-workspace-page .creator-workspace-content').evaluate(element => {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
  // clientWidth excludes the scrollbar gutter and rounds fractional CSS pixels.
  expect(Math.round(await stack.evaluate(element => element.getBoundingClientRect().width))).toBe(Math.round(contentWidth));
  expect(wide.rowTops).toHaveLength(1);
  expect(Math.abs(wide.itemsCenter - wide.listCenter)).toBeLessThan(2);
  expect(wide.loadedIcons).toBe(true);

  await page.setViewportSize({ width: 1000, height: 800 });
  const narrow = await platforms.evaluate(element => {
    const list = element.getBoundingClientRect();
    const itemBoxes = [...element.querySelectorAll('li')].map(item => item.getBoundingClientRect());
    return {
      rowTops: [...new Set(itemBoxes.map(box => Math.round(box.top)))],
      withinBounds: itemBoxes.every(box => box.left >= list.left && box.right <= list.right)
    };
  });
  expect(narrow.rowTops.length).toBeGreaterThan(1);
  expect(narrow.withinBounds).toBe(true);
});
