import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/runtime.js';

test('手动创建后可从最近进入专属会话，并可暂停、恢复、编辑和删除', async ({ page, runtime }) => {
  await runtime.openApp(page);
  await openSchedules(page);
  await createManualSchedule(page, {
    name: '每日端到端简报',
    prompt: '汇总当天端到端测试结果'
  });

  await selectTask(page, '每日端到端简报');

  await page.getByRole('button', { name: '暂停任务' }).click();
  await expect(page.getByRole('status', { name: '任务状态' })).toContainText('已暂停');
  await page.getByRole('button', { name: '恢复任务' }).click();
  await expect(page.getByRole('status', { name: '任务状态' })).toContainText('已启用');

  await page.getByRole('button', { name: '编辑任务' }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务 每日端到端简报' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('定时任务标题').fill('每周端到端简报');
  await editor.getByRole('button', { name: '保存更改' }).click();
  await expect(page.getByRole('heading', { name: '每周端到端简报' })).toBeVisible();
  await openSchedules(page);
  await expect(page.getByRole('button', { name: '打开任务会话 每周端到端简报' }))
    .toBeVisible();

  await page.getByRole('button', { name: '删除每周端到端简报' }).click();
  const deleteDialog = page.getByRole('alertdialog', { name: '删除任务' });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole('button', { name: '删除任务' }).click();
  await expect(page.getByRole('button', { name: '打开任务会话 每周端到端简报' }))
    .toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('连续立即执行只排队一次，结果追加到同一会话且切换不串线', async ({ page, runtime }) => {
  runtime.configureInvocations([
    { message: '第一次专属任务结果', initialDelayMs: 800 },
    { message: '第二次专属任务结果' }
  ]);
  const schedule = await runtime.createSchedule({
    name: '连续运行任务',
    prompt: '连续生成两次结果',
    concurrencyPolicy: 'queue'
  });
  await runtime.openApp(page);
  await selectTask(page, '连续运行任务');
  const taskUrl = page.url();

  const runNow = page.getByRole('button', { name: '立即运行任务' });
  await runNow.click();
  await expect(runNow).toBeEnabled();
  await runNow.click();
  await expect(page.getByText('本次运行已排队，会在当前任务结束后执行')).toBeVisible();

  await page.goto(`${runtime.origin}/#/thread/${encodeURIComponent(runtime.ordinaryThreadId)}`);
  await expect(page).not.toHaveURL(taskUrl);
  await expect(page.getByText('第一次专属任务结果')).toHaveCount(0);
  await expect(page.getByText('第二次专属任务结果')).toHaveCount(0);

  await page.goto(`${runtime.origin}/#/thread/${encodeURIComponent(schedule.threadId)}`);
  await expect(page.getByText('第一次专属任务结果')).toBeVisible();
  await expect.poll(
    () => runtime.readInvocationCount(),
    { timeout: 20_000 }
  ).toBe(2);
  expect(runtime.readCodexMethods()).toContain('thread/read');
  await expect(page.getByText('第二次专属任务结果')).toBeVisible();
  await expect(page).toHaveURL(taskUrl);
  await expectNoHorizontalOverflow(page);
});

test('运行中刷新后恢复活动 Run 和 SSE', async ({ page, runtime }) => {
  runtime.configureInvocations([
    { message: '刷新后恢复的任务结果', initialDelayMs: 1_800 }
  ]);
  const schedule = await runtime.createSchedule({ name: '刷新恢复任务' });
  await runtime.openApp(page);
  await selectTask(page, '刷新恢复任务');

  await page.getByRole('button', { name: '立即运行任务' }).click();
  await expect(page.getByRole('status', { name: '任务状态' })).toContainText('运行中');
  await page.reload();
  await expect(page.getByRole('status', { name: '本地运行内核正常' })).toBeVisible();
  await expect(page.getByRole('heading', { name: schedule.name })).toBeVisible();
  await expect(page.getByText('刷新后恢复的任务结果')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('审批通知进入正确任务，批准后成功通知可打开 HTML 结果', async ({ page, runtime }) => {
  runtime.configureInvocations([
    {
      approval: true,
      command: 'node generate-report.mjs',
      message: '报告已生成：[打开报告](report.html)',
      completionDelayMs: 500,
      files: {
        'report.html': '<!doctype html><html><body><h1>审批后的报告</h1></body></html>'
      }
    }
  ]);
  const schedule = await runtime.createSchedule({ name: '审批报告任务' });
  await runtime.openApp(page);
  await waitForTaskPollingBaseline(page);

  const response = await runtime.runScheduleNow(schedule.id);
  expect(response.run).not.toBeNull();
  const runId = response.run!.id;
  await waitForNotification(page, '审批报告任务等待审批');
  await clickLatestNotification(page);

  await expect(page).toHaveURL(new RegExp(
    `#/thread/${escapeRegExp(schedule.threadId)}\\?runId=${escapeRegExp(runId)}&approvalId=`
  ));
  const approval = page.getByRole('region', { name: '允许执行命令' });
  await expect(approval).toBeVisible();
  await approval.getByRole('button', { name: '允许一次' }).click();

  await page.goto(`${runtime.origin}/#/thread/${encodeURIComponent(runtime.ordinaryThreadId)}`);
  await waitForNotification(page, '审批报告任务');
  await clickLatestNotification(page);
  await expect(page).toHaveURL(new RegExp(
    `#/thread/${escapeRegExp(schedule.threadId)}\\?runId=${escapeRegExp(runId)}`
  ));
  await expect(page.getByText('报告已生成：')).toBeVisible();
  await page.getByRole('link', { name: '打开报告' }).click();
  const preview = page.getByTitle('report.html HTML 预览');
  await expect(preview).toBeVisible();
  await expect(preview.contentFrame().getByRole('heading', { name: '审批后的报告' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('失败通知深链到正确任务和 Run', async ({ page, runtime }) => {
  runtime.configureInvocations([
    {
      message: '失败前的公开摘要',
      turnStatus: 'failed'
    }
  ]);
  const schedule = await runtime.createSchedule({ name: '失败通知任务' });
  await runtime.openApp(page);
  await waitForTaskPollingBaseline(page);

  const response = await runtime.runScheduleNow(schedule.id);
  expect(response.run).not.toBeNull();
  const runId = response.run!.id;
  await runtime.waitForRunStatus(runId, 'failed');
  await waitForNotification(page, '失败通知任务失败');
  await clickLatestNotification(page);

  await expect(page).toHaveURL(new RegExp(
    `#/thread/${escapeRegExp(schedule.threadId)}\\?runId=${escapeRegExp(runId)}$`
  ));
  await expect(page.getByRole('heading', { name: '失败通知任务' })).toBeVisible();
  await expect(page.getByText('失败前的公开摘要')).toBeVisible();
  await expect(page.getByText('Codex 输出异常')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

async function createManualSchedule(
  page: Page,
  input: {
    name: string;
    prompt: string;
  }
) {
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '创建定时任务' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('定时任务标题').fill(input.name);
  await editor.getByLabel('任务内容').fill(input.prompt);
  await editor.getByLabel('重复').selectOption('hourly');
  await editor.getByRole('button', { name: '创建任务' }).click();
}

async function openSchedules(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/#/schedules`);
  await expect(page.getByRole('heading', { name: '定时任务' })).toBeVisible();
}

async function selectTask(page: Page, name: string) {
  await openSchedules(page);
  await page.getByRole('button', { name: `打开任务会话 ${name}` }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function waitForTaskPollingBaseline(page: Page) {
  await page.waitForTimeout(5_200);
}

async function waitForNotification(page: Page, title: string) {
  await expect.poll(async () => page.evaluate(expectedTitle => {
    const notifications = (window as Window & {
      __opencreatorE2eNotifications?: Array<{ title: string }>;
    }).__opencreatorE2eNotifications ?? [];
    return notifications.some(notification => notification.title === expectedTitle);
  }, title), { timeout: 12_000 }).toBe(true);
}

async function clickLatestNotification(page: Page) {
  await page.evaluate(() => {
    const notifications = (window as Window & {
      __opencreatorE2eNotifications?: Array<{ click(): void }>;
    }).__opencreatorE2eNotifications ?? [];
    notifications.at(-1)?.click();
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
