import type { CreatorPresetListResponse } from '@opencreator/protocol';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/runtime.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
let catalogRoot: string;
let previousCatalogRoot: string | undefined;

test.beforeAll(() => {
  previousCatalogRoot = process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT;
  catalogRoot = mkdtempSync(join(tmpdir(), 'opencreator-cover-filter-'));
  execFileSync(process.execPath, [
    '--import', 'tsx', 'apps/daemon/scripts/creator-presets.ts', 'compile'
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OPENCREATOR_PRESET_SOURCE_ROOT: join(repositoryRoot, 'template'),
      OPENCREATOR_PRESET_CATALOG_ROOT: catalogRoot
    }
  });
  process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT = catalogRoot;
});

test.afterAll(() => {
  if (previousCatalogRoot === undefined) {
    delete process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT;
  } else {
    process.env.OPENCREATOR_E2E_PRESET_CATALOG_ROOT = previousCatalogRoot;
  }
  if (catalogRoot !== undefined) rmSync(catalogRoot, { recursive: true, force: true });
});

test('已撤下的两张封面不再出现在视频封面筛选中', async ({
  page,
  runtime
}) => {
  const catalog = await runtime.api<CreatorPresetListResponse>(
    'GET', '/creator/presets?locale=zh-CN'
  );
  const coverIds = [
    'images-go-hard-thumbnail'
  ];
  const covers = coverIds.map(id => {
    const cover = catalog.presets.find(preset => (
      preset.module === 'cover-generator' && preset.id === id && preset.version === 1
    ));
    expect(cover, `catalog 缺少 cover-generator/${id}/1`).toBeDefined();
    return cover!;
  });

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/new`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  const coverFilter = page.getByRole('button', { name: '视频封面', exact: true });
  if (await coverFilter.count() === 0) {
    await page.getByRole('button', { name: '更多' }).click();
  }
  await coverFilter.click();

  for (const cover of covers) {
    const card = page.locator(`[data-preset-id="cover-generator/${cover.id}/1"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(cover.title);
    await expect.poll(async () => card.locator('img').evaluate(image => (
      image.complete && image.naturalWidth > 0
    ))).toBe(true);
  }
  await expect(page.locator('[data-preset-id^="cover-generator/"]')).toHaveCount(1);
  for (const id of ['bilibili-red-blue-white', 'psychology', 'wealth-platinum-red']) {
    expect(catalog.presets.some(preset => preset.module === 'cover-generator' && preset.id === id))
      .toBe(false);
    await expect(page.locator(`[data-preset-id="cover-generator/${id}/1"]`)).toHaveCount(0);
  }
});
