import type { CreatorJob, CreatorPresetListResponse } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

for (const item of [
  { module: 'image-generation', id: 'botanical-plate', tab: '图像设计', title: '虚构植物科学图版' },
  { module: 'video-generation', id: 'khachapuri-overhead-cooking', tab: '视频创作', title: '哈恰普里俯拍烹饪' }
] as const) {
  test(`${item.title}：卡片、详情和任务参数`, async ({ page, runtime }) => {
    const catalog = await runtime.api<CreatorPresetListResponse>('GET', '/creator/presets?locale=zh-CN');
    const preset = catalog.presets.find(candidate => candidate.module === item.module && candidate.id === item.id);
    expect(preset).toBeDefined();
    expect(preset!.prompt).toBeTruthy();
    expect(preset!.previewUrl).toBeTruthy();

    await runtime.openApp(page);
    await page.goto(`${runtime.origin}/#/new`);
    const skipSetup = page.getByRole('button', { name: '暂时跳过' });
    if (await skipSetup.isVisible()) await skipSetup.click();
    await page.getByRole('tab', { name: item.tab, exact: true }).click();
    const card = page.getByRole('button', { name: `查看${item.title}模板详情` });
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 960);
    await card.click();
    const detail = page.getByRole('dialog', { name: item.title });
    await expect(detail).toContainText('生成效果尚未在本模板中复测');
    await expect(detail.locator('.creator-template-prompt-card')).toContainText(preset!.prompt!.slice(0, 30));
    if (item.module === 'video-generation') {
      await expect(detail.locator('video')).toHaveAttribute('src', preset!.previewVideoUrl!);
    } else {
      await expect(detail.locator('.creator-template-outcome img')).toHaveJSProperty('naturalWidth', 1254);
    }

    await detail.getByRole('button', { name: '使用此模板' }).click();
    await expect(page).toHaveURL(new RegExp(`#\\/workbench\\?tool=${item.module}&jobId=`));
    const jobId = new URL(new URL(page.url()).hash.slice(1), runtime.origin).searchParams.get('jobId')!;
    const { job } = await runtime.api<{ job: CreatorJob }>('GET', `/creator/jobs/${jobId}`);
    expect(job.state.prompt).toBe(preset!.prompt);
    expect(job.presetOrigin).toMatchObject({ module: item.module, id: item.id, locale: 'zh-CN' });
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue(preset!.prompt!);
  });
}
