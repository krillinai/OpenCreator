import { expect, test } from './fixtures/runtime.js';

test('image catalog loads on model open and a failed request leaves the composer unchanged', async ({ page, runtime }) => {
  await page.setViewportSize({ width: 1224, height: 768 });
  let catalogRequests = 0;
  await page.route('**/gateway/models/catalog', route => {
    catalogRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/dashboard`);
  const model = page.getByRole('combobox', { name: '模型' });
  await expect(model).toBeVisible();
  expect(catalogRequests).toBe(0);

  await model.click();
  await expect.poll(() => catalogRequests).toBe(1);
  await expect(page.getByRole('listbox', { name: '模型' }).getByRole('option')).toHaveCount(1);
  await expect(page.locator('.image-generation-catalog-status')).toHaveCount(0);
  await expect(page.getByText('图片模型目录加载失败')).toHaveCount(0);

  const controls = await page.locator('.image-generation-action-bar').evaluate(bar => {
    const box = (selector: string) => bar.querySelector(selector)!.getBoundingClientRect();
    const model = box('.image-generation-model-row');
    const settings = box('.image-generation-settings');
    const submit = box('.image-generation-submit-row');
    return {
      controlTopDifference: Math.max(model.top, settings.top, submit.top) - Math.min(model.top, settings.top, submit.top)
    };
  });
  expect(controls.controlTopDifference).toBeLessThan(2);

  await page.setViewportSize({ width: 390, height: 768 });
  const mobile = await page.locator('.image-generation-composer').evaluate(composer => ({
    editorHeight: composer.querySelector('.image-generation-editor')!.getBoundingClientRect().height,
    pageOverflows: document.documentElement.scrollWidth > window.innerWidth
  }));
  expect(mobile.editorHeight).toBeGreaterThanOrEqual(140);
  expect(mobile.pageOverflows).toBe(false);
});
