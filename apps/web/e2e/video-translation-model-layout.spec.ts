import { expect, test } from './fixtures/runtime.js';

test('dashboard translation model selector and local configuration stay on one row', async ({ page, runtime }) => {
  let catalogRequests = 0;
  await page.route('**/gateway/models/catalog?modality=text', route => {
    catalogRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/dashboard`);
  await page.getByRole('button', { name: /视频翻译|Video Translation/ }).click();

  const bar = page.locator('.dashboard-translation-action-bar');
  const selector = bar.getByRole('combobox', { name: /翻译模型|Translation model/ });
  const configure = bar.getByRole('button', { name: /设置翻译模型|Configure translation model/ });
  await expect(selector).toBeVisible();
  await expect(configure).toBeVisible();
  expect(catalogRequests).toBe(0);
  await expect(bar.locator('.dashboard-translation-catalog-status')).toHaveCount(0);

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

  await selector.click();
  await expect.poll(() => catalogRequests).toBe(1);
  await expect(bar.locator('.dashboard-translation-catalog-status')).toHaveCount(0);
  await expect(page.getByText('模型列表加载失败，请重试。')).toHaveCount(0);
});
