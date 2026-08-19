# Codex Runtime Thread / Chat Resume 实施计划

> **给 agentic workers 的要求：** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 实现 R2 Thread / Chat Resume：Runtime thread 持久化固化配置，第一轮绑定 Codex `thread_id`，后续通过 `codex exec resume` 续接，同 thread 串行，并暴露 thread 历史和诊断。

**架构：** 在现有 `RunRepository` 旁增加持久化 `ThreadRepository`，所有 thread run 都经过 `RunManager` 解析 `new_thread` / `resume_thread`，捕获 `thread.started.thread_id`，并执行同 thread 队列。继续使用 Runtime API 和 Runtime 归一化事件作为产品协议，不新增 UI 或 `messages` 表。

**技术栈：** TypeScript、Fastify、better-sqlite3、Vitest、fake Codex helper、gated real Codex smoke。

---

## 文件结构

需要修改的文件：

- `packages/protocol/src/api.ts`：补齐 thread API 类型、`resumeMode: "auto"`、run 返回 `codexThreadId`。
- `packages/protocol/src/errors.ts`：补齐 R2 错误码。
- `packages/protocol/src/events.ts`：允许 `status` event 携带 `threadId` / `codexThreadId` metadata。
- `apps/daemon/src/storage/migrations.ts`：补齐 `threads.title`、`threads.archived_at`、`runs.resume_mode`、`runs.queue_state` 和索引。
- `apps/daemon/src/storage/repositories.ts`：新增 `ThreadRepository`，扩展 `RunRepository`。
- `apps/daemon/src/threads/types.ts`：定义持久化 thread 类型和 thread service 接口。
- `apps/daemon/src/threads/manager.ts`：从内存 thread creator 改成 DB-backed thread service。
- `apps/daemon/src/api/routes.threads.ts`：实现 thread list/detail/runs/archive。
- `apps/daemon/src/api/routes.runs.ts`：校验 thread 配置不可变，使用 thread 固化配置创建 run。
- `apps/daemon/src/api/routes.codex.ts`：返回 resume capability。
- `apps/daemon/src/api/server.ts`：用同一个 DB 组装 thread manager 和 run manager。
- `apps/daemon/src/codex/argv.ts`：新增 `buildCodexResumeArgs`。
- `apps/daemon/src/codex/capabilities.ts`：解析 0.142.5 resume help 能力。
- `apps/daemon/src/codex/smoke.ts`：新增 real Codex resume smoke helper。
- `apps/daemon/src/runs/types.ts`：补齐 `resumeMode`、`codexThreadId`、queue 字段。
- `apps/daemon/src/runs/manager.ts`：实现 thread run、resume、队列、取消、orphan、诊断。
- `apps/daemon/test/helpers/fake-codex.ts`：记录 argv，支持 resume 断言。

需要修改的测试：

- `apps/daemon/test/unit/storage.test.ts`
- `apps/daemon/test/unit/thread-manager.test.ts`
- `apps/daemon/test/unit/codex-argv.test.ts`
- `apps/daemon/test/unit/codex-capabilities.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/daemon/test/integration/diagnostics.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`

R2 不修改：

- UI 或桌面壳。
- Profile / `CODEX_HOME` 写入管理。
- Skills 管理。
- MCP 管理，除 capability help 解析外。
- Scheduler 行为。
- `messages` 表。
- workspace 全局写锁。

---

### Task 1: 协议、Schema、Repository 基础

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `packages/protocol/src/events.ts`
- Modify: `apps/daemon/src/storage/migrations.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/unit/storage.test.ts` 增加 import：

```ts
import type { InsertRunInput } from '../../src/storage/repositories.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';
```

在文件底部增加 helper：

```ts
function createTestDatabase(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return db;
}

function makeRunInput(overrides: Partial<InsertRunInput> = {}): InsertRunInput {
  return {
    id: 'run_default',
    publicStatus: 'queued',
    internalStatus: 'created',
    createdBy: 'api',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1,
    ...overrides
  };
}
```

增加测试：

```ts
it('persists threads and codex thread binding', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: 'R2 plan',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    model: 'gpt-5',
    reasoning: 'high',
    status: 'active'
  });

  expect(threads.getThread('thread_1')).toMatchObject({
    id: 'thread_1',
    title: 'R2 plan',
    codex_thread_id: null,
    status: 'active'
  });

  threads.setCodexThreadId('thread_1', '019f-thread');
  expect(threads.getThread('thread_1')?.codex_thread_id).toBe('019f-thread');
});

it('lists thread run history and preserves archived thread data', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);
  const runs = createRunRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: null,
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active'
  });
  runs.insertRun(makeRunInput({ id: 'run_1', threadId: 'thread_1', resumeMode: 'new_thread' }));

  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);

  threads.archiveThread('thread_1');
  expect(threads.getThread('thread_1')).toMatchObject({ status: 'archived' });
  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts
```

Expected: 失败，缺少 `createThreadRepository`、`insertThread`、`setCodexThreadId`、`archiveThread`、`listRunsByThread`、`resumeMode` 持久化。

- [ ] **Step 3: 更新 protocol 类型**

在 `packages/protocol/src/api.ts` 中定义：

```ts
export type ResumeMode = 'auto' | 'new_thread' | 'resume_thread';
export type ThreadStatus = 'active' | 'archived';

export type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: ResumeMode;
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
  codexThreadId?: string | null;
  status: PublicRunStatus;
};

export type CreateThreadRequest = {
  title?: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type ThreadResponse = {
  id: string;
  title?: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type ThreadListResponse = {
  threads: ThreadResponse[];
};

export type ThreadRunsResponse = {
  runs: RunResponse[];
};
```

在 `packages/protocol/src/errors.ts` 加入：

```ts
  | 'THREAD_ARCHIVED'
  | 'THREAD_HAS_ACTIVE_RUN'
  | 'THREAD_CONFIG_IMMUTABLE'
  | 'THREAD_CONCURRENCY_CONFLICT'
  | 'RESUME_CAPABILITY_UNVERIFIED'
  | 'CODEX_THREAD_ID_MISSING'
  | 'THREAD_RUN_ORPHANED'
```

在 `packages/protocol/src/events.ts` 修改 status payload：

```ts
  | {
      type: 'status';
      label: 'queued' | 'initializing' | 'running' | 'canceling' | 'finalizing';
      threadId?: string;
      codexThreadId?: string;
    }
```

- [ ] **Step 4: 更新 SQLite migration**

在 `apps/daemon/src/storage/migrations.ts`：

1. `runs` CREATE TABLE 增加 `resume_mode TEXT` 和 `queue_state TEXT NOT NULL DEFAULT 'none'`。
2. `threads` CREATE TABLE 增加 `title TEXT` 和 `archived_at TEXT`。
3. 主 `db.exec` 后增加兼容旧库的 helper：

```ts
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
```

4. 调用：

```ts
ensureColumn(db, 'threads', 'title', 'title TEXT');
ensureColumn(db, 'threads', 'archived_at', 'archived_at TEXT');
ensureColumn(db, 'runs', 'resume_mode', 'resume_mode TEXT');
ensureColumn(db, 'runs', 'queue_state', "queue_state TEXT NOT NULL DEFAULT 'none'");
```

5. 增加索引：

```sql
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
CREATE INDEX IF NOT EXISTS idx_threads_codex_thread_id ON threads(codex_thread_id);
CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_runs_codex_thread_id ON runs(codex_thread_id);
CREATE INDEX IF NOT EXISTS idx_runs_thread_created_at ON runs(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_runs_thread_public_status ON runs(thread_id, public_status);
```

- [ ] **Step 5: 实现 repositories**

在 `apps/daemon/src/storage/repositories.ts` 增加：

```ts
export type InsertThreadInput = {
  id: string;
  title?: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: string;
  profile: string;
  sandbox: string;
  model?: string | null;
  reasoning?: string | null;
  status: 'active' | 'archived';
};

export type ThreadRow = {
  id: string;
  title: string | null;
  codex_thread_id: string | null;
  cwd: string;
  canonical_cwd: string;
  workspace_mode: string;
  profile: string;
  sandbox: string;
  model: string | null;
  reasoning: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
};

export type ThreadRepository = {
  insertThread(input: InsertThreadInput): void;
  getThread(id: string): ThreadRow | undefined;
  listThreads(input?: { status?: 'active' | 'archived' | 'all'; limit?: number }): ThreadRow[];
  archiveThread(id: string): void;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
```

实现 `createThreadRepository(db)`，使用 prepared statements：

```sql
INSERT INTO threads (
  id, title, codex_thread_id, cwd, canonical_cwd, workspace_mode,
  profile, sandbox, model, reasoning, status
) VALUES (
  @id, @title, @codexThreadId, @cwd, @canonicalCwd, @workspaceMode,
  @profile, @sandbox, @model, @reasoning, @status
)
SELECT * FROM threads WHERE id = ?
SELECT * FROM threads WHERE (@status = 'all' OR status = @status) ORDER BY updated_at DESC, id DESC LIMIT @limit
UPDATE threads SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
UPDATE threads SET codex_thread_id = @codexThreadId, updated_at = CURRENT_TIMESTAMP WHERE id = @threadId
UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
```

扩展 `InsertRunInput` / `RunRow`：

```ts
resumeMode?: 'independent' | 'new_thread' | 'resume_thread';
queueState?: 'none' | 'queued' | 'started';
```

扩展 `RunRepository`：

```ts
listRunsByThread(threadId: string, limit?: number): RunRow[];
setRunCodexThreadId(runId: string, codexThreadId: string): void;
setRunQueueState(runId: string, queueState: 'none' | 'queued' | 'started'): void;
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts
pnpm typecheck
```

Expected: storage 测试通过；typecheck 若失败，只能是后续任务要更新的调用点类型错误。

- [ ] **Step 7: 提交**

```bash
git add packages/protocol/src/api.ts packages/protocol/src/errors.ts packages/protocol/src/events.ts apps/daemon/src/storage/migrations.ts apps/daemon/src/storage/repositories.ts apps/daemon/test/unit/storage.test.ts
git commit -m "feat: add thread persistence contract"
```

---

### Task 2: DB-backed Thread Manager 和 Thread API

**Files:**
- Modify: `apps/daemon/src/threads/types.ts`
- Modify: `apps/daemon/src/threads/manager.ts`
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/runs/manager.ts`
- Test: `apps/daemon/test/unit/thread-manager.test.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/unit/thread-manager.test.ts` 增加 imports：

```ts
import type Database from 'better-sqlite3';
import { realpathSync } from 'node:fs';
import { openRuntimeDatabase } from '../../src/storage/database.js';
```

增加局部变量和 helper：

```ts
let db: Database.Database | undefined;

function openTestDatabase(root: string): Database.Database {
  db = openRuntimeDatabase(join(root, 'app.sqlite'));
  return db;
}
```

在 `afterEach` 里增加：

```ts
db?.close();
db = undefined;
```

增加测试：

```ts
it('persists managed and external threads', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-thread-'));
  const database = openTestDatabase(tempDir);
  const manager = createThreadManager({ db: database, dataDir: tempDir });

  const managed = manager.createThread({
    title: 'Managed',
    workspaceMode: 'managed',
    profile: 'default',
    sandbox: 'read-only'
  });
  expect(managed.cwd).toContain(join('workspaces', managed.id));
  expect(manager.getThread(managed.id)).toMatchObject({ id: managed.id, title: 'Managed' });

  const external = manager.createThread({
    title: 'External',
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'workspace-write'
  });
  expect(external.cwd).toBe(tempDir);
  expect(external.canonicalCwd).toBe(realpathSync(tempDir));
});

it('archives active threads and rejects missing threads', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-thread-'));
  const database = openTestDatabase(tempDir);
  const manager = createThreadManager({ db: database, dataDir: tempDir });
  const thread = manager.createThread({ workspaceMode: 'managed' });

  expect(manager.archiveThread(thread.id).status).toBe('archived');
  expect(() => manager.archiveThread('thread_missing')).toThrow(/THREAD_NOT_FOUND/);
});
```

在 `apps/daemon/test/integration/api.test.ts` 增加测试：

```ts
it('creates, lists, gets, and archives threads through the api', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
  server = await buildServer({ token: 'secret', dataDir: tempDir });

  const created = await server.inject({
    method: 'POST',
    url: '/threads',
    headers: { authorization: 'Bearer secret' },
    payload: { title: 'R2', workspaceMode: 'managed', sandbox: 'read-only' }
  });
  expect(created.statusCode).toBe(201);
  const thread = created.json().thread;

  const listed = await server.inject({
    method: 'GET',
    url: '/threads',
    headers: { authorization: 'Bearer secret' }
  });
  expect(listed.json().threads).toEqual([expect.objectContaining({ id: thread.id })]);

  const detail = await server.inject({
    method: 'GET',
    url: `/threads/${thread.id}`,
    headers: { authorization: 'Bearer secret' }
  });
  expect(detail.json().thread).toMatchObject({ id: thread.id, status: 'active' });

  const archived = await server.inject({
    method: 'POST',
    url: `/threads/${thread.id}/archive`,
    headers: { authorization: 'Bearer secret' }
  });
  expect(archived.statusCode).toBe(200);
  expect(archived.json().thread.status).toBe('archived');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts test/integration/api.test.ts
```

Expected: 失败，因为 thread manager 没接 DB，thread routes 只有 `POST /threads`。

- [ ] **Step 3: 实现 ThreadManager**

在 `apps/daemon/src/threads/types.ts` 定义：

```ts
export type ThreadManager = {
  createThread(request: CreateRuntimeThreadInput): RuntimeThread;
  getThread(id: string): RuntimeThread | undefined;
  listThreads(filter?: { status?: 'active' | 'archived' | 'all'; limit?: number }): RuntimeThread[];
  archiveThread(id: string): RuntimeThread;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
```

在 `apps/daemon/src/threads/manager.ts` 中把输入改为：

```ts
export type CreateThreadManagerInput = {
  db: Database.Database;
  dataDir: string;
};
```

使用 `createThreadRepository(input.db)` 实现上面的接口。创建 managed thread 时：

```ts
const id = `thread_${nanoid(10)}`;
const workspaceMode = request.workspaceMode ?? 'managed';
const cwd = workspaceMode === 'managed'
  ? join(input.dataDir, 'workspaces', id)
  : request.cwd ?? process.cwd();
mkdirSync(cwd, { recursive: true });
const canonicalCwd = realpathSync(cwd);
```

默认值：

- `title = request.title ?? null`
- `profile = request.profile ?? 'default'`
- `sandbox = request.sandbox ?? 'read-only'`
- `status = 'active'`

如果 `archiveThread` 找不到 thread，抛出 `new Error('THREAD_NOT_FOUND')`。

- [ ] **Step 4: 实现 thread routes**

把 `registerThreadRoutes` 改为接收已创建的 manager：

```ts
export async function registerThreadRoutes(
  server: FastifyInstance,
  manager: ThreadManager,
  runManager: Pick<RunManager, 'listRunsByThread'>
): Promise<void>
```

实现：

```http
POST /threads
GET /threads?status=active&limit=50
GET /threads/:id
GET /threads/:id/runs?limit=50
POST /threads/:id/archive
```

错误映射：

```ts
reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
```

`POST /threads` 返回 201：

```ts
return reply.code(201).send({ thread: toThreadResponse(thread) });
```

`GET /threads/:id/runs` 在本任务中可以先调用 `runManager.listRunsByThread(threadId, limit)` 并返回空数组或已有 run；同 thread active run 导致 archive 冲突在 Task 6 实现。

在 `apps/daemon/src/runs/manager.ts` 的 `RunManager` 接口中先增加只读方法：

```ts
listRunsByThread(threadId: string, limit?: number): RuntimeRun[];
```

实现为调用 `runs.listRunsByThread(threadId, limit).map(mapRunRow)`。

- [ ] **Step 5: Wire server**

在 `apps/daemon/src/api/server.ts`：

1. 创建 `threadManager = createThreadManager({ db, dataDir })`。
2. 创建 `runManager` 时把 `threadManager` 传进去；Task 4 才会使用，当前可以先让 `RunManagerOptions` 接收可选字段。
3. 调用 `registerThreadRoutes(server, threadManager, runManager)`。
4. 删除 `routes.threads.ts` 内部自己创建 manager 的行为。

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts test/integration/api.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/threads/types.ts apps/daemon/src/threads/manager.ts apps/daemon/src/api/routes.threads.ts apps/daemon/src/api/server.ts apps/daemon/test/unit/thread-manager.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: persist runtime threads"
```

---

### Task 3: Codex Resume Argv 和 Capability Matrix

**Files:**
- Modify: `apps/daemon/src/codex/argv.ts`
- Modify: `apps/daemon/src/codex/capabilities.ts`
- Modify: `apps/daemon/src/api/routes.codex.ts`
- Test: `apps/daemon/test/unit/codex-argv.test.ts`
- Test: `apps/daemon/test/unit/codex-capabilities.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/unit/codex-argv.test.ts` 增加：

```ts
it('builds codex exec resume args without unsupported cwd profile or sandbox flags', () => {
  expect(buildCodexResumeArgs({
    codexThreadId: '019f-thread',
    model: 'gpt-5',
    reasoning: 'high'
  })).toEqual([
    'exec',
    'resume',
    '019f-thread',
    '--json',
    '--skip-git-repo-check',
    '--model',
    'gpt-5',
    '-c',
    'model_reasoning_effort="high"'
  ]);
});

it('does not pass profile cwd or sandbox to resume', () => {
  const args = buildCodexResumeArgs({
    codexThreadId: '019f-thread',
    profile: 'default',
    cwd: '/tmp/project',
    sandbox: 'workspace-write'
  });
  expect(args).not.toContain('-p');
  expect(args).not.toContain('-C');
  expect(args).not.toContain('--sandbox');
});
```

在 `apps/daemon/test/unit/codex-capabilities.test.ts` 增加 0.142.5 resume help fixture：

```ts
const RESUME_HELP_01425 = `
Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
      --last
      --all
  -c, --config <key=value>
  -m, --model <MODEL>
      --skip-git-repo-check
      --ephemeral
      --ignore-user-config
      --ignore-rules
      --output-schema <FILE>
      --json
`;
```

增加测试：

```ts
it('detects resume support and unsupported resume cwd profile sandbox overrides', () => {
  const matrix = parseCodexCapabilityMatrix({
    versionOutput: 'codex-cli 0.142.5',
    execHelp: EXEC_HELP_01425,
    resumeHelp: RESUME_HELP_01425,
    mcpAddHelp: MCP_ADD_HELP_01425
  });

  expect(matrix.resumeJson).toBe(true);
  expect(matrix.resumeByThreadId).toBe(true);
  expect(matrix.resumeLast).toBe(true);
  expect(matrix.resumeModelOverride).toBe(true);
  expect(matrix.resumeConfigOverride).toBe(true);
  expect(matrix.resumeCwdOverride).toBe(false);
  expect(matrix.resumeProfileOverride).toBe(false);
  expect(matrix.resumeSandboxOverride).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-argv.test.ts test/unit/codex-capabilities.test.ts
```

Expected: 失败，因为 `buildCodexResumeArgs` 和 `parseCodexCapabilityMatrix` 不存在。

- [ ] **Step 3: 实现 resume argv builder**

在 `apps/daemon/src/codex/argv.ts` 增加：

```ts
export type BuildCodexResumeArgsInput = {
  codexThreadId: string;
  profile?: string;
  cwd?: string;
  sandbox?: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
};

export function buildCodexResumeArgs(input: BuildCodexResumeArgsInput): string[] {
  const args = ['exec', 'resume', input.codexThreadId, '--json', '--skip-git-repo-check'];
  if (input.model) args.push('--model', input.model);
  if (input.reasoning && input.reasoning !== 'default') {
    args.push('-c', `model_reasoning_effort="${input.reasoning}"`);
  }
  return args;
}
```

不要把 `-C`、`-p`、`--sandbox`、`--add-dir` 放进 resume args。

- [ ] **Step 4: 实现 capability matrix**

在 `apps/daemon/src/codex/capabilities.ts` 保留现有 `parseCodexExecHelp`，新增：

```ts
export type RuntimeCapabilityMatrix = {
  codexVersion: string;
  checkedAt: string;
  execJson: boolean;
  execStdinPrompt: boolean;
  execProfile: boolean;
  execCwd: boolean;
  execSandbox: boolean;
  execSkipGitRepoCheck: boolean;
  resumeJson: boolean;
  resumeByThreadId: boolean;
  resumeLast: boolean;
  resumeModelOverride: boolean;
  resumeConfigOverride: boolean;
  resumeCwdOverride: boolean;
  resumeProfileOverride: boolean;
  resumeSandboxOverride: boolean;
  resumeContextContinuityVerified: boolean;
  mcpAddEnv: boolean;
  warnings: string[];
};
```

实现：

```ts
export function parseCodexCapabilityMatrix(input: {
  versionOutput: string;
  execHelp: string;
  resumeHelp: string;
  mcpAddHelp: string;
  resumeContextContinuityVerified?: boolean;
  checkedAt?: string;
}): RuntimeCapabilityMatrix
```

解析规则：

- `resumeJson = resumeHelp.includes('--json')`
- `resumeByThreadId = resumeHelp.includes('[SESSION_ID]') || resumeHelp.includes('SESSION_ID')`
- `resumeLast = resumeHelp.includes('--last')`
- `resumeModelOverride = resumeHelp.includes('--model') || resumeHelp.includes('-m,')`
- `resumeConfigOverride = resumeHelp.includes('--config') || resumeHelp.includes('-c,')`
- `resumeCwdOverride = resumeHelp.includes('--cd') || resumeHelp.includes('-C,')`
- `resumeProfileOverride = resumeHelp.includes('--profile') || resumeHelp.includes('-p,')`
- `resumeSandboxOverride = resumeHelp.includes('--sandbox')`

在 `apps/daemon/src/api/routes.codex.ts` 暂时用 help parser 可得字段返回结构；如果 daemon 启动时尚未真实采集 help，返回 `resumeContextContinuityVerified: false` 和 warning。

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/unit/codex-argv.test.ts test/unit/codex-capabilities.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/codex/argv.ts apps/daemon/src/codex/capabilities.ts apps/daemon/src/api/routes.codex.ts apps/daemon/test/unit/codex-argv.test.ts apps/daemon/test/unit/codex-capabilities.test.ts
git commit -m "feat: add codex resume capability contract"
```

---

### Task 4: Thread Run 创建、配置不可变、Codex Thread 绑定

**Files:**
- Modify: `apps/daemon/src/runs/types.ts`
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/api/routes.runs.ts`
- Test: `apps/daemon/test/integration/api.test.ts`
- Test: `apps/daemon/test/integration/run-manager.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/integration/api.test.ts` 增加 helper：

```ts
function authPost(url: string, payload: unknown) {
  return server!.inject({ method: 'POST', url, headers: { authorization: 'Bearer secret' }, payload });
}

function authGet(url: string) {
  return server!.inject({ method: 'GET', url, headers: { authorization: 'Bearer secret' } });
}
```

增加测试：

```ts
it('creates a thread run using immutable thread config and binds codex thread id', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
  const fake = createFakeCodex(tempDir, {
    stdoutLines: [
      { type: 'thread.started', thread_id: 'codex-thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
      { type: 'turn.completed' }
    ]
  });
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    codexBin: fake.bin,
    codexHome: join(tempDir, 'codex-home')
  });

  const thread = (await authPost('/threads', {
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  })).json().thread;

  const createdRun = await authPost('/runs', {
    threadId: thread.id,
    prompt: 'hello'
  });
  expect(createdRun.statusCode).toBe(202);

  await waitForRunStatus(createdRun.json().id, 'succeeded');

  const detail = await authGet(`/threads/${thread.id}`);
  expect(detail.json().thread.codexThreadId).toBe('codex-thread-1');
});

it('rejects run requests that override thread config', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
  server = await buildServer({ token: 'secret', dataDir: tempDir });
  const thread = (await authPost('/threads', {
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  })).json().thread;

  const response = await authPost('/runs', {
    threadId: thread.id,
    prompt: 'hello',
    sandbox: 'workspace-write'
  });

  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('THREAD_CONFIG_IMMUTABLE');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts test/integration/run-manager.test.ts
```

Expected: 失败，因为 run 创建还不读取 thread config，也不会更新 thread 的 `codexThreadId`。

- [ ] **Step 3: 扩展 run input 和 manager 依赖**

在 `apps/daemon/src/runs/types.ts`：

```ts
resumeMode?: 'auto' | 'new_thread' | 'resume_thread';
codexThreadId?: string;
```

在 `apps/daemon/src/runs/manager.ts` 定义轻量接口，避免 import cycle：

```ts
type ThreadAccess = {
  getThread(id: string): RuntimeThread | undefined;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
```

扩展 `RunManagerOptions`：

```ts
threadAccess?: ThreadAccess;
resumeCapabilityVerified?: boolean;
```

Task 2 wiring 中的 `threadManager` 作为 `threadAccess` 传入。

- [ ] **Step 4: 在 routes.runs 校验配置不可变**

在 `apps/daemon/src/api/routes.runs.ts`：

1. `registerRunRoutes` 增加可选 `threadManager` 参数，或从 `RunManager` 暴露 `getThreadForRunRequest`；推荐传入 `ThreadManager`。
2. 无 `threadId` 时保持原行为。
3. 有 `threadId` 时查询 thread。
4. 找不到返回 `THREAD_NOT_FOUND`。
5. `status === 'archived'` 返回 `THREAD_ARCHIVED`。
6. 如果请求体包含 `cwd`、`profile`、`model`、`reasoning`、`sandbox` 且与 thread 固化值不同，返回 `THREAD_CONFIG_IMMUTABLE`。
7. 调用 `manager.startRun` 时使用 thread 固化配置和 `resumeMode: body.resumeMode ?? 'auto'`。

- [ ] **Step 5: 捕获 Codex thread id**

在 `runs/manager.ts` stdout JSONL 处理处增加：

```ts
function isThreadStarted(value: unknown): value is { type: 'thread.started'; thread_id: string } {
  return typeof value === 'object'
    && value !== null
    && (value as { type?: unknown }).type === 'thread.started'
    && typeof (value as { thread_id?: unknown }).thread_id === 'string';
}
```

解析到 `thread.started` 时：

```ts
if (isThreadStarted(parsed.value)) {
  const codexThreadId = parsed.value.thread_id;
  runs.setRunCodexThreadId(id, codexThreadId);
  if (input.threadId) options.threadAccess?.setCodexThreadId(input.threadId, codexThreadId);
  publishStatus(id, seq, 'initializing', publish, { threadId: input.threadId, codexThreadId });
}
```

把 `publishStatus` 改为：

```ts
function publishStatus(
  runId: string,
  seq: number,
  label: 'queued' | 'initializing' | 'running' | 'canceling' | 'finalizing',
  publish: (event: AgentEventEnvelope) => void,
  metadata: { threadId?: string; codexThreadId?: string } = {}
): void
```

thread run 如果成功退出但没捕获 `codexThreadId`，标记失败：

- `errorCode = 'CODEX_THREAD_ID_MISSING'`
- `terminationReason = 'stream_error'`
- 写 `error` event 和 `done(status=failed)`

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts test/integration/run-manager.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/runs/types.ts apps/daemon/src/runs/manager.ts apps/daemon/src/api/routes.runs.ts apps/daemon/test/integration/api.test.ts apps/daemon/test/integration/run-manager.test.ts
git commit -m "feat: bind thread runs to codex sessions"
```

---

### Task 5: Resume 执行和失败诊断

**Files:**
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/api/routes.runs.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/helpers/fake-codex.ts`
- Test: `apps/daemon/test/integration/run-manager.test.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 增强 fake Codex**

在 `apps/daemon/test/helpers/fake-codex.ts` 中记录 argv：

```ts
const argvPath = join(dir, 'argv.json');
```

生成脚本中加入：

```js
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
```

返回对象增加：

```ts
readArgv(): string[] {
  return JSON.parse(readFileSync(argvPath, 'utf8')) as string[];
}
```

- [ ] **Step 2: 写失败测试**

在 `apps/daemon/test/integration/run-manager.test.ts` 增加 helper：

```ts
function createTestRunManager(input: {
  tempDir?: string;
  codexBin?: string;
  resumeCapabilityVerified?: boolean;
} = {}) {
  tempDir = input.tempDir ?? mkdtempSync(join(tmpdir(), 'opencreator-manager-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const manager = createRunManager({
    db,
    dataDir: tempDir,
    codexBin: input.codexBin ?? createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    }).bin,
    codexHome: join(tempDir, 'codex-home'),
    threadAccess: threadManager,
    resumeCapabilityVerified: input.resumeCapabilityVerified ?? true
  });
  return { manager, threadManager };
}

function createPersistedThread(
  threadManager: ReturnType<typeof createThreadManager>,
  overrides: { codexThreadId?: string } = {}
) {
  const thread = threadManager.createThread({
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  });
  if (overrides.codexThreadId) threadManager.setCodexThreadId(thread.id, overrides.codexThreadId);
  return threadManager.getThread(thread.id)!;
}

function threadRun(thread: { id: string; cwd: string; profile: string; sandbox: 'read-only' }, prompt: string) {
  return {
    threadId: thread.id,
    prompt,
    cwd: thread.cwd,
    profile: thread.profile,
    sandbox: thread.sandbox,
    resumeMode: 'auto' as const
  };
}
```

增加测试：

```ts
it('uses codex exec resume for a thread with codexThreadId', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-run-'));
  const fake = createFakeCodex(tempDir, {
    stdoutLines: [
      { type: 'thread.started', thread_id: 'codex-thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'resumed' } },
      { type: 'turn.completed' }
    ]
  });
  const { manager, threadManager } = createTestRunManager({
    tempDir,
    codexBin: fake.bin,
    resumeCapabilityVerified: true
  });
  const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

  const run = await manager.createAndRun(threadRun(thread, 'continue'));

  expect(run.status).toBe('succeeded');
  expect(fake.readArgv()).toEqual(expect.arrayContaining(['exec', 'resume', 'codex-thread-1', '--json']));
});

it('fails resume_thread when resume capability is unverified', async () => {
  const { manager, threadManager } = createTestRunManager({ resumeCapabilityVerified: false });
  const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

  const run = manager.startRun({
    ...threadRun(thread, 'continue'),
    resumeMode: 'resume_thread'
  });

  await waitForRunStatus(run.id, 'failed');
  expect(manager.getRun(run.id)).toMatchObject({
    errorCode: 'RESUME_CAPABILITY_UNVERIFIED'
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts
```

Expected: 失败，因为 resume argv 路径和 capability unverified 处理尚未实现。

- [ ] **Step 4: 实现 resume mode resolution**

在 `runs/manager.ts` 中实现：

```ts
function resolveResumeMode(
  input: CreateRunInput,
  thread?: RuntimeThread
): 'independent' | 'new_thread' | 'resume_thread' {
  if (!input.threadId) return 'independent';
  if (input.resumeMode === 'new_thread') return 'new_thread';
  if (input.resumeMode === 'resume_thread') return 'resume_thread';
  return thread?.codexThreadId ? 'resume_thread' : 'new_thread';
}
```

`resume_thread` 分支规则：

1. 必须有 `thread.codexThreadId`，否则 failed run：`CODEX_THREAD_ID_MISSING`。
2. 必须 `options.resumeCapabilityVerified === true`，否则 failed run：`RESUME_CAPABILITY_UNVERIFIED`。
3. 使用 `buildCodexResumeArgs({ codexThreadId, model, reasoning })`。
4. `startCodexExec` 的 `cwd` 仍使用 thread cwd，但 resume args 不带 `-C`。

`new_thread` 且 thread 已经有旧 `codexThreadId` 时，写 diagnostic code `THREAD_CODEX_SESSION_RESET`。

在 `apps/daemon/src/api/server.ts` 的 `BuildServerInput` 增加：

```ts
resumeCapabilityVerified?: boolean;
```

创建 run manager 时传入：

```ts
resumeCapabilityVerified: input.resumeCapabilityVerified
```

- [ ] **Step 5: 实现失败诊断**

新增内部 helper：

```ts
function failRunBeforeSpawn(input: {
  id: string;
  runDir: string;
  code: string;
  message: string;
  terminationReason: TerminationReason;
  publish: (event: AgentEventEnvelope) => void;
}): CreatedRun
```

该 helper 必须：

1. 写 `diagnostics.json`。
2. `updateStatus(id, 'failed', 'failed', { errorCode, errorMessage, terminationReason, endedAt })`。
3. 发布 `error` event。
4. 发布 `done(status=failed)` event。

Codex resume 非零退出时：

- stderr/stdout 包含 `not found`、`No session`、`unknown session` 时映射 `RESUME_TARGET_NOT_FOUND`。
- 其它 resume 非零退出映射 `RESUME_FAILED`。

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts test/integration/api.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/runs/manager.ts apps/daemon/src/api/routes.runs.ts apps/daemon/test/helpers/fake-codex.ts apps/daemon/test/integration/run-manager.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: execute codex thread resume"
```

---

### Task 6: 同 Thread 队列、取消、Archive 冲突、Restart Orphan

**Files:**
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Test: `apps/daemon/test/integration/run-manager.test.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/integration/run-manager.test.ts` 增加：

```ts
it('queues same-thread runs and starts the second after the first completes', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-run-'));
  const fake = createFakeCodex(tempDir, {
    stdoutLines: [
      { type: 'thread.started', thread_id: 'codex-thread-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
      { type: 'turn.completed' }
    ],
    lineDelayMs: 50
  });
  const { manager, threadManager } = createTestRunManager({
    tempDir,
    codexBin: fake.bin,
    resumeCapabilityVerified: true
  });
  const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

  const first = manager.startRun(threadRun(thread, 'first'));
  const second = manager.startRun(threadRun(thread, 'second'));

  expect(manager.getRun(second.id)?.status).toBe('queued');
  await waitForRunStatus(first.id, 'succeeded');
  await waitForRunStatus(second.id, 'succeeded');
});

it('cancels queued same-thread runs without spawning codex', async () => {
  const { manager, threadManager } = createTestRunManager({ resumeCapabilityVerified: true });
  const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

  const first = manager.startRun(threadRun(thread, 'first'));
  const second = manager.startRun(threadRun(thread, 'second'));

  expect(manager.cancelRun(second.id)).toBe(true);
  expect(manager.getRun(second.id)).toMatchObject({ status: 'canceled' });
  await waitForRunStatus(first.id, 'succeeded');
});
```

在 `apps/daemon/test/integration/api.test.ts` 增加：

```ts
async function createThreadViaApi() {
  return (await authPost('/threads', {
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  })).json().thread;
}

it('rejects archiving a thread with queued or running runs', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-api-'));
  const fake = createFakeCodex(tempDir, { stdoutLines: [{ type: 'turn.started' }], hang: true });
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    codexBin: fake.bin,
    codexHome: join(tempDir, 'codex-home')
  });
  const thread = await createThreadViaApi();
  await authPost('/runs', { threadId: thread.id, prompt: 'hang' });

  const archived = await authPost(`/threads/${thread.id}/archive`, {});
  expect(archived.statusCode).toBe(409);
  expect(archived.json().error.code).toBe('THREAD_HAS_ACTIVE_RUN');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts test/integration/api.test.ts
```

Expected: 失败，因为同 thread 队列尚未实现。

- [ ] **Step 3: 实现队列状态**

在 `runs/manager.ts` 增加：

```ts
type QueuedRun = {
  id: string;
  input: CreateRunInput;
  runDir: string;
};

const threadQueues = new Map<string, QueuedRun[]>();
const runningThreadRun = new Map<string, string>();
```

`startRun` 遇到 `input.threadId` 且 `runningThreadRun.has(threadId)`：

1. 插入 run，`public_status = queued`、`internal_status = queued`、`queue_state = queued`。
2. 发布 `status(queued)`。
3. push 到 `threadQueues`。
4. 返回 `{ id, threadId, status: 'queued' }`。

thread running run 进入 terminal 后：

```ts
runningThreadRun.delete(threadId);
startNextQueuedThreadRun(threadId);
```

`startNextQueuedThreadRun` 必须复用已有 run row，不插入第二条 run。

- [ ] **Step 4: 实现 queued cancel**

`cancelRun(id)` 逻辑：

1. active process 存在时保留现有行为。
2. 否则在所有 `threadQueues` 中查找 queued run。
3. 找到则移除。
4. 更新为 `public_status = canceled`、`internal_status = canceled`。
5. 发布 `status(canceling)` 和 `done(canceled)`。
6. 返回 true。

- [ ] **Step 5: 实现 active thread 检查和 restart orphan**

在 `RunManager` 接口增加：

```ts
hasActiveRunForThread(threadId: string): boolean;
```

`hasActiveRunForThread` 对 queued/running/canceling 返回 true。

在 `apps/daemon/src/api/routes.threads.ts` 的 archive route 中加入：

```ts
if (runManager.hasActiveRunForThread(id)) {
  return reply.code(409).send(apiError('THREAD_HAS_ACTIVE_RUN', 'Thread has active run'));
}
```

在 `apps/daemon/src/api/server.ts` 中把 thread routes 的 `runManager` 参数类型从 Task 2 的 `listRunsByThread` 扩展为同时包含 `hasActiveRunForThread`。

`recoverOrphanedRuns` 对 queued/running thread run 使用：

```ts
errorCode: 'THREAD_RUN_ORPHANED',
terminationReason: 'daemon_restart'
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts test/integration/api.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add apps/daemon/src/runs/manager.ts apps/daemon/src/api/routes.threads.ts apps/daemon/test/integration/run-manager.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: serialize thread runs"
```

---

### Task 7: Thread Run History、Diagnostics、API Polish

**Files:**
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Modify: `apps/daemon/src/api/routes.diagnostics.ts`
- Test: `apps/daemon/test/integration/api.test.ts`
- Test: `apps/daemon/test/integration/diagnostics.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/daemon/test/integration/api.test.ts` 增加：

```ts
it('lists runs for a thread in newest-first order', async () => {
  const thread = await createThreadViaApi();
  const first = await authPost('/runs', { threadId: thread.id, prompt: 'first' });
  const second = await authPost('/runs', { threadId: thread.id, prompt: 'second' });

  await waitForRunStatus(first.json().id, 'succeeded');
  await waitForRunStatus(second.json().id, 'succeeded');

  const history = await authGet(`/threads/${thread.id}/runs`);
  expect(history.statusCode).toBe(200);
  expect(history.json().runs.map((run: { id: string }) => run.id)).toEqual([
    second.json().id,
    first.json().id
  ]);
});
```

在 `apps/daemon/test/integration/diagnostics.test.ts` 增加 helper：

```ts
function readDiagnosticsFile(root: string, runId: string) {
  return JSON.parse(readFileSync(join(root, 'runs', runId, 'diagnostics.json'), 'utf8')) as Record<string, unknown>;
}

function authPost(url: string, payload: unknown) {
  return server!.inject({ method: 'POST', url, headers: { authorization: 'Bearer secret' }, payload });
}
```

增加测试：

```ts
it('includes thread and resume diagnostics for failed resume runs', async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
  const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const fake = createFakeCodex(tempDir, {
    stdoutLines: [],
    stderrLines: ['No session found for missing-session'],
    exitCode: 1
  });
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    db: database,
    codexBin: fake.bin,
    codexHome: join(tempDir, 'codex-home'),
    resumeCapabilityVerified: true
  });
  const thread = (await authPost('/threads', {
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  })).json().thread;
  createThreadRepository(database).setCodexThreadId(thread.id, 'missing-session');

  const created = await authPost('/runs', {
    threadId: thread.id,
    prompt: 'continue',
    resumeMode: 'resume_thread'
  });
  await waitForRunStatus(created.json().id, 'failed');

  expect(readDiagnosticsFile(tempDir, created.json().id)).toMatchObject({
    threadId: thread.id,
    codexThreadId: 'missing-session',
    resumeMode: 'resume_thread',
    errorCode: 'RESUME_TARGET_NOT_FOUND'
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts test/integration/diagnostics.test.ts
```

Expected: 失败，因为 thread run history 和 diagnostics metadata 不完整。

- [ ] **Step 3: 补齐 thread run history**

`GET /threads/:id/runs?limit=50` 使用：

```ts
runManager.listRunsByThread(threadId, limit)
```

返回：

```ts
{
  runs: rows.map(run => ({
    id: run.id,
    threadId: run.threadId,
    codexThreadId: run.codexThreadId,
    status: run.status
  }))
}
```

- [ ] **Step 4: 丰富 diagnostics**

所有 thread run 写 `diagnostics.json` 时包含：

```ts
{
  threadId: input.threadId,
  codexThreadId: resolvedCodexThreadId,
  resumeMode,
  argv,
  cwd,
  profile,
  sandbox,
  queueState,
  errorCode,
  errorMessage,
  terminationReason
}
```

保持现有 `stderr.redacted.log` 和 `raw.redacted.ndjson` 策略。

- [ ] **Step 5: 运行测试**

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts test/integration/diagnostics.test.ts
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/runs/manager.ts apps/daemon/src/api/routes.threads.ts apps/daemon/src/api/routes.diagnostics.ts apps/daemon/test/integration/api.test.ts apps/daemon/test/integration/diagnostics.test.ts
git commit -m "feat: expose thread run diagnostics"
```

---

### Task 8: Real Codex Resume Smoke 和全量回归

**Files:**
- Modify: `apps/daemon/src/codex/smoke.ts`
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- Modify: `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`

- [ ] **Step 1: 写 gated real smoke 测试**

在 `apps/daemon/test/smoke/real-codex-smoke.test.ts` 增加：

```ts
it('verifies codex exec resume context continuity', async () => {
  const result = await runRealCodexResumeSmoke({
    marker: `R2_RESUME_${Date.now()}`
  });

  expect(result.first.exitCode).toBe(0);
  expect(result.first.threadId).toMatch(/[0-9a-f-]{10,}/);
  expect(result.second.exitCode).toBe(0);
  expect(result.second.agentMessages.join('\n')).toContain(result.marker);
  expect(result.resumeContextContinuityVerified).toBe(true);
  expect(result.first.stderr).toEqual(expect.any(String));
  expect(result.second.stderr).toEqual(expect.any(String));
}, 120_000);
```

该文件已经用 `describe.runIf(runRealCodex)` 包住真实 smoke，所以不需要再加单测级 `skipIf`。

- [ ] **Step 2: 运行测试确认失败**

不带 env：

```bash
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 通过，真实 smoke 整个 describe 被跳过。

带 env：

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 失败，因为 `runRealCodexResumeSmoke` 尚未实现。

- [ ] **Step 3: 实现 real smoke helper**

在 `apps/daemon/src/codex/smoke.ts` 增加类型：

```ts
export type RealCodexSmokeTurn = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  threadId: string | null;
  agentMessages: string[];
  malformedLines: string[];
};

export type RealCodexResumeSmokeResult = {
  marker: string;
  first: RealCodexSmokeTurn;
  second: RealCodexSmokeTurn;
  resumeContextContinuityVerified: boolean;
};
```

实现内部 helper：

```ts
async function runCodexJsonTurn(input: { args: string[]; prompt: string }): Promise<RealCodexSmokeTurn> {
  const child = spawn('codex', input.args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.end(input.prompt);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  return parseSmokeTurn(['codex', ...input.args], exitCode, stdout, stderr);
}
```

实现 `parseSmokeTurn`：

```ts
function parseSmokeTurn(command: string[], exitCode: number | null, stdout: string, stderr: string): RealCodexSmokeTurn {
  let threadId: string | null = null;
  const agentMessages: string[] = [];
  const malformedLines: string[] = [];

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } };
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        agentMessages.push(event.item.text);
      }
    } catch {
      malformedLines.push(line);
    }
  }

  return { command, exitCode, stdout, stderr, threadId, agentMessages, malformedLines };
}
```

实现导出函数：

```ts
export async function runRealCodexResumeSmoke(input: { marker: string }): Promise<RealCodexResumeSmokeResult> {
  const first = await runCodexJsonTurn({
    args: ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', process.cwd()],
    prompt: `Automated Runtime ABI smoke. Do not run tools and do not modify files. Reply with exactly this marker and no extra commentary: ${input.marker}`
  });

  if (first.threadId === null) {
    return {
      marker: input.marker,
      first,
      second: { command: [], exitCode: null, stdout: '', stderr: '', threadId: null, agentMessages: [], malformedLines: [] },
      resumeContextContinuityVerified: false
    };
  }

  const second = await runCodexJsonTurn({
    args: ['exec', 'resume', first.threadId, '--json'],
    prompt: 'Automated Runtime ABI smoke. In the previous turn I asked you to reply with a marker. Reply with exactly that marker and no extra commentary.'
  });

  return {
    marker: input.marker,
    first,
    second,
    resumeContextContinuityVerified:
      second.exitCode === 0 && second.agentMessages.some(message => message.includes(input.marker))
  };
}
```

注意：stderr 有内容不代表失败，不能因为 stderr 包含 `ERROR` 就 throw。

- [ ] **Step 4: 运行全量回归**

```bash
pnpm typecheck
pnpm test
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

Expected: 全部通过。如果 real Codex 因登录态或网络失败，最终说明必须写明失败原因，不能声称真实 smoke 通过。

- [ ] **Step 5: 更新覆盖报告**

更新 `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`：

1. Thread manager/API 按实际完成面标为 PASS 或 PARTIAL。
2. Codex resume argv 和 real resume smoke 按测试结果更新状态。
3. Profile、Skills、MCP 管理、Scheduler 未实现时继续标为缺口。

- [ ] **Step 6: 提交**

```bash
git add apps/daemon/src/codex/smoke.ts apps/daemon/test/smoke/real-codex-smoke.test.ts docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md
git commit -m "test: verify real codex thread resume"
```

---

## 最终验证

运行：

```bash
pnpm typecheck
pnpm test
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

手动 API smoke：

```bash
pnpm daemon:dev
```

用 harness 或 curl 携带 daemon 输出的 bearer token：

```bash
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"workspaceMode":"external","cwd":"'"$PWD"'","profile":"default","sandbox":"read-only"}' \
  http://127.0.0.1:$PORT/threads

curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"threadId":"THREAD_ID","prompt":"Reply exactly: R2_MANUAL_FIRST"}' \
  http://127.0.0.1:$PORT/runs

curl -sS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:$PORT/threads/THREAD_ID

curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"threadId":"THREAD_ID","prompt":"Repeat the marker from the previous turn exactly."}' \
  http://127.0.0.1:$PORT/runs
```

Expected:

1. 第一轮 run 后 thread 有非空 `codexThreadId`。
2. 第二轮 run 使用 resume 并成功。
3. `GET /threads/:id/runs` 返回两个 run。
4. `GET /runs/:id/events` 可以 replay assistant 和 done events。

## 自审记录

Spec 覆盖：

- Thread 持久化、列表、详情、run history、archive：Task 1、Task 2、Task 7。
- 第一轮捕获 `thread.started.thread_id`：Task 4。
- 后续 run 使用 `codex exec resume`：Task 3、Task 5。
- 同 thread 串行和 queued cancel：Task 6。
- resume 失败诊断、不自动 reseed：Task 5、Task 7。
- `/codex/status` resume capability：Task 3。
- fake Codex 和 real Codex smoke：Task 5、Task 8。
- R0/R1 回归：Task 8。

本计划不实现 UI、`messages` 表、Profile 管理、Skills 管理、MCP 管理、Scheduler 行为或 workspace 全局写锁。
