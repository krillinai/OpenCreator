import { test, expect } from './fixtures/runtime.js';

test('工作台模板新建 Creator Job，刷新和最近项目精确恢复历史且不启动普通 Codex Run', async ({ page, runtime }) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

  await page.getByRole('button', { name: /视频下载/ }).last().click();
  const input = page.getByRole('textbox', { name: '待下载视频链接' });
  await expect(input).toBeVisible();
  await input.fill('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const firstJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(firstJobId).toBeTruthy();

  await expect(page.getByRole('region', { name: '当前创作状态' }))
    .toContainText('YouTube');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ id: string; templateId: string; state: Record<string, unknown> }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.find(job => job.id === decodeURIComponent(firstJobId!))?.state.sourceUrl;
  }).toBe('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(1);
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '视频下载' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');

  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.getByRole('button', { name: /视频下载/ }).last().click();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' })).toHaveValue('');
  await page.getByRole('textbox', { name: '待下载视频链接' })
    .fill('https://www.youtube.com/watch?v=OpenCreatorSecond');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const secondJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(secondJobId).toBeTruthy();
  expect(decodeURIComponent(secondJobId!)).not.toBe(decodeURIComponent(firstJobId!));
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(2);

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('button', { name: '打开项目 youtube.com · OpenCreatorDemo' }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${firstJobId}`));
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');
});

test('图像生成在桌面和移动视口创建、持久化并从项目中心恢复 Creator Job', async ({
  page,
  runtime
}) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /^图像生成/ }).click();

  const prompt = '一间明亮的现代创意工作室，清晨自然光，真实摄影';
  await page.getByRole('textbox', { name: '提示词' }).fill(prompt);
  await expect(page).toHaveURL(/#\/workbench\?tool=image-generation&jobId=creator_job_/);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('radio', { name: /横向/ }).click();
  await page.getByRole('radio', { name: '高清', exact: true }).click();
  await page.getByRole('radio', { name: '4 张', exact: true }).click();

  const jobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(jobId).toBeTruthy();
  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${decodeURIComponent(jobId!)}`);
    return response.job.state;
  }).toMatchObject({
    prompt,
    provider: 'openai',
    size: '1536x1024',
    quality: 'high',
    candidateCount: 4,
    currentStep: 1,
    furthestStep: 1
  });
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  await page.getByRole('button', { name: `打开项目 ${prompt}` }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${jobId}`));
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();
});
