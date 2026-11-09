import type { CreatorArtifact, CreatorJob, GatewayAccountState } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('配音设置控件对齐，字幕烧录默认开启且可关闭', async ({ page, runtime }, testInfo) => {
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-translation',
    templateVersion: 2,
    creationKey: 'burn-subtitles-settings',
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=OpenCreatorBurnSubtitlesE2E',
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      dubbing: true,
      composeVideo: true,
      workspacePhase: 'result',
      resultVersion: 1
    }
  });
  const target: CreatorArtifact = {
    id: 'aligned-target', jobId: job.id, kind: 'target_subtitle', version: 1,
    status: 'completed', path: null, scopeKey: null, inputFingerprint: null, sha256: null,
    sourceArtifactIds: [], createdAt: job.createdAt,
    metadata: { resultVersion: 1, fileName: 'aligned.srt', cues: [{ id: 1,
      start: '00:00:00,000', end: '00:00:01,000', text: '配音字幕' }] }
  };
  const completed: CreatorJob = { ...job, status: 'completed', artifacts: [target], state: {
    ...job.state, resultSnapshots: [{ version: 1, createdAt: job.createdAt,
      action: 'stage-succeeded', stageId: 'subtitle', description: 'Translated',
      artifactRefs: { target_subtitle: [target.id] }, changedArtifactIds: [target.id],
      staleArtifactIds: [], state: job.state }]
  } };
  await page.route(`**/creator/jobs/${job.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { job: completed } }) : route.continue());
  await page.route(`**/creator/jobs/${job.id}/actions`, route => {
    const request = route.request().postDataJSON();
    completed.state = { ...completed.state, ...request.input?.patch };
    completed.revision++;
    return route.fulfill({ json: { job: completed, receipt: {
      actor: 'user', action: request.action, summary: 'Updated settings',
      affectedArtifacts: [], newRevision: completed.revision, createdAt: job.createdAt
    } } });
  });
  await page.route('**/video-metadata?*', route => route.fulfill({
    json: { platform: 'youtube', title: 'Subtitle fixture', width: 1920, height: 1080 }
  }));
  const gateway: GatewayAccountState = {
    source: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'layout-test', email: 'layout@example.test', verified: true },
    bindingVersion: 'layout-test:1', activationError: null,
    selectedModels: { speech: 'grok-tts' },
    models: [
      { id: 'grok-tts', modality: 'speech', capabilities: [], voices: ['eve', 'alloy'] },
      { id: 'openai-tts', modality: 'speech', capabilities: [], voices: ['alloy'] }
    ]
  };
  await page.route('**/gateway/account*', route => route.fulfill({ json: gateway }));
  await page.route('**/gateway/auth/check', route => route.fulfill({ json: gateway }));
  await page.route('**/gateway/billing/summary', route => route.fulfill({ json: {
    balance: { availableUnits: '1000000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-15T00:00:00Z' },
    subscription: null, billingAvailable: false
  } }));
  await page.addInitScript(() => localStorage.setItem('opencreator.agent-setup-confirmed.v1', '1'));

  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${encodeURIComponent(job.id)}`);
  await page.getByRole('tab', { name: '配音' }).click();
  const dubbingSettings = page.locator('.video-translation-dubbing-settings');
  await expect(dubbingSettings.getByRole('combobox', { name: '语音合成模型' })).toHaveValue('grok-tts');
  const modelControl = dubbingSettings.locator('.creator-tool-field :is(.official-model-control, .official-model-value), .video-translation-voice-source > div');
  const voiceControl = dubbingSettings.locator('.tts-voice-select');
  const voiceActions = dubbingSettings.locator('.tts-voice-picker-actions');
  await expect(modelControl).toBeVisible();
  await expect(voiceControl).toBeVisible();
  const bounds = await Promise.all([modelControl, voiceControl, voiceActions].map(locator => locator.boundingBox()));
  const [model, voice, actions] = bounds;
  expect(model && voice && actions).toBeTruthy();
  expect(Math.abs(model!.x - voice!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(model!.width - voice!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(model!.height - voice!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(actions!.y - voice!.y)).toBeLessThanOrEqual(1);
  const [enableLabel, modelLabel, voiceLabel, burnLabel, enableSwitch, burnSwitch] = await Promise.all([
    dubbingSettings.getByText('启用配音', { exact: true }),
    dubbingSettings.locator('.video-translation-voice-source > span, .creator-tool-field > span').first(),
    dubbingSettings.locator('.tts-voice-picker-field > span'),
    dubbingSettings.getByText('烧录字幕', { exact: true }),
    dubbingSettings.getByRole('switch', { name: '启用配音' }),
    dubbingSettings.getByRole('switch', { name: '烧录字幕' })
  ].map(locator => locator.boundingBox()));
  expect(enableLabel && modelLabel && voiceLabel && burnLabel && enableSwitch && burnSwitch).toBeTruthy();
  for (const label of [modelLabel!, voiceLabel!, burnLabel!]) {
    expect(Math.abs(label.x - enableLabel!.x)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs((enableSwitch!.x + enableSwitch!.width) - (burnSwitch!.x + burnSwitch!.width))).toBeLessThanOrEqual(1);
  await dubbingSettings.screenshot({ path: testInfo.outputPath('dubbing-settings.png') });
  const burnSubtitles = page.getByRole('switch', { name: '烧录字幕' });
  await expect(burnSubtitles).toBeVisible();
  await expect(burnSubtitles).toBeChecked();
  await burnSubtitles.click();
  await expect(burnSubtitles).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1);

  await page.getByRole('tab', { name: '字幕样式' }).click();
  await page.getByRole('button', { name: '自定义样式' }).click();
  const drawer = page.getByRole('dialog', { name: '自定义字幕样式' });
  const font = drawer.getByRole('combobox', { name: '字幕字体' });
  await font.click();
  const rounded = page.getByRole('option', { name: '圆体' });
  await expect(rounded).toBeVisible();
  expect(await rounded.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await rounded.click();
  await expect(font).toHaveAttribute('data-value', 'rounded');
  await drawer.getByRole('combobox', { name: '字幕字重' }).click();
  await page.getByRole('option', { name: '常规' }).click();
  await drawer.getByRole('combobox', { name: '字幕大小' }).click();
  await page.getByRole('option', { name: '小' }).click();
  for (const [label, color] of [
    ['译文颜色', '#7EE7FF'],
    ['原文颜色', '#FFE45C'],
    ['描边颜色', '#FFFFFF'],
    ['阴影颜色', '#A7F3D0']
  ] as const) {
    await drawer.getByRole('button', { name: `选择${label}` }).click();
    const palette = page.getByRole('dialog', { name: `${label}色板` });
    const swatch = palette.getByRole('button', { name: label === '译文颜色' ? color : `${label} ${color}` });
    await expect(swatch).toBeVisible();
    await swatch.click();
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
    await palette.getByRole('button', { name: '关闭色板' }).click();
  }
  await drawer.getByRole('spinbutton', { name: '描边宽度' }).fill('4');
  await drawer.getByRole('spinbutton', { name: '字幕高度' }).fill('40');
  await drawer.getByRole('spinbutton', { name: '不透明度' }).fill('0.4');
  await drawer.getByRole('spinbutton', { name: '水平偏移' }).fill('-4');
  await drawer.getByRole('spinbutton', { name: '垂直偏移' }).fill('6');
  await drawer.getByRole('spinbutton', { name: '模糊' }).fill('2.5');
  await drawer.getByRole('button', { name: '完成' }).click();
  await expect.poll(() => completed.state.subtitleStyle).toMatchObject({
    fontPreset: 'rounded', fontWeight: 'regular', fontSize: 'small',
    primaryColor: '#7EE7FF', secondaryColor: '#FFE45C', outlineColor: '#FFFFFF', outlineWidth: 4,
    verticalOffset: 40,
    shadow: { enabled: true, color: '#A7F3D0', opacity: 0.4, offsetX: -4, offsetY: 6, blur: 2.5 }
  });
});
