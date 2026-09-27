import type { CreatorJob } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('video download platforms stay centered and wrap within translation-sized settings', async ({ page, runtime }) => {
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
  await expect(items).toHaveCount(9);

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
  expect(await stack.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(960, 0);
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
