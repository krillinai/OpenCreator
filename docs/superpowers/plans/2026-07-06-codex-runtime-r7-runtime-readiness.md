# Codex Runtime R7 Runtime Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本计划。所有步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 完成 R7 Runtime Readiness：增强 run diagnostics JSON API，加入导出层二次脱敏和 Codex status snapshot，并提供只清理 Runtime 自有数据的 dry-run/confirm cleanup API。

**Architecture:** 新增诊断和清理两个小服务层，API route 只做鉴权后的参数解析、错误映射和响应组装。诊断读取只允许 `dataDir/runs/run_*` 下的固定文件，清理只允许 `dataDir/runs/run_*` 和 `dataDir/workspaces/thread_*`，并通过 repository 交叉确认 DB 记录和状态。

**Tech Stack:** pnpm workspace, TypeScript, Node.js fs/path APIs, Fastify, SQLite via `better-sqlite3`, Vitest, existing fake Codex fixtures, existing protocol package.

---

## 0. 实施边界

本计划只实现 R7 后端 readiness 收口，不实现 UI、zip 导出、自动后台清理、SQLite 历史裁剪、`~/.codex` 清理、external cwd 清理或未脱敏 raw 模式。

本计划的验收口径：

1. `/runs/:id/diagnostics` 返回增强结构，默认不包含 `raw.redacted.ndjson`。
2. `includeRawRedacted=true` 时才包含 `raw.redacted.ndjson`。
3. 所有导出文件内容都经过导出层二次脱敏。
4. 诊断响应包含导出时刻的 `codexStatusSnapshot`。
5. 合法但不存在的 run 返回 `404 RUN_NOT_FOUND`。
6. run 存在但诊断文件缺失返回 `200`，并通过 `warnings[]` 说明。
7. `/runtime/cleanup/preview` 只返回安全候选项，不删除文件。
8. `POST /runtime/cleanup` 必须 `confirm: true`，执行前重新扫描候选项。
9. cleanup 只删除 Runtime 自己生成的 run logs 和 managed archived thread workspace，不删除 DB 记录。
10. readiness 命令全部通过。

## 1. 目标文件结构

新增和修改后的相关文件结构：

```text
apps/daemon/src/
  api/
    routes.cleanup.ts              # 新增 cleanup API route
    routes.codex.ts                # 改为复用 Codex status response builder
    routes.diagnostics.ts          # 改为调用 DiagnosticsCollector 和 status snapshot provider
    server.ts                      # 注入 repositories、diagnostics collector、cleanup service
  cleanup/
    service.ts                     # 新增 Runtime-owned cleanup 预览和确认删除服务
  codex/
    status.ts                      # 新增 /codex/status 和 diagnostics snapshot 共用 builder
  diagnostics/
    collector.ts                   # 新增固定诊断文件读取、安全边界和 warning 聚合
    redactor.ts                    # 新增导出层二次脱敏封装
  security/
    redaction.ts                   # 增强 central redactText，覆盖 Authorization header

apps/daemon/test/
  unit/
    cleanup-service.test.ts
    codex-status.test.ts
    diagnostics-collector.test.ts
    diagnostics-redactor.test.ts
    protocol-shape.test.ts
  integration/
    api.test.ts
    diagnostics.test.ts

packages/protocol/src/
  api.ts                           # 新增 diagnostics 和 cleanup response/request 类型
  errors.ts                        # 新增 CLEANUP_FAILED 错误码
```

## Task 1: Protocol Contracts

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `apps/daemon/test/unit/protocol-shape.test.ts`

- [ ] **Step 1: 写失败的 protocol shape 测试**

在 `apps/daemon/test/unit/protocol-shape.test.ts` 的 import type 列表中加入：

```ts
  CleanupDeleteRequest,
  CleanupDeleteResponse,
  CleanupPreviewResponse,
  RunDiagnosticsResponse,
```

在文件末尾追加测试：

```ts
  it('allows run diagnostics response shape', () => {
    const response: RunDiagnosticsResponse = {
      runId: 'run_123',
      files: [
        { name: 'meta.json', content: '{"id":"run_123"}' },
        { name: 'events.ndjson', content: '{"type":"done"}\n' }
      ],
      codexStatusSnapshot: {
        codexBin: 'codex',
        codexVersion: '0.0.0-test',
        codexHome: '/tmp/codex-home',
        codexHomeMode: 'isolated',
        codexHomeSource: 'isolated',
        codexHomeWritable: true,
        capabilities: { execJson: true },
        diagnostics: []
      },
      warnings: ['Diagnostics are redacted on a best-effort basis.']
    };

    expect(response.files[0]?.name).toBe('meta.json');
    expect(response.codexStatusSnapshot.codexHomeMode).toBe('isolated');
  });

  it('allows runtime cleanup request and response shapes', () => {
    const preview: CleanupPreviewResponse = {
      olderThanDays: 30,
      items: [
        {
          type: 'run_logs',
          id: 'run_123',
          path: '/tmp/runtime/runs/run_123',
          sizeBytes: 100,
          lastModifiedAt: '2026-07-06T00:00:00.000Z',
          reason: 'run logs older than 30 days'
        },
        {
          type: 'managed_thread_workspace',
          id: 'thread_123',
          path: '/tmp/runtime/workspaces/thread_123',
          sizeBytes: 200,
          lastModifiedAt: '2026-07-05T00:00:00.000Z',
          reason: 'archived managed thread workspace older than 30 days'
        }
      ],
      totalSizeBytes: 300,
      warnings: []
    };
    const request: CleanupDeleteRequest = { olderThanDays: 30, confirm: true };
    const deleted: CleanupDeleteResponse = {
      deleted: [
        {
          type: 'run_logs',
          id: 'run_123',
          path: '/tmp/runtime/runs/run_123',
          sizeBytes: 100
        }
      ],
      failed: [],
      totalDeletedBytes: 100,
      warnings: []
    };

    expect(preview.totalSizeBytes).toBe(300);
    expect(request.confirm).toBe(true);
    expect(deleted.deleted[0]?.type).toBe('run_logs');
  });

  it('includes cleanup failed as a closed error code', () => {
    const code: RuntimeErrorCode = 'CLEANUP_FAILED';
    expect(code).toBe('CLEANUP_FAILED');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/protocol-shape.test.ts
```

Expected:

```text
FAIL apps/daemon/test/unit/protocol-shape.test.ts
TypeScript reports missing exported members:
CleanupDeleteRequest, CleanupDeleteResponse, CleanupPreviewResponse, RunDiagnosticsResponse
```

- [ ] **Step 3: 新增 protocol 类型**

在 `packages/protocol/src/api.ts` 的 `CodexStatusResponse` 后追加：

```ts
export type DiagnosticFileResponse = {
  name: string;
  content: string;
};

export type RunDiagnosticsResponse = {
  runId: string;
  files: DiagnosticFileResponse[];
  codexStatusSnapshot: CodexStatusResponse;
  warnings: string[];
};

export type CleanupItemType = 'run_logs' | 'managed_thread_workspace';

export type CleanupPreviewItem = {
  type: CleanupItemType;
  id: string;
  path: string;
  sizeBytes: number;
  lastModifiedAt: string;
  reason: string;
};

export type CleanupPreviewResponse = {
  olderThanDays: number;
  items: CleanupPreviewItem[];
  totalSizeBytes: number;
  warnings: string[];
};

export type CleanupDeleteRequest = {
  olderThanDays: number;
  confirm: true;
};

export type CleanupDeletedItem = Pick<CleanupPreviewItem, 'type' | 'id' | 'path' | 'sizeBytes'>;

export type CleanupFailedItem = CleanupDeletedItem & {
  error: string;
};

export type CleanupDeleteResponse = {
  deleted: CleanupDeletedItem[];
  failed: CleanupFailedItem[];
  totalDeletedBytes: number;
  warnings: string[];
};
```

在 `packages/protocol/src/errors.ts` 的 union 中把 `CLEANUP_FAILED` 加到 `SCHEDULE_NOT_FOUND` 之后：

```ts
  | 'SCHEDULE_NOT_FOUND'
  | 'CLEANUP_FAILED'
  | 'INTERNAL_ERROR';
```

- [ ] **Step 4: 运行 protocol shape 测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/protocol-shape.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/protocol-shape.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/errors.ts apps/daemon/test/unit/protocol-shape.test.ts
git commit -m "feat: add readiness protocol contracts"
```

## Task 2: Shared Codex Status Builder

**Files:**
- Create: `apps/daemon/src/codex/status.ts`
- Create: `apps/daemon/test/unit/codex-status.test.ts`
- Modify: `apps/daemon/src/api/routes.codex.ts`

- [ ] **Step 1: 写失败的 Codex status builder 测试**

创建 `apps/daemon/test/unit/codex-status.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildCodexStatusResponse } from '../../src/codex/status.js';
import type { RuntimeCapabilityMatrix } from '../../src/codex/capabilities.js';

describe('codex status response builder', () => {
  it('builds the stable codex status response shape', () => {
    const capabilities: RuntimeCapabilityMatrix = {
      codexVersion: '1.2.3-test',
      checkedAt: '2026-07-06T00:00:00.000Z',
      execJson: true,
      execStdinPrompt: true,
      execProfile: true,
      execCwd: true,
      execSandbox: true,
      execSkipGitRepoCheck: true,
      resumeJson: true,
      resumeByThreadId: true,
      resumeLast: true,
      resumeModelOverride: true,
      resumeConfigOverride: true,
      resumeCwdOverride: true,
      resumeProfileOverride: true,
      resumeSandboxOverride: true,
      resumeContextContinuityVerified: true,
      mcpList: true,
      mcpGet: true,
      mcpAdd: true,
      mcpRemove: true,
      mcpLogin: true,
      mcpLogout: true,
      mcpAddEnv: true,
      mcpAddUrl: true,
      mcpAddBearerTokenEnvVar: true,
      mcpAddOAuth: true,
      mcpRuntimeDiscoveryVerified: true,
      mcpRuntimeBehaviorVerified: true,
      skillsScan: true,
      skillsInstall: true,
      skillsDelete: true,
      skillsGlobalWrite: true,
      skillsRuntimeDiscoveryVerified: true,
      skillsRuntimeBehaviorVerified: true,
      warnings: []
    };

    const response = buildCodexStatusResponse({
      codexBin: 'codex',
      codexHome: {
        path: '/tmp/codex-home',
        mode: 'isolated',
        source: 'isolated',
        writable: true
      },
      capabilities
    });

    expect(response).toEqual({
      codexBin: 'codex',
      codexVersion: '1.2.3-test',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      codexHomeSource: 'isolated',
      codexHomeWritable: true,
      capabilities,
      diagnostics: []
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-status.test.ts
```

Expected:

```text
FAIL apps/daemon/test/unit/codex-status.test.ts
Cannot find module '../../src/codex/status.js'
```

- [ ] **Step 3: 新增 builder 并复用到 `/codex/status`**

创建 `apps/daemon/src/codex/status.ts`：

```ts
import type { CodexStatusResponse } from '@clawee/protocol';
import type { RuntimeCapabilityMatrix } from './capabilities.js';
import type { ResolvedCodexHome } from './home.js';

export type BuildCodexStatusResponseInput = {
  codexBin: string;
  codexHome: ResolvedCodexHome;
  capabilities: RuntimeCapabilityMatrix;
};

export function buildCodexStatusResponse(
  input: BuildCodexStatusResponseInput
): CodexStatusResponse {
  return {
    codexBin: input.codexBin,
    codexVersion: input.capabilities.codexVersion,
    codexHome: input.codexHome.path,
    codexHomeMode: input.codexHome.mode,
    codexHomeSource: input.codexHome.source,
    codexHomeWritable: input.codexHome.writable,
    capabilities: input.capabilities,
    diagnostics: []
  };
}
```

修改 `apps/daemon/src/api/routes.codex.ts`：

```ts
import type { FastifyInstance } from 'fastify';
import type { RuntimeCapabilityMatrix } from '../codex/capabilities.js';
import type { ResolvedCodexHome } from '../codex/home.js';
import { buildCodexStatusResponse } from '../codex/status.js';

export async function registerCodexRoutes(
  server: FastifyInstance,
  input: { codexBin: string; codexHome: ResolvedCodexHome; capabilities: RuntimeCapabilityMatrix }
): Promise<void> {
  server.get('/codex/status', async () => buildCodexStatusResponse(input));
}
```

- [ ] **Step 4: 运行 Codex status 和 API 回归测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-status.test.ts test/integration/api.test.ts -t "returns codex status with auth"
```

Expected:

```text
PASS apps/daemon/test/unit/codex-status.test.ts
PASS apps/daemon/test/integration/api.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/codex/status.ts apps/daemon/src/api/routes.codex.ts apps/daemon/test/unit/codex-status.test.ts
git commit -m "refactor: share codex status response builder"
```

## Task 3: Diagnostics Export Redaction

**Files:**
- Modify: `apps/daemon/src/security/redaction.ts`
- Create: `apps/daemon/src/diagnostics/redactor.ts`
- Create: `apps/daemon/test/unit/diagnostics-redactor.test.ts`

- [ ] **Step 1: 写失败的 diagnostics redactor 测试**

创建 `apps/daemon/test/unit/diagnostics-redactor.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_REDACTION_WARNING,
  redactDiagnosticContent,
  redactDiagnosticFiles
} from '../../src/diagnostics/redactor.js';

describe('diagnostics redactor', () => {
  it('redacts common secret assignments and authorization headers', () => {
    const content = [
      'OPENAI_API_KEY=sk-secret-value',
      'MCP_TOKEN=mcp-secret-value',
      'PASSWORD=db-password',
      'Authorization: Bearer bearer-secret-value',
      'auth=lowercase-secret'
    ].join('\n');

    const redacted = redactDiagnosticContent(content);

    expect(redacted).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(redacted).toContain('MCP_TOKEN=[REDACTED]');
    expect(redacted).toContain('PASSWORD=[REDACTED]');
    expect(redacted).toContain('Authorization: Bearer [REDACTED]');
    expect(redacted).toContain('auth=[REDACTED]');
    expect(redacted).not.toContain('sk-secret-value');
    expect(redacted).not.toContain('mcp-secret-value');
    expect(redacted).not.toContain('db-password');
    expect(redacted).not.toContain('bearer-secret-value');
    expect(redacted).not.toContain('lowercase-secret');
  });

  it('redacts every exported diagnostic file and exposes a fixed warning', () => {
    const files = redactDiagnosticFiles([
      { name: 'stderr.redacted.log', content: 'TOKEN=plain-token' },
      { name: 'diagnostics.json', content: '{"authorization":"AUTH=plain-auth"}' }
    ]);

    expect(files).toEqual([
      { name: 'stderr.redacted.log', content: 'TOKEN=[REDACTED]' },
      { name: 'diagnostics.json', content: '{"authorization":"AUTH=[REDACTED]"}' }
    ]);
    expect(DIAGNOSTICS_REDACTION_WARNING).toBe(
      'Diagnostics are redacted on a best-effort basis.'
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/diagnostics-redactor.test.ts
```

Expected:

```text
FAIL apps/daemon/test/unit/diagnostics-redactor.test.ts
Cannot find module '../../src/diagnostics/redactor.js'
```

- [ ] **Step 3: 增强 central `redactText()`**

替换 `apps/daemon/src/security/redaction.ts` 为：

```ts
const assignmentSecretPattern = /([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)[A-Z0-9_]*)=([^\s"',}\]]+)/gi;
const authorizationHeaderPattern = /(Authorization:\s*Bearer\s+)([^\s"',}\]]+)/gi;

export function redactText(input: string): string {
  return input
    .replace(assignmentSecretPattern, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(authorizationHeaderPattern, (_match, prefix: string) => `${prefix}[REDACTED]`);
}
```

创建 `apps/daemon/src/diagnostics/redactor.ts`：

```ts
import type { DiagnosticFileResponse } from '@clawee/protocol';
import { redactText } from '../security/redaction.js';

export const DIAGNOSTICS_REDACTION_WARNING =
  'Diagnostics are redacted on a best-effort basis.';

export function redactDiagnosticContent(content: string): string {
  return redactText(content);
}

export function redactDiagnosticFiles(files: DiagnosticFileResponse[]): DiagnosticFileResponse[] {
  return files.map(file => ({
    name: file.name,
    content: redactDiagnosticContent(file.content)
  }));
}
```

- [ ] **Step 4: 运行 redaction 相关测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/diagnostics-redactor.test.ts \
  test/unit/codex-mcp-parser.test.ts \
  test/unit/codex-mcp-redaction.test.ts \
  test/unit/codex-mcp-runner.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/diagnostics-redactor.test.ts
PASS apps/daemon/test/unit/codex-mcp-parser.test.ts
PASS apps/daemon/test/unit/codex-mcp-redaction.test.ts
PASS apps/daemon/test/unit/codex-mcp-runner.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/security/redaction.ts apps/daemon/src/diagnostics/redactor.ts apps/daemon/test/unit/diagnostics-redactor.test.ts
git commit -m "feat: redact diagnostics exports"
```

## Task 4: Diagnostics Collector Service

**Files:**
- Create: `apps/daemon/src/diagnostics/collector.ts`
- Create: `apps/daemon/test/unit/diagnostics-collector.test.ts`
- Modify: `apps/daemon/test/integration/diagnostics.test.ts`

- [ ] **Step 1: 写失败的 collector 单元测试**

创建 `apps/daemon/test/unit/diagnostics-collector.test.ts`：

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DiagnosticsError,
  collectRunDiagnostics
} from '../../src/diagnostics/collector.js';
import type { RunRepository, RunRow } from '../../src/storage/repositories.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('diagnostics collector', () => {
  it('collects the default diagnostic files without raw.redacted.ndjson', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'events.ndjson': '{"type":"done"}\n',
      'stderr.redacted.log': 'TOKEN=plain-token',
      'diagnostics.json': '{"exitCode":0}',
      'raw.redacted.ndjson': '{"secret":"still-redacted"}\n'
    });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files.map(file => file.name).sort()).toEqual([
      'diagnostics.json',
      'events.ndjson',
      'meta.json',
      'stderr.redacted.log'
    ]);
    expect(result.files.find(file => file.name === 'stderr.redacted.log')?.content).toBe(
      'TOKEN=[REDACTED]'
    );
    expect(result.warnings).toContain('Diagnostics are redacted on a best-effort basis.');
  });

  it('includes raw.redacted.ndjson only when requested', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'raw.redacted.ndjson': 'AUTH=raw-auth\n'
    });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1',
      includeRawRedacted: true
    });

    expect(result.files).toEqual([
      { name: 'meta.json', content: '{"id":"run_1"}' },
      { name: 'raw.redacted.ndjson', content: 'AUTH=[REDACTED]\n' }
    ]);
  });

  it('rejects invalid run ids before filesystem access', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));

    expect(() =>
      collectRunDiagnostics({
        dataDir: tempDir,
        runs: makeRunRepository(['run_1']),
        runId: '../outside'
      })
    ).toThrowError(new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid'));
  });

  it('returns RUN_NOT_FOUND for syntactically valid missing runs', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));

    expect(() =>
      collectRunDiagnostics({
        dataDir: tempDir,
        runs: makeRunRepository([]),
        runId: 'run_missing'
      })
    ).toThrowError(new DiagnosticsError('RUN_NOT_FOUND', 'Run not found'));
  });

  it('keeps a 200-style collection result when files are missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));
    mkdirSync(join(tempDir, 'runs', 'run_1'), { recursive: true });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Diagnostics are redacted on a best-effort basis.',
        'Diagnostic file meta.json is missing.',
        'Diagnostic file events.ndjson is missing.',
        'Diagnostic file stderr.redacted.log is missing.',
        'Diagnostic file diagnostics.json is missing.'
      ])
    );
  });

  it('skips symlinked diagnostic files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-collector-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'meta.json'), 'SECRET=outside');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    symlinkSync(join(outsideDir, 'meta.json'), join(runDir, 'meta.json'));

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([{ name: 'events.ndjson', content: '{"type":"done"}\n' }]);
    expect(result.warnings).toContain('Diagnostic file meta.json was skipped because it is unsafe.');
  });
});

function writeRunFiles(root: string, runId: string, files: Record<string, string>): void {
  const runDir = join(root, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(runDir, name), content);
  }
}

function makeRunRepository(ids: string[]): Pick<RunRepository, 'getRun'> {
  return {
    getRun(id: string) {
      if (!ids.includes(id)) return undefined;
      return { id } as RunRow;
    }
  };
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/diagnostics-collector.test.ts
```

Expected:

```text
FAIL apps/daemon/test/unit/diagnostics-collector.test.ts
Cannot find module '../../src/diagnostics/collector.js'
```

- [ ] **Step 3: 实现 collector**

创建 `apps/daemon/src/diagnostics/collector.ts`：

```ts
import type { DiagnosticFileResponse, RuntimeErrorCode } from '@clawee/protocol';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { redactDiagnosticFiles, DIAGNOSTICS_REDACTION_WARNING } from './redactor.js';
import type { RunRepository } from '../storage/repositories.js';

export type CollectRunDiagnosticsInput = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  runId: string;
  includeRawRedacted?: boolean;
};

export type CollectedRunDiagnostics = {
  runId: string;
  files: DiagnosticFileResponse[];
  warnings: string[];
};

const defaultDiagnosticFiles = [
  'meta.json',
  'events.ndjson',
  'stderr.redacted.log',
  'diagnostics.json'
];
const rawDiagnosticFile = 'raw.redacted.ndjson';
const runIdPattern = /^run_[A-Za-z0-9_-]+$/;

export class DiagnosticsError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode, 'VALIDATION_FAILED' | 'RUN_NOT_FOUND'>,
    message: string
  ) {
    super(message);
    this.name = 'DiagnosticsError';
  }
}

export function collectRunDiagnostics(
  input: CollectRunDiagnosticsInput
): CollectedRunDiagnostics {
  if (!runIdPattern.test(input.runId)) {
    throw new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid');
  }
  if (input.runs.getRun(input.runId) === undefined) {
    throw new DiagnosticsError('RUN_NOT_FOUND', 'Run not found');
  }

  const warnings = [DIAGNOSTICS_REDACTION_WARNING];
  const runsDir = resolve(input.dataDir, 'runs');
  const runDir = resolve(runsDir, input.runId);
  if (!isPathInside(runsDir, runDir)) {
    throw new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid');
  }

  const realRunDir = getSafeRunDir({ runsDir, runDir, warnings });
  if (realRunDir === undefined) {
    return { runId: input.runId, files: [], warnings };
  }

  const fileNames = input.includeRawRedacted
    ? [...defaultDiagnosticFiles, rawDiagnosticFile]
    : defaultDiagnosticFiles;
  const files: DiagnosticFileResponse[] = [];

  for (const name of fileNames) {
    const file = readSafeDiagnosticFile({ runDir, realRunDir, name, warnings });
    if (file !== undefined) files.push(file);
  }

  return {
    runId: input.runId,
    files: redactDiagnosticFiles(files),
    warnings
  };
}

function getSafeRunDir(input: {
  runsDir: string;
  runDir: string;
  warnings: string[];
}): string | undefined {
  try {
    const stat = lstatSync(input.runDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      input.warnings.push('Run diagnostics directory was skipped because it is unsafe.');
      return undefined;
    }

    const realRunsDir = realpathSync(input.runsDir);
    const realRunDir = realpathSync(input.runDir);
    if (!isPathInside(realRunsDir, realRunDir)) {
      input.warnings.push('Run diagnostics directory was skipped because it is outside runtime data.');
      return undefined;
    }
    return realRunDir;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      input.warnings.push('Run diagnostics directory is missing.');
      return undefined;
    }
    throw error;
  }
}

function readSafeDiagnosticFile(input: {
  runDir: string;
  realRunDir: string;
  name: string;
  warnings: string[];
}): DiagnosticFileResponse | undefined {
  const filePath = resolve(input.runDir, input.name);
  if (!isPathInside(input.runDir, filePath)) {
    input.warnings.push(`Diagnostic file ${input.name} was skipped because it is unsafe.`);
    return undefined;
  }

  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      input.warnings.push(`Diagnostic file ${input.name} was skipped because it is unsafe.`);
      return undefined;
    }

    const realFilePath = realpathSync(filePath);
    if (!isPathInside(input.realRunDir, realFilePath)) {
      input.warnings.push(`Diagnostic file ${input.name} was skipped because it is unsafe.`);
      return undefined;
    }

    return { name: input.name, content: readFileSync(filePath, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      input.warnings.push(`Diagnostic file ${input.name} is missing.`);
      return undefined;
    }
    throw error;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !path.includes(`..${sep}`));
}
```

- [ ] **Step 4: 运行 collector 测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/diagnostics-collector.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/diagnostics-collector.test.ts
```

- [ ] **Step 5: 更新旧 diagnostics integration 测试的 collector import**

在 `apps/daemon/test/integration/diagnostics.test.ts` 中删除：

```ts
import { collectRunDiagnostics } from '../../src/api/routes.diagnostics.js';
```

把前三个 `collectRunDiagnostics(...)` 直接单元测试移除，因为这些行为已经迁移到 `diagnostics-collector.test.ts`。保留 API 鉴权、resume diagnostics、queued cancel diagnostics 测试。

- [ ] **Step 6: 运行 diagnostics 相关测试**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/diagnostics-collector.test.ts \
  test/unit/diagnostics-redactor.test.ts \
  test/integration/diagnostics.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/diagnostics-collector.test.ts
PASS apps/daemon/test/unit/diagnostics-redactor.test.ts
PASS apps/daemon/test/integration/diagnostics.test.ts
```

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/diagnostics/collector.ts apps/daemon/test/unit/diagnostics-collector.test.ts apps/daemon/test/integration/diagnostics.test.ts
git commit -m "feat: collect run diagnostics safely"
```

## Task 5: Enhanced Diagnostics API

**Files:**
- Modify: `apps/daemon/src/api/routes.diagnostics.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/diagnostics.test.ts`

- [ ] **Step 1: 写失败的 diagnostics API 集成测试**

在 `apps/daemon/test/integration/diagnostics.test.ts` import 中加入：

```ts
import { createRunRepository } from '../../src/storage/repositories.js';
```

在 `describe('diagnostics', () => { ... })` 内加入：

```ts
  it('returns enhanced diagnostics with codex status snapshot', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    const runDir = join(tempDir, 'runs', 'run_1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'meta.json'), '{"id":"run_1"}');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    writeFileSync(join(runDir, 'stderr.redacted.log'), 'Authorization: Bearer secret-token');
    writeFileSync(join(runDir, 'diagnostics.json'), '{"exitCode":0}');
    writeFileSync(join(runDir, 'raw.redacted.ndjson'), 'TOKEN=raw-token\n');
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexBin: 'codex-test',
      codexHome: join(tempDir, 'codex-home')
    });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: 'run_1',
      codexStatusSnapshot: {
        codexBin: 'codex-test',
        codexHome: join(tempDir, 'codex-home'),
        codexHomeMode: 'isolated'
      },
      warnings: expect.arrayContaining(['Diagnostics are redacted on a best-effort basis.'])
    });
    expect(response.json().files.map((file: { name: string }) => file.name)).toEqual([
      'meta.json',
      'events.ndjson',
      'stderr.redacted.log',
      'diagnostics.json'
    ]);
    expect(response.body).toContain('Authorization: Bearer [REDACTED]');
    expect(response.body).not.toContain('secret-token');
    expect(response.body).not.toContain('raw-token');
  });

  it('includes raw.redacted.ndjson only when includeRawRedacted=true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    const runDir = join(tempDir, 'runs', 'run_1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'meta.json'), '{"id":"run_1"}');
    writeFileSync(join(runDir, 'raw.redacted.ndjson'), 'TOKEN=raw-token\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir, db: database });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics?includeRawRedacted=true',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().files).toEqual([
      { name: 'meta.json', content: '{"id":"run_1"}' },
      { name: 'raw.redacted.ndjson', content: 'TOKEN=[REDACTED]\n' }
    ]);
  });

  it('maps invalid and missing diagnostics runs to API errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    server = await buildServer({ token: 'secret', dataDir: tempDir, db: database });

    const invalid = await server.inject({
      method: 'GET',
      url: '/runs/..%2Foutside/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/runs/run_missing/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('RUN_NOT_FOUND');
  });

  it('keeps diagnostics available after run log files are deleted', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    server = await buildServer({ token: 'secret', dataDir: tempDir, db: database });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().files).toEqual([]);
    expect(response.json().warnings).toEqual(
      expect.arrayContaining(['Run diagnostics directory is missing.'])
    );
  });
```

在文件底部新增 helper：

```ts
function insertFinishedRun(database: Database.Database, id: string): void {
  createRunRepository(database).insertRun({
    id,
    publicStatus: 'succeeded',
    internalStatus: 'succeeded',
    createdBy: 'test',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1
  });
}
```

同时把旧的测试 `returns diagnostics response for authorized route requests` 改为预期缺失 run 返回 404：

```ts
  it('returns RUN_NOT_FOUND for authorized diagnostics requests to missing runs', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RUN_NOT_FOUND');
  });
```

- [ ] **Step 2: 运行 diagnostics API 测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/diagnostics.test.ts
```

Expected:

```text
FAIL apps/daemon/test/integration/diagnostics.test.ts
Expected enhanced response but received old { runId, files } shape, or missing run still returns 200.
```

- [ ] **Step 3: 更新 diagnostics route**

替换 `apps/daemon/src/api/routes.diagnostics.ts` 为：

```ts
import type { CodexStatusResponse, RunDiagnosticsResponse } from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  collectRunDiagnostics,
  DiagnosticsError,
  type CollectedRunDiagnostics
} from '../diagnostics/collector.js';
import type { RunRepository } from '../storage/repositories.js';
import { apiError } from './errors.js';

export type DiagnosticsRouteInput = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  getCodexStatusSnapshot: () => CodexStatusResponse;
};

export async function registerDiagnosticsRoutes(
  server: FastifyInstance,
  input: DiagnosticsRouteInput
): Promise<void> {
  server.get<{ Params: { id: string }; Querystring: { includeRawRedacted?: string } }>(
    '/runs/:id/diagnostics',
    async (request, reply) => {
      const includeRawRedacted = request.query.includeRawRedacted === 'true';

      try {
        const collected = collectRunDiagnostics({
          dataDir: input.dataDir,
          runs: input.runs,
          runId: request.params.id,
          includeRawRedacted
        });
        return toResponse(collected, input.getCodexStatusSnapshot());
      } catch (error) {
        return sendDiagnosticsError(error, reply);
      }
    }
  );
}

function toResponse(
  collected: CollectedRunDiagnostics,
  codexStatusSnapshot: CodexStatusResponse
): RunDiagnosticsResponse {
  return {
    runId: collected.runId,
    files: collected.files,
    codexStatusSnapshot,
    warnings: collected.warnings
  };
}

function sendDiagnosticsError(error: unknown, reply: FastifyReply) {
  if (error instanceof DiagnosticsError) {
    if (error.code === 'VALIDATION_FAILED') {
      return reply.code(400).send(apiError(error.code, error.message));
    }
    if (error.code === 'RUN_NOT_FOUND') {
      return reply.code(404).send(apiError(error.code, error.message));
    }
  }

  return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal error'));
}
```

- [ ] **Step 4: 更新 server 注入**

修改 `apps/daemon/src/api/server.ts`：

新增 import：

```ts
import { buildCodexStatusResponse } from '../codex/status.js';
import { createRunRepository } from '../storage/repositories.js';
```

在 `db` 创建后实例化 run repository：

```ts
  const runRepository = createRunRepository(db);
```

把：

```ts
  await registerDiagnosticsRoutes(server, dataDir);
```

替换为：

```ts
  await registerDiagnosticsRoutes(server, {
    dataDir,
    runs: runRepository,
    getCodexStatusSnapshot: () =>
      buildCodexStatusResponse({
        codexBin,
        codexHome: resolvedCodexHome,
        capabilities
      })
  });
```

- [ ] **Step 5: 运行 diagnostics API 测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/diagnostics-collector.test.ts \
  test/integration/diagnostics.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/diagnostics-collector.test.ts
PASS apps/daemon/test/integration/diagnostics.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/api/routes.diagnostics.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/diagnostics.test.ts
git commit -m "feat: enhance run diagnostics api"
```

## Task 6: Cleanup Service

**Files:**
- Create: `apps/daemon/src/cleanup/service.ts`
- Create: `apps/daemon/test/unit/cleanup-service.test.ts`

- [ ] **Step 1: 写失败的 cleanup service 单元测试**

创建 `apps/daemon/test/unit/cleanup-service.test.ts`：

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CleanupError, createCleanupService } from '../../src/cleanup/service.js';
import type { RunRepository, RunRow, ThreadRepository, ThreadRow } from '../../src/storage/repositories.js';

let tempDir = '';
const now = new Date('2026-07-06T00:00:00.000Z');
const old = new Date('2026-05-01T00:00:00.000Z');
const recent = new Date('2026-07-05T00:00:00.000Z');

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('cleanup service', () => {
  it('previews old non-active run log directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    writeRuntimeDir(join(tempDir, 'runs', 'run_old'), old, { 'meta.json': '12345' });
    writeRuntimeDir(join(tempDir, 'runs', 'run_recent'), recent, { 'meta.json': '12345' });
    writeRuntimeDir(join(tempDir, 'runs', 'run_active'), old, { 'meta.json': '12345' });
    writeRuntimeDir(join(tempDir, 'runs', 'not_runtime'), old, { 'meta.json': '12345' });

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({
        run_old: makeRunRow('run_old', 'succeeded', 'succeeded'),
        run_recent: makeRunRow('run_recent', 'succeeded', 'succeeded'),
        run_active: makeRunRow('run_active', 'running', 'running')
      }),
      threads: makeThreadRepository({}),
      clock: () => now
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview).toMatchObject({
      olderThanDays: 30,
      totalSizeBytes: 5,
      warnings: []
    });
    expect(preview.items).toEqual([
      expect.objectContaining({
        type: 'run_logs',
        id: 'run_old',
        path: join(tempDir, 'runs', 'run_old'),
        sizeBytes: 5,
        reason: 'run logs older than 30 days'
      })
    ]);
  });

  it('previews only archived managed thread workspaces', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    writeRuntimeDir(join(tempDir, 'workspaces', 'thread_archived'), old, { 'file.txt': '123' });
    writeRuntimeDir(join(tempDir, 'workspaces', 'thread_active'), old, { 'file.txt': '123' });
    writeRuntimeDir(join(tempDir, 'workspaces', 'thread_external'), old, { 'file.txt': '123' });

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({}),
      threads: makeThreadRepository({
        thread_archived: makeThreadRow('thread_archived', 'managed', 'archived'),
        thread_active: makeThreadRow('thread_active', 'managed', 'active'),
        thread_external: makeThreadRow('thread_external', 'external', 'archived')
      }),
      clock: () => now
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([
      expect.objectContaining({
        type: 'managed_thread_workspace',
        id: 'thread_archived',
        path: join(tempDir, 'workspaces', 'thread_archived'),
        sizeBytes: 3,
        reason: 'archived managed thread workspace older than 30 days'
      })
    ]);
  });

  it('rejects invalid olderThanDays values', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({}),
      threads: makeThreadRepository({}),
      clock: () => now
    });

    expect(() => service.preview({ olderThanDays: 0 })).toThrowError(
      new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer')
    );
    expect(() => service.preview({ olderThanDays: 1.5 })).toThrowError(
      new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer')
    );
  });

  it('skips symlinked candidates with warnings', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    const outside = join(tempDir, 'outside');
    mkdirSync(join(tempDir, 'runs'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(tempDir, 'runs', 'run_link'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({ run_link: makeRunRow('run_link', 'succeeded', 'succeeded') }),
      threads: makeThreadRepository({}),
      clock: () => now
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([]);
    expect(preview.warnings).toEqual([
      `Skipping unsafe runtime cleanup candidate: ${join(tempDir, 'runs', 'run_link')}`
    ]);
  });

  it('skips symlinked runtime roots with warnings', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    const outside = join(tempDir, 'outside-runs');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(tempDir, 'runs'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({}),
      threads: makeThreadRepository({}),
      clock: () => now
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([]);
    expect(preview.warnings).toEqual([
      `Skipping unsafe runtime cleanup root: ${join(tempDir, 'runs')}`
    ]);
  });

  it('deletes candidates after rescanning and does not delete non-candidates', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-'));
    const oldRun = join(tempDir, 'runs', 'run_old');
    const activeRun = join(tempDir, 'runs', 'run_active');
    writeRuntimeDir(oldRun, old, { 'meta.json': '12345' });
    writeRuntimeDir(activeRun, old, { 'meta.json': '12345' });

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository({
        run_old: makeRunRow('run_old', 'succeeded', 'succeeded'),
        run_active: makeRunRow('run_active', 'running', 'running')
      }),
      threads: makeThreadRepository({}),
      clock: () => now
    });

    const result = service.delete({ olderThanDays: 30 });

    expect(result).toEqual({
      deleted: [{ type: 'run_logs', id: 'run_old', path: oldRun, sizeBytes: 5 }],
      failed: [],
      totalDeletedBytes: 5,
      warnings: []
    });
    expect(existsSync(oldRun)).toBe(false);
    expect(existsSync(activeRun)).toBe(true);
  });
});

function writeRuntimeDir(path: string, mtime: Date, files: Record<string, string>): void {
  mkdirSync(path, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(path, name);
    writeFileSync(filePath, content);
    utimesSync(filePath, mtime, mtime);
  }
  utimesSync(path, mtime, mtime);
}

function makeRunRepository(rows: Record<string, RunRow>): Pick<RunRepository, 'getRun'> {
  return {
    getRun(id: string) {
      return rows[id];
    }
  };
}

function makeThreadRepository(rows: Record<string, ThreadRow>): Pick<ThreadRepository, 'getThread'> {
  return {
    getThread(id: string) {
      return rows[id];
    }
  };
}

function makeRunRow(id: string, publicStatus: string, internalStatus: string): RunRow {
  return {
    id,
    public_status: publicStatus,
    internal_status: internalStatus
  } as RunRow;
}

function makeThreadRow(id: string, workspaceMode: string, status: 'active' | 'archived'): ThreadRow {
  return {
    id,
    workspace_mode: workspaceMode,
    status
  } as ThreadRow;
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/cleanup-service.test.ts
```

Expected:

```text
FAIL apps/daemon/test/unit/cleanup-service.test.ts
Cannot find module '../../src/cleanup/service.js'
```

- [ ] **Step 3: 实现 cleanup service**

创建 `apps/daemon/src/cleanup/service.ts`：

```ts
import type {
  CleanupDeleteResponse,
  CleanupItemType,
  CleanupPreviewItem,
  CleanupPreviewResponse,
  RuntimeErrorCode
} from '@clawee/protocol';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { RunRepository, RunRow, ThreadRepository, ThreadRow } from '../storage/repositories.js';

export type CleanupServiceInput = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  threads: Pick<ThreadRepository, 'getThread'>;
  clock?: () => Date;
};

export type CleanupRequest = {
  olderThanDays: number;
};

export class CleanupError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode, 'VALIDATION_FAILED' | 'CLEANUP_FAILED'>,
    message: string
  ) {
    super(message);
    this.name = 'CleanupError';
  }
}

export function createCleanupService(input: CleanupServiceInput) {
  const clock = input.clock ?? (() => new Date());

  return {
    preview(request: CleanupRequest): CleanupPreviewResponse {
      return previewCleanup({ ...input, clock }, request);
    },

    delete(request: CleanupRequest): CleanupDeleteResponse {
      const preview = previewCleanup({ ...input, clock }, request);
      const deleted: CleanupDeleteResponse['deleted'] = [];
      const failed: CleanupDeleteResponse['failed'] = [];

      for (const item of preview.items) {
        try {
          rmSync(item.path, { recursive: true, force: false });
          deleted.push({
            type: item.type,
            id: item.id,
            path: item.path,
            sizeBytes: item.sizeBytes
          });
        } catch (error) {
          failed.push({
            type: item.type,
            id: item.id,
            path: item.path,
            sizeBytes: item.sizeBytes,
            error: formatError(error)
          });
        }
      }

      return {
        deleted,
        failed,
        totalDeletedBytes: deleted.reduce((sum, item) => sum + item.sizeBytes, 0),
        warnings: preview.warnings
      };
    }
  };
}

function previewCleanup(
  input: CleanupServiceInput & { clock: () => Date },
  request: CleanupRequest
): CleanupPreviewResponse {
  validateOlderThanDays(request.olderThanDays);
  const thresholdMs = input.clock().getTime() - request.olderThanDays * 24 * 60 * 60 * 1000;
  const warnings: string[] = [];
  const items = [
    ...scanRunLogs(input, thresholdMs, request.olderThanDays, warnings),
    ...scanManagedWorkspaces(input, thresholdMs, request.olderThanDays, warnings)
  ].sort((a, b) => a.path.localeCompare(b.path));

  return {
    olderThanDays: request.olderThanDays,
    items,
    totalSizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    warnings
  };
}

function scanRunLogs(
  input: CleanupServiceInput,
  thresholdMs: number,
  olderThanDays: number,
  warnings: string[]
): CleanupPreviewItem[] {
  const root = resolve(input.dataDir, 'runs');
  return scanRuntimeRoot(root, /^run_[A-Za-z0-9_-]+$/, warnings)
    .map(candidate => {
      const row = input.runs.getRun(candidate.id);
      if (row === undefined || isActiveRun(row)) return undefined;
      if (candidate.lastModifiedAt.getTime() >= thresholdMs) return undefined;
      return toPreviewItem(
        'run_logs',
        candidate,
        `run logs older than ${olderThanDays} days`
      );
    })
    .filter((item): item is CleanupPreviewItem => item !== undefined);
}

function scanManagedWorkspaces(
  input: CleanupServiceInput,
  thresholdMs: number,
  olderThanDays: number,
  warnings: string[]
): CleanupPreviewItem[] {
  const root = resolve(input.dataDir, 'workspaces');
  return scanRuntimeRoot(root, /^thread_[A-Za-z0-9_-]+$/, warnings)
    .map(candidate => {
      const row = input.threads.getThread(candidate.id);
      if (row === undefined || !isArchivedManagedThread(row)) return undefined;
      if (candidate.lastModifiedAt.getTime() >= thresholdMs) return undefined;
      return toPreviewItem(
        'managed_thread_workspace',
        candidate,
        `archived managed thread workspace older than ${olderThanDays} days`
      );
    })
    .filter((item): item is CleanupPreviewItem => item !== undefined);
}

type RuntimeCandidate = {
  id: string;
  path: string;
  sizeBytes: number;
  lastModifiedAt: Date;
};

function scanRuntimeRoot(root: string, idPattern: RegExp, warnings: string[]): RuntimeCandidate[] {
  if (!existsSync(root)) return [];
  const realRoot = safeRuntimeRoot(root, warnings);
  if (realRoot === undefined) return [];
  const candidates: RuntimeCandidate[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!idPattern.test(entry.name)) continue;
    const candidatePath = resolve(root, entry.name);
    const candidate = readRuntimeCandidate(realRoot, candidatePath, entry.name, warnings);
    if (candidate !== undefined) candidates.push(candidate);
  }

  return candidates;
}

function safeRuntimeRoot(root: string, warnings: string[]): string | undefined {
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      warnings.push(`Skipping unsafe runtime cleanup root: ${root}`);
      return undefined;
    }
    return realpathSync(root);
  } catch (error) {
    warnings.push(`Skipping runtime cleanup root ${root}: ${formatError(error)}`);
    return undefined;
  }
}

function readRuntimeCandidate(
  realRoot: string,
  candidatePath: string,
  id: string,
  warnings: string[]
): RuntimeCandidate | undefined {
  try {
    const stat = lstatSync(candidatePath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      warnings.push(`Skipping unsafe runtime cleanup candidate: ${candidatePath}`);
      return undefined;
    }

    const realCandidatePath = realpathSync(candidatePath);
    if (!isPathInside(realRoot, realCandidatePath)) {
      warnings.push(`Skipping unsafe runtime cleanup candidate: ${candidatePath}`);
      return undefined;
    }

    const metadata = readDirectoryMetadata(realCandidatePath);
    return {
      id,
      path: candidatePath,
      sizeBytes: metadata.sizeBytes,
      lastModifiedAt: metadata.lastModifiedAt
    };
  } catch (error) {
    warnings.push(`Skipping runtime cleanup candidate ${candidatePath}: ${formatError(error)}`);
    return undefined;
  }
}

function readDirectoryMetadata(path: string): { sizeBytes: number; lastModifiedAt: Date } {
  const stat = statSync(path);
  let sizeBytes = stat.isFile() ? stat.size : 0;
  let lastModifiedMs = stat.mtimeMs;

  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const childPath = join(path, entry.name);
      const childStat = lstatSync(childPath);
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) {
        const child = readDirectoryMetadata(childPath);
        sizeBytes += child.sizeBytes;
        lastModifiedMs = Math.max(lastModifiedMs, child.lastModifiedAt.getTime());
      } else if (childStat.isFile()) {
        sizeBytes += childStat.size;
        lastModifiedMs = Math.max(lastModifiedMs, childStat.mtimeMs);
      }
    }
  }

  return {
    sizeBytes,
    lastModifiedAt: new Date(lastModifiedMs)
  };
}

function toPreviewItem(
  type: CleanupItemType,
  candidate: RuntimeCandidate,
  reason: string
): CleanupPreviewItem {
  return {
    type,
    id: candidate.id,
    path: candidate.path,
    sizeBytes: candidate.sizeBytes,
    lastModifiedAt: candidate.lastModifiedAt.toISOString(),
    reason
  };
}

function validateOlderThanDays(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer');
  }
}

function isActiveRun(row: RunRow): boolean {
  return (
    ['queued', 'running', 'canceling'].includes(row.public_status) ||
    ['created', 'queued', 'spawning', 'running', 'canceling'].includes(row.internal_status)
  );
}

function isArchivedManagedThread(row: ThreadRow): boolean {
  return row.workspace_mode === 'managed' && row.status === 'archived';
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !path.includes(`..${sep}`));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 运行 cleanup service 测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/unit/cleanup-service.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/cleanup-service.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/daemon/src/cleanup/service.ts apps/daemon/test/unit/cleanup-service.test.ts
git commit -m "feat: add runtime cleanup service"
```

## Task 7: Cleanup API Routes and Server Wiring

**Files:**
- Create: `apps/daemon/src/api/routes.cleanup.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写失败的 cleanup API 集成测试**

在 `apps/daemon/test/integration/api.test.ts` import 中加入：

```ts
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';
```

在 `describe('runtime api', () => { ... })` 内加入：

```ts
  it('previews and confirms runtime cleanup without deleting database rows', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertApiRun(database, 'run_old', 'succeeded', 'succeeded');
    insertApiRun(database, 'run_active', 'running', 'running');
    insertApiThread(database, 'thread_old', 'managed', 'archived');
    insertApiThread(database, 'thread_active', 'managed', 'active');

    writeOldApiDir(join(tempDir, 'runs', 'run_old'), { 'meta.json': '12345' });
    writeOldApiDir(join(tempDir, 'runs', 'run_active'), { 'meta.json': '12345' });
    writeOldApiDir(join(tempDir, 'workspaces', 'thread_old'), { 'file.txt': 'abc' });
    writeOldApiDir(join(tempDir, 'workspaces', 'thread_active'), { 'file.txt': 'abc' });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database
    });

    const preview = await authGet('/runtime/cleanup/preview?olderThanDays=30');
    expect(preview.statusCode).toBe(200);
    expect(preview.json().items).toEqual([
      expect.objectContaining({ type: 'run_logs', id: 'run_old' }),
      expect.objectContaining({ type: 'managed_thread_workspace', id: 'thread_old' })
    ]);
    expect(preview.json().items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'run_active' }),
        expect.objectContaining({ id: 'thread_active' })
      ])
    );

    const rejected = await authPost('/runtime/cleanup', { olderThanDays: 30 });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('VALIDATION_FAILED');

    const deleted = await authPost('/runtime/cleanup', { olderThanDays: 30, confirm: true });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      failed: [],
      totalDeletedBytes: 8
    });
    expect(deleted.json().deleted).toEqual([
      expect.objectContaining({ type: 'run_logs', id: 'run_old', sizeBytes: 5 }),
      expect.objectContaining({ type: 'managed_thread_workspace', id: 'thread_old', sizeBytes: 3 })
    ]);
    expect(existsSync(join(tempDir, 'runs', 'run_old'))).toBe(false);
    expect(existsSync(join(tempDir, 'runs', 'run_active'))).toBe(true);
    expect(existsSync(join(tempDir, 'workspaces', 'thread_old'))).toBe(false);
    expect(existsSync(join(tempDir, 'workspaces', 'thread_active'))).toBe(true);
    expect(createRunRepository(database).getRun('run_old')).toBeDefined();
    expect(createThreadRepository(database).getThread('thread_old')).toBeDefined();
  });

  it('validates runtime cleanup query and body parameters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    server = await buildServer({ token: 'secret', dataDir: tempDir, db: database });

    const invalidPreview = await authGet('/runtime/cleanup/preview?olderThanDays=0');
    const missingPreview = await authGet('/runtime/cleanup/preview');
    const stringBody = await server.inject({
      method: 'POST',
      url: '/runtime/cleanup',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      payload: JSON.stringify('not-an-object')
    });
    const invalidConfirm = await authPost('/runtime/cleanup', {
      olderThanDays: 30,
      confirm: false
    });

    expect(invalidPreview.statusCode).toBe(400);
    expect(invalidPreview.json().error.code).toBe('VALIDATION_FAILED');
    expect(missingPreview.statusCode).toBe(400);
    expect(missingPreview.json().error.code).toBe('VALIDATION_FAILED');
    expect(stringBody.statusCode).toBe(400);
    expect(stringBody.json().error.code).toBe('VALIDATION_FAILED');
    expect(invalidConfirm.statusCode).toBe(400);
    expect(invalidConfirm.json().error.code).toBe('VALIDATION_FAILED');
  });
```

在 `apps/daemon/test/integration/api.test.ts` 底部新增 helper：

```ts
function insertApiRun(
  database: Database.Database,
  id: string,
  publicStatus: string,
  internalStatus: string
): void {
  createRunRepository(database).insertRun({
    id,
    publicStatus,
    internalStatus,
    createdBy: 'test',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1
  });
}

function insertApiThread(
  database: Database.Database,
  id: string,
  workspaceMode: 'managed' | 'external',
  status: 'active' | 'archived'
): void {
  createThreadRepository(database).insertThread({
    id,
    cwd: workspaceMode === 'managed' ? join(tempDir, 'workspaces', id) : tempDir,
    canonicalCwd: workspaceMode === 'managed' ? join(tempDir, 'workspaces', id) : tempDir,
    workspaceMode,
    profile: 'default',
    sandbox: 'read-only',
    status
  });
}

function writeOldApiDir(path: string, files: Record<string, string>): void {
  const oldDate = new Date('2026-05-01T00:00:00.000Z');
  mkdirSync(path, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(path, name);
    writeFileSync(filePath, content);
    utimesSync(filePath, oldDate, oldDate);
  }
  utimesSync(path, oldDate, oldDate);
}
```

在 import 中加入 `utimesSync`：

```ts
  utimesSync,
```

- [ ] **Step 2: 运行 cleanup API 测试确认失败**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "runtime cleanup"
```

Expected:

```text
FAIL apps/daemon/test/integration/api.test.ts
GET /runtime/cleanup/preview returns 404
```

- [ ] **Step 3: 新增 cleanup route**

创建 `apps/daemon/src/api/routes.cleanup.ts`：

```ts
import type { CleanupDeleteRequest } from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CleanupError, type CleanupRequest } from '../cleanup/service.js';
import { apiError } from './errors.js';

export type RuntimeCleanupService = {
  preview(request: CleanupRequest): unknown;
  delete(request: CleanupRequest): unknown;
};

export async function registerCleanupRoutes(
  server: FastifyInstance,
  cleanup: RuntimeCleanupService
): Promise<void> {
  server.get<{ Querystring: { olderThanDays?: string } }>(
    '/runtime/cleanup/preview',
    async (request, reply) => {
      const parsed = parseOlderThanDays(request.query.olderThanDays);
      if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

      try {
        return cleanup.preview({ olderThanDays: parsed.value });
      } catch (error) {
        return sendCleanupError(error, reply);
      }
    }
  );

  server.post<{ Body: unknown }>('/runtime/cleanup', async (request, reply) => {
    const parsed = parseCleanupBody(request.body);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return cleanup.delete({ olderThanDays: parsed.value.olderThanDays });
    } catch (error) {
      return sendCleanupError(error, reply);
    }
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseOlderThanDays(value: unknown): ParseResult<number> {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'olderThanDays must be a positive integer' };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, message: 'olderThanDays must be a positive integer' };
  }
  return { ok: true, value: parsed };
}

function parseCleanupBody(body: unknown): ParseResult<CleanupDeleteRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (body.confirm !== true) return { ok: false, message: 'confirm must be true' };
  const olderThanDays = Number(body.olderThanDays);
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    return { ok: false, message: 'olderThanDays must be a positive integer' };
  }
  return { ok: true, value: { olderThanDays, confirm: true } };
}

function sendCleanupError(error: unknown, reply: FastifyReply) {
  if (error instanceof CleanupError) {
    if (error.code === 'VALIDATION_FAILED') {
      return reply.code(400).send(apiError(error.code, error.message));
    }
    if (error.code === 'CLEANUP_FAILED') {
      return reply.code(500).send(apiError(error.code, 'Cleanup failed'));
    }
  }

  return reply.code(500).send(apiError('CLEANUP_FAILED', 'Cleanup failed'));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: 接入 server**

修改 `apps/daemon/src/api/server.ts`。

新增 import：

```ts
import { createCleanupService } from '../cleanup/service.js';
import { createRunRepository, createThreadRepository } from '../storage/repositories.js';
import { registerCleanupRoutes } from './routes.cleanup.js';
```

把 Task 5 中的 repository 初始化扩展为：

```ts
  const runRepository = createRunRepository(db);
  const threadRepository = createThreadRepository(db);
```

创建 cleanup service：

```ts
  const cleanupService = createCleanupService({
    dataDir,
    runs: runRepository,
    threads: threadRepository
  });
```

在 schedule routes 和 diagnostics routes 附近注册：

```ts
  await registerScheduleRoutes(server, scheduler);
  await registerCleanupRoutes(server, cleanupService);
  await registerDiagnosticsRoutes(server, {
    dataDir,
    runs: runRepository,
    getCodexStatusSnapshot: () =>
      buildCodexStatusResponse({
        codexBin,
        codexHome: resolvedCodexHome,
        capabilities
      })
  });
```

如果 Task 5 已经引入 `createRunRepository`，把 import 扩展为同一行的 `createRunRepository, createThreadRepository`，不要保留重复 import。

- [ ] **Step 5: 运行 cleanup API 测试确认通过**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "runtime cleanup"
```

Expected:

```text
PASS apps/daemon/test/integration/api.test.ts
```

- [ ] **Step 6: 运行 API 相关回归**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/cleanup-service.test.ts \
  test/integration/api.test.ts \
  test/integration/diagnostics.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/cleanup-service.test.ts
PASS apps/daemon/test/integration/api.test.ts
PASS apps/daemon/test/integration/diagnostics.test.ts
```

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/api/routes.cleanup.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose runtime cleanup api"
```

## Task 8: Diagnostics After Cleanup Integration

**Files:**
- Modify: `apps/daemon/test/integration/api.test.ts`
- Modify: `apps/daemon/test/integration/diagnostics.test.ts`

- [ ] **Step 1: 写跨功能集成测试**

在 `apps/daemon/test/integration/api.test.ts` 的 cleanup 测试后追加：

```ts
  it('keeps run database records after cleanup so diagnostics reports missing files', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertApiRun(database, 'run_old', 'succeeded', 'succeeded');
    writeOldApiDir(join(tempDir, 'runs', 'run_old'), {
      'meta.json': '{"id":"run_old"}',
      'events.ndjson': '{"type":"done"}\n'
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, db: database });

    const deleted = await authPost('/runtime/cleanup', { olderThanDays: 30, confirm: true });
    const diagnostics = await authGet('/runs/run_old/diagnostics');

    expect(deleted.statusCode).toBe(200);
    expect(createRunRepository(database).getRun('run_old')).toBeDefined();
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json().runId).toBe('run_old');
    expect(diagnostics.json().files).toEqual([]);
    expect(diagnostics.json().warnings).toEqual(
      expect.arrayContaining(['Run diagnostics directory is missing.'])
    );
  });
```

- [ ] **Step 2: 运行测试确认当前行为**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "keeps run database records after cleanup"
```

Expected:

```text
PASS apps/daemon/test/integration/api.test.ts
```

如果失败，修复点只允许在 cleanup delete 不删除 DB、diagnostics collector 对 DB 存在但 run dir 缺失返回 200 这两个边界内调整，不引入 SQLite 删除。

- [ ] **Step 3: 运行 diagnostics 和 cleanup 集成组合**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/integration/api.test.ts \
  test/integration/diagnostics.test.ts
```

Expected:

```text
PASS apps/daemon/test/integration/api.test.ts
PASS apps/daemon/test/integration/diagnostics.test.ts
```

- [ ] **Step 4: 提交**

```bash
git add apps/daemon/test/integration/api.test.ts apps/daemon/test/integration/diagnostics.test.ts
git commit -m "test: cover diagnostics after cleanup"
```

## Task 9: Full Verification Gate

**Files:**
- No source changes expected.

- [ ] **Step 1: 运行 focused readiness tests**

Run:

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/protocol-shape.test.ts \
  test/unit/codex-status.test.ts \
  test/unit/diagnostics-redactor.test.ts \
  test/unit/diagnostics-collector.test.ts \
  test/unit/cleanup-service.test.ts \
  test/integration/diagnostics.test.ts \
  test/integration/api.test.ts
```

Expected:

```text
PASS apps/daemon/test/unit/protocol-shape.test.ts
PASS apps/daemon/test/unit/codex-status.test.ts
PASS apps/daemon/test/unit/diagnostics-redactor.test.ts
PASS apps/daemon/test/unit/diagnostics-collector.test.ts
PASS apps/daemon/test/unit/cleanup-service.test.ts
PASS apps/daemon/test/integration/diagnostics.test.ts
PASS apps/daemon/test/integration/api.test.ts
```

- [ ] **Step 2: 运行 workspace typecheck**

Run:

```bash
pnpm typecheck
```

Expected:

```text
All workspace typecheck scripts exit with code 0.
```

- [ ] **Step 3: 运行全量自动化测试**

Run:

```bash
pnpm test
```

Expected:

```text
All workspace test scripts exit with code 0.
Real Codex gated smoke remains skipped unless CLAWEE_RUN_REAL_CODEX_SMOKE=1 is set.
```

- [ ] **Step 4: 运行默认 real Codex smoke 文件**

Run:

```bash
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected:

```text
PASS apps/daemon/test/smoke/real-codex-smoke.test.ts
Real Codex tests that require CLAWEE_RUN_REAL_CODEX_SMOKE=1 are skipped by default.
```

- [ ] **Step 5: 运行 diff whitespace gate**

Run:

```bash
git diff --check
```

Expected:

```text
No output and exit code 0.
```

- [ ] **Step 6: 可选真实 Codex scheduler smoke**

只有当前机器 Codex 登录态、网络和额度都可用时运行：

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"
```

Expected:

```text
PASS apps/daemon/test/smoke/real-codex-smoke.test.ts
```

如果失败原因是认证、网络、额度或模型不可用，记录为环境阻塞，不能把 R7 readiness 声明为真实 Codex gate 已通过。

- [ ] **Step 7: 最终提交**

如果 Step 1-5 发现需要修复的小问题，修复后提交：

```bash
git add apps/daemon/src apps/daemon/test packages/protocol/src
git commit -m "test: verify runtime readiness"
```

如果 Step 1-5 没有产生文件变更，不创建空提交。

## 10. 实施顺序和提交节奏

按以下顺序执行：

1. Task 1: protocol contracts。
2. Task 2: shared Codex status builder。
3. Task 3: diagnostics export redaction。
4. Task 4: diagnostics collector service。
5. Task 5: enhanced diagnostics API。
6. Task 6: cleanup service。
7. Task 7: cleanup API routes and server wiring。
8. Task 8: diagnostics after cleanup integration。
9. Task 9: full verification gate。

每个 Task 完成后单独提交。不要把 cleanup 和 diagnostics 的主要实现混在一个提交里；这两个模块边界清晰，单独提交更利于回归定位。

## 11. 风险和处理

1. **`redactText()` 增强影响 MCP 旧测试。** Task 3 必须运行 MCP parser/redaction/runner 相关测试，确认 central redaction 改动没有破坏已有语义。
2. **diagnostics route 行为从 missing run 返回 200 变成 404。** Task 5 必须同步更新旧测试，并以 DB 是否存在为准，而不是以 run directory 是否存在为准。
3. **cleanup 删除范围必须严格限定。** Cleanup service 不接收 path 或 id 删除参数，只从重新扫描出的候选项删除。
4. **目录 mtime 不足以判断嵌套文件变化。** Cleanup service 使用目录树最大 mtime，避免只看顶层目录导致误删。
5. **symlink 风险。** diagnostics 和 cleanup 都用 `lstatSync()` 拒绝 symlink，并用 `realpathSync()` 做边界校验。
6. **DB 记录不能删除。** cleanup 删除的是 Runtime 生成的文件目录，SQLite rows 保留，保证后续 UI 仍能展示历史记录和缺失诊断 warning。

## 12. 自查清单

实现完成后逐项确认：

1. `/runs/:id/diagnostics` 默认文件列表是 `meta.json/events.ndjson/stderr.redacted.log/diagnostics.json`。
2. `raw.redacted.ndjson` 只在 `includeRawRedacted=true` 出现。
3. 诊断导出响应包含 `codexStatusSnapshot`。
4. 诊断文件内容不包含测试中的 `secret-token/raw-token/plain-token`。
5. 非法 run id 返回 `400 VALIDATION_FAILED`。
6. 合法但 DB 中不存在的 run 返回 `404 RUN_NOT_FOUND`。
7. DB 中存在但 run directory 缺失返回 `200`，`files` 为空并包含 warning。
8. cleanup preview 不删除文件。
9. cleanup confirm 缺失或 `false` 返回 `400 VALIDATION_FAILED`。
10. cleanup confirm 删除前重新扫描候选项。
11. cleanup 不删除 active run、active thread workspace、external workspace、非 `run_*`/`thread_*` 目录、symlink。
12. cleanup 删除后 DB run/thread row 仍存在。
13. `pnpm typecheck` 通过。
14. `pnpm test` 通过。
15. `git diff --check` 通过。

## 13. 完成后的可声明状态

完成本计划并通过验证后，可以声明：

> R7 Runtime Readiness 后端能力完成：Runtime 已具备第一版增强诊断导出、导出层二次脱敏、Codex 状态快照、本地 Runtime 数据 dry-run/confirm 清理和 readiness 验收命令，可作为后续 UI/桌面壳的基础后端继续推进。

不能声明：

1. 产品发布完成。
2. UI 完成。
3. zip 诊断包完成。
4. 自动后台清理完成。
5. SQLite 历史裁剪完成。
6. 所有敏感信息都能 100% 脱敏。
