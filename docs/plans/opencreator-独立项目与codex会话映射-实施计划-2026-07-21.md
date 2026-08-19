# OpenCreator 独立项目与 Codex 会话映射实施计划

> 状态：已完成
> 生成日期：2026-07-21
> 来源方案：`docs/specs/opencreator-独立项目与codex会话映射-方案-2026-07-21.md`
> 用户批准证据：“没问题，方案我审过了，可以继续了”
> 执行授权：“开始执行”（2026-07-21）
> 方案流程结论：PASS（用户知情批准）
> 方案 Reviewer 原始结论：BLOCKED
> Plan Reviewer 原始结论：BLOCKED
> Plan 流程结论：PASS（用户知情授权执行）
> 体量判断：复杂。该交付包含 SQLite 迁移、Daemon 所有权边界、Codex 外部会话过滤、Web 状态迁移和 Desktop/Web E2E；这些部分共享同一个数据契约和发布边界，任一部分单独发布都会造成项目或会话不可见，因此保持一个内聚 Plan，不按技术层拆分。

## 执行边界

1. 本 Plan 是执行者的唯一实施合同，不要求回看聊天。
2. 在当前分支、当前工作区实施，不使用 `git worktree`，不创建额外工作树。
3. 当前工作区存在大量用户未提交修改；实施时只增量修改本 Plan 列出的直接影响文件，不回退、覆盖或清理无关改动。
4. 不启动实现子代理。独立 Reviewer 只用于本 Plan 第一版审核。
5. 每个行为任务严格执行 RED、GREEN、相关回归和任务完成门；最终一次相关修改后重新生成验证证据。
6. 不新增独立实施报告、流程日志或证据文档；命令、时间、退出状态和结果摘要保留在执行会话最终报告中。

## 当前基线

| 项目 | 基线 |
|---|---|
| Git 分支 | `codex-native-runtime-kernel` |
| 生成基线提交 | `b42748369df8e369927263672375969d33f231c5` |
| 项目事实源 | Web `localStorage` 的 `opencreator.projects.v1` |
| 默认项目 | `LOCAL_HOME_PROJECT_ID = 'local-home'`，显示名“本机目录”，目录 `~` |
| 会话归属 | `AppController.projectIdForThread` 按 `cwd` 匹配，未匹配回退到“本机目录” |
| RuntimeThread 持久化 | Daemon SQLite `threads` 表 |
| Codex 映射 | `threads.codex_thread_id` 已存在，但只有普通非唯一索引 |
| Codex 列表 | `/threads` 通过 `listRecentCodexThreads` 调用 `thread/list` 并自动导入 |
| Codex 搜索 | `app-server-provider.search` 对每个结果调用 `importCodexThread` |
| 首次绑定 | `runs/manager.ts` 的 app-server `onThreadStarted` 和 exec `isThreadStarted` |
| Web 项目服务 | `apps/web/src/services/project-service.ts` 是未接入 Runtime 的 mock |
| Web E2E 项目夹具 | 按 `cwd` 计算项目 ID，并直接写 `localStorage` |
| Desktop E2E Codex | fake Codex 只支持 exec，不支持 app-server |

## 契约快照

### 目标

1. OpenCreator 项目与 Codex Desktop、CLI、IDE 的项目概念彻底分离。
2. OpenCreator 只展示自己创建或用户明确认领的普通会话。
3. Daemon SQLite 持久化 OpenCreator 项目、RuntimeThread 所有权和 `codexThreadId` 映射。
4. Codex app-server 只负责会话执行、恢复、正文历史和正文搜索。
5. 删除运行期 `cwd` 归属推断和“本机目录”默认项目。
6. 升级保留旧项目、自建会话、映射和原始 `localStorage` 数据。

### 非目标

1. 不读取、修改或同步 Codex Desktop 的项目状态。
2. 不提供任意 Codex 历史会话主动导入。
3. 不支持一个普通会话属于多个项目。
4. 不重构 `schedule_draft`、`schedule_task` 的生命周期。
5. 不删除本机代码目录、Codex 会话文件或归档项目的 Thread 映射。

### 需求和规则

| ID | 执行约束 |
|---|---|
| FR-1 | 用户可创建、查看、修改、归档和恢复 OpenCreator 独立项目 |
| FR-2 | 新建普通会话必须指定活跃 `projectId`，Daemon 持久化归属 |
| FR-3 | 首次运行后绑定唯一 `codexThreadId`，后续从 Codex 恢复历史 |
| FR-4 | 侧边栏、搜索和导航只展示 OpenCreator 项目会话及现有调度会话 |
| FR-5 | 升级后可查看并认领无法自动归属的 OpenCreator 自建会话 |
| FR-6 | 用户可显式更换项目目录，既有普通会话改用新目录 |
| BR-1 | OpenCreator 不读取、不修改、不同步 Codex 项目配置 |
| BR-2 | 运行期禁止根据 `cwd`、标题或时间推断项目归属 |
| BR-3 | 未知 Codex 会话不得因列表、搜索、深链接或刷新自动导入 |
| BR-4 | 项目归档不删除目录、Codex 会话或 Thread 映射 |
| BR-5 | 调度会话继续由 `purpose` 和调度系统管理 |
| BR-6 | 不再创建“本机目录”，没有项目时禁止新建普通会话 |
| NFR-1 | Codex 不可用时，项目和本地会话索引仍可从 SQLite 加载 |
| NFR-2 | 项目迁移和 `codexThreadId` 绑定幂等、唯一且可恢复 |
| NFR-3 | 升级不静默删除旧项目、自建会话或原始 `localStorage` 备份 |

### 关键决策

| ID | 不得改变的决定 |
|---|---|
| DEC-1 | Daemon SQLite 是项目事实源 |
| DEC-2 | `threads` 直接保存 `project_id` 和 `origin` |
| DEC-3 | 先创建 RuntimeThread，首次运行成功取得 Codex ID 后绑定 |
| DEC-4 | OpenCreator 保存索引和所有权，Codex 保存会话正文 |
| DEC-5 | 路径匹配只用于一次性旧数据迁移 |
| DEC-6 | 显式更换目录时更新项目及其全部普通 Thread 执行目录 |
| DEC-7 | Codex 搜索结果必须与 Daemon 已映射 `codexThreadId` 求交集 |

## 公共契约

### Protocol 类型

在 `packages/protocol/src/api.ts` 增加并由 Daemon、Web 共用：

```ts
export type ProjectStatus = 'active' | 'archived';
export type ProjectDirectoryState = 'available' | 'missing';
export type ProjectSandbox = 'follow-global' | SandboxMode;
export type ThreadOrigin = 'opencreator_created' | 'codex_discovered';

export type ProjectResponse = {
  id: string;
  name: string;
  cwd: string;
  canonicalCwd: string | null;
  directoryState: ProjectDirectoryState;
  profile: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
  sandbox: ProjectSandbox;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProjectListResponse = {
  projects: ProjectResponse[];
};

export type CreateProjectRequest = {
  cwd: string;
  name?: string;
  profile?: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox?: ProjectSandbox;
};

export type UpdateProjectRequest = {
  name?: string;
  profile?: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox?: ProjectSandbox;
};

export type ReplaceProjectDirectoryRequest = {
  cwd: string;
};
```

普通会话和调度草稿使用判别联合，防止普通会话继续绕过项目传入任意 `cwd`：

```ts
export type CreateThreadRequest =
  | {
      projectId: string;
      purpose?: 'conversation';
      title?: string;
      profile?: string;
      model?: string;
      reasoning?: ReasoningEffort;
      sandbox?: SandboxMode;
    }
  | {
      purpose: 'schedule_draft';
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
  projectId: string | null;
  origin: ThreadOrigin;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  status: ThreadStatus;
  purpose: ThreadPurpose;
  scheduleId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};
```

迁移和待归属接口类型：

```ts
export type LegacyLocalStorageProjectV1 = {
  id: string;
  name: string;
  cwd: string;
  sandbox: ProjectSandbox;
  profile: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

export type MigrateLocalStorageProjectsV1Request = {
  projects: LegacyLocalStorageProjectV1[];
};

export type MigrateLocalStorageProjectsV1Response = {
  status: 'applied' | 'already_applied';
  projectIdMap: Record<string, string>;
  assignedThreadIds: string[];
  unassignedThreadIds: string[];
};

export type AssignThreadProjectRequest = {
  projectId: string;
};
```

`ConversationSearchResult` 增加必填 `projectId: string`。搜索结果只能来自已归属普通会话，因此不允许用 `cwd` 在 Web 推断项目显示名。

### 项目 API

| 方法 | 路径 | 成功结果 |
|---|---|---|
| GET | `/projects?status=active|archived|all` | `ProjectListResponse`，默认 `active` |
| POST | `/projects` | `201 { project }` |
| PATCH | `/projects/:id` | `{ project }`，只修改名称和默认运行配置 |
| POST | `/projects/:id/archive` | `{ project }` |
| POST | `/projects/:id/restore` | `{ project }` |
| POST | `/projects/:id/replace-directory` | `{ project }` |
| POST | `/projects/migrations/local-storage-v1` | `MigrateLocalStorageProjectsV1Response` |
| POST | `/threads/:id/assign-project` | `{ thread }` |

### 错误语义

| HTTP | 错误码 | 条件 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 请求结构、枚举或空字符串无效 |
| 404 | `PROJECT_NOT_FOUND` | 项目不存在 |
| 404 | `THREAD_NOT_FOUND` | Thread 不存在，或普通 Thread 来源为 `codex_discovered` |
| 409 | `PROJECT_DIRECTORY_CONFLICT` | 规范路径已被另一个活跃项目占用 |
| 409 | `PROJECT_ARCHIVED` | 用归档项目创建普通会话 |
| 409 | `PROJECT_HAS_ACTIVE_RUN` | 归档或更换目录时项目存在活跃运行 |
| 409 | `THREAD_ALREADY_ASSIGNED` | 重复认领已有项目归属的普通会话 |
| 409 | `THREAD_CODEX_ID_CONFLICT` | `codexThreadId` 已绑定到其他 RuntimeThread |
| 422 | `PROJECT_DIRECTORY_UNAVAILABLE` | 新建、恢复、运行或更换目录时目录不存在、不是目录或无法规范化 |

未知 `codex_discovered` 普通 Thread 对 `/threads/:id`、运行列表、历史、更新和归档统一表现为 `404 THREAD_NOT_FOUND`，避免通过状态码探测隐藏会话。

## 数据和状态约束

### `projects`

```text
id TEXT PRIMARY KEY
name TEXT NOT NULL
cwd TEXT NOT NULL
canonical_cwd TEXT
profile TEXT NOT NULL
model TEXT
reasoning TEXT
sandbox TEXT NOT NULL
status TEXT NOT NULL
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
archived_at TEXT
```

约束：

1. `canonical_cwd` 非空且 `status='active'` 时唯一。
2. 新建、恢复和更换目录必须展开 `~`、确认目录存在且为目录、执行 `realpath`。
3. 旧迁移允许目录缺失，此时保留原始 `cwd`、设置 `canonical_cwd = NULL`，响应为 `directoryState='missing'`。
4. `directoryState` 每次读取和运行前按当前文件系统重新判断；项目创建后目录被移动或删除时，即使数据库仍有旧 `canonical_cwd`，也必须返回 `missing` 并拒绝新运行。
5. 目录缺失项目不能创建或运行普通会话，必须先更换目录。

### `threads`

新增：

```text
project_id TEXT NULL REFERENCES projects(id) ON DELETE RESTRICT
origin TEXT NOT NULL
```

约束：

1. 普通新会话必须为 `purpose='conversation'`、`origin='opencreator_created'`、`project_id IS NOT NULL`。
2. `schedule_draft`、`schedule_task` 保持 `project_id = NULL`，来源为 `opencreator_created`。
3. 非空 `codex_thread_id` 使用唯一部分索引。
4. Schema 升级把 `purpose='conversation' AND id LIKE 'thread_codex_%'` 标为 `codex_discovered`，其他既有 Thread 标为 `opencreator_created`。
5. 若升级前存在重复非空 `codex_thread_id`，迁移不得清空或覆盖数据；启动失败并报告冲突 ID，执行者停止发布并人工处理。

### 绑定状态转换

```text
RuntimeThread(projectId, codexThreadId=NULL)
  -> 首次 run 写 runs.codex_thread_id
  -> 唯一约束下写 threads.codex_thread_id
  -> 后续 run 使用 thread/resume
```

绑定 Thread 失败时：

1. 已写入的 `runs.codex_thread_id` 保留。
2. Thread 继续保持未绑定。
3. Run 记录 `THREAD_CODEX_ID_CONFLICT` 或实际持久化错误，不覆盖其他 Thread 映射。
4. Daemon 启动时只自动修复满足以下全部条件的候选：Thread 未绑定、该 Codex ID 的历史 Run 只指向此 Thread、此 Thread 的候选 Codex ID 唯一、该 Codex ID 未被其他 Thread 占用。
5. 候选不唯一时不猜测，保留数据并记录可诊断错误。
6. 保留现有 Codex 会话轮换：新 Codex Thread 成功建立并绑定后才替换旧映射；轮换失败或新绑定冲突时旧 Thread 映射保持不变，Run 仍保留本次 Codex ID 和诊断。

### 一次性迁移

`project_migrations` 使用固定键 `local-storage-v1` 保存请求摘要和结果 JSON。第一次请求在单个事务内：

1. 忽略 `id='local-home'`，不创建“本机目录”项目。
2. 按完整 `realpath` 合并重复项目；目录缺失时按规范化原始路径合并。
3. 返回每个旧项目 ID 到服务端项目 ID 的 `projectIdMap`。
4. 仅对 `origin='opencreator_created'`、`purpose='conversation'`、`project_id IS NULL` 的既有 Thread 按完整规范路径分配项目。
5. `codex_discovered` 永不分配、永不返回。
6. 未匹配自建普通会话进入待归属列表。
7. 重复调用不再次修改项目或 Thread，返回第一次保存的结果并标记 `already_applied`。
8. Web 不删除、不覆盖 `opencreator.projects.v1`；迁移成功后停止把它作为事实源。

## 文件地图

| 范围 | 直接入口 |
|---|---|
| Schema | `apps/daemon/src/storage/migrations.ts` |
| Repository | `apps/daemon/src/storage/repositories.ts` |
| 新项目领域 | `apps/daemon/src/projects/types.ts`、`apps/daemon/src/projects/manager.ts` |
| Thread 领域 | `apps/daemon/src/threads/types.ts`、`apps/daemon/src/threads/manager.ts` |
| Run 绑定 | `apps/daemon/src/runs/manager.ts` |
| 项目路由 | 新建 `apps/daemon/src/api/routes.projects.ts` |
| Thread 路由 | `apps/daemon/src/api/routes.threads.ts` |
| 搜索路由 | `apps/daemon/src/api/routes.search.ts` |
| Codex 会话 Provider | `apps/daemon/src/codex/sessions/app-server-provider.ts` |
| 服务装配 | `apps/daemon/src/api/server.ts` |
| Protocol | `packages/protocol/src/api.ts` |
| Web 项目模型 | `apps/web/src/features/projects/project-model.ts` |
| Web 项目服务 | `apps/web/src/services/project-service.ts` |
| Web Thread 服务 | `apps/web/src/services/thread-service.ts` |
| Web 总控制器 | `apps/web/src/app/AppController.tsx` |
| Web 状态 | `apps/web/src/app/app-state.ts` |
| 项目 UI | `apps/web/src/features/shell/OpenCreatorSidebar.tsx`、新建 `apps/web/src/features/projects/ProjectManagementDialog.tsx` |
| 搜索显示 | `apps/web/src/features/search/SearchView.tsx` |
| E2E Runtime | `apps/web/e2e/fixtures/runtime.ts`、`apps/web/e2e/support/fake-codex.mjs` |
| Desktop E2E | `apps/desktop/e2e/desktop.spec.ts` |

## 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
|---|---|---|---|---|
| TASK-1 | FR-1, NFR-1, NFR-2 | DEC-1, DEC-2 | storage、project-manager、protocol-shape | AC-1, AC-5, AC-7 |
| TASK-2 | FR-1, FR-6, BR-4 | DEC-1, DEC-6 | project-api | AC-1, AC-5 |
| TASK-3 | FR-2, FR-3, BR-5, BR-6, NFR-2 | DEC-2, DEC-3, DEC-4 | thread-manager、run-manager、api | AC-3, AC-4 |
| TASK-4 | FR-4, BR-1, BR-2, BR-3, NFR-1 | DEC-4, DEC-7 | app-server provider、session API、search API | AC-2, AC-7, AC-8 |
| TASK-5 | FR-5, BR-2, BR-3, NFR-2, NFR-3 | DEC-1, DEC-2, DEC-5 | migration API、thread assignment | AC-6, AC-8 |
| TASK-6 | FR-1, FR-2, FR-4, BR-2, BR-6 | DEC-1, DEC-2 | project-service、project-model、App、Sidebar | AC-1, AC-3 |
| TASK-7 | FR-1, FR-5, FR-6, BR-2, BR-4 | DEC-5, DEC-6, DEC-7 | project management、memory、search Web 测试 | AC-5, AC-6, AC-8 |
| TASK-8 | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, BR-1, BR-2, BR-3, BR-4, BR-5, BR-6, NFR-1, NFR-2, NFR-3 | DEC-1, DEC-2, DEC-3, DEC-4, DEC-5, DEC-6, DEC-7 | Web E2E、Desktop E2E、全量回归 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 |
| TASK-9 | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, BR-1, BR-2, BR-3, BR-4, BR-5, BR-6, NFR-1, NFR-2, NFR-3 | DEC-1, DEC-2, DEC-3, DEC-4, DEC-5, DEC-6, DEC-7 | 最终命令和公开边界验收 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 |

## 失败熔断

1. RED 预期失败不计入失败次数；必须确认失败来自目标能力缺失，而不是类型错误、环境或夹具损坏。
2. 进入 GREEN 后，每次修复前记录失败命令、关键输出、根因假设和本次最小改动。
3. 同一测试或命令因同一根因经过两次有实质差异的修复仍失败，立即停止当前 TASK，标记 `BLOCKED`。
4. 熔断后区分实现、测试夹具、环境或 Plan 契约问题；不得放宽断言、删除失败用例、静默修改 `FR/BR/NFR/DEC/AC` 或启动子代理继续试错。

## 实施任务

### TASK-0：确认 Plan 仍然有效

**交付结果**

- 确认执行时的代码、接口和测试基线仍能承载本 Plan，不把过期 Plan 直接用于实现。

**文件与符号**

- 读取：本 Plan、来源方案和本文件地图列出的入口。
- 核对：当前分支、`git rev-parse HEAD`、`git status --short`、workspace package scripts。

**实施步骤**

1. 记录执行开始时分支、提交和工作区状态。
2. 核对 `threads` Schema、`ThreadManager`、`registerThreadRoutes`、`createCodexSessionProvider`、`AppController`、Web E2E fixture 的符号仍存在。
3. 核对测试命令仍由 Vitest、Playwright 和 TypeScript 提供。
4. 无关变化或局部路径改名只记录偏差后继续。
5. 若 `DEC-1` 至 `DEC-7`、公共接口、数据所有权或 AC 已失效，停止执行并更新方案或 Plan。

**TDD**

- 策略：豁免。该任务只验证执行合同，不改变行为。
- 基线：运行 `git diff --check`，预期退出状态为 `0`；若既有用户改动导致失败，记录与本交付是否相关。

**任务完成门**

- 基线、偏差和相关既有修改已记录；没有需要退回 Brainstorm 的契约变化。

### TASK-1：建立项目持久化与所有权 Schema `[FR-1, NFR-1, NFR-2, DEC-1, DEC-2, AC-1, AC-5, AC-7]`

**交付结果**

- SQLite 可持久化独立项目、Thread 项目归属、Thread 来源和唯一 Codex 映射。
- 项目目录可用性、重复活跃目录和缺失迁移目录有确定行为。

**文件与符号**

- 修改：`packages/protocol/src/api.ts` - 公共类型。
- 修改：`apps/daemon/src/storage/migrations.ts` - `migrate`、索引和旧 Thread 来源分类。
- 修改：`apps/daemon/src/storage/repositories.ts` - `ProjectRow`、`ProjectRepository`、Thread 新字段和查询。
- 创建：`apps/daemon/src/projects/types.ts`。
- 创建：`apps/daemon/src/projects/manager.ts` - `createProjectManager`。
- 测试：`apps/daemon/test/unit/storage.test.ts`。
- 创建测试：`apps/daemon/test/unit/project-manager.test.ts`。
- 修改测试：`apps/daemon/test/unit/protocol-shape.test.ts`。

该任务超过五个文件，因为 Schema、公共类型、Repository 和领域管理器必须在同一个可编译增量内建立；拆开会留下无法构造或无法序列化的半成品契约。

**实施步骤**

1. 按“公共契约”和“数据约束”增加 `projects`、`project_migrations`、`threads.project_id`、`threads.origin`。
2. 添加活跃 `canonical_cwd` 唯一部分索引和非空 `codex_thread_id` 唯一部分索引。
3. 升级时先分类旧 Thread 来源，再创建唯一 Codex 索引；重复 Codex ID 时抛出包含冲突 ID 的启动错误，不修改原绑定。
4. `ProjectRepository` 提供 insert、get、list、update、archive、restore、replaceDirectory 和迁移结果读写。
5. `ThreadRepository` 的行类型、insert、select、list 和 map 全部携带 `project_id`、`origin`。
6. `ProjectManager` 集中处理 `~` 展开、目录存在性、`stat`、`realpath`、默认值、重复路径和缺失迁移项目。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`creates project ownership schema and enforces active directory and Codex mapping uniqueness`。
  - Setup：打开全新数据库，读取表、列和索引；插入两个同 `canonical_cwd` 活跃项目及两个同 `codex_thread_id` Thread。
  - Assert：当前缺少表、列和唯一约束而失败。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts`
  - 预期失败原因：`projects`、`project_migrations`、`project_id`、`origin` 和唯一部分索引尚不存在。
- RED：
  - 测试名：`persists projects and preserves a missing migrated directory`。
  - Setup：创建真实目录项目、重复项目、缺失目录迁移项目，关闭并重开数据库。
  - Assert：真实目录规范化且持久化；重复活跃路径被拒绝；缺失项目 `canonicalCwd=null` 且 `directoryState='missing'`。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/unit/project-manager.test.ts`
  - 预期失败原因：项目 Manager 和 Repository 尚不存在。
- GREEN：实现最小 Schema、Repository、Manager 和 Protocol；重复运行上述两个命令，预期全部通过。
- REFACTOR：只抽取项目行映射和路径规范化辅助函数；运行 `pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/project-manager.test.ts test/unit/thread-manager.test.ts` 及 `pnpm --filter @opencreator/daemon typecheck`。

**任务完成门**

- 新旧数据库均可启动。
- 旧 Thread 来源分类符合约束。
- 缺失目录数据保留，重复映射不被静默改写。
- Daemon 类型检查和目标单元测试通过。

### TASK-2：提供项目 CRUD、归档恢复和目录更换 API `[FR-1, FR-6, BR-4, DEC-1, DEC-6, AC-1, AC-5]`

**交付结果**

- Web 可通过 Runtime API 管理项目；归档和目录更换受活跃运行保护。

**文件与符号**

- 创建：`apps/daemon/src/api/routes.projects.ts` - `registerProjectRoutes` 和请求解析。
- 修改：`apps/daemon/src/api/server.ts` - 创建 `projectManager` 并注册项目路由。
- 修改：`apps/daemon/src/projects/manager.ts` - 更新、归档、恢复、目录更换。
- 修改：`apps/daemon/src/runs/manager.ts` - `hasActiveRunForProject(projectId)`。
- 创建测试：`apps/daemon/test/integration/project-api.test.ts`。

**实施步骤**

1. 实现“项目 API”和“错误语义”表中的公开路由。
2. PATCH 明确拒绝 `cwd` 和 `status`，目录只能通过 `replace-directory` 改变。
3. 归档只更新项目状态，不修改 Thread、目录或 Codex 映射。
4. 恢复必须重新验证目录；同规范路径活跃项目存在时返回冲突。
5. `replace-directory` 在事务内更新项目，以及该项目全部 `purpose='conversation' AND origin='opencreator_created'` Thread 的 `cwd`、`canonical_cwd`；项目 ID 和 Codex ID 不变。
6. 归档和更换目录前通过 RunManager 检查项目下任一 Thread 是否存在 queued、running 或 canceling Run。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`manages projects without deleting threads and replaces execution directories atomically`。
  - Setup：POST 创建项目和普通 Thread；PATCH 改名；归档、恢复；更换到第二个真实目录。
  - Assert：状态和字段正确；归档后 Thread 与 `codex_thread_id` 原样存在；更换目录后项目与普通 Thread 同时更新；调度 Thread 不变。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/integration/project-api.test.ts`
  - 预期失败原因：项目路由尚未注册。
- RED：
  - 测试名：`rejects duplicate directories and project mutations with active runs`。
  - Setup：创建同规范路径项目并为目标项目构造活跃 Run。
  - Assert：重复路径、归档和目录更换分别返回规定的 `409` 错误码。
  - 命令同上。
  - 预期失败原因：冲突和活跃运行保护尚未实现。
- GREEN：实现路由、Manager 事务和项目级活跃运行查询；运行目标测试，预期通过。
- REFACTOR：复用现有 `apiError` 和解析模式，不建立第二套 API 框架；运行 `pnpm --filter @opencreator/daemon test -- test/integration/project-api.test.ts test/integration/api.test.ts`。

**任务完成门**

- 项目 CRUD、归档、恢复、更换目录的成功与失败语义均由真实 Fastify 注入测试覆盖。
- 更换目录不存在部分更新。
- Thread 和 Codex 映射不会因项目归档丢失。

### TASK-3：强制普通会话项目归属并保证 Codex 绑定唯一可恢复 `[FR-2, FR-3, BR-5, BR-6, NFR-2, DEC-2, DEC-3, DEC-4, AC-3, AC-4]`

**交付结果**

- 普通会话只能从活跃可用项目创建，Daemon 从项目读取 `cwd`。
- 调度草稿和调度任务继续使用现有内部生命周期。
- 首次运行绑定唯一 Codex ID，异常绑定可从 Run 记录保守恢复。

**文件与符号**

- 修改：`packages/protocol/src/api.ts` - `CreateThreadRequest` 判别联合、`ThreadResponse.projectId/origin`。
- 修改：`apps/daemon/src/threads/types.ts` - 普通创建输入和内部调度输入分离。
- 修改：`apps/daemon/src/threads/manager.ts` - `createConversationThread`、`createScheduleThread`、可见性和安全读取。
- 修改：`apps/daemon/src/storage/repositories.ts` - 所有权查询、唯一绑定和绑定修复候选。
- 修改：`apps/daemon/src/api/routes.threads.ts` - 普通创建校验和响应字段。
- 修改：`apps/daemon/src/api/routes.runs.ts` - 普通 Thread 运行前项目校验和项目记忆键。
- 修改：`apps/daemon/src/runs/manager.ts` - 绑定错误记录、启动修复和运行前项目可用性保护。
- 修改：`apps/daemon/src/api/server.ts` - 注入 `projectManager`。
- 修改测试：`apps/daemon/test/unit/thread-manager.test.ts`。
- 修改测试：`apps/daemon/test/integration/run-manager.test.ts`。
- 修改测试：`apps/daemon/test/integration/api.test.ts`。

该任务跨越 Protocol、Thread、Run 和 API，因为两阶段绑定是一次不可拆状态转换；只改其中一层会允许绕过项目、破坏调度兼容或丢失 Codex ID。

**实施步骤**

1. 普通 `POST /threads` 要求 `projectId`，拒绝 `cwd`、`workspaceMode` 和非 conversation purpose。
2. Daemon 读取项目默认配置；请求中显式 profile、model、reasoning、sandbox 覆盖项目默认值。项目 sandbox 为具体模式时可作为请求缺省值；项目为 `follow-global` 且请求未提供 sandbox 时使用安全缺省 `read-only`。Web 必须按用户全局偏好解析为具体 Sandbox 后发送。
3. 从项目复制 `cwd/canonicalCwd`，保存 `projectId`、`origin='opencreator_created'`、配置快照。
4. `schedule_draft` 保留 managed workspace 创建；`schedule_task` 继续只由内部调度方法创建。
5. `setCodexThreadId` 在 Repository 唯一约束下绑定；冲突转换为 `THREAD_CODEX_ID_CONFLICT`。
6. app-server 和 exec 都先写 Run Codex ID，再尝试 Thread 绑定；绑定失败时保留 Run 证据并产生诊断。
7. Daemon 初始化时在 `recoverOrphanedRuns` 前执行保守绑定修复；不满足唯一条件的候选只记录，不猜测。
8. 普通 Thread 启动 Run 前重新确认项目为 active 且目录 available；调度 Thread 不走该检查。
9. 保留现有自动轮换：成功新建并绑定后替换 Thread Codex ID，失败时保留旧映射；现有轮换摘要、阈值和显式 resume 回归必须继续通过。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`creates conversations from projects and preserves schedule thread creation`。
  - Setup：创建活跃项目、归档项目和缺失目录项目，分别调用普通创建与调度创建。
  - Assert：普通会话取项目目录并带 `projectId/origin`；无项目、归档项目、缺失目录和普通请求覆盖 cwd 被拒绝；调度测试保持通过。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts test/integration/api.test.ts`
  - 预期失败原因：当前普通会话允许空 body 和任意 cwd，Thread 没有所有权字段。
- RED：
  - 测试名：`keeps the run Codex id on binding conflict and repairs only an unambiguous missing binding`。
  - Setup：两个 Thread 竞争同一 Codex ID；另建一个未绑定 Thread 和唯一 Run 证据后重启 Manager。
  - Assert：冲突 Thread 不覆盖原映射，Run 保留 ID 和错误；唯一候选自动修复；多候选保持未绑定。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts`
  - 预期失败原因：当前索引不唯一，绑定失败恢复不存在。
- GREEN：实现判别创建、项目校验、唯一绑定和保守恢复；重复运行目标测试。
- REFACTOR：合并 app-server/exec 绑定为同一个内部辅助函数，避免两条路径语义漂移；运行 `pnpm --filter @opencreator/daemon test -- test/unit/thread-manager.test.ts test/integration/run-manager.test.ts test/integration/api.test.ts test/unit/scheduler-coordinator.test.ts`，确认现有 rotation 用例继续通过，再运行 Daemon typecheck。

**任务完成门**

- 普通会话无法绕过 `projectId`。
- 调度相关现有测试通过。
- 首次绑定、冲突和重启恢复均有持久化断言。

### TASK-4：切断 Codex 自动导入并隔离列表、搜索和深链接 `[FR-4, BR-1, BR-2, BR-3, NFR-1, DEC-4, DEC-7, AC-2, AC-7, AC-8]`

**交付结果**

- `/threads` 不再调用 `thread/list`。
- 搜索只返回已映射、已归属的 OpenCreator 普通会话。
- 未知 Codex 会话不能通过 ID、历史、运行、更新或归档路由暴露。

**文件与符号**

- 修改：`apps/daemon/src/codex/sessions/app-server-provider.ts` - 删除导入副作用，搜索分页过滤。
- 修改：`apps/daemon/src/api/routes.search.ts` - 注入本地映射解析。
- 修改：`apps/daemon/src/api/routes.threads.ts` - 删除 `mergeRecentThreads`，增加安全 Thread 读取。
- 修改：`apps/daemon/src/api/routes.runs.ts` - 公共 Run 创建拒绝隐藏 Thread。
- 修改：`apps/daemon/src/api/server.ts` - 删除 `listRecentCodexThreads` 装配和 `importThread` 回调。
- 修改：`apps/daemon/src/workspace-files/service.ts` 或其 Server 注入 - 公共工作区文件入口使用安全 Thread 解析。
- 修改测试：`apps/daemon/test/unit/codex-app-server-session-provider.test.ts`。
- 修改测试：`apps/daemon/test/integration/app-server-sessions-api.test.ts`。
- 修改测试：`apps/daemon/test/integration/search-api.test.ts`。

**实施步骤**

1. `CodexSessionProvider` 只保留 `listTurns`、`search`、`close`；不再接收 `importThread`。
2. `/threads` 只查询 SQLite：默认返回已归属 `opencreator_created` 普通会话和现有调度会话。
3. `GET /threads?assignment=unassigned&purpose=conversation` 只返回待归属 `opencreator_created` 会话。
4. Thread 详情、runs、history、PATCH、archive、`POST /runs` 的 threadId 和公共工作区文件入口共用安全读取：`codex_discovered` 普通会话统一返回 404。内部 scheduler 和 agent-tool 可继续使用不做 UI 可见性过滤的内部 `getThread`。
5. 搜索每页从 Codex 获得原始结果，通过 `getThreadByCodexThreadId` 求交集，只接受 `origin='opencreator_created'`、`purpose='conversation'`、`projectId != null` 的 Thread，并把 RuntimeThread ID 和 `projectId` 写入响应。
6. 过滤后不足请求 limit 时使用 Codex `nextCursor` 继续取页；每次请求 raw limit 使用“剩余结果数”，避免丢弃未消费的已映射结果。
7. Codex 不可用时列表仍从 SQLite 返回；历史和搜索按既有外部错误路径失败，不清空映射。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`lists only local owned threads without calling Codex thread list`。
  - Setup：SQLite 插入已归属自建、未归属自建、`codex_discovered` 和调度 Thread；Provider 的任意列表调用设为抛错。
  - Assert：默认列表只含已归属和调度；待归属查询只含未归属；没有 `thread/list` 调用。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/integration/app-server-sessions-api.test.ts`
  - 预期失败原因：当前 `/threads` 会调用 Provider 并合并最近 Codex 会话。
- RED：
  - 测试名：`filters unknown search pages and rejects discovered thread deep links without importing rows`。
  - Setup：Codex 第一页只有未知会话并返回 cursor，第二页包含已映射会话；数据库预置一个 `codex_discovered` 行。
  - Assert：搜索继续翻页并只返回已映射 RuntimeThread；数据库行数不增加；发现行详情、历史、runs、Run 创建和工作区文件访问均 404。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/integration/app-server-sessions-api.test.ts test/integration/search-api.test.ts`
  - 预期失败原因：当前搜索会导入未知会话，详情路由不检查来源。
- GREEN：移除自动导入并实现分页求交集和安全读取；运行目标测试。
- REFACTOR：删除不再使用的 `ImportCodexThreadInput`、`listRecent` 和 `mergeRecentThreads`，不保留死兼容层；运行 Provider、session API、search API 和 Daemon typecheck。

**任务完成门**

- 列表、搜索、刷新和深链接均无法增加未知 RuntimeThread。
- 搜索分页不会因前页未知结果提前结束。
- Codex 下线不影响本地项目和 Thread 索引读取。

### TASK-5：迁移旧 localStorage 项目并提供待归属认领 `[FR-5, BR-2, BR-3, NFR-2, NFR-3, DEC-1, DEC-2, DEC-5, AC-6, AC-8]`

**交付结果**

- 旧项目和可确定归属的 OpenCreator 自建会话幂等迁移。
- 无法确定归属的自建普通会话可被用户明确认领。
- 外部 Codex 会话始终隐藏。

**文件与符号**

- 修改：`apps/daemon/src/projects/manager.ts` - `migrateLocalStorageV1`。
- 修改：`apps/daemon/src/storage/repositories.ts` - 迁移事务、路径归属和待归属查询。
- 修改：`apps/daemon/src/api/routes.projects.ts` - 迁移路由。
- 修改：`apps/daemon/src/api/routes.threads.ts` - `assign-project` 路由。
- 修改：`packages/protocol/src/api.ts` - 迁移和认领类型。
- 修改测试：`apps/daemon/test/integration/project-api.test.ts`。
- 修改测试：`apps/daemon/test/unit/storage.test.ts`。

**实施步骤**

1. 解析并严格校验 `LegacyLocalStorageProjectV1`，单项无效时整个请求返回 400，不做部分迁移。
2. 在一个 SQLite 事务中完成项目创建/合并、旧 ID 映射、Thread 路径分配和迁移结果保存。
3. 完整路径比较只使用项目和 Thread 的规范路径；不做父目录、尾目录名、标题或时间近似匹配。
4. `local-home` 不进入项目表；它下面的 OpenCreator 自建普通会话自然保留为待归属。
5. `assign-project` 只允许 `origin='opencreator_created'`、`purpose='conversation'`、`projectId=null`；只写项目 ID，保留旧 Thread cwd。cwd 与项目不一致通过响应供 UI 提示，不阻止认领。
6. 迁移结果记录首次请求的完整稳定结果；重复请求不因后续 body 变化重新迁移。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`migrates local storage projects once and classifies owned, unassigned and discovered threads`。
  - Setup：旧项目含重复真实路径、缺失目录、`local-home`；Thread 含路径匹配自建、主目录自建和 `thread_codex_*`。
  - Assert：项目合并、缺失项目保留、匹配自建归属、主目录自建待归属、Codex discovered 隐藏；第二次调用返回 `already_applied` 且行数不变。
  - 命令：`pnpm --filter @opencreator/daemon test -- test/integration/project-api.test.ts`
  - 预期失败原因：迁移接口和事务尚不存在。
- RED：
  - 测试名：`assigns an unowned OpenCreator thread without changing its execution directory`。
  - Setup：创建待归属 Thread 和目标项目，调用 assign 两次。
  - Assert：第一次写 `projectId` 且 cwd 不变；第二次返回 `THREAD_ALREADY_ASSIGNED`；discovered Thread 返回 404。
  - 命令同上。
  - 预期失败原因：认领路由尚不存在。
- GREEN：实现事务迁移、固定结果和认领；运行目标测试。
- REFACTOR：只在 Repository 暴露事务所需的窄方法，避免 API 路由直接执行 SQL；运行 project API、storage、thread manager 回归。

**任务完成门**

- 迁移重复执行无新增或重复归属。
- 原始 `localStorage` 无删除代码。
- 待归属和隐藏来源由 API 行为而不是 Web 过滤保证。

### TASK-6：Web 改用 Runtime 项目事实源并删除“本机目录” `[FR-1, FR-2, FR-4, BR-2, BR-6, DEC-1, DEC-2, AC-1, AC-3]`

**交付结果**

- Web 连接 Daemon 后先迁移旧数据，再从项目 API 加载状态。
- 侧边栏无“本机目录”，普通会话直接按 `thread.projectId` 分组。
- 无活跃项目时 Composer 和 Skill 使用入口不能创建普通会话。

**文件与符号**

- 修改：`apps/web/src/services/project-service.ts` - `createProjectService`。
- 创建测试：`apps/web/src/services/project-service.test.ts`。
- 修改：`apps/web/src/features/projects/project-model.ts` - 使用 Protocol 类型和服务端状态，删除默认项目、路径哈希和 cwd 匹配。
- 修改测试：`apps/web/src/features/projects/project-model.test.ts`。
- 修改：`apps/web/src/app/app-state.ts` - `currentProjectId?: string`。
- 修改：`apps/web/src/app/AppController.tsx` - 项目加载、迁移、分组、创建请求和空项目状态。
- 修改：`apps/web/src/services/thread-service.ts` - `createThread` 必须显式传入判别联合。
- 修改：`apps/web/src/features/shell/OpenCreatorSidebar.tsx` - 删除本机项目特例。
- 修改：`apps/web/src/features/conversation/ConversationEmptyState.tsx` - 无项目提示。
- 修改测试：`apps/web/src/app/App.test.tsx`、`apps/web/src/features/shell/OpenCreatorSidebar.test.tsx`、`apps/web/src/services/thread-service.test.ts`。

该任务覆盖 Web 的项目来源、导航和创建入口；这些状态必须同时切换，否则会出现项目已服务端化但 UI 仍按 cwd 分组的混合状态。

**实施步骤**

1. `createProjectService` 实现项目列表、创建、更新、归档、恢复、更换目录、localStorage 迁移和待归属认领。
2. Runtime 连接后按固定顺序执行：读取原始 `opencreator.projects.v1`、调用幂等迁移、加载 active/all 项目、加载 Thread；迁移失败时显示错误并禁止普通新建，不回退到 localStorage 事实源。
3. 使用迁移 `projectIdMap` 修正旧 `opencreator.navigation.v2.currentProjectId`；旧 ID 无映射时选择第一个活跃项目，没有项目时为 `undefined`。
4. 删除 `LOCAL_HOME_PROJECT_ID`、`LOCAL_HOME_PROJECT_NAME`、`createDefaultProjects`、`projectMatchesCwd`、`projectIdForThread`、`readPersistedProjects`、`writePersistedProjects`。
5. `mapThreadToConversation` 直接读取非空 `thread.projectId`；调度 Thread 不进入普通会话分组。打开 schedule draft、schedule task、任务中心或调度深链接时不按 cwd 切换项目，保留当前项目或无项目状态。
6. `buildThreadRequest` 发送 `projectId` 和配置，不发送 cwd/workspaceMode。
7. `resolveThreadIdForPrompt`、`useMarketSkill` 在没有活跃项目时返回明确错误；Composer 禁用并显示“请先添加项目”。
8. 目录选择器只返回路径，随后调用 `POST /projects`；重复目录错误时刷新并选中服务端已有项目。
9. 无项目空状态显示“先添加项目后开始对话”，侧边栏仍提供添加项目按钮。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`loads migrated projects from Runtime and never renders local home`。
  - Setup：mock Runtime 返回迁移映射、一个项目和归属 Thread，localStorage 保留旧项目。
  - Assert：先调用迁移再列表；UI 只显示服务端项目；没有“本机目录”；会话按 `projectId` 归组；原始 key 仍存在。
  - 命令：`pnpm --filter @opencreator/web test -- src/app/App.test.tsx src/services/project-service.test.ts`
  - 预期失败原因：当前项目来自 localStorage 并总是注入“本机目录”。
- RED：
  - 测试名：`blocks conversation creation until a Runtime project exists and sends projectId without cwd`。
  - Setup：先返回空项目，再通过目录选择器创建项目并提交消息。
  - Assert：空项目时 Composer 禁用；创建后 `POST /threads` body 含 projectId 且不含 cwd/workspaceMode。
  - 命令：`pnpm --filter @opencreator/web test -- src/app/App.test.tsx src/services/thread-service.test.ts`
  - 预期失败原因：当前普通会话可在 local-home 下发送 cwd。
- GREEN：实现 Runtime 项目服务、加载顺序、状态和创建入口；运行目标测试。
- REFACTOR：将连接后的项目/Thread 初始加载收敛到一个可取消异步流程，避免多个 effect 竞态；运行 App、project model、Sidebar、thread service 测试和 Web typecheck。

**任务完成门**

- 页面文本和 DOM 中无“本机目录”。
- 项目和会话归属不再读取或比较 cwd。
- 无项目不能通过 Composer 或 Skill 市场创建普通会话。

### TASK-7：完成项目管理、待归属认领、稳定记忆键和搜索显示 `[FR-1, FR-5, FR-6, BR-2, BR-4, DEC-5, DEC-6, DEC-7, AC-5, AC-6, AC-8]`

**交付结果**

- 用户可在 UI 修改、归档、恢复、更换项目目录和认领待归属会话。
- 项目记忆以稳定 `projectId` 为 scope key。
- 搜索和最近会话用服务端 `projectId` 显示项目，不再按路径近似匹配。

**文件与符号**

- 创建：`apps/web/src/features/projects/ProjectManagementDialog.tsx`。
- 创建测试：`apps/web/src/features/projects/ProjectManagementDialog.test.tsx`。
- 修改：`apps/web/src/features/shell/OpenCreatorSidebar.tsx` - 项目管理入口和项目菜单。
- 修改：`apps/web/src/app/AppController.tsx` - 项目 mutation、待归属加载和记忆键。
- 修改：`apps/web/src/features/search/SearchView.tsx` - `projectId` 项目显示。
- 修改：`apps/daemon/src/api/routes.runs.ts` - `prepareRunContext.projectKey` 使用 Thread `projectId`。
- 修改测试：`apps/web/src/features/search/SearchView.test.tsx`。
- 修改测试：`apps/web/src/features/conversation/MemorySuggestion.test.tsx`。
- 修改：`apps/web/src/styles/app.css` - 对话框和状态样式。

**实施步骤**

1. 项目菜单提供“编辑项目”“更换目录”“归档项目”；项目区标题提供图标按钮打开项目管理对话框。
2. 对话框使用表单编辑名称、profile、model、reasoning、sandbox；归档项目列表提供恢复。
3. 更换目录调用 Desktop/Browser host 的目录选择器后请求 `replace-directory`；缺失目录项目在列表中显示不可用状态并提供修复入口。
4. 对话框加载 `assignment=unassigned`，每条待归属会话显示原 cwd 和目标项目选择；路径不一致时显示提示但允许认领。
5. 归档当前项目后选择下一个活跃项目；没有活跃项目时进入无项目空状态。归档操作不从本地直接删除 Thread。
6. `buildMemoryProjectOptions` 使用项目 `id` 作为 key；`currentMemoryProjectKey` 直接取 selected Thread `projectId` 或当前项目 ID；Daemon `prepareRunContext.projectKey` 同样使用普通 Thread `projectId`，调度 Thread 不附加项目记忆 scope。
7. `SearchView.projectNameForCwd` 替换为 `findProjectById(result.projectId)`；最近会话构造的搜索项也带 `projectId`。
8. 认领成功后刷新项目 Thread 和待归属列表，不按 cwd 在 Web 自动移动任何会话。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`manages archived and missing projects and assigns an unowned thread explicitly`。
  - Setup：对话框传入 active、archived、missing 项目和一个 cwd 不一致的待归属 Thread。
  - Assert：编辑、恢复、更换目录、认领调用准确服务方法；不一致提示可见；没有自动认领。
  - 命令：`pnpm --filter @opencreator/web test -- src/features/projects/ProjectManagementDialog.test.tsx src/features/shell/OpenCreatorSidebar.test.tsx`
  - 预期失败原因：项目管理 UI 和认领入口尚不存在。
- RED：
  - 测试名：`uses project ids for memory scopes and search labels after a directory change`。
  - Setup：项目 ID 不变但 cwd 改变，Thread 和搜索结果带相同 projectId。
  - Assert：Memory request `scopeKey` 为项目 ID；搜索显示项目名称，不调用任何路径后缀匹配。
  - 命令：`pnpm --filter @opencreator/web test -- src/app/App.test.tsx src/features/search/SearchView.test.tsx src/features/conversation/MemorySuggestion.test.tsx`
  - 预期失败原因：当前记忆 key 是 canonicalCwd，搜索按 cwd 和末级目录名推断。
- GREEN：实现项目管理对话框、mutation、认领、稳定键和搜索显示；运行目标测试。
- REFACTOR：保持项目 mutation 统一经 `projectService`，对话框不直接操作 RuntimeClient；运行相关 Web 回归和 typecheck。

**任务完成门**

- FR-1、FR-5、FR-6 均有用户可操作入口。
- 项目改目录后记忆 scope 不变化。
- 搜索、侧边栏、待归属区无 cwd 所有权推断。

### TASK-8：补齐迁移、重启恢复和未知会话隔离 E2E `[FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, BR-1, BR-2, BR-3, BR-4, BR-5, BR-6, NFR-1, NFR-2, NFR-3, DEC-1, DEC-2, DEC-3, DEC-4, DEC-5, DEC-6, DEC-7, AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8]`

**交付结果**

- Web E2E 覆盖真实 Daemon、受控 Codex app-server、项目 API、首次绑定、重启历史、未知会话隔离和迁移。
- Desktop E2E 覆盖项目 SQLite 持久化、应用重启和 Codex 不可用时索引可见。

**文件与符号**

- 修改：`apps/web/e2e/fixtures/runtime.ts` - 先创建项目，再创建普通 Thread。
- 修改：`apps/web/e2e/support/fake-codex.mjs` - 可配置并持久化 thread list、turns、search、start/resume。
- 创建：`apps/web/e2e/project-session-ownership.spec.ts`。
- 修改：`apps/desktop/e2e/desktop.spec.ts` - 同一 user-data 目录重启测试。
- 修改：`apps/desktop/e2e/packaged-app.ts` - 增加使用原 executablePath、args 和 env 重新拉起已关闭应用的 helper。

**实施步骤**

1. Web fixture 通过 `POST /projects` 获取服务端 projectId，再用 projectId 创建普通 Thread；删除 `projectIdForCwd` 和项目 localStorage 初始化。
2. fake Codex 把配置中的外部会话、搜索结果和 turns 持久化到 stateDir；记录所有 method，支持断言没有 `thread/list`。
3. Web E2E 场景一：全新数据目录无“本机目录”；创建项目、会话、首次运行，断言 projectId 和 codexThreadId；重载后从 fake Codex turns 恢复正文。
4. Web E2E 场景二：fake Codex 注入相同 cwd 和不同 cwd 的未知会话；列表、搜索、直接 `#/threads/<runtime-id>` 均不可见且 SQLite RuntimeThread 数量不增加。
5. Web E2E 场景三：预置旧 `opencreator.projects.v1`、旧自建 Thread 和 `thread_codex_*`，断言迁移、待归属和隐藏分类。
6. Desktop E2E 使用同一临时 `--user-data-dir`：第一次通过 Runtime API 创建项目，关闭并重新启动应用，断言项目仍显示且无“本机目录”。
7. Desktop fake Codex 保持 app-server 不可用；该用例只验证 SQLite 项目索引和降级，不把 Codex 历史恢复错误归因到 Desktop fixture。

**TDD**

- 策略：必须。
- RED：
  - 测试名：`OpenCreator owns projects and mapped sessions across reloads`。
  - Setup：使用更新前 fixture 执行新 E2E。
  - Assert：项目 API 创建和 projectId Thread body 当前无法满足而失败。
  - 命令：`pnpm e2e -- apps/web/e2e/project-session-ownership.spec.ts`
  - 预期失败原因：fixture 仍写 localStorage，fake Codex 无持久历史数据。
- RED：
  - 测试名：`packaged app persists OpenCreator projects when Codex app-server is unavailable`。
  - Setup：打包应用，创建项目，关闭后用同一 user-data 重启。
  - Assert：项目仍存在且没有“本机目录”。
  - 命令：`pnpm --filter @opencreator/desktop e2e -- e2e/desktop.spec.ts`
  - 预期失败原因：当前 Desktop E2E 没有项目持久化重启场景。
- GREEN：更新 fixture 和 E2E，运行两个目标命令。
- REFACTOR：只抽取可复用的 API/重启 helper，不扩展 Desktop fake Codex 到 app-server；重跑两个 E2E。

**任务完成门**

- AC-1、AC-2、AC-3、AC-4、AC-6、AC-7、AC-8 有 E2E 或真实 API 集成证据。
- fake Codex method 日志证明普通列表没有调用 `thread/list`。
- 测试结束清理临时目录和进程。

### TASK-9：执行完整功能验收

**交付结果**

- 完成本地实现差异自审、全量自动化回归、公开边界功能验收、打包验证和回滚检查。

**本地实现差异自审**

1. 运行 `git diff --stat`，再定向读取本次修改的 `git diff`。
2. 对照契约快照、追踪矩阵和 TASK-1 至 TASK-8，确认无漏项、范围外功能、接口漂移或 AC 降级。
3. 检查 SQLite 迁移是否保留旧数据、唯一索引是否会静默清理冲突、API 是否存在来源绕过。
4. 检查普通与调度 Thread 创建是否真正分离，Web 是否仍残留 `LOCAL_HOME`、`projectIdForThread`、`projectMatchesCwd` 或项目 localStorage 写入。
5. 检查搜索分页、深链接、Run 绑定失败和项目 mutation 的错误处理。
6. 检查重复抽象、无用兼容层、测试是否只断言 Mock 调用而没有公开结果。
7. 自审发现问题时按受影响任务的 TDD 顺序修复并重跑；相关修改使旧证据失效。

**自动化回归**

在仓库根目录依次运行：

```bash
pnpm --filter @opencreator/daemon test
pnpm --filter @opencreator/web test
pnpm --filter @opencreator/desktop test
pnpm -r typecheck
pnpm e2e -- apps/web/e2e/project-session-ownership.spec.ts
pnpm --filter @opencreator/desktop e2e -- e2e/desktop.spec.ts
pnpm -r test
git diff --check
```

预期全部退出状态为 `0`。若 Desktop E2E 依赖当前平台已构建包，先运行：

```bash
pnpm desktop:package
pnpm --filter @opencreator/desktop verify:package
```

**功能验收环境**

1. 使用临时 Daemon dataDir、临时 Codex home 和受控 fake Codex，不读取用户真实 Codex 历史。
2. Web 使用 Playwright 真实浏览器；Daemon 使用真实 Fastify HTTP 边界；Desktop 使用打包应用。
3. 每项证据记录执行时间、工作目录、命令、退出状态和关键业务结果。
4. 测试后停止 Daemon、浏览器、Desktop 进程并删除测试临时目录。

**验收矩阵**

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 证据 |
|---|---|---|---|---|---|---|---|
| AC-1 | P0 | 全新安装项目持久化 | 全新 dataDir | 启动打包应用，添加项目，关闭并用同一 user-data 重启 | 从始至终无“本机目录”；项目重启后存在 | Desktop Playwright + `/projects` | 本次命令、时间、截图或断言摘要 |
| AC-2 | P0 | 未知 Codex 会话隔离 | fake Codex 含相同和不同 cwd 未知会话 | 刷新列表并搜索关键词 | 未映射会话不出现，RuntimeThread 行数不增加，未调用 `thread/list` | Web Playwright + fake method 日志 + API | 本次日志摘要 |
| AC-3 | P0 | 普通会话创建和首次绑定 | 已有活跃可用项目 | 创建会话并发送首次消息 | 创建响应有 projectId；请求无 cwd 覆盖；运行后唯一绑定 Codex ID | Web Playwright + Daemon API/DB 断言 | 本次响应和断言摘要 |
| AC-4 | P0 | 重启恢复历史 | AC-3 已完成，fake Codex 保存 turns | 重启或刷新后打开会话 | 按 projectId 展示，并通过映射读取原历史 | Web Playwright 真实交互 | 本次断言摘要 |
| AC-5 | P1 | 改名和更换目录 | 项目无活跃运行且有既有普通 Thread | 改名，再选择新目录 | projectId、codexThreadId 不变；项目和普通 Thread cwd 更新；调度 Thread 不变 | 真实项目 API + UI | 本次响应摘要 |
| AC-6 | P0 | 旧数据迁移和待归属 | 旧 localStorage、自建 Thread、外部导入 Thread | 启动新版并执行迁移，认领待归属会话 | 项目保留；匹配会话归属；主目录自建会话待归属；外部会话隐藏；原 key 保留 | Web Playwright + 项目 API | 本次断言摘要 |
| AC-7 | P0 | Codex 不可用降级 | 已有项目和绑定 Thread | 停止 Codex 后启动 OpenCreator | 项目和 Thread 索引可见；历史不可用但映射未清空 | Desktop Playwright + API | 本次响应摘要 |
| AC-8 | P0 | 搜索和深链接不能采用未知会话 | Codex 搜索返回未知结果，DB 有 discovered 行 | 搜索、直接访问 discovered RuntimeThread ID | 搜索过滤未知结果；详情、history、runs 返回 404；不创建新行 | Web Playwright + 真实 API | 本次状态码和行数摘要 |

**发布与回滚**

1. Schema 只新增表、列和索引，不删除旧列；发布前确认重复 Codex ID 检查通过。
2. `opencreator.projects.v1` 至少保留本版本，不新增删除逻辑。
3. 打包前运行 `pnpm desktop:package` 和 `verify:package`；产物命名遵循项目现有发布脚本。
4. 回滚旧应用时保留新版 `app.sqlite` 和原 localStorage；若旧版本无法接受扩展 Schema，先停止应用并恢复发布前数据库备份，不对运行中数据库复制。
5. 回滚不删除新版创建的目录或 Codex 会话；旧版本可能看不到只存在 SQLite 的新项目，该限制在发布说明中明确。

**任务完成门**

- 本地差异自审通过，或所有本交付相关问题已按 TDD 修复并重新验证。
- 全部 P0 AC 为 PASS，且证据来自最后一次相关修改之后。
- 任一 P0 为 FAIL 或 BLOCKED 时，不宣布完成、可发布或已打包成功。

## 执行结果（2026-07-21）

### 实施结论

1. Daemon SQLite 已成为 OpenCreator 项目事实源，普通会话通过 `project_id` 和 `origin` 持久化所有权。
2. 普通会话创建必须提交 `projectId`，Daemon 从项目解析执行目录；Web 和 Daemon 均不再按 `cwd` 推断项目归属。
3. Codex app-server 只承担执行、恢复、历史和正文搜索；列表、搜索、深链接不会自动导入未知 Codex 会话。
4. 旧 `opencreator.projects.v1` 只作为幂等迁移输入，原始 localStorage 保留；`local-home` 不迁移，生产界面不再生成或展示“本机目录”。
5. 项目创建、配置修改、归档、恢复、目录更换和待归属会话认领均已接入 Runtime API。
6. 项目、会话和 Codex ID 映射在页面刷新、Daemon 重启和同一 Desktop user-data 应用重启后保持。
7. 未发生契约偏差；调度 Thread 生命周期保持原设计。

### 最终验证证据

| 验证项 | 结果 |
|---|---|
| `pnpm test` | PASS；退出状态 `0`。Daemon `677 passed / 23 skipped`，Desktop `63 passed`，其余工作区测试全部通过 |
| `pnpm typecheck` | PASS；退出状态 `0` |
| `pnpm build` | PASS；退出状态 `0`，仅保留既有 Web chunk 大小警告 |
| `pnpm e2e -- apps/web/e2e/project-session-ownership.spec.ts` | PASS；根配置在桌面和移动项目执行完整 Web E2E，`20 passed` |
| `OPENCREATOR_DESKTOP_OFFLINE=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm desktop:dist` | PASS；离线生成 macOS arm64 `.app`、DMG 和 ZIP，包内校验通过 |
| `pnpm --filter @opencreator/desktop e2e:package` | PASS；最新分发包 `9 passed` |
| `git diff --check` | PASS；退出状态 `0` |
| 生产代码残留检查 | PASS；无“本机目录”、`projectIdForThread`、`pathsLookRelated`、`projectIdFromCwd`、运行期 Codex 自动导入或项目 localStorage 写入 |

### AC 验收

| AC ID | 状态 | 最终证据摘要 |
|---|---|---|
| AC-1 | PASS | Packaged E2E 创建项目和会话，刷新及同一 user-data 重启后仍存在，全程无“本机目录” |
| AC-2 | PASS | Web E2E 验证相同和不同 `cwd` 的未知 Codex 会话均不进入列表、搜索或 RuntimeThread |
| AC-3 | PASS | Web、API 和 Run 集成测试验证普通会话只提交 `projectId`，首次运行后唯一绑定 Codex ID |
| AC-4 | PASS | Web E2E 和历史 API 测试验证刷新后按持久化映射恢复历史 |
| AC-5 | PASS | 项目 API、Manager 和 Web 组件测试验证改名、目录更换及归档恢复 |
| AC-6 | PASS | Web E2E 和迁移测试验证一次性迁移、精确路径归属、待归属认领、外部会话隐藏及原 key 保留 |
| AC-7 | PASS | Packaged E2E 在 Codex app-server 不可用时仍加载 SQLite 项目和会话索引 |
| AC-8 | PASS | Web E2E 和 API 测试验证未知搜索结果被过滤，隐藏会话详情、history 和 runs 均不可公开访问 |

### 分发产物

| 产物 | 生成时间 | SHA-256 |
|---|---|---|
| `apps/desktop/release/OpenCreator-0.1.0-arm64.dmg` | `2026-07-21 13:39:19 +0800` | `bf43c31f4d2818f64260a1e8725f4fc1fad2230a974f358f77f93e79fe7ef964` |
| `apps/desktop/release/OpenCreator-0.1.0-arm64-mac.zip` | `2026-07-21 13:39:06 +0800` | `91d4e8a738813f3418f2e9ded7fd0b53c137c2af3dcefbeee2d63ed4bb298ba5` |

构建清单 `apps/desktop/release/opencreator-desktop-build-manifest.json` 的模式为 `dist`，生成时间为 `2026-07-21T05:39:21.656Z`，工作区状态为 `dirty`。产物为未公证的本地 macOS arm64 构建；正式外部分发仍需 Developer ID 签名和 Apple 公证。

## 偏差规则

1. 不改变契约的文件位置、局部命名和内部辅助函数可调整，最终报告记录原因和影响。
2. 改变项目事实源、Thread 所有权、迁移分类、Codex 映射、错误语义或 AC 时立即停止，更新方案和 Plan。
3. 不得为通过测试删除失败用例、降低唯一性、恢复 cwd 推断、重新引入“本机目录”或允许未知会话导入。
4. 实施中发现现有用户改动与本任务重叠时，先理解并兼容；只有确实无法完成时才向用户报告阻塞。

## 最终报告格式

最终回复必须包含：

1. 实施结果和未完成项。
2. Plan 偏差及是否改变契约。
3. 本地实现差异自审结论和修复项。
4. 关键 RED、GREEN、回归命令和结果。
5. AC-1 至 AC-8 的 PASS、FAIL 或 BLOCKED 及本次证据摘要。
6. 打包、发布、回滚状态和遗留风险。

## 已接受风险

1. 来源方案未获得有效独立 Reviewer 审核；原 Reviewer 因无文件读取能力返回 `BLOCKED`，明确说明不代表方案本身存在 Blocker。用户已知情批准继续。
2. 旧 `thread_codex_*` 来源分类依赖现有稳定 ID 规则；TASK-1 和 TASK-5 必须用迁移测试锁定，不能扩大为运行期推断。
3. Codex 搜索过滤需要多页读取；TASK-4 必须验证 cursor 不重复、结果不丢失和未知页不会提前终止。
4. Desktop fake Codex 不支持 app-server；Desktop E2E 只承担项目持久化和 Codex 不可用降级，历史映射恢复由 Web E2E 和 Daemon 集成测试承担。

## Plan 审核记录

> 自定义 Reviewer：`zhiyu-reviewer` 未注册，返回 `unknown agent_type`
> 回退 Reviewer：`default`
> Reviewer 原始结论：BLOCKED
> 流程结论：PASS（用户知情授权执行）

### Reviewer 原始输出

```text
## 审核结论
BLOCKED

## 审核问题
**Blocker-1：审核证据不可读取**

- 证据：当前会话未提供 CodeGraph 或本地文件只读工具；三次定向工具发现均未找到相关能力。用户同时明确禁止启动子进程，因此不能通过 shell/CLI 读取方案、Plan、AGENTS 及代码证据。
- 影响：无法验证 Plan 的契约覆盖、任务依赖、TDD 顺序、迁移幂等性、会话绑定唯一性、隔离行为及验收关闭条件。此时给出 PASS 或 REVISE 均缺乏证据。
- 建议：为 Reviewer 暴露 CodeGraph/本地只读文件工具，或直接提供方案、Plan、AGENTS 及关键代码片段的内容。
- 关闭条件：能够只读获取指定文档和直接影响证据，并完成逐项追踪与代码级一致性检查。

## 契约追踪检查
未能执行。FR-1～FR-6、BR-1～BR-6、NFR-1～NFR-3、DEC-1～DEC-7、AC-1～AC-8 与 TASK-0～TASK-9 的闭环状态均无法从现有证据确认。

## 审核范围说明
本次仅尝试审核用户指定的第一版 Plan、已批准方案、AGENTS 及列明的直接影响证据；未审查排除项，未修改文件、未实现、未运行测试、未启动子进程或调用 Codex CLI。
```

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
|---|---|---|---|---|---|
| R-1 | Blocker | 用户知情接受独立审核缺失风险并授权执行 | 文档头部、本节、已接受风险 | Reviewer 的关闭条件未满足；其输出明确是审核基础设施阻塞，未指出 Plan 本身的具体缺陷。用户在看到审核状态后明确回复“开始执行”（2026-07-21） | Plan 未获得有效独立 Reviewer 审核；开发阶段必须严格执行 TASK-0、迁移/绑定/隔离 RED 测试和最终 P0 验收 |
