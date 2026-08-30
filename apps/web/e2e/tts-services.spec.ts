import { expect, test, type Page } from './fixtures/runtime.js';

test('统一配音配置在设置、智能配音和视频翻译中保持一致', async ({ page, runtime }) => {
  await page.route('**/.opencreator/runtime/creator-services/tts/voices?**', async route => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get('provider');
    if (provider === 'aliyun') {
      await route.fulfill({
        json: {
          provider,
          model: url.searchParams.get('model') ?? 'qwen3-tts-flash',
          voices: [
            { id: 'Cherry', name: 'Cherry', provider, kind: 'builtin' },
            { id: 'Kiki', name: 'Kiki', provider, kind: 'builtin' }
          ]
        }
      });
      return;
    }
    await route.fulfill({
      json: {
        provider: provider ?? 'openai',
        model: url.searchParams.get('model') ?? 'gpt-4o-mini-tts',
        voices: [{
          id: 'marin',
          name: 'Marin',
          provider: provider ?? 'openai',
          kind: 'builtin'
        }]
      }
    });
  });
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/settings?tab=ai-services&section=tts`);
  await expect(page.getByRole('heading', { name: 'AI 服务' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '配音服务' }))
    .toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Codex Agent' })).toHaveCount(0);
  const providerSelect = page.getByRole('combobox', { name: '服务商' });
  await expect(providerSelect).toHaveText('OpenAI TTS');
  await expect(page.getByRole('combobox', { name: '默认音色' })).toHaveValue('marin');

  await providerSelect.click();
  await page.getByRole('option', { name: '阿里云百炼' }).click();
  await expect(providerSelect).toHaveText('阿里云百炼');
  await expect(page.getByLabel('Base URL')).toHaveValue('https://dashscope.aliyuncs.com/api/v1');
  await expect(page.getByLabel('模型')).toHaveValue('qwen3-tts-flash');
  await expect(page.getByLabel('API Key')).toBeVisible();
  await expect(page.getByLabel('Access Key ID')).toHaveCount(0);
  await expect(page.getByLabel('Access Key Secret')).toHaveCount(0);
  await expect(page.getByLabel('App Key')).toHaveCount(0);

  const defaultVoice = page.getByRole('combobox', { name: '默认音色' });
  await expect(defaultVoice).toHaveValue('Cherry');
  await expect.poll(async () => defaultVoice.locator('option').allTextContents())
    .toEqual(expect.arrayContaining([
      expect.stringContaining('Cherry'),
      expect.stringContaining('Kiki')
    ]));

  await page.getByLabel('API Key').fill('e2e-aliyun-api-key');
  await defaultVoice.selectOption('Kiki');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByText('配置已安全保存')).toBeVisible();

  const saved = await runtime.api<{
    config: {
      tts: {
        provider: string;
        aliyun: {
          baseUrl: string;
          apiKey: string;
          model: string;
          defaultVoiceId: string;
        };
      };
    };
    configuredCredentials: string[];
  }>('GET', '/creator-services/config');
  expect(saved.config.tts).toMatchObject({
    provider: 'aliyun',
    aliyun: {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: '',
      model: 'qwen3-tts-flash',
      defaultVoiceId: 'Kiki'
    }
  });
  expect(saved.configuredCredentials).toContain('tts.aliyun.apiKey');

  await page.goto(`${runtime.origin}/#/workbench?tool=smart-dubbing`);
  await expect(page.getByRole('heading', { name: '智能配音' })).toBeVisible();
  await page.getByRole('textbox', { name: '配音文案内容' }).fill('这是统一配音配置的端到端验证。');
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.locator('.smart-dubbing-provider-row')).toContainText('阿里云百炼');
  await expect(page.locator('.smart-dubbing-provider-row')).toContainText('qwen3-tts-flash');
  await expect(page.getByRole('combobox', { name: '配音音色' })).toHaveValue('Kiki');

  const translationJob = await runtime.api<{
    job: { id: string };
  }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-translation',
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=OpenCreatorTtsE2E',
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      dubbing: true,
      currentStep: 3,
      furthestStep: 3
    }
  });
  await page.goto(
    `${runtime.origin}/#/workbench?tool=video-translation&jobId=${encodeURIComponent(translationJob.job.id)}`
  );
  await expect(page.getByRole('heading', { name: '视频翻译配音' })).toBeVisible();
  await expect(page.locator('.video-translation-voice-source')).toContainText('阿里云百炼');
  await expect(page.locator('.video-translation-voice-source')).toContainText('qwen3-tts-flash');
  await expect(page.getByRole('combobox', { name: '配音音色' })).toHaveValue('Kiki');

  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${encodeURIComponent(translationJob.job.id)}`);
    return response.job.state;
  }).toMatchObject({
    ttsProvider: 'aliyun',
    ttsModel: 'qwen3-tts-flash',
    voiceCode: 'Kiki'
  });

  await expectNoHorizontalOverflow(page);
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowingElements: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(element => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1);
      })
      .slice(0, 10)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        className: element.className,
        text: element.textContent?.trim().slice(0, 80) ?? ''
      }))
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.overflowingElements).toEqual([]);
}
