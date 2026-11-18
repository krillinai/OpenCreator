import { expect, test } from './fixtures/runtime.js';

test('offers Agent onboarding once even when the first window closes without finishing', async ({ browser, page, runtime }) => {
  await page.goto(`${runtime.origin}/#/chat`);
  const setup = page.getByRole('region', { name: 'Get started with Agent' });
  await setup.getByRole('button', { name: 'Local mode', exact: true }).click();
  await expect(setup.getByRole('button', { name: 'Use local Codex and continue' })).toBeVisible();
  await page.close();

  const nextContext = await browser.newContext({ locale: 'en-US' });
  try {
    const nextPage = await nextContext.newPage();
    await nextPage.goto(`${runtime.origin}/#/chat`);
    await expect(nextPage.locator('.opencreator-shell')).toBeVisible();
    await expect(nextPage.getByRole('region', { name: 'Get started with Agent' })).toHaveCount(0);
  } finally {
    await nextContext.close();
  }
});
