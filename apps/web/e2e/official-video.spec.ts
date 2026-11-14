import { test, expect } from './fixtures/runtime.js';
import type { CreatorJob, GatewayAccountState } from '@opencreator/protocol';

test('official video settings and single image input fit the workspace', async ({ page, runtime }, testInfo) => {
  const model = { id: 'seedance-2.5官方版', modality: 'video' as const, name: 'Seedance 2.5', capabilities: ['generate', 'image_to_video'], status: 'ready' as const,
    durations: Array.from({ length: 20 }, (_, index) => index + 4), resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1'],
    price: { version: 'video-v1', videoUnitsPerSecond: { '720p': 200_000_000 } },
    videoOptions: { profile: 'seedance', maxImages: 30, maxVideos: 10, maxAudios: 10, firstLastFrames: true, framesExclusive: true, generateAudio: false, referenceDuration: 0 } };
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'video-test', email: 'video@example.test', verified: true },
    bindingVersion: 'video:1', selectedModels: { video: model.id }, models: [model], activationError: null };
  await page.route('**/gateway/account', route => route.fulfill({ json: state }));
  await page.route('**/gateway/billing/summary', route => route.fulfill({ json: { balance: { availableUnits: '1000000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-15T00:00:00Z' }, subscription: null, billingAvailable: false } }));
  await page.addInitScript(() => localStorage.setItem('opencreator.agent-setup-confirmed.v1', '1'));
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-generation', state: { officialModels: { video: model.id }, prompt: '海边的一段连续镜头', provider: 'seedance', size: '720p@16:9', duration: 4, currentStep: 1, furthestStep: 1 }
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-generation&jobId=${job.id}`);
  await expect(page.getByRole('combobox', { name: '模型' })).toBeVisible();
  await expect(page.getByText(/本次消耗|This generation costs/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('official-video-settings.png'), fullPage: true });
  await expect(page.getByLabel('上传视频参考图')).toBeAttached();
  await expect(page.locator('.video-generation-reference-count')).toHaveText('0/1');
  await expect(page.getByLabel('上传视频参考图')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  await expect(page.getByLabel('上传参考视频')).toHaveCount(0);
  await expect(page.getByLabel('上传参考音频')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '参考模式' })).toHaveCount(0);
  await page.getByRole('button', { name: '视频设置' }).click();
  const settings = page.getByRole('dialog', { name: '视频设置' });
  await expect(settings.getByRole('slider', { name: '视频时长' })).toBeVisible();
  await expect(settings.getByRole('radiogroup', { name: '清晰度' }).getByRole('radio', { name: '1080p' })).toBeVisible();
  await settings.getByRole('slider', { name: '视频时长' }).fill('11');
  await expect(settings.getByRole('spinbutton', { name: '视频时长' })).toHaveValue('15');
  expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('official-video-settings-open.png'), fullPage: true });
  await page.keyboard.press('Escape');
  const reference = await page.locator('.video-generation-reference').boundingBox();
  const prompt = await page.getByRole('textbox', { name: '提示词' }).boundingBox();
  const actionBar = await page.locator('.video-generation-action-bar').boundingBox();
  const composer = await page.locator('.creator-tool-embedded .video-generation-composer').boundingBox();
  expect(reference && prompt && actionBar).toBeTruthy();
  if (testInfo.project.name === 'chromium-desktop') expect(composer?.height).toBe(248);
  else expect(composer!.height).toBeGreaterThan(248);
  expect(reference!.height).toBeGreaterThan(50);
  expect(prompt!.height).toBeGreaterThan(50);
  expect(reference!.y + reference!.height).toBeLessThanOrEqual(actionBar!.y + 1);
  expect(prompt!.y + prompt!.height).toBeLessThanOrEqual(actionBar!.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overlap = await page.locator('.video-generation-settings-grid label').evaluateAll(elements => elements.some(element => element.scrollWidth > element.clientWidth + 1));
  expect(overlap).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('official-video.png'), fullPage: true });
});

test('a new video defaults to Seedance 2.5 even when the account default is SD 2.0', async ({ page, runtime }) => {
  const models = [
    { id: 'SD2.0', name: 'SD 2.0', modality: 'video' as const, capabilities: ['generate'], sizes: ['480p@16:9'], durations: [5] },
    { id: 'seedance-2.5官方版', name: 'Seedance 2.5', modality: 'video' as const, capabilities: ['generate'], sizes: ['720p@16:9'], durations: [5] }
  ];
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'video-default-test', email: 'video@example.test', verified: true }, bindingVersion: 'video:1',
    selectedModels: { video: 'SD2.0' }, models, activationError: null };
  await page.route('**/gateway/account', route => route.fulfill({ json: state }));
  await page.route('**/gateway/billing/summary', route => route.fulfill({ json: { balance: { availableUnits: '1000000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-15T00:00:00Z' }, subscription: null, billingAvailable: false } }));
  await page.addInitScript(() => localStorage.setItem('opencreator.agent-setup-confirmed.v1', '1'));
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-generation', state: { prompt: 'A coastal tracking shot' }
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-generation&jobId=${job.id}`);
  await expect(page.getByRole('combobox', { name: '模型' })).toHaveValue('Seedance 2.5');
  await expect(page.getByRole('button', { name: '视频设置' })).toContainText('720p');
});
