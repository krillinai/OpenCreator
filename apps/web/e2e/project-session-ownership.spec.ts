import type { Page } from '@playwright/test';
import {
  expect,
  test,
  type FakeCodexThread
} from './fixtures/runtime.js';

test('Clawee owns projects and mapped sessions across reloads', async ({ page, runtime }) => {
  runtime.configureInvocations([{
    threadId: 'codex-owned-e2e',
    message: '刷新后仍从 Codex 会话恢复的回答'
  }]);

  await runtime.openApp(page);
  await expect(page.getByText('本机目录')).toHaveCount(0);
  await openSidebar(page);
  await page.getByRole('button', { name: /普通会话/ }).click();
  await expect(page.getByRole('heading', { name: '普通会话' })).toBeVisible();

  const prompt = '验证 Clawee 项目和 Codex 会话映射';
  await page.getByRole('textbox', { name: '输入任务' }).fill(prompt);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('刷新后仍从 Codex 会话恢复的回答')).toBeVisible();

  const mapped = await runtime.api<{
    thread: {
      id: string;
      projectId: string | null;
      codexThreadId: string | null;
      cwd: string;
    };
  }>('GET', `/threads/${encodeURIComponent(runtime.ordinaryThreadId)}`);
  expect(mapped.thread).toMatchObject({
    id: runtime.ordinaryThreadId,
    projectId: runtime.projectId,
    codexThreadId: 'codex-owned-e2e',
    cwd: runtime.projectDir
  });

  await page.reload();
  await expect(page.getByText('本地运行内核正常')).toBeVisible();
  await expect(page.getByRole('heading', { name: '普通会话' })).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();
  await expect(page.getByText('刷新后仍从 Codex 会话恢复的回答')).toBeVisible();
  await expect(page.getByText('本机目录')).toHaveCount(0);
});

test('unknown Codex sessions stay isolated from lists, search, and deep links', async ({
  page,
  runtime
}) => {
  const sameCwd = codexThread(
    'codex-external-same-cwd',
    '外部未知同目录会话',
    runtime.projectDir
  );
  const otherCwd = codexThread(
    'codex-external-other-cwd',
    '外部未知其他目录会话',
    `${runtime.projectDir}-other`
  );
  runtime.configureCodex({
    threads: [sameCwd, otherCwd],
    searchResults: [
      { thread: sameCwd, snippet: '外部未知同目录会话' },
      { thread: otherCwd, snippet: '外部未知其他目录会话' }
    ]
  });

  const before = await runtime.api<{ threads: Array<{ id: string }> }>(
    'GET',
    '/threads?status=active&limit=50'
  );
  await runtime.openApp(page);
  await openSidebar(page);
  await expect(page.getByText('外部未知同目录会话')).toHaveCount(0);
  await expect(page.getByText('外部未知其他目录会话')).toHaveCount(0);

  const search = await runtime.api<{ results: unknown[] }>(
    'GET',
    `/search/conversations?query=${encodeURIComponent('外部未知')}&limit=20`
  );
  expect(search.results).toEqual([]);

  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByRole('searchbox', { name: '搜索会话' }).fill('外部未知');
  await expect(page.getByText('没有找到匹配的会话')).toBeVisible();

  const unknownRuntimeId = 'thread_codex_external_same';
  for (const path of [
    `/threads/${unknownRuntimeId}`,
    `/threads/${unknownRuntimeId}/history?limit=50`,
    `/threads/${unknownRuntimeId}/runs?limit=50`
  ]) {
    const result = await runtime.apiResult('GET', path);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      error: { code: 'THREAD_NOT_FOUND' }
    });
  }

  const after = await runtime.api<{ threads: Array<{ id: string }> }>(
    'GET',
    '/threads?status=active&limit=50'
  );
  expect(after.threads.map(thread => thread.id)).toEqual(
    before.threads.map(thread => thread.id)
  );
  await expect.poll(() => runtime.readCodexMethods()).toContain('thread/search');
  expect(runtime.readCodexMethods()).not.toContain('thread/list');
});

test('legacy localStorage projects migrate once without restoring local home', async ({
  page,
  runtime
}) => {
  const legacyProjects = [
    {
      id: 'local-home',
      name: '本机目录',
      cwd: '~',
      sandbox: 'follow-global',
      profile: 'default',
      model: null,
      reasoning: null
    },
    {
      id: 'legacy-workspace',
      name: '旧工作区',
      cwd: runtime.projectDir,
      sandbox: 'follow-global',
      profile: 'default',
      model: null,
      reasoning: null
    }
  ];

  await runtime.openApp(page, {
    legacyProjects,
    currentProjectId: 'legacy-workspace'
  });
  await openSidebar(page);
  await expect(page.getByRole('button', { name: 'workspace', exact: true }))
    .toHaveAttribute('data-current-project', 'true');
  await expect(page.getByText('本机目录')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /普通会话/ })).toBeVisible();

  const stored = await page.evaluate(() => localStorage.getItem('clawee.projects.v1'));
  expect(stored).toBe(JSON.stringify(legacyProjects));

  const repeated = await runtime.api<{
    status: string;
    projectIdMap: Record<string, string>;
  }>('POST', '/projects/migrations/local-storage-v1', { projects: [] });
  expect(repeated.status).toBe('already_applied');
  expect(repeated.projectIdMap['legacy-workspace']).toBe(runtime.projectId);
  expect(repeated.projectIdMap).not.toHaveProperty('local-home');

  const projects = await runtime.api<{
    projects: Array<{ id: string; name: string }>;
  }>('GET', '/projects?status=all');
  expect(projects.projects).toEqual([
    expect.objectContaining({
      id: runtime.projectId,
      name: 'workspace'
    })
  ]);
});

function codexThread(id: string, name: string, cwd: string): FakeCodexThread {
  const now = Math.floor(Date.now() / 1_000);
  return {
    id,
    preview: name,
    name,
    createdAt: now,
    updatedAt: now,
    recencyAt: now,
    cwd
  };
}

async function openSidebar(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: '打开导航' });
  if (await trigger.isVisible()) await trigger.click();
}
