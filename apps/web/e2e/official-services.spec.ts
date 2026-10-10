import { test, expect } from './fixtures/runtime.js';
import { createDefaultCreatorServicesConfig, type GatewayAccountState } from '@opencreator/protocol';

test('登录只显示官方模型，退出登录后恢复用户配置', async ({ page, runtime }, testInfo) => {
  const custom = createDefaultCreatorServicesConfig();
  custom.llm = { source: 'custom', baseUrl: 'https://personal.example.test/v1', apiKey: 'personal-test-key', model: 'personal-model', jsonMode: true };
  custom.transcription.provider = 'openai';
  await runtime.api('PATCH', '/creator-services/config', custom);
  let state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'official-test', email: 'creator@example.test', verified: true }, bindingVersion: 'official-test:1', selectedModels: { text: 'vendor/text-first' }, models: [
    { id: 'vendor/text-first', modality: 'text', capabilities: ['responses'] },
    { id: 'vendor/text-second', modality: 'text', capabilities: ['responses'] },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `vendor/text-extra-${index}`, modality: 'text' as const, capabilities: ['responses'] })),
    { id: 'vendor/image', modality: 'image', capabilities: ['edit'] },
    { id: 'vendor/video', modality: 'video', capabilities: [] },
    { id: 'vendor/speech', modality: 'speech', capabilities: [] },
    { id: 'vendor/transcription', modality: 'transcription', capabilities: [] }
  ], activationError: null };
  await page.route('**/gateway/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/gateway/billing/summary')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ balance: { availableUnits: '1000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-08T00:00:00Z' }, subscription: null, billingAvailable: false }) });
      return;
    } else if (path.endsWith('/gateway/model')) {
      const body = route.request().postDataJSON(); state = { ...state, selectedModels: { ...state.selectedModels, [body.modality]: body.model } };
    } else if (path.endsWith('/gateway/auth/logout')) {
      state = { ...state, source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [] };
    } else if (path.endsWith('/gateway/auth/start')) {
      state = { ...state, source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'official-test', email: 'creator@example.test', verified: true }, bindingVersion: 'official-test:1', models: [{ id: 'vendor/text-first', modality: 'text', capabilities: ['responses'] }, { id: 'vendor/text-second', modality: 'text', capabilities: ['responses'] }] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ attemptId: 'mock', authorizationUrl: `${runtime.origin}/#/account`, expiresAt: '2099-01-01T00:00:00Z' }) });
      return;
    } else if (!path.endsWith('/gateway/account')) { await route.continue(); return; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.addInitScript(() => localStorage.setItem('opencreator.agent-setup-confirmed.v1', '1'));
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/settings?tab=ai-services`);
  const model = page.getByRole('combobox', { name: '文本模型' });
  await expect(model).toHaveValue('text-first');
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('API Key', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/OpenRouter/i)).toHaveCount(0);
  await model.click();
  await model.fill('text-second');
  await expect(page.getByRole('listbox', { name: '文本模型' }).getByRole('option')).toHaveCount(1);
  await page.getByRole('option', { name: 'text-second', exact: true }).click();
  await expect(model).toHaveValue('text-second');
  await page.screenshot({ path: testInfo.outputPath('official-models.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '自定义配置', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '常规', exact: true }).click();
  const proxy = page.getByRole('textbox', { name: '网络代理', exact: true });
  await expect(proxy).toBeEnabled();
  await proxy.fill('http://127.0.0.1:8888');
  await page.getByRole('button', { name: '保存网络代理', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存网络代理', exact: true })).toBeDisabled();
  expect(await runtime.api('GET', '/creator-services/network')).toEqual({ proxy: 'http://127.0.0.1:8888' });
  await page.screenshot({ path: testInfo.outputPath('general-network.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`${runtime.origin}/#/account`);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.goto(`${runtime.origin}/#/settings?tab=ai-services`);
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('https://personal.example.test/v1');
  await expect(page.getByLabel('API Key', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('custom-services.png'), fullPage: true });
  await page.goto(`${runtime.origin}/#/account`);
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
  await page.goto(`${runtime.origin}/#/settings?tab=ai-services`);
  await expect(model).toHaveValue('text-second');
  await expect(page.getByLabel('Base URL', { exact: true })).toHaveCount(0);
  const saved = await runtime.api<{ config: typeof custom; configuredCredentials: string[] }>('GET', '/creator-services/config');
  expect(saved.config.llm.baseUrl).toBe(custom.llm.baseUrl);
  expect(saved.configuredCredentials).toContain('llm.apiKey');
  expect(saved.config.proxy).toBe('http://127.0.0.1:8888');
});
