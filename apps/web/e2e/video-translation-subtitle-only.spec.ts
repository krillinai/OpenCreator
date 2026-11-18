import type { CreatorJob } from '@opencreator/protocol';
import { expect, test } from './fixtures/runtime.js';

test('standalone SRT uses two steps and opens an editable result without video', async ({ page, runtime }, testInfo) => {
  const { job } = await runtime.api<{ job: CreatorJob }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'video-translation', templateVersion: 2,
    creationKey: 'standalone-srt', state: { sourceLanguage: 'en', targetLanguage: 'zh_cn' }
  });
  await page.addInitScript(({ projectId, threadId }) => {
    localStorage.setItem('opencreator.preferences.dynamicBackground', 'false');
    localStorage.setItem('opencreator.preferences.language', 'zh-CN');
    localStorage.setItem('opencreator.navigation.v3', JSON.stringify({ currentProjectId: projectId, selectedThreadId: threadId }));
  }, { projectId: runtime.projectId, threadId: runtime.ordinaryThreadId });
  await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${encodeURIComponent(job.id)}`);
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
  const creatorTab = page.getByRole('tab', { name: '创作', exact: true });
  if (await creatorTab.isVisible()) await creatorTab.click();
  const workspace = page.getByRole('region', { name: '视频翻译操作区' });
  await workspace.getByRole('tab', { name: '翻译字幕', exact: true }).click();
  await expect(workspace.getByRole('navigation', { name: '翻译流程' }).locator('li')).toHaveCount(2);
  await workspace.getByLabel('UTF-8 SRT 文件').setInputFiles({
    name: 'lecture.en.srt', mimeType: 'application/x-subrip',
    buffer: Buffer.from('1\n00:00:02,250 --> 00:00:04,750\nWelcome to OpenCreator.\n\n2\n00:00:05,000 --> 00:00:07,500\nKeep the original timeline.\n')
  });
  await expect(workspace.getByText(/本地导入 · lecture.en.srt/)).toBeVisible();
  await expect(workspace.locator('.video-translation-subtitle-import pre')).toBeVisible();
  await expect(workspace.locator('.video-translation-subtitle-import pre')).toContainText('Welcome to OpenCreator.');
  await expect(workspace.locator('.video-translation-subtitle-import pre')).toContainText('00:00:02,250');
  await workspace.getByRole('button', { name: '继续', exact: true }).click();
  await expect(workspace.getByRole('button', { name: '开始翻译', exact: true })).toBeVisible();
  await expect(workspace.getByRole('switch', { name: '优先使用平台字幕' })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: /视频与字幕/ })).toHaveCount(0);
  await expect.poll(async () => (await runtime.api<{ job: CreatorJob }>('GET', `/creator/jobs/${job.id}`)).job.state.currentStep).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('subtitle-only-settings.png'), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
  if (await creatorTab.isVisible()) await creatorTab.click();
  await expect(workspace.getByRole('button', { name: '开始翻译', exact: true })).toBeVisible();
  const saved = (await runtime.api<{ job: CreatorJob }>('GET', `/creator/jobs/${job.id}`)).job;
  expect(saved.state.sourceType).toBe('subtitle');
  expect(saved.stages).toHaveLength(0);
  const source = saved.artifacts.find(artifact => artifact.id === saved.state.importedSourceSubtitleId)!;
  const target = { ...source, id: 'translated-srt', kind: 'target_subtitle', metadata: {
    resultVersion: 2, fileName: 'lecture.zh.srt', cues: [
      { id: 1, start: '00:00:02,250', end: '00:00:04,750', text: '欢迎使用 OpenCreator。' },
      { id: 2, start: '00:00:05,000', end: '00:00:07,500', text: '保留原始时间轴。' }
    ]
  } };
  const bilingual = { ...target, id: 'bilingual-srt', kind: 'bilingual_subtitle', metadata: { ...target.metadata, fileName: 'lecture.bilingual.srt' } };
  const completed: CreatorJob = { ...saved, revision: saved.revision + 1, status: 'completed', artifacts: [...saved.artifacts, target, bilingual], state: {
    ...saved.state, resultVersion: 2, workspacePhase: 'result', resultSnapshots: [{
      version: 2, createdAt: saved.updatedAt, action: 'stage-succeeded', stageId: 'subtitle', description: '字幕翻译',
      artifactRefs: { source_subtitle: [source.id], target_subtitle: [target.id], bilingual_subtitle: [bilingual.id] },
      changedArtifactIds: [target.id, bilingual.id], staleArtifactIds: [], state: saved.state
    }]
  } };
  await page.route(`**/creator/jobs/${job.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ json: { job: completed } }) : route.continue());
  await page.route(`**/creator/jobs/${job.id}/artifacts/${target.id}/content`, route => route.fulfill({
    contentType: 'application/x-subrip', body: '1\n00:00:02,250 --> 00:00:04,750\n欢迎使用 OpenCreator。\n'
  }));
  await page.reload();
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
  if (await creatorTab.isVisible()) await creatorTab.click();
  await expect(workspace.getByRole('tab', { name: '字幕', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(workspace.getByRole('textbox', { name: '字幕原文 1', exact: true })).toHaveValue('Welcome to OpenCreator.');
  await expect(workspace.getByRole('textbox', { name: '字幕 1', exact: true })).toHaveValue('欢迎使用 OpenCreator。');
  await expect(workspace.locator('video')).toHaveCount(0);
  await expect(workspace.getByRole('tab', { name: '作品', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('tab', { name: '配音', exact: true })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: '双语 SRT' })).toBeEnabled();
  const downloadEvent = page.waitForEvent('download');
  await workspace.getByRole('button', { name: '译文 SRT' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('lecture.zh.srt');
  await workspace.getByRole('textbox', { name: '字幕 1', exact: true }).fill('欢迎使用 OpenCreator 字幕翻译。');
  await expect(workspace.getByRole('button', { name: '保存字幕', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('subtitle-only-editor.png'), fullPage: true, animations: 'disabled' });
});
