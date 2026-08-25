import type { Page, Request, TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures/runtime.js';

type PerformanceBaseline = {
  scenario: string;
  seedCount: number;
  thresholds: {
    maxRuntimeRequestsPerLoad: number;
    maxThreadListRequestsPerLoad: number;
    maxScheduleViewRequests: number;
    maxSearchViewRequests: number;
    maxTaskHistoryRequestsBeforeSelection: number;
    maxTaskHistoryRequestsAfterSelection: number;
    maxDomNodes: number;
    maxLongTaskCount: number;
    maxLongTaskDurationMs: number;
    maxLongTaskTotalMs: number;
    maxTaskOpenLatencyMs: number;
  };
};

const performanceBaseline = JSON.parse(readFileSync(
  resolve('docs/performance/2026-07-15-scheduled-task-100-baseline.json'),
  'utf8'
)) as PerformanceBaseline;
const SCHEDULE_COUNT = performanceBaseline.seedCount;
const {
  maxRuntimeRequestsPerLoad: MAX_RUNTIME_REQUESTS_PER_LOAD,
  maxThreadListRequestsPerLoad: MAX_THREAD_LIST_REQUESTS_PER_LOAD,
  maxScheduleViewRequests: MAX_SCHEDULE_VIEW_REQUESTS,
  maxSearchViewRequests: MAX_SEARCH_VIEW_REQUESTS,
  maxTaskHistoryRequestsBeforeSelection: MAX_TASK_HISTORY_REQUESTS_BEFORE_SELECTION,
  maxTaskHistoryRequestsAfterSelection: MAX_TASK_HISTORY_REQUESTS_AFTER_SELECTION,
  maxDomNodes: MAX_DOM_NODES,
  maxLongTaskCount: MAX_LONG_TASK_COUNT,
  maxLongTaskDurationMs: MAX_LONG_TASK_DURATION_MS,
  maxLongTaskTotalMs: MAX_LONG_TASK_TOTAL_MS,
  maxTaskOpenLatencyMs: MAX_TASK_OPEN_LATENCY_MS
} = performanceBaseline.thresholds;

type RuntimeRequest = {
  method: string;
  path: string;
};

type BrowserPerformanceSample = {
  domNodes: number;
  longTaskCount: number;
  maxLongTaskDurationMs: number;
  totalLongTaskDurationMs: number;
};

test('100 个任务只加载摘要，并按需加载单个任务会话历史', async ({
  page,
  runtime
}, testInfo) => {
  const schedules = await Promise.all(
    Array.from({ length: SCHEDULE_COUNT }, (_, index) => runtime.createSchedule({
      name: `性能任务 ${String(index + 1).padStart(3, '0')}`,
      prompt: `生成性能基线摘要 ${String(index + 1).padStart(3, '0')}`
    }))
  );
  const taskThreadIds = new Set(schedules.map(schedule => schedule.threadId));
  const requests = observeRuntimeRequests(page);
  await installPerformanceObserver(page);

  await runtime.openApp(page);
  const initialSample = await readPerformanceSample(page);
  const initialRequests = requests.splice(0);
  expectLoadRequestBudget(initialRequests, taskThreadIds);

  await page.reload();
  await expect(page.getByRole('status', { name: '本地运行内核正常' })).toBeVisible();
  const refreshSample = await readPerformanceSample(page);
  const refreshRequests = requests.splice(0);
  expectLoadRequestBudget(refreshRequests, taskThreadIds);

  await page.goto(`${runtime.origin}/#/schedules`);
  await expect(page.getByRole('heading', { name: '定时任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^打开任务会话 性能任务/ }))
    .toHaveCount(SCHEDULE_COUNT);
  const schedulesSample = await readPerformanceSample(page);
  const scheduleRequests = requests.splice(0);
  expect(scheduleRequests.length).toBeLessThanOrEqual(MAX_SCHEDULE_VIEW_REQUESTS);
  expect(taskHistoryRequests(scheduleRequests, taskThreadIds)).toEqual([]);

  const scheduleSearch = page.getByRole('searchbox', { name: '搜索定时任务' });
  await scheduleSearch.fill('性能任务 100');
  await expect(page.getByRole('button', { name: '打开任务会话 性能任务 100' }))
    .toBeVisible();
  expect(taskHistoryRequests(requests, taskThreadIds)).toEqual([]);
  requests.splice(0);

  let searchRequests: RuntimeRequest[] = [];
  if (testInfo.project.name === 'chromium-desktop') {
    await page.goto(`${runtime.origin}/#/search`);
    await page.getByRole('searchbox', { name: '搜索会话' }).fill('性能基线摘要');
    await expect.poll(
      () => searchConversationRequests(requests).length
    ).toBe(1);
    await expect(page.getByText('没有找到匹配的会话')).toBeVisible();
    searchRequests = requests.splice(0);
    expect(searchRequests.length).toBeLessThanOrEqual(MAX_SEARCH_VIEW_REQUESTS);
    expect(taskHistoryRequests(searchRequests, taskThreadIds)).toEqual([]);
  }

  const selectedSchedule = schedules[SCHEDULE_COUNT - 1]!;
  await page.goto(`${runtime.origin}/#/schedules`);
  const selectedTaskButton = page.getByRole('button', {
    name: `打开任务会话 ${selectedSchedule.name}`
  });
  const taskOpenStartedAt = Date.now();
  await selectedTaskButton.click();
  await expect(page.getByRole('heading', { name: selectedSchedule.name })).toBeVisible();
  await expect.poll(
    () => taskHistoryRequests(requests, taskThreadIds).length
  ).toBe(1);
  const taskOpenLatencyMs = Date.now() - taskOpenStartedAt;
  const taskOpenRequests = requests.splice(0);
  const taskHistoryRequestsAfterSelection = taskHistoryRequests(
    taskOpenRequests,
    taskThreadIds
  );
  expect(taskHistoryRequestsAfterSelection).toEqual([
    `/threads/${selectedSchedule.threadId}/history?limit=50`
  ]);
  expect(taskHistoryRequestsAfterSelection.length).toBeLessThanOrEqual(
    MAX_TASK_HISTORY_REQUESTS_AFTER_SELECTION
  );
  expect(taskOpenLatencyMs).toBeLessThanOrEqual(MAX_TASK_OPEN_LATENCY_MS);

  const finalSample = await readPerformanceSample(page);
  const samples = [initialSample, refreshSample, schedulesSample, finalSample];
  const maxDomNodes = Math.max(...samples.map(sample => sample.domNodes));
  const maxLongTaskDurationMs = Math.max(
    ...samples.map(sample => sample.maxLongTaskDurationMs)
  );
  const totalLongTaskDurationMs = Math.max(
    ...samples.map(sample => sample.totalLongTaskDurationMs)
  );
  const longTaskCount = Math.max(...samples.map(sample => sample.longTaskCount));
  expect(maxDomNodes).toBeLessThanOrEqual(MAX_DOM_NODES);
  expect(longTaskCount).toBeLessThanOrEqual(MAX_LONG_TASK_COUNT);
  expect(maxLongTaskDurationMs).toBeLessThanOrEqual(MAX_LONG_TASK_DURATION_MS);
  expect(totalLongTaskDurationMs).toBeLessThanOrEqual(MAX_LONG_TASK_TOTAL_MS);

  const report = {
    version: 1,
    scenario: performanceBaseline.scenario,
    generatedAt: new Date().toISOString(),
    project: testInfo.project.name,
    viewport: testInfo.project.use.viewport,
    seedCount: SCHEDULE_COUNT,
    measurements: {
      initialRuntimeRequests: initialRequests.length,
      refreshRuntimeRequests: refreshRequests.length,
      initialThreadListRequests: threadListRequests(initialRequests).length,
      refreshThreadListRequests: threadListRequests(refreshRequests).length,
      scheduleViewRequests: scheduleRequests.length,
      searchViewRequests: searchRequests.length,
      taskHistoryRequestsBeforeSelection: taskHistoryRequests([
        ...initialRequests,
        ...refreshRequests,
        ...scheduleRequests,
        ...searchRequests
      ], taskThreadIds).length,
      taskHistoryRequestsAfterSelection: taskHistoryRequestsAfterSelection.length,
      maxDomNodes,
      longTaskCount,
      maxLongTaskDurationMs,
      totalLongTaskDurationMs,
      taskOpenLatencyMs
    }
  };
  await attachAndWriteReport(testInfo, report);
});

function observeRuntimeRequests(page: Page): RuntimeRequest[] {
  const requests: RuntimeRequest[] = [];
  page.on('request', request => {
    const measured = toRuntimeRequest(request);
    if (measured !== undefined) requests.push(measured);
  });
  return requests;
}

function toRuntimeRequest(request: Request): RuntimeRequest | undefined {
  if (request.resourceType() !== 'fetch') return undefined;
  const url = new URL(request.url());
  const pathname = normalizeRuntimePath(url.pathname);
  if (!isRuntimePath(pathname)) return undefined;
  return {
    method: request.method(),
    path: `${pathname}${url.search}`
  };
}

function normalizeRuntimePath(pathname: string): string {
  const proxyPrefix = '/.opencreator/runtime';
  if (!pathname.startsWith(proxyPrefix)) return pathname;
  return pathname.slice(proxyPrefix.length) || '/';
}

function isRuntimePath(pathname: string): boolean {
  return [
    '/healthz',
    '/codex/',
    '/threads',
    '/schedules',
    '/tasks',
    '/runs',
    '/search/',
    '/notifications',
    '/memory/',
    '/diagnostics/'
  ].some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

async function installPerformanceObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as Window & {
      __opencreatorPerformanceLongTasks?: number[];
    };
    target.__opencreatorPerformanceLongTasks = [];
    if (
      typeof PerformanceObserver === 'undefined'
      || !PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      return;
    }
    const observer = new PerformanceObserver(entries => {
      for (const entry of entries.getEntries()) {
        target.__opencreatorPerformanceLongTasks!.push(entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  });
}

async function readPerformanceSample(page: Page): Promise<BrowserPerformanceSample> {
  return await page.evaluate(() => {
    const longTasks = (window as Window & {
      __opencreatorPerformanceLongTasks?: number[];
    }).__opencreatorPerformanceLongTasks ?? [];
    return {
      domNodes: document.getElementsByTagName('*').length,
      longTaskCount: longTasks.length,
      maxLongTaskDurationMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
      totalLongTaskDurationMs: longTasks.reduce((total, duration) => total + duration, 0)
    };
  });
}

function expectLoadRequestBudget(
  requests: RuntimeRequest[],
  taskThreadIds: ReadonlySet<string>
): void {
  expect(requests.length).toBeLessThanOrEqual(MAX_RUNTIME_REQUESTS_PER_LOAD);
  expect(threadListRequests(requests).length).toBeLessThanOrEqual(
    MAX_THREAD_LIST_REQUESTS_PER_LOAD
  );
  expect(taskHistoryRequests(requests, taskThreadIds).length).toBeLessThanOrEqual(
    MAX_TASK_HISTORY_REQUESTS_BEFORE_SELECTION
  );
}

function threadListRequests(requests: RuntimeRequest[]): RuntimeRequest[] {
  return requests.filter(request => request.path.startsWith('/threads?'));
}

function searchConversationRequests(requests: RuntimeRequest[]): RuntimeRequest[] {
  return requests.filter(request => request.path.startsWith('/search/conversations?'));
}

function taskHistoryRequests(
  requests: RuntimeRequest[],
  taskThreadIds: ReadonlySet<string>
): string[] {
  return requests
    .map(request => {
      const match = /^\/threads\/([^/]+)\/history(?:\?.*)?$/.exec(request.path);
      if (match === null) return undefined;
      const threadId = decodeURIComponent(match[1]!);
      return taskThreadIds.has(threadId) ? request.path : undefined;
    })
    .filter((path): path is string => path !== undefined);
}

async function attachAndWriteReport(
  testInfo: TestInfo,
  report: Record<string, unknown>
): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach('scheduled-task-performance.json', {
    body,
    contentType: 'application/json'
  });
  const outputDir = resolve('test-results/performance');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    resolve(outputDir, `${testInfo.project.name}.json`),
    body
  );
}
