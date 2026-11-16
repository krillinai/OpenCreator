import { expect, test } from './fixtures/runtime.js';

test('dashboard translation model selector and local configuration stay on one row', async ({ page, runtime }) => {
  let finishCatalog!: () => void;
  const catalogPending = new Promise<void>(resolve => { finishCatalog = resolve; });
  await page.route('**/gateway/models/catalog?modality=text', async route => {
    await catalogPending;
    await route.fulfill({ json: { models: [] } });
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/dashboard`);
  await page.getByRole('button', { name: /视频翻译|Video Translation/ }).click();

  const bar = page.locator('.dashboard-translation-action-bar');
  const selector = bar.getByRole('combobox', { name: /翻译模型|Translation model/ });
  const configure = bar.getByRole('button', { name: /设置翻译模型|Configure translation model/ });
  try {
    await expect(selector).toBeVisible();
    await expect(configure).toBeVisible();
    await expect(bar.locator('.dashboard-translation-catalog-status')).toBeVisible();

    const selectBox = await selector.boundingBox();
    const configureBox = await configure.boundingBox();
    expect(selectBox).not.toBeNull();
    expect(configureBox).not.toBeNull();
    expect(Math.abs(selectBox!.y + selectBox!.height / 2 - configureBox!.y - configureBox!.height / 2)).toBeLessThan(2);
    expect(configureBox!.width).toBeLessThanOrEqual(40);
    expect(configureBox!.x).toBeGreaterThanOrEqual(selectBox!.x + selectBox!.width);

    if (page.viewportSize()!.width > 760) {
      const settingsBox = await bar.getByRole('button', { name: /翻译设置|Translation settings/ }).boundingBox();
      expect(settingsBox).not.toBeNull();
      expect(Math.abs(selectBox!.y + selectBox!.height / 2 - settingsBox!.y - settingsBox!.height / 2)).toBeLessThan(2);
    }
  } finally {
    finishCatalog();
  }
});
