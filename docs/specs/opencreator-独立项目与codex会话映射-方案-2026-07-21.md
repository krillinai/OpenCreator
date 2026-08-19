# OpenCreator 独立项目与 Codex 会话映射方案

> 状态：已批准
> 设计确认：已完成（D-1 至 D-3）
> Reviewer 原始结论：BLOCKED
> 流程结论：PASS（用户知情批准）
> 用户批准：已批准（2026-07-21）

## 背景、目标与非目标

### 背景

当前 OpenCreator 的项目保存在 Web `localStorage`，普通会话从 Codex
app-server 的 `thread/list` 导入后，再按 `cwd` 与项目路径是否相等进行前端分组。
这同时混淆了三个不同概念：

1. OpenCreator 主动创建并管理的项目。
2. OpenCreator 主动创建的 RuntimeThread。
3. Codex CLI、Desktop、IDE 或其他入口产生的任意历史会话。

现有“本机目录”回退虽然避免了临时目录被自动创建为项目，却会把所有未匹配会话
集中到 `~`，既丢失项目所有权，也可能让新会话在用户主目录运行。

### 目标

1. OpenCreator 项目与 Codex 项目彻底分离，双方不建立同步关系。
2. OpenCreator 只展示和管理自己创建或用户明确认领的普通会话。
3. OpenCreator 持久化项目与 RuntimeThread 的所有权关系，以及 RuntimeThread 与
   `codexThreadId` 的绑定。
4. Codex app-server 继续负责会话执行、恢复、正文历史和搜索来源。
5. 删除 `cwd` 运行期推断和“本机目录”默认项目，消除项目丢失与历史会话污染。
6. 升级时保留既有 OpenCreator 项目和自建会话，并提供待归属会话恢复入口。

### 非目标

1. 不读取、修改或同步 Codex Desktop 的项目状态文件。
2. 本期不提供任意 Codex 历史会话的主动导入功能。
3. 不把一个会话同时分配给多个项目。
4. 不重构 `schedule_draft`、`schedule_task` 的现有生命周期。
5. 不删除本机代码目录或底层 Codex 会话文件。

## 用户需求原文

1. “那就直接来个彻底的，opencreator的项目和codex的项目彻底分离，二者不需要有关系，
   opencreator维护自己创建的项目的会话，问题是会话是从codex cli读取的，由opencreator维护
   一套映射逻辑，有没有问题？ $zhiyu-brainstorm 分析这个需求”
2. D-1 确认：“没问题，继续”
3. D-2 确认：“没问题，继续”
4. D-3 确认：“没问题，继续”

## 事实基线与假设

| 证据 | 已确认事实 |
|---|---|
| `apps/web/src/features/projects/project-model.ts` | 项目由 Web 模型定义并持久化到 `opencreator.projects.v1` |
| `apps/web/src/app/AppController.tsx` | `projectIdForThread` 通过 `cwd` 匹配项目，未匹配时归入 `local-home` |
| `apps/daemon/src/codex/sessions/app-server-provider.ts` | Codex 会话通过 `thread/list`、`thread/turns/list` 和 `thread/search` 读取 |
| `apps/daemon/src/threads/manager.ts` | Daemon 已持久化 RuntimeThread 与 `codexThreadId` 的绑定 |
| `apps/daemon/src/api/routes.threads.ts` | 普通会话列表会合并并导入最近 Codex 会话 |
| `apps/daemon/src/storage/migrations.ts` | SQLite 已有 `threads`，目前没有 `projects`、`project_id` 或会话来源字段 |
| `apps/daemon/src/codex/app-server-runner.ts` | `thread/start` 和 `thread/resume` 都接收 OpenCreator 提供的 `cwd` |

假设：

1. 一个普通 RuntimeThread 在任意时刻最多属于一个 OpenCreator 项目。
2. 项目目录是普通会话的执行与文件访问边界，但不是会话所有权标识。
3. 旧 `thread_codex_*` ID 只由现有 Codex 自动导入逻辑生成，可用于一次性来源迁移。
4. Desktop 与 Web 使用同一个 Daemon 数据目录，SQLite 适合作为项目事实源。

## 设计确认记录

| 设计部分 | 核心决定 | 用户确认原话 |
|---|---|---|
| D-1 目标与产品边界 | 项目完全独立；移除“本机目录”；只展示 OpenCreator 拥有的会话；未知 Codex 会话不自动导入 | “没问题，继续” |
| D-2 数据模型与映射 | 项目进入 Daemon SQLite；Thread 直接保存 `projectId` 和来源；首次运行后绑定唯一 `codexThreadId` | “没问题，继续” |
| D-3 迁移与验收 | 幂等迁移旧项目；本机目录自建会话进入待归属区；Codex 不可用时保留本地索引 | “没问题，继续” |

## 需求与业务规则

| ID | 类型 | 优先级 | 描述 |
|---|---|---|---|
| FR-1 | 功能 | P0 | 用户可以在 OpenCreator 中创建、查看、修改、归档和恢复独立项目 |
| FR-2 | 功能 | P0 | 新建普通会话必须指定活跃 `projectId`，Daemon 持久化项目归属 |
| FR-3 | 功能 | P0 | RuntimeThread 首次运行后绑定唯一 `codexThreadId`，后续从 Codex 读取和恢复历史 |
| FR-4 | 功能 | P0 | 侧边栏、搜索和导航只展示 OpenCreator 项目会话及现有调度会话 |
| FR-5 | 功能 | P0 | 升级后可查看并认领无法自动归属的 OpenCreator 自建会话 |
| FR-6 | 功能 | P1 | 用户可以显式更换项目目录，并让该项目既有普通会话使用新目录 |
| BR-1 | 规则 | P0 | OpenCreator 不读取、不修改、不同步 Codex 项目配置 |
| BR-2 | 规则 | P0 | 运行期禁止根据 `cwd`、标题或时间推断项目归属 |
| BR-3 | 规则 | P0 | 未知 Codex 会话不得因列表、搜索、深链接或刷新而自动导入 |
| BR-4 | 规则 | P0 | 归档项目不删除目录、Codex 会话或 Thread 映射 |
| BR-5 | 规则 | P1 | 调度会话继续由 `purpose` 和调度系统管理 |
| BR-6 | 规则 | P0 | 不再创建“本机目录”，没有项目时禁止新建普通会话 |
| NFR-1 | 约束 | P0 | Codex 不可用时，项目和会话索引仍可从 SQLite 加载 |
| NFR-2 | 约束 | P0 | 项目迁移和 `codexThreadId` 绑定必须幂等、唯一且可恢复 |
| NFR-3 | 约束 | P0 | 升级不得静默删除旧项目、自建会话或原始 localStorage 备份 |

## 方案比较与推荐

### 方案 A：`threads.project_id` 直接外键，推荐

项目保存在 Daemon SQLite，普通 Thread 直接保存 `project_id`。一对多关系明确，
创建、查询、归档和搜索都可以通过单次连接或索引完成。

优点：数据模型简单、数据库可维护完整性、查询和迁移成本低。

### 方案 B：独立 `project_threads` 映射表

可表达多对多关系，但当前没有一个会话属于多个项目的需求。它会增加事务、唯一约束、
归档和查询复杂度，没有带来实际能力。

### 方案 C：继续按 `cwd` 推断

无法区分显式项目和任意历史目录，遇到临时路径、符号链接、目录移动和同路径外部会话时
都会产生错误归属，因此排除。

## 关键设计决策

| DEC ID | 决策 | 理由 | 约束范围 |
|---|---|---|---|
| DEC-1 | Daemon SQLite 是项目事实源 | 项目需要与 Thread、运行和迁移保持事务一致 | 项目 API、Web 状态 |
| DEC-2 | Thread 直接保存 `project_id` 和 `origin` | 明确所有权并区分自建与历史自动发现会话 | 普通 Thread、迁移 |
| DEC-3 | 采用先创建 RuntimeThread、首次运行后绑定 Codex 的两阶段流程 | Codex ID 只能在 `thread/start` 后获得 | 创建、运行、故障恢复 |
| DEC-4 | OpenCreator 保存索引和所有权，Codex 保存会话正文 | 离线可见且不复制完整会话真相 | 列表、历史、恢复 |
| DEC-5 | 路径匹配只允许出现在一次性迁移中 | 保留旧数据但杜绝运行期启发式 | 升级迁移 |
| DEC-6 | 显式更换项目目录时更新该项目普通 Thread 的执行目录 | Codex resume 支持由 OpenCreator提供新 `cwd` | 项目目录修复 |
| DEC-7 | Codex 搜索结果必须在 Daemon 与映射求交集 | 防止 Web 绕过所有权边界 | 搜索、深链接 |

## 详细设计

### 项目数据

新增 `projects` 表：

```text
id, name, cwd, canonical_cwd, profile, model, reasoning, sandbox,
status, created_at, updated_at, archived_at
```

新项目使用 OpenCreator 生成的稳定 ID。新建时展开 `~`、校验目录并执行 `realpath`。
同一个 `canonical_cwd` 只能有一个活跃项目。迁移产生的缺失目录项目允许
`canonical_cwd` 为空，并在修复目录前禁止运行。

新增项目 API：

```text
GET  /projects
POST /projects
PATCH /projects/:id
POST /projects/:id/archive
POST /projects/:id/restore
POST /projects/:id/replace-directory
```

Desktop 目录选择器只返回路径，项目创建和校验全部由 Daemon 完成。

### Thread 所有权

`threads` 新增：

```text
project_id TEXT NULL
origin TEXT NOT NULL  -- opencreator_created | codex_discovered
```

普通项目会话必须满足：

```text
purpose = conversation
origin = opencreator_created
project_id IS NOT NULL
```

`codex_thread_id` 增加非空唯一索引。`ThreadResponse` 返回 `projectId` 和 `origin`。
普通 `POST /threads` 必须传 `projectId`，Daemon 从项目读取 `cwd`，不接受 Web
覆盖项目目录。Composer 明确配置可覆盖项目默认值，Thread 创建后保存配置快照。

### 创建与绑定

1. Daemon 校验项目活跃且目录可用。
2. 创建带 `projectId`、`origin=opencreator_created` 的 RuntimeThread。
3. 首次发送消息调用 Codex `thread/start`。
4. Codex 返回 ID 后，在唯一约束保护下写入 `codex_thread_id`。
5. 后续历史使用 `thread/turns/list`，运行使用 `thread/resume`。

若绑定写入失败，Run 保留返回的 Codex ID，Thread 保持未绑定并记录错误。启动恢复只在
Thread 未绑定、Run 唯一指向该 Thread、Codex ID 未被占用时自动修复，否则停止并报告。

### 列表、搜索与导航

普通 `/threads` 列表只查询本地 `origin=opencreator_created` 且已有项目归属的记录，不再
调用 `listRecentCodexThreads` 导入任意会话。项目侧边栏直接使用服务端 `projectId`
分组，删除 `projectIdForThread(cwd)`。

搜索仍以 Codex app-server 为正文来源，但 Daemon 必须用已映射 `codexThreadId`
过滤结果；过滤后不足请求数量时继续读取 Codex 搜索分页。未知结果不返回 Web。
打开搜索结果或深链接只能访问已存在的 OpenCreator RuntimeThread。

### 项目目录更换

普通改名或默认配置修改不改变既有 Thread。显式更换目录时校验新路径，并在不存在
运行中任务的前提下，事务性更新项目及其全部普通 Thread 的 `cwd/canonical_cwd`。
`projectId` 和 `codexThreadId` 不变。

## 兼容、迁移与回滚

新增幂等迁移接口 `POST /projects/migrations/local-storage-v1`。Web 传入旧
`opencreator.projects.v1`，Daemon 在事务中创建项目、合并规范路径重复项，并仅将
`opencreator_created` 历史普通会话按完整规范路径归属。旧 `local-home` 不创建项目；
其自建会话进入待归属区。`codex_discovered` 始终隐藏。

迁移状态保存在 Daemon，重复调用返回既有映射。旧 localStorage 至少保留一个版本，
新版迁移成功后停止把它作为事实源。回滚旧版本时仍可读取原数据。

项目归档或目录更换遇到活跃运行返回 `409`。项目目录缺失时项目保留并标记不可用。
Codex 不可用或已映射 Codex 会话不存在时，不清空本地项目、Thread 或绑定。

## 验收标准

| AC ID | 关联需求 | 前置条件 | 操作 | 可观察结果 | 验证层级 |
|---|---|---|---|---|---|
| AC-1 | FR-1, BR-6 | 全新数据目录 | 启动、添加项目、重启 | 无“本机目录”，项目持久存在 | Desktop E2E |
| AC-2 | FR-4, BR-2, BR-3 | Codex 存在相同及不同 cwd 历史会话 | 刷新列表和搜索 | 未映射会话均不出现 | Daemon 集成 |
| AC-3 | FR-2, FR-3, NFR-2 | 已有活跃项目 | 新建会话并完成首次运行 | 创建时有 projectId，运行后绑定唯一 Codex ID | API 集成 |
| AC-4 | FR-3, NFR-1 | 已完成一次会话 | 重启并打开会话 | 按 projectId 展示并从 Codex 读取原历史 | Desktop E2E |
| AC-5 | FR-6, BR-2 | 项目无活跃运行 | 改名并显式更换目录 | 归属不变，既有会话使用新目录 | Daemon 集成 |
| AC-6 | FR-5, NFR-3 | 存在旧项目、自建会话和外部 Codex 会话 | 执行升级迁移 | 项目保留，本机会话待归属，外部会话隐藏 | 迁移测试 |
| AC-7 | NFR-1, BR-4 | 已有项目和绑定会话 | 停止 Codex 后启动 OpenCreator | 索引仍显示，历史不可用但映射不丢失 | Desktop E2E |
| AC-8 | FR-4, BR-3 | 存在未知 Codex 搜索结果和深链接 | 搜索或直接导航 | 不创建 RuntimeThread、不导入未知会话 | Web/API 集成 |

## 测试策略

Daemon 单元测试覆盖项目仓储、路径规范化、重复路径、归档恢复、Thread 所有权、
Codex ID 唯一绑定、绑定恢复和迁移幂等性。

Daemon 集成测试覆盖项目 API、普通 Thread 必须携带项目、列表不再自动导入、
搜索映射过滤、目录更换、活跃运行冲突和 Codex 不可用降级。

Web 测试覆盖空项目状态、服务端项目 CRUD、按 `projectId` 分组、待归属认领、
搜索导航隔离以及删除“本机目录”和 `cwd` 推断。

Desktop E2E 使用临时数据目录完成创建、首次运行、重启恢复、注入外部 Codex 会话、
Codex 下线和恢复的完整链路。

## 风险与未决问题

1. 旧项目 localStorage 只能由 Web 主动提交，迁移必须等待 Daemon 连接成功后执行。
2. 一次性通过 `thread_codex_*` 分类旧自动导入会话依赖现有稳定 ID 生成规则，需要测试锁定。
3. 搜索结果过滤可能需要读取多个 Codex 分页，必须保留游标和加载状态，避免结果提前截断。
4. 当前没有阻塞设计或实现的未决问题。

## 独立审核记录

> Reviewer 原始结论：BLOCKED
> 审核角色：`zhiyu-reviewer` 未注册，按兼容规则使用一次默认独立 Reviewer

### Reviewer 原始输出

```text
## 审核结论
BLOCKED

## 审核问题
### R-1 审核对象无法读取
- 严重程度：Blocker
- 证据：方案路径未提供正文；Reviewer 会话未暴露可用的 CodeGraph 或文件读取资源。
  审核约束同时禁止通过命令或子进程读取文件。
- 影响：无法核验方案契约，也无法对迁移幂等性、数据保留、未知会话隔离、
  Codex ID 绑定、失败恢复及直接调用方兼容性作出有证据的结论。
  此处是审核阻塞，不代表方案本身已有 Blocker。
- 建议：向 Reviewer 暴露只读 CodeGraph/文件读取工具，或提供方案正文以及直接影响
  代码和测试片段。
- 关闭条件：能够只读访问方案全文，并定向读取直接影响证据及其一层调用关系后，
  重新完成一次独立审核。

## 契约追踪检查
审核包声明了必须保持一致的契约组合，但缺少各契约正文，无法验证需求、决策和 AC
是否形成闭环，也无法确认是否遗漏直接调用方。

## 审核范围说明
Reviewer 遵守了只读和排除项。审核被阻塞所缺失的外部事实是方案全文、直接影响
代码/测试内容及其一层调用关系。
```

### 问题处理记录

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
|---|---|---|---|---|---|
| R-1 | Blocker | 用户知情接受审核缺失风险，不修改方案契约 | 本节及文档头部 | Reviewer 已明确说明这不代表方案本身存在 Blocker；用户在看到审核状态和遗留风险后批准继续，原话：“没问题，方案我审过了，可以继续了” | 本方案未获得有效独立 Reviewer 审核，实施计划和开发验证需重点检查契约、迁移与兼容问题 |
