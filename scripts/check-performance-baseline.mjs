import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const assetsDir = resolve('apps/web/dist/assets');
const performanceBaselinePath = resolve(
  'docs/performance/2026-07-15-scheduled-task-100-baseline.json'
);
const performanceResultsDir = resolve('test-results/performance');
const expectedPerformanceProjects = [
  'chromium-desktop',
  'chromium-mobile'
];
const performanceResultsRequired =
  process.env.CLAWEE_PERFORMANCE_RESULTS_REQUIRED === '1';
let failed = false;

const assetMeasurements = measureAssets();
const performance = measureScheduledTaskPerformance();

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  assetsDir,
  assetMeasurements,
  performance
}, null, 2));

if (failed) process.exitCode = 1;

function measureAssets() {
  const files = readdirSync(assetsDir).map(name => ({
    name,
    path: join(assetsDir, name),
    bytes: statSync(join(assetsDir, name)).size
  }));
  const targets = [
    {
      label: 'Web 主入口 JavaScript',
      pattern: /^index-[^.]+\.js$/,
      maxBytes: 600_000,
      maxGzipBytes: 180_000
    },
    {
      label: 'FilesPage JavaScript',
      pattern: /^FilesPage-[^.]+\.js$/,
      maxBytes: 600_000,
      maxGzipBytes: 220_000
    },
    {
      label: 'SettingsPage JavaScript',
      pattern: /^SettingsPage-[^.]+\.js$/,
      maxBytes: 60_000,
      maxGzipBytes: 18_000
    },
    {
      label: 'Web 主样式',
      pattern: /^index-[^.]+\.css$/,
      maxBytes: 80_000,
      maxGzipBytes: 16_000
    }
  ];

  return targets.map(target => {
    const asset = files.find(file => target.pattern.test(file.name));
    if (asset === undefined) {
      failed = true;
      return { label: target.label, error: '未找到构建产物' };
    }
    const gzipBytes = gzipSync(readFileSync(asset.path)).byteLength;
    const withinBudget =
      asset.bytes <= target.maxBytes
      && gzipBytes <= target.maxGzipBytes;
    if (!withinBudget) failed = true;
    return {
      label: target.label,
      file: basename(asset.path),
      bytes: asset.bytes,
      gzipBytes,
      maxBytes: target.maxBytes,
      maxGzipBytes: target.maxGzipBytes,
      withinBudget
    };
  });
}

function measureScheduledTaskPerformance() {
  const baseline = readJson(performanceBaselinePath);
  if (!isRecord(baseline)) {
    failed = true;
    return {
      baselinePath: performanceBaselinePath,
      error: '性能基线必须是 JSON 对象'
    };
  }
  if (
    typeof baseline.scenario !== 'string'
    || !isPositiveInteger(baseline.seedCount)
    || !isRecord(baseline.thresholds)
    || !isRecord(baseline.baselines)
  ) {
    failed = true;
    return {
      baselinePath: performanceBaselinePath,
      error: '性能基线缺少 scenario、seedCount、thresholds 或 baselines'
    };
  }

  const projects = Object.keys(baseline.baselines);
  const missingProjects = expectedPerformanceProjects.filter(
    project => !projects.includes(project)
  );
  const unexpectedProjects = projects.filter(
    project => !expectedPerformanceProjects.includes(project)
  );
  if (missingProjects.length > 0 || unexpectedProjects.length > 0) {
    failed = true;
  }
  const committed = projects.map(project => evaluateProject({
    source: 'committed-baseline',
    project,
    payload: baseline.baselines[project],
    thresholds: baseline.thresholds
  }));
  const current = projects.flatMap(project => {
    const resultPath = join(performanceResultsDir, `${project}.json`);
    if (!existsSync(resultPath)) {
      if (!performanceResultsRequired) return [];
      failed = true;
      return [{
        source: 'current-run',
        project,
        resultPath,
        error: '缺少本次性能测量结果'
      }];
    }
    const result = readJson(resultPath);
    if (
      !isRecord(result)
      || result.scenario !== baseline.scenario
      || result.seedCount !== baseline.seedCount
      || result.project !== project
      || !isRecord(result.measurements)
    ) {
      failed = true;
      return [{
        source: 'current-run',
        project,
        resultPath,
        error: '本次性能测量结果与基线场景不匹配'
      }];
    }
    return [evaluateProject({
      source: 'current-run',
      project,
      resultPath,
      payload: result,
      thresholds: baseline.thresholds
    })];
  });

  return {
    baselinePath: performanceBaselinePath,
    resultsDir: performanceResultsDir,
    resultsRequired: performanceResultsRequired,
    scenario: baseline.scenario,
    seedCount: baseline.seedCount,
    projectValidation: {
      expected: expectedPerformanceProjects,
      actual: projects,
      missing: missingProjects,
      unexpected: unexpectedProjects,
      valid: missingProjects.length === 0 && unexpectedProjects.length === 0
    },
    thresholds: baseline.thresholds,
    committed,
    current
  };
}

function evaluateProject(input) {
  const measurements = isRecord(input.payload)
    && isRecord(input.payload.measurements)
    ? input.payload.measurements
    : undefined;
  if (measurements === undefined) {
    failed = true;
    return {
      source: input.source,
      project: input.project,
      ...(input.resultPath === undefined ? {} : { resultPath: input.resultPath }),
      error: '缺少 measurements'
    };
  }

  const budgets = [
    ['initialRuntimeRequests', 'maxRuntimeRequestsPerLoad', '首屏 runtime 请求'],
    ['refreshRuntimeRequests', 'maxRuntimeRequestsPerLoad', '刷新 runtime 请求'],
    ['initialThreadListRequests', 'maxThreadListRequestsPerLoad', '首屏 Thread 列表请求'],
    ['refreshThreadListRequests', 'maxThreadListRequestsPerLoad', '刷新 Thread 列表请求'],
    ['scheduleViewRequests', 'maxScheduleViewRequests', '已安排页面请求'],
    ['searchViewRequests', 'maxSearchViewRequests', '搜索页面请求'],
    [
      'taskHistoryRequestsBeforeSelection',
      'maxTaskHistoryRequestsBeforeSelection',
      '选中任务前的任务历史请求'
    ],
    [
      'taskHistoryRequestsAfterSelection',
      'maxTaskHistoryRequestsAfterSelection',
      '选中任务后的任务历史请求'
    ],
    ['maxDomNodes', 'maxDomNodes', 'DOM 节点峰值'],
    ['longTaskCount', 'maxLongTaskCount', 'Long Task 数量'],
    ['maxLongTaskDurationMs', 'maxLongTaskDurationMs', '单次 Long Task'],
    ['totalLongTaskDurationMs', 'maxLongTaskTotalMs', 'Long Task 累计'],
    ['taskOpenLatencyMs', 'maxTaskOpenLatencyMs', '任务打开延迟']
  ];
  const checks = budgets.map(([measurementKey, thresholdKey, label]) => {
    const value = measurements[measurementKey];
    const maximum = input.thresholds[thresholdKey];
    const withinBudget =
      isNonNegativeNumber(value)
      && isNonNegativeNumber(maximum)
      && value <= maximum;
    if (!withinBudget) failed = true;
    return {
      label,
      measurementKey,
      value,
      maximum,
      withinBudget
    };
  });

  return {
    source: input.source,
    project: input.project,
    ...(input.resultPath === undefined ? {} : { resultPath: input.resultPath }),
    checks
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failed = true;
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
