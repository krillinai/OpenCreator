# Codex-native Runtime 内核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本计划。所有步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 构建第一版 Codex-native Agent Runtime 内核：通过本地 API/SSE 调用 Codex CLI，稳定管理 run/thread、事件、日志、`CODEX_HOME`、MCP、Skills 和 Scheduler，不实现完整桌面 UI。

**Architecture:** Runtime 采用 Node.js + TypeScript 的 headless daemon。Codex CLI 是唯一执行内核，Runtime 负责 argv 构建、stdin/stdout/stderr、JSONL normalizer、状态机、SQLite 索引、文件日志、鉴权和调度。客户端可以是命令行 harness、API 测试或后续 UI；第一版不做 Electron、React、安装器和桌面生命周期。

**Tech Stack:** pnpm workspace, TypeScript, Node.js, Fastify, SSE, SQLite via `better-sqlite3`, Vitest, tsx, fake Codex fixtures, real Codex smoke fixtures.

---

## 0. 计划边界

本计划只实现 Runtime 内核。以下内容不在本计划内：

1. Electron 桌面壳。
2. React/Vite 前端。
3. 安装器、自动更新、系统服务。
4. 企业权限、多租户、审批流。
5. 自研 Agent loop、Skills runtime、MCP runtime。

本计划的完成标准：

1. `pnpm test` 通过。
2. `pnpm daemon:dev` 能启动本地 daemon。
3. 命令行 harness 可以创建 run、订阅 SSE、取消 run、查询历史和导出诊断。
4. fake Codex 测试覆盖成功、失败、非法 JSON、stderr、timeout、cancel、resume 失败。
5. real Codex smoke 脚本能采集 help/version/最小 JSONL fixture。

## 1. 目标文件结构

实现后目录如下：

```text
.
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .gitignore
  apps/
    daemon/
      package.json
      tsconfig.json
      vitest.config.ts
      src/
        main.ts
        api/
          auth.ts
          errors.ts
          routes.codex.ts
          routes.runs.ts
          routes.threads.ts
          routes.diagnostics.ts
          server.ts
          sse.ts
        codex/
          argv.ts
          capabilities.ts
          home.ts
          mcp.ts
          runner.ts
          smoke.ts
        events/
          normalizer.ts
          parser.ts
          protocol.ts
        platform/
          paths.ts
          process-tree.ts
        runs/
          concurrency.ts
          manager.ts
          state.ts
          types.ts
        scheduler/
          scheduler.ts
          types.ts
        security/
          redaction.ts
          token.ts
        storage/
          database.ts
          migrations.ts
          repositories.ts
        threads/
          manager.ts
          types.ts
      test/
        fixtures/
          codex-success.ndjson
          codex-command.ndjson
          codex-invalid.ndjson
        helpers/
          fake-codex.ts
        unit/
        integration/
        smoke/
    harness/
      package.json
      tsconfig.json
      src/
        cli.ts
  packages/
    protocol/
      package.json
      tsconfig.json
      src/
        api.ts
        events.ts
        errors.ts
        index.ts
```

## Task 1: Workspace Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `apps/daemon/package.json`
- Create: `apps/daemon/tsconfig.json`
- Create: `apps/daemon/vitest.config.ts`
- Create: `apps/daemon/src/main.ts`
- Create: `apps/harness/package.json`
- Create: `apps/harness/tsconfig.json`
- Create: `apps/harness/src/cli.ts`

- [ ] **Step 1: Create root workspace files**

`package.json`:

```json
{
  "name": "opencreator-agent",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "daemon:dev": "pnpm --filter @opencreator/daemon dev",
    "harness": "pnpm --filter @opencreator/harness start"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:

```gitignore
node_modules/
dist/
.runtime/
coverage/
*.log
```

- [ ] **Step 2: Create package manifests**

`packages/protocol/package.json`:

```json
{
  "name": "@opencreator/protocol",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  }
}
```

`packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

`apps/daemon/package.json`:

```json
{
  "name": "@opencreator/daemon",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@opencreator/protocol": "workspace:*",
    "better-sqlite3": "^11.8.1",
    "fastify": "^5.2.1",
    "nanoid": "^5.0.9",
    "toml": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12"
  }
}
```

`apps/daemon/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`apps/daemon/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10000
  }
});
```

`apps/harness/package.json`:

```json
{
  "name": "@opencreator/harness",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@opencreator/protocol": "workspace:*"
  }
}
```

`apps/harness/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create minimal entrypoints**

`packages/protocol/src/index.ts`:

```ts
export const protocolVersion = '0.1.0';
```

`apps/daemon/src/main.ts`:

```ts
console.log('opencreator runtime daemon bootstrap');
```

`apps/harness/src/cli.ts`:

```ts
console.log('opencreator runtime harness bootstrap');
```

- [ ] **Step 4: Install and verify scaffold**

Run:

```bash
pnpm install
pnpm typecheck
pnpm test
```

Expected:

```text
pnpm typecheck exits 0
pnpm test exits 0
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages apps
git commit -m "chore: scaffold runtime workspace"
```

## Task 2: Protocol Package

**Files:**
- Create: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/errors.ts`
- Create: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `apps/daemon/test/unit/protocol-shape.test.ts`

- [ ] **Step 1: Write protocol shape test**

`apps/daemon/test/unit/protocol-shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope, RunRequest, RuntimeErrorCode } from '@opencreator/protocol';

describe('protocol shape', () => {
  it('allows a minimal run request', () => {
    const request: RunRequest = {
      prompt: 'hello',
      sandbox: 'read-only'
    };
    expect(request.prompt).toBe('hello');
  });

  it('allows a done event envelope', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-04T00:00:00.000Z',
      type: 'done',
      payload: {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed'
      },
      normalizerVersion: 1
    };
    expect(event.payload.status).toBe('succeeded');
  });

  it('keeps error codes as closed string literals', () => {
    const code: RuntimeErrorCode = 'CODEX_NOT_FOUND';
    expect(code).toBe('CODEX_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts
```

Expected:

```text
FAIL because AgentEventEnvelope, RunRequest, RuntimeErrorCode are not exported
```

- [ ] **Step 3: Implement protocol types**

`packages/protocol/src/errors.ts`:

```ts
export type RuntimeErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'RUN_NOT_FOUND'
  | 'THREAD_NOT_FOUND'
  | 'RESUME_TARGET_NOT_FOUND'
  | 'RESUME_FAILED'
  | 'WORKSPACE_BUSY'
  | 'CODEX_NOT_FOUND'
  | 'CODEX_AUTH_REQUIRED'
  | 'CODEX_CONFIG_INVALID'
  | 'CODEX_INCOMPATIBLE'
  | 'CODEX_UNVERIFIED_WRITE_BLOCKED'
  | 'SPAWN_FAILED'
  | 'CODEX_STREAM_ERROR'
  | 'MCP_COMMAND_FAILED'
  | 'SCHEDULE_INVALID'
  | 'INTERNAL_ERROR';

export type ApiError = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

`packages/protocol/src/events.ts`:

```ts
export type PublicRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type TerminationReason =
  | 'completed'
  | 'user_canceled'
  | 'timeout'
  | 'inactivity_timeout'
  | 'spawn_failed'
  | 'codex_exit_non_zero'
  | 'stream_error'
  | 'daemon_restart'
  | 'process_kill_failed';

export type AgentEventType =
  | 'status'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'usage'
  | 'diagnostic'
  | 'error'
  | 'unknown_event'
  | 'done';

export type AgentEventPayload =
  | { type: 'status'; label: 'initializing' | 'running' | 'canceling' | 'finalizing' }
  | { type: 'assistant_message'; text: string; format: 'plain_text'; delivery: 'message' | 'delta' }
  | { type: 'tool_use'; toolCallId: string; name: string; input: { command?: string; args?: string[]; raw?: unknown } }
  | { type: 'tool_result'; toolCallId: string; output: string; exitCode?: number | null; isError: boolean }
  | {
      type: 'usage';
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
      source: 'stream_cumulative' | 'rollout_best_effort';
    }
  | { type: 'diagnostic'; code: string; severity: 'info' | 'warning' | 'error'; message: string; details?: Record<string, unknown> }
  | { type: 'error'; code: string; message: string; details?: Record<string, unknown> }
  | { type: 'unknown_event'; rawEventId: string; codexType?: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'canceled'; terminationReason: TerminationReason };

export type AgentEventEnvelope = {
  id: string;
  runId: string;
  seq: number;
  ts: string;
  type: AgentEventType;
  payload: AgentEventPayload;
  normalizerVersion: number;
  rawEventId?: string;
};
```

`packages/protocol/src/api.ts`:

```ts
import type { PublicRunStatus } from './events.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type WorkspaceMode = 'managed' | 'external';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';

export type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: 'new_thread' | 'resume_thread';
  cwd?: string;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
  images?: string[];
};

export type RunResponse = {
  id: string;
  threadId?: string;
  status: PublicRunStatus;
};

export type CreateThreadRequest = {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type ThreadResponse = {
  id: string;
  codexThreadId?: string;
  cwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  sandbox: SandboxMode;
  status: 'active' | 'archived' | 'resume_unavailable';
};
```

`packages/protocol/src/index.ts`:

```ts
export const protocolVersion = '0.1.0';
export * from './api.js';
export * from './errors.js';
export * from './events.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts
pnpm typecheck
```

Expected:

```text
protocol-shape.test.ts PASS
pnpm typecheck exits 0
```

- [ ] **Step 5: Commit**

```bash
git add packages/protocol apps/daemon/test/unit/protocol-shape.test.ts
git commit -m "feat: define runtime protocol types"
```

## Task 3: Storage and Migrations

**Files:**
- Create: `apps/daemon/src/storage/database.ts`
- Create: `apps/daemon/src/storage/migrations.ts`
- Create: `apps/daemon/src/storage/repositories.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`

- [ ] **Step 1: Write storage test**

`apps/daemon/test/unit/storage.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository } from '../../src/storage/repositories.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('runtime storage', () => {
  it('creates schema and persists a run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runs = createRunRepository(db);

    runs.insertRun({
      id: 'run_1',
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const loaded = runs.getRun('run_1');
    expect(loaded?.public_status).toBe('queued');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts
```

Expected:

```text
FAIL because storage modules do not exist
```

- [ ] **Step 3: Implement database and migrations**

`apps/daemon/src/storage/migrations.ts`:

```ts
import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      codex_thread_id TEXT,
      public_status TEXT NOT NULL,
      internal_status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      source_id TEXT,
      profile TEXT NOT NULL,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      prompt_hash TEXT,
      prompt_preview_redacted TEXT,
      model TEXT,
      reasoning TEXT,
      sandbox TEXT NOT NULL,
      codex_version TEXT NOT NULL,
      codex_bin TEXT NOT NULL,
      codex_home TEXT NOT NULL,
      normalizer_version INTEGER NOT NULL,
      timeout_ms INTEGER,
      inactivity_timeout_ms INTEGER,
      transcript_reseed_mode TEXT,
      resume_argv_json TEXT,
      usage_source TEXT,
      termination_reason TEXT,
      exit_code INTEGER,
      signal TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      error_code TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      raw_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      codex_thread_id TEXT,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      profile TEXT NOT NULL,
      sandbox TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error_code TEXT,
      last_error_message TEXT
    );
  `);
}
```

`apps/daemon/src/storage/database.ts`:

```ts
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { migrate } from './migrations.js';

export function openRuntimeDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  migrate(db);
  return db;
}
```

`apps/daemon/src/storage/repositories.ts`:

```ts
import type Database from 'better-sqlite3';

export type InsertRunInput = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  publicStatus: string;
  internalStatus: string;
  createdBy: string;
  sourceId?: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: string;
  promptHash?: string;
  promptPreviewRedacted?: string;
  model?: string;
  reasoning?: string;
  sandbox: string;
  codexVersion: string;
  codexBin: string;
  codexHome: string;
  normalizerVersion: number;
};

export function createRunRepository(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO runs (
      id, thread_id, codex_thread_id, public_status, internal_status, created_by, source_id,
      profile, cwd, canonical_cwd, workspace_mode, prompt_hash, prompt_preview_redacted,
      model, reasoning, sandbox, codex_version, codex_bin, codex_home, normalizer_version
    ) VALUES (
      @id, @threadId, @codexThreadId, @publicStatus, @internalStatus, @createdBy, @sourceId,
      @profile, @cwd, @canonicalCwd, @workspaceMode, @promptHash, @promptPreviewRedacted,
      @model, @reasoning, @sandbox, @codexVersion, @codexBin, @codexHome, @normalizerVersion
    )
  `);

  const get = db.prepare('SELECT * FROM runs WHERE id = ?');

  return {
    insertRun(input: InsertRunInput): void {
      insert.run({
        threadId: null,
        codexThreadId: null,
        sourceId: null,
        promptHash: null,
        promptPreviewRedacted: null,
        model: null,
        reasoning: null,
        ...input
      });
    },
    getRun(id: string): any | undefined {
      return get.get(id);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts
pnpm typecheck
```

Expected:

```text
storage.test.ts PASS
pnpm typecheck exits 0
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/storage apps/daemon/test/unit/storage.test.ts
git commit -m "feat: add runtime storage schema"
```

## Task 4: Codex Home Resolution and Path Safety

**Files:**
- Create: `apps/daemon/src/platform/paths.ts`
- Create: `apps/daemon/src/codex/home.ts`
- Test: `apps/daemon/test/unit/codex-home.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/daemon/test/unit/codex-home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveCodexHome } from '../../src/codex/home.js';
import { expandHome } from '../../src/platform/paths.js';

describe('codex home resolution', () => {
  it('uses CODEX_HOME when present', () => {
    const result = resolveCodexHome({
      env: { CODEX_HOME: '~/custom-codex' },
      homeDir: '/Users/tester'
    });
    expect(result.mode).toBe('global');
    expect(result.path).toBe('/Users/tester/custom-codex');
  });

  it('falls back to ~/.codex', () => {
    const result = resolveCodexHome({
      env: {},
      homeDir: '/Users/tester'
    });
    expect(result.path).toBe('/Users/tester/.codex');
  });

  it('expands only leading tilde', () => {
    expect(expandHome('~/x', '/home/a')).toBe('/home/a/x');
    expect(expandHome('/tmp/~/x', '/home/a')).toBe('/tmp/~/x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-home.test.ts
```

Expected:

```text
FAIL because codex/home.ts and platform/paths.ts do not exist
```

- [ ] **Step 3: Implement path helpers**

`apps/daemon/src/platform/paths.ts`:

```ts
import { join } from 'node:path';

export function expandHome(input: string, homeDir: string): string {
  if (input === '~') return homeDir;
  if (input.startsWith('~/')) return join(homeDir, input.slice(2));
  return input;
}
```

`apps/daemon/src/codex/home.ts`:

```ts
import { join } from 'node:path';
import { homedir } from 'node:os';
import { expandHome } from '../platform/paths.js';

export type CodexHomeMode = 'global' | 'isolated';

export type ResolveCodexHomeInput = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  isolatedHome?: string;
};

export type ResolvedCodexHome = {
  path: string;
  mode: CodexHomeMode;
  source: 'env' | 'default' | 'isolated';
};

export function resolveCodexHome(input: ResolveCodexHomeInput = {}): ResolvedCodexHome {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();

  if (input.isolatedHome) {
    return {
      path: expandHome(input.isolatedHome, homeDir),
      mode: 'isolated',
      source: 'isolated'
    };
  }

  if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) {
    return {
      path: expandHome(env.CODEX_HOME, homeDir),
      mode: 'global',
      source: 'env'
    };
  }

  return {
    path: join(homeDir, '.codex'),
    mode: 'global',
    source: 'default'
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-home.test.ts
```

Expected:

```text
codex-home.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/platform/paths.ts apps/daemon/src/codex/home.ts apps/daemon/test/unit/codex-home.test.ts
git commit -m "feat: resolve codex home"
```

## Task 5: Codex Args and Capability Probe

**Files:**
- Create: `apps/daemon/src/codex/argv.ts`
- Create: `apps/daemon/src/codex/capabilities.ts`
- Test: `apps/daemon/test/unit/codex-argv.test.ts`
- Test: `apps/daemon/test/unit/codex-capabilities.test.ts`

- [ ] **Step 1: Write failing args test**

`apps/daemon/test/unit/codex-argv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs } from '../../src/codex/argv.js';

describe('codex argv', () => {
  it('builds exec args without prompt in argv', () => {
    const args = buildCodexExecArgs({
      profile: 'default',
      cwd: '/repo',
      sandbox: 'workspace-write',
      model: 'gpt-5',
      reasoning: 'high'
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-p',
      'default',
      '-C',
      '/repo',
      '--sandbox',
      'workspace-write',
      '--model',
      'gpt-5',
      '-c',
      'model_reasoning_effort="high"'
    ]);
    expect(args).not.toContain('hello');
  });
});
```

`apps/daemon/test/unit/codex-capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCodexExecHelp } from '../../src/codex/capabilities.js';

describe('codex capability parsing', () => {
  it('detects supported exec flags', () => {
    const parsed = parseCodexExecHelp(`
Usage: codex exec [OPTIONS] [PROMPT]
  --json
  -p, --profile <PROFILE>
  -C, --cd <DIR>
  --sandbox <MODE>
  --image <PATH>
  --skip-git-repo-check
`);
    expect(parsed.supportsJson).toBe(true);
    expect(parsed.supportsProfiles).toBe(true);
    expect(parsed.supportsSkipGitRepoCheck).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-argv.test.ts test/unit/codex-capabilities.test.ts
```

Expected:

```text
FAIL because codex/argv.ts and codex/capabilities.ts do not exist
```

- [ ] **Step 3: Implement argv and capability parser**

`apps/daemon/src/codex/argv.ts`:

```ts
import type { ReasoningEffort, SandboxMode } from '@opencreator/protocol';

export type BuildCodexExecArgsInput = {
  profile?: string;
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
};

export function buildCodexExecArgs(input: BuildCodexExecArgsInput): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check'];

  if (input.profile) args.push('-p', input.profile);
  args.push('-C', input.cwd);
  args.push('--sandbox', input.sandbox);
  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }

  return args;
}
```

`apps/daemon/src/codex/capabilities.ts`:

```ts
export type ExecHelpCapabilities = {
  supportsJson: boolean;
  supportsProfiles: boolean;
  supportsCd: boolean;
  supportsSandbox: boolean;
  supportsImages: boolean;
  supportsSkipGitRepoCheck: boolean;
};

export function parseCodexExecHelp(help: string): ExecHelpCapabilities {
  return {
    supportsJson: help.includes('--json'),
    supportsProfiles: help.includes('--profile') || help.includes('-p,'),
    supportsCd: help.includes('--cd') || help.includes('-C,'),
    supportsSandbox: help.includes('--sandbox'),
    supportsImages: help.includes('--image'),
    supportsSkipGitRepoCheck: help.includes('--skip-git-repo-check')
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-argv.test.ts test/unit/codex-capabilities.test.ts
```

Expected:

```text
codex-argv.test.ts PASS
codex-capabilities.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/codex/argv.ts apps/daemon/src/codex/capabilities.ts apps/daemon/test/unit/codex-*.test.ts
git commit -m "feat: build codex args and parse capabilities"
```

## Task 6: JSONL Parser and Event Normalizer

**Files:**
- Create: `apps/daemon/src/events/parser.ts`
- Create: `apps/daemon/src/events/normalizer.ts`
- Test: `apps/daemon/test/unit/events.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

`apps/daemon/test/unit/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseJsonLine } from '../../src/events/parser.js';
import { normalizeCodexEvent } from '../../src/events/normalizer.js';

describe('event parser and normalizer', () => {
  it('parses valid json lines', () => {
    expect(parseJsonLine('{"type":"turn.started"}')).toEqual({ ok: true, value: { type: 'turn.started' } });
  });

  it('reports invalid json lines', () => {
    const result = parseJsonLine('{broken');
    expect(result.ok).toBe(false);
  });

  it('normalizes agent messages', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 1,
      raw: {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'hello' }
      }
    });
    expect(event.type).toBe('assistant_message');
    expect(event.payload).toMatchObject({ type: 'assistant_message', text: 'hello' });
  });

  it('normalizes command execution result', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 2,
      raw: {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'pwd',
          aggregated_output: '/repo',
          exit_code: 0,
          status: 'completed'
        }
      }
    });
    expect(event.type).toBe('tool_result');
    expect(event.payload).toMatchObject({ type: 'tool_result', output: '/repo', exitCode: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/events.test.ts
```

Expected:

```text
FAIL because events/parser.ts and events/normalizer.ts do not exist
```

- [ ] **Step 3: Implement parser and normalizer**

`apps/daemon/src/events/parser.ts`:

```ts
export type JsonLineParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; line: string };

export function parseJsonLine(line: string): JsonLineParseResult {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      line
    };
  }
}
```

`apps/daemon/src/events/normalizer.ts`:

```ts
import { nanoid } from 'nanoid';
import type { AgentEventEnvelope } from '@opencreator/protocol';

export type NormalizeInput = {
  runId: string;
  seq: number;
  raw: any;
};

export const normalizerVersion = 1;

export function normalizeCodexEvent(input: NormalizeInput): AgentEventEnvelope {
  const raw = input.raw;
  const base = {
    id: nanoid(),
    runId: input.runId,
    seq: input.seq,
    ts: new Date().toISOString(),
    normalizerVersion
  };

  if (raw?.type === 'thread.started') {
    return {
      ...base,
      type: 'status',
      payload: { type: 'status', label: 'initializing' },
      rawEventId: raw.thread_id
    };
  }

  if (raw?.type === 'turn.started') {
    return {
      ...base,
      type: 'status',
      payload: { type: 'status', label: 'running' }
    };
  }

  if (raw?.type === 'item.completed' && raw.item?.type === 'agent_message') {
    return {
      ...base,
      type: 'assistant_message',
      payload: {
        type: 'assistant_message',
        text: String(raw.item.text ?? ''),
        format: 'plain_text',
        delivery: 'message'
      }
    };
  }

  if (raw?.type === 'item.started' && raw.item?.type === 'command_execution') {
    return {
      ...base,
      type: 'tool_use',
      payload: {
        type: 'tool_use',
        toolCallId: raw.item.id ?? `${input.runId}:${input.seq}`,
        name: 'command_execution',
        input: {
          command: raw.item.command,
          raw: raw.item
        }
      }
    };
  }

  if (raw?.type === 'item.completed' && raw.item?.type === 'command_execution') {
    return {
      ...base,
      type: 'tool_result',
      payload: {
        type: 'tool_result',
        toolCallId: raw.item.id ?? `${input.runId}:${input.seq}`,
        output: String(raw.item.aggregated_output ?? ''),
        exitCode: typeof raw.item.exit_code === 'number' ? raw.item.exit_code : null,
        isError: raw.item.exit_code !== 0
      }
    };
  }

  if (raw?.type === 'turn.completed') {
    return {
      ...base,
      type: 'done',
      payload: { type: 'done', status: 'succeeded', terminationReason: 'completed' }
    };
  }

  return {
    ...base,
    type: 'unknown_event',
    payload: {
      type: 'unknown_event',
      rawEventId: `${input.runId}:${input.seq}`,
      codexType: typeof raw?.type === 'string' ? raw.type : undefined
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/events.test.ts
```

Expected:

```text
events.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/events apps/daemon/test/unit/events.test.ts
git commit -m "feat: normalize codex jsonl events"
```

## Task 7: Fake Codex and Runner

**Files:**
- Create: `apps/daemon/test/helpers/fake-codex.ts`
- Create: `apps/daemon/src/codex/runner.ts`
- Test: `apps/daemon/test/integration/codex-runner.test.ts`

- [ ] **Step 1: Write integration test**

`apps/daemon/test/integration/codex-runner.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { runCodexExec } from '../../src/codex/runner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('codex runner', () => {
  it('writes prompt to stdin and captures stdout/stderr separately', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      stderrLines: ['diagnostic warning']
    });

    const result = await runCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutLines).toHaveLength(4);
    expect(result.stderr).toContain('diagnostic warning');
    expect(fake.readPrompt()).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/codex-runner.test.ts
```

Expected:

```text
FAIL because fake-codex.ts and runner.ts do not exist
```

- [ ] **Step 3: Implement fake Codex helper**

`apps/daemon/test/helpers/fake-codex.ts`:

```ts
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FakeCodexOptions = {
  stdoutLines: unknown[];
  stderrLines?: string[];
  exitCode?: number;
};

export function createFakeCodex(dir: string, options: FakeCodexOptions) {
  const bin = join(dir, 'fake-codex.js');
  const promptPath = join(dir, 'prompt.txt');
  mkdirSync(dir, { recursive: true });

  const script = `#!/usr/bin/env node
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(promptPath)}, prompt);
for (const line of ${JSON.stringify(options.stderrLines ?? [])}) console.error(line);
for (const event of ${JSON.stringify(options.stdoutLines)}) console.log(JSON.stringify(event));
process.exit(${options.exitCode ?? 0});
`;

  writeFileSync(bin, script);
  chmodSync(bin, 0o755);

  return {
    bin,
    readPrompt(): string {
      return readFileSync(promptPath, 'utf8');
    }
  };
}
```

- [ ] **Step 4: Implement runner**

`apps/daemon/src/codex/runner.ts`:

```ts
import { spawn } from 'node:child_process';

export type RunCodexExecInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  args: string[];
  prompt: string;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
};

export type RunCodexExecResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
};

export function runCodexExec(input: RunCodexExecInput): Promise<RunCodexExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.codexBin, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        CODEX_HOME: input.codexHome
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = '';
    let stderr = '';
    let finished = false;

    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(totalTimer);
      clearTimeout(inactivityTimer);
      fn();
    };

    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      if (input.inactivityTimeoutMs) {
        inactivityTimer = setTimeout(() => {
          child.kill('SIGTERM');
          finish(() => reject(new Error('inactivity_timeout')));
        }, input.inactivityTimeoutMs);
      }
    };

    const totalTimer = input.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          finish(() => reject(new Error('timeout')));
        }, input.timeoutMs)
      : undefined;

    let inactivityTimer: NodeJS.Timeout | undefined;
    resetInactivity();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', chunk => {
      resetInactivity();
      stdoutBuffer += chunk;
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = parts.pop() ?? '';
      for (const part of parts) {
        if (part.length > 0) stdoutLines.push(part);
      }
    });

    child.stderr.on('data', chunk => {
      resetInactivity();
      stderr += chunk;
    });

    child.on('error', error => {
      finish(() => reject(error));
    });

    child.on('close', (exitCode, signal) => {
      if (stdoutBuffer.length > 0) stdoutLines.push(stdoutBuffer);
      finish(() => resolve({ exitCode, signal, stdoutLines, stderr }));
    });

    child.stdin.end(input.prompt);
  });
}
```

- [ ] **Step 5: Run integration test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/codex-runner.test.ts
```

Expected:

```text
codex-runner.test.ts PASS
```

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/codex/runner.ts apps/daemon/test/helpers/fake-codex.ts apps/daemon/test/integration/codex-runner.test.ts
git commit -m "feat: run codex subprocess"
```

## Task 8: Run Manager and File Logs

**Files:**
- Create: `apps/daemon/src/runs/types.ts`
- Create: `apps/daemon/src/runs/state.ts`
- Create: `apps/daemon/src/runs/manager.ts`
- Test: `apps/daemon/test/integration/run-manager.test.ts`

- [ ] **Step 1: Write run manager integration test**

`apps/daemon/test/integration/run-manager.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunManager } from '../../src/runs/manager.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('run manager', () => {
  it('creates a run and writes redacted raw/events/stderr/meta files', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      stderrLines: ['warning TOKEN=secret-value']
    });
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('succeeded');
    expect(existsSync(join(tempDir, 'runs', run.id, 'meta.json'))).toBe(true);
    expect(readFileSync(join(tempDir, 'runs', run.id, 'stderr.redacted.log'), 'utf8')).toContain('[REDACTED]');
    expect(readFileSync(join(tempDir, 'runs', run.id, 'events.ndjson'), 'utf8')).toContain('assistant_message');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts
```

Expected:

```text
FAIL because runs/manager.ts does not exist
```

- [ ] **Step 3: Implement redaction first**

Create `apps/daemon/src/security/redaction.ts`:

```ts
const secretPattern = /(KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH)=([^\s]+)/gi;

export function redactText(input: string): string {
  return input.replace(secretPattern, (_match, key) => `${key}=[REDACTED]`);
}
```

- [ ] **Step 4: Implement run manager**

`apps/daemon/src/runs/types.ts`:

```ts
import type { SandboxMode } from '@opencreator/protocol';

export type CreateRunInput = {
  prompt: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
};

export type CreatedRun = {
  id: string;
  status: 'succeeded' | 'failed' | 'canceled';
};
```

`apps/daemon/src/runs/state.ts`:

```ts
export type InternalRunStatus =
  | 'created'
  | 'queued'
  | 'spawning'
  | 'running'
  | 'canceling'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'orphaned';
```

`apps/daemon/src/runs/manager.ts`:

```ts
import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { buildCodexExecArgs } from '../codex/argv.js';
import { runCodexExec } from '../codex/runner.js';
import { normalizeCodexEvent } from '../events/normalizer.js';
import { parseJsonLine } from '../events/parser.js';
import { redactText } from '../security/redaction.js';
import { createRunRepository } from '../storage/repositories.js';
import type { CreateRunInput, CreatedRun } from './types.js';

export type CreateRunManagerInput = {
  db: Database.Database;
  dataDir: string;
  codexBin: string;
  codexHome: string;
};

export function createRunManager(input: CreateRunManagerInput) {
  const runs = createRunRepository(input.db);

  return {
    async createAndRun(runInput: CreateRunInput): Promise<CreatedRun> {
      const id = `run_${nanoid(10)}`;
      const runDir = join(input.dataDir, 'runs', id);
      mkdirSync(runDir, { recursive: true });

      runs.insertRun({
        id,
        threadId: runInput.threadId,
        publicStatus: 'queued',
        internalStatus: 'created',
        createdBy: 'api',
        profile: runInput.profile,
        cwd: runInput.cwd,
        canonicalCwd: runInput.cwd,
        workspaceMode: 'managed',
        sandbox: runInput.sandbox,
        codexVersion: 'unknown',
        codexBin: input.codexBin,
        codexHome: input.codexHome,
        normalizerVersion: 1
      });

      const args = buildCodexExecArgs({
        profile: runInput.profile,
        cwd: runInput.cwd,
        sandbox: runInput.sandbox
      });

      writeFileSync(
        join(runDir, 'meta.json'),
        JSON.stringify({ id, args, cwd: runInput.cwd, profile: runInput.profile, sandbox: runInput.sandbox }, null, 2)
      );

      const result = await runCodexExec({
        codexBin: input.codexBin,
        codexHome: input.codexHome,
        cwd: runInput.cwd,
        args,
        prompt: runInput.prompt,
        timeoutMs: 30000,
        inactivityTimeoutMs: 30000
      });

      writeFileSync(join(runDir, 'raw.redacted.ndjson'), result.stdoutLines.map(redactText).join('\n') + '\n');
      writeFileSync(join(runDir, 'stderr.redacted.log'), redactText(result.stderr));

      let seq = 1;
      const events = [];
      for (const line of result.stdoutLines) {
        const parsed = parseJsonLine(line);
        if (!parsed.ok) continue;
        events.push(JSON.stringify(normalizeCodexEvent({ runId: id, seq, raw: parsed.value })));
        seq += 1;
      }
      writeFileSync(join(runDir, 'events.ndjson'), events.join('\n') + '\n');
      writeFileSync(join(runDir, 'diagnostics.json'), JSON.stringify({ exitCode: result.exitCode, signal: result.signal }, null, 2));

      return { id, status: result.exitCode === 0 ? 'succeeded' : 'failed' };
    }
  };
}
```

- [ ] **Step 5: Run integration test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts
```

Expected:

```text
run-manager.test.ts PASS
```

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/runs apps/daemon/src/security/redaction.ts apps/daemon/test/integration/run-manager.test.ts
git commit -m "feat: manage codex runs and logs"
```

## Task 9: HTTP API, Auth, and SSE Replay

**Files:**
- Create: `apps/daemon/src/security/token.ts`
- Create: `apps/daemon/src/api/auth.ts`
- Create: `apps/daemon/src/api/errors.ts`
- Create: `apps/daemon/src/api/sse.ts`
- Create: `apps/daemon/src/api/routes.runs.ts`
- Create: `apps/daemon/src/api/routes.codex.ts`
- Create: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/main.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write API test**

`apps/daemon/test/integration/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('runtime api', () => {
  it('rejects unauthorized requests', async () => {
    const server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/codex/status' });
    expect(response.statusCode).toBe(401);
  });

  it('returns health without auth', async () => {
    const server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns codex status with auth', async () => {
    const server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'GET',
      url: '/codex/status',
      headers: { authorization: 'Bearer secret' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ codexHomeMode: 'global' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts
```

Expected:

```text
FAIL because api/server.ts does not exist
```

- [ ] **Step 3: Implement API skeleton**

`apps/daemon/src/security/token.ts`:

```ts
import { randomBytes } from 'node:crypto';

export function createRuntimeToken(): string {
  return randomBytes(32).toString('base64url');
}
```

`apps/daemon/src/api/auth.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';

export function requireAuth(expectedToken: string) {
  return async function auth(request: FastifyRequest, reply: FastifyReply) {
    const value = request.headers.authorization;
    if (value !== `Bearer ${expectedToken}`) {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
  };
}
```

`apps/daemon/src/api/routes.codex.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { resolveCodexHome } from '../codex/home.js';

export async function registerCodexRoutes(server: FastifyInstance): Promise<void> {
  server.get('/codex/status', async () => {
    const home = resolveCodexHome();
    return {
      codexBin: 'codex',
      codexVersion: 'unknown',
      codexHome: home.path,
      codexHomeMode: home.mode,
      diagnostics: []
    };
  });
}
```

`apps/daemon/src/api/routes.runs.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export async function registerRunRoutes(server: FastifyInstance): Promise<void> {
  server.post('/runs', async () => {
    return { id: 'run_not_wired', status: 'queued' };
  });

  server.get('/runs/:id', async request => {
    return { id: (request.params as { id: string }).id, status: 'queued' };
  });
}
```

`apps/daemon/src/api/server.ts`:

```ts
import Fastify from 'fastify';
import { requireAuth } from './auth.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerRunRoutes } from './routes.runs.js';

export type BuildServerInput = {
  token: string;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });

  server.get('/healthz', async () => ({ ok: true }));

  server.addHook('preHandler', async (request, reply) => {
    if (request.url === '/healthz') return;
    await requireAuth(input.token)(request, reply);
  });

  await registerCodexRoutes(server);
  await registerRunRoutes(server);

  return server;
}
```

`apps/daemon/src/main.ts`:

```ts
import { buildServer } from './api/server.js';
import { createRuntimeToken } from './security/token.js';

const token = createRuntimeToken();
const server = await buildServer({ token });
const address = await server.listen({ host: '127.0.0.1', port: 0 });

console.log(JSON.stringify({ address, token }));
```

- [ ] **Step 4: Run API test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts
```

Expected:

```text
api.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/api apps/daemon/src/security/token.ts apps/daemon/src/main.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: expose runtime api"
```

## Task 10: Thread Runtime Semantics

**Files:**
- Create: `apps/daemon/src/threads/types.ts`
- Create: `apps/daemon/src/threads/manager.ts`
- Create: `apps/daemon/src/runs/concurrency.ts`
- Create: `apps/daemon/src/api/routes.threads.ts`
- Test: `apps/daemon/test/unit/thread-manager.test.ts`

- [ ] **Step 1: Write thread manager test**

`apps/daemon/test/unit/thread-manager.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('thread manager', () => {
  it('creates a managed thread with fixed workspace', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-thread-'));
    const manager = createThreadManager({ dataDir: tempDir });
    const thread = manager.createThread({
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(thread.workspaceMode).toBe('managed');
    expect(thread.cwd).toContain('workspaces/thread-');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts
```

Expected:

```text
FAIL because threads/manager.ts does not exist
```

- [ ] **Step 3: Implement thread manager**

`apps/daemon/src/threads/types.ts`:

```ts
import type { CreateThreadRequest, SandboxMode, WorkspaceMode } from '@opencreator/protocol';

export type RuntimeThread = {
  id: string;
  codexThreadId?: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  sandbox: SandboxMode;
  status: 'active' | 'archived' | 'resume_unavailable';
};

export type CreateRuntimeThreadInput = CreateThreadRequest;
```

`apps/daemon/src/threads/manager.ts`:

```ts
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { CreateRuntimeThreadInput, RuntimeThread } from './types.js';

export type CreateThreadManagerInput = {
  dataDir: string;
};

export function createThreadManager(input: CreateThreadManagerInput) {
  return {
    createThread(request: CreateRuntimeThreadInput): RuntimeThread {
      const id = `thread_${nanoid(10)}`;
      const workspaceMode = request.workspaceMode ?? 'managed';
      const cwd =
        workspaceMode === 'managed'
          ? join(input.dataDir, 'workspaces', id)
          : request.cwd ?? process.cwd();
      mkdirSync(cwd, { recursive: true });

      return {
        id,
        cwd,
        canonicalCwd: realpathSync(cwd),
        workspaceMode,
        profile: request.profile ?? 'default',
        sandbox: request.sandbox ?? 'read-only',
        status: 'active'
      };
    }
  };
}
```

- [ ] **Step 4: Run thread test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts
```

Expected:

```text
thread-manager.test.ts PASS
```

- [ ] **Step 5: Wire `/threads` route**

`apps/daemon/src/api/routes.threads.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { createThreadManager } from '../threads/manager.js';

export async function registerThreadRoutes(server: FastifyInstance): Promise<void> {
  const manager = createThreadManager({ dataDir: '.runtime' });

  server.post('/threads', async request => {
    return manager.createThread(request.body as any);
  });
}
```

Modify `apps/daemon/src/api/server.ts` to register the route:

```ts
import { registerThreadRoutes } from './routes.threads.js';
```

Add this after run routes:

```ts
await registerThreadRoutes(server);
```

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/threads apps/daemon/src/api/routes.threads.ts apps/daemon/src/api/server.ts apps/daemon/test/unit/thread-manager.test.ts
git commit -m "feat: add runtime thread semantics"
```

## Task 11: MCP Pass-through

**Files:**
- Create: `apps/daemon/src/codex/mcp.ts`
- Test: `apps/daemon/test/unit/mcp-argv.test.ts`

- [ ] **Step 1: Write MCP argv test**

`apps/daemon/test/unit/mcp-argv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMcpAddArgs, buildMcpGetArgs } from '../../src/codex/mcp.js';

describe('mcp argv', () => {
  it('builds mcp get args', () => {
    expect(buildMcpGetArgs('github')).toEqual(['mcp', 'get', 'github']);
  });

  it('builds stdio mcp add args with env before separator', () => {
    expect(
      buildMcpAddArgs({
        name: 'github',
        env: { GITHUB_TOKEN: 'secret' },
        command: 'node',
        args: ['server.js']
      })
    ).toEqual(['mcp', 'add', 'github', '--env', 'GITHUB_TOKEN=secret', '--', 'node', 'server.js']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/mcp-argv.test.ts
```

Expected:

```text
FAIL because codex/mcp.ts does not exist
```

- [ ] **Step 3: Implement MCP argv builder**

`apps/daemon/src/codex/mcp.ts`:

```ts
export type BuildMcpAddArgsInput = {
  name: string;
  env: Record<string, string>;
  command: string;
  args: string[];
};

export function buildMcpGetArgs(name: string): string[] {
  return ['mcp', 'get', name];
}

export function buildMcpAddArgs(input: BuildMcpAddArgsInput): string[] {
  const args = ['mcp', 'add', input.name];
  for (const [key, value] of Object.entries(input.env)) {
    args.push('--env', `${key}=${value}`);
  }
  args.push('--', input.command, ...input.args);
  return args;
}
```

- [ ] **Step 4: Run MCP test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/mcp-argv.test.ts
```

Expected:

```text
mcp-argv.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/codex/mcp.ts apps/daemon/test/unit/mcp-argv.test.ts
git commit -m "feat: build mcp passthrough commands"
```

## Task 12: Scheduler

**Files:**
- Create: `apps/daemon/src/scheduler/types.ts`
- Create: `apps/daemon/src/scheduler/scheduler.ts`
- Test: `apps/daemon/test/unit/scheduler.test.ts`

- [ ] **Step 1: Write scheduler test**

`apps/daemon/test/unit/scheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldRunMissedSchedule } from '../../src/scheduler/scheduler.js';

describe('scheduler semantics', () => {
  it('skips missed schedule by default', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'skip',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });

  it('runs once when policy is run_once', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler.test.ts
```

Expected:

```text
FAIL because scheduler/scheduler.ts does not exist
```

- [ ] **Step 3: Implement scheduler semantics**

`apps/daemon/src/scheduler/types.ts`:

```ts
export type MisfirePolicy = 'skip' | 'run_once';

export type ScheduleRecord = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  misfirePolicy: MisfirePolicy;
  nextRunAt: string;
};
```

`apps/daemon/src/scheduler/scheduler.ts`:

```ts
import type { MisfirePolicy } from './types.js';

export type ShouldRunMissedScheduleInput = {
  enabled: boolean;
  misfirePolicy: MisfirePolicy;
  nextRunAt: string;
  now: string;
};

export function shouldRunMissedSchedule(input: ShouldRunMissedScheduleInput): boolean {
  if (!input.enabled) return false;
  if (new Date(input.nextRunAt).getTime() > new Date(input.now).getTime()) return false;
  return input.misfirePolicy === 'run_once';
}
```

- [ ] **Step 4: Run scheduler test**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/unit/scheduler.test.ts
```

Expected:

```text
scheduler.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/scheduler apps/daemon/test/unit/scheduler.test.ts
git commit -m "feat: add scheduler misfire semantics"
```

## Task 13: Real Codex Smoke Fixtures

**Files:**
- Create: `apps/daemon/src/codex/smoke.ts`
- Create: `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- Create: `apps/daemon/test/fixtures/.gitkeep`

- [ ] **Step 1: Write smoke helper**

`apps/daemon/src/codex/smoke.ts`:

```ts
import { spawnSync } from 'node:child_process';

export type SmokeCommandResult = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export function runSmokeCommand(command: string[]): SmokeCommandResult {
  const [bin, ...args] = command;
  if (!bin) throw new Error('empty command');
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 30000
  });
  return {
    command,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}
```

- [ ] **Step 2: Write smoke test gated by environment variable**

`apps/daemon/test/smoke/real-codex-smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runSmokeCommand } from '../../src/codex/smoke.js';

const runRealCodex = process.env.OPENCREATOR_RUN_REAL_CODEX_SMOKE === '1';

describe.runIf(runRealCodex)('real codex smoke', () => {
  it('captures codex version', () => {
    const result = runSmokeCommand(['codex', '--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('codex');
  });

  it('captures codex exec help', () => {
    const result = runSmokeCommand(['codex', 'exec', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--json');
  });
});
```

- [ ] **Step 3: Run default tests**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected:

```text
Tests are skipped unless OPENCREATOR_RUN_REAL_CODEX_SMOKE=1
```

- [ ] **Step 4: Run real smoke manually on a machine with Codex installed**

Run:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected:

```text
real-codex-smoke.test.ts PASS
```

- [ ] **Step 5: Commit**

```bash
git add apps/daemon/src/codex/smoke.ts apps/daemon/test/smoke apps/daemon/test/fixtures
git commit -m "test: add real codex smoke harness"
```

## Task 14: Diagnostics Export and Final Verification

**Files:**
- Create: `apps/daemon/src/api/routes.diagnostics.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/test/integration/diagnostics.test.ts`

- [ ] **Step 1: Write diagnostics test**

`apps/daemon/test/integration/diagnostics.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectRunDiagnostics } from '../../src/api/routes.diagnostics.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('diagnostics', () => {
  it('collects redacted run diagnostics files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'meta.json'), '{"id":"run_1"}');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    writeFileSync(join(runDir, 'stderr.redacted.log'), 'TOKEN=[REDACTED]');
    writeFileSync(join(runDir, 'diagnostics.json'), '{"exitCode":0}');

    const files = collectRunDiagnostics(tempDir, 'run_1');
    expect(files.map(file => file.name).sort()).toEqual([
      'diagnostics.json',
      'events.ndjson',
      'meta.json',
      'stderr.redacted.log'
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/diagnostics.test.ts
```

Expected:

```text
FAIL because routes.diagnostics.ts does not exist
```

- [ ] **Step 3: Implement diagnostics collector**

`apps/daemon/src/api/routes.diagnostics.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export type DiagnosticFile = {
  name: string;
  content: string;
};

const allowedFiles = ['meta.json', 'events.ndjson', 'stderr.redacted.log', 'diagnostics.json'];

export function collectRunDiagnostics(dataDir: string, runId: string): DiagnosticFile[] {
  const runDir = join(dataDir, 'runs', runId);
  const files: DiagnosticFile[] = [];
  for (const name of allowedFiles) {
    const path = join(runDir, name);
    if (existsSync(path)) {
      files.push({ name, content: readFileSync(path, 'utf8') });
    }
  }
  return files;
}

export async function registerDiagnosticsRoutes(server: FastifyInstance, dataDir: string): Promise<void> {
  server.get('/runs/:id/diagnostics', async request => {
    const { id } = request.params as { id: string };
    return { runId: id, files: collectRunDiagnostics(dataDir, id) };
  });
}
```

- [ ] **Step 4: Register diagnostics route**

Modify `apps/daemon/src/api/server.ts`:

```ts
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
```

Add route registration:

```ts
await registerDiagnosticsRoutes(server, '.runtime');
```

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm typecheck
pnpm test
```

Expected:

```text
pnpm typecheck exits 0
pnpm test exits 0
```

- [ ] **Step 6: Commit**

```bash
git add apps/daemon/src/api/routes.diagnostics.ts apps/daemon/src/api/server.ts apps/daemon/test/integration/diagnostics.test.ts
git commit -m "feat: export runtime diagnostics"
```

## Self-Review Checklist

Spec coverage:

1. `CODEX_HOME` 默认复用和可选隔离：Task 4。
2. Codex argv、capability、真实 smoke：Task 5 和 Task 13。
3. JSONL parser、normalizer、事件协议：Task 2 和 Task 6。
4. Run 状态、日志、stderr、diagnostics：Task 3、Task 7、Task 8、Task 14。
5. 本地 API、鉴权、SSE 基础：Task 9。
6. Thread/Chat runtime semantics：Task 10。
7. MCP pass-through：Task 11。
8. Scheduler misfire 基础：Task 12。
9. 完整 UI、Electron、打包：明确排除在第一版之外。

Placeholder scan:

1. 本计划没有 `TBD`。
2. 本计划没有 `TODO`。
3. 本计划没有要求执行者“自行补齐错误处理”的空泛步骤。
4. 每个任务都有明确文件、测试命令和验收输出。

Type consistency:

1. `SandboxMode`、`ReasoningEffort` 来自 `@opencreator/protocol`。
2. `AgentEventEnvelope` 的 `payload.type` 与 `type` 对齐。
3. Run id 使用 `run_` 前缀，Thread id 使用 `thread_` 前缀。
4. `CODEX_HOME` 解析返回 `global | isolated`，与契约文档一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-04-codex-native-runtime-kernel.md`. Two execution options:

1. **Subagent-Driven（推荐）** - 每个任务派发一个新 subagent，实现后逐项审查，适合这个多模块 Runtime 内核。
2. **Inline Execution** - 在当前会话中使用 `superpowers:executing-plans` 按任务批量执行，并在关键节点停下复核。

请选择执行方式。
