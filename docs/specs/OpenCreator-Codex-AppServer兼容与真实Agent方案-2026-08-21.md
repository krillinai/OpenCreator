# OpenCreator Codex App Server 兼容与真实 Agent 方案

> 日期：2026-08-21
> 版本：V3
> 状态：已批准
> 方案类型：复杂方案
> 目标 Codex 版本：`0.149.0`
> 关联方案：`docs/specs/OpenCreator模板化创作架构方案-2026-08-20.md`
> V1 Reviewer 原始结论：`BLOCKED`，原因是缺少用户需求原文、确认上下文和可枚举审核影响清单，未进入技术审核
> V2 Reviewer 原始结论：`REVISE`，提出 4 个 Major，无产品未决问题
> 流程结论：`PASS`，4 个 Major 已在 V3 按关闭条件修订
> 用户批准：2026-08-21，批准原话：`没问题，继续`

## 1. 文档目的

本方案解决四个已经明确的问题：

1. OpenCreator 升级并内置最新稳定 Codex，交互式 Agent 统一使用 `codex app-server`，不再把 `codex exec` 当作主链路。
2. 内置 Codex 与用户机器上已经安装的 Codex 完全隔离，不修改用户 PATH、全局配置、Skills 或凭据。
3. OpenCreator 右侧 Agent 接入真实 Codex Thread、Turn、Item 和工具调用，删除生产环境的 Demo、规则回答与假结果兜底。
4. 将容易误解的“OpenCreator MCP”重新定义为 Creator Tool Server：它是 OpenCreator 业务工具服务，MCP 只是 Codex 使用它的一种传输协议。

本方案继承上一份模板化创作方案中的产品定位、Creator Job、TemplateDefinition、Artifact、Activity 和 Stage 设计；当两份文档在 Codex Runtime、Agent 持久化、Creator Tool 或 KrillinAI 运行方式上冲突时，以本方案为准。

## 2. 用户需求原文与设计来源

以下原文按本轮方案形成顺序记录，用于让独立 Reviewer 判断是否发生需求漂移：

1. `其他的没问题，我就觉得skills的描述那一节我没看明白，模版和skills的关系到底是什么，skills是每次作为上下文全部传到底层的codex，还是写入到codex的skills里面，这个要讲清楚。还有就是Krillinai是一个golang服务，是每次都用cli调用，还是作为一个常驻的服务启动，让执行更快呢，这个也要考虑下。你还是画一个全局的架构图来讲解吧，每个部分都要想清楚`
2. `稳定 Skill 安装一次 -- 在什么时机安装呢，正常来说，用户肯定不会显示去处理，可能也看不懂什么是skill，其他方案没问题了`
3. `功能可以分不同阶段，P0确实可以先从最小的开始验证，但是其他阶段的方案也要一起出出来，方便后续指导开发，没问题，继续吧`
4. `codex昨天有重大更新，OpenCreator底层用的就是codex的cli，你再分析下最新的codex开源代码，我看是有app-server和sdk一整套的harness开源，分析下对OpenCreator的影响`
5. `1. 目前OpenCreator全部依赖的就是codex cli，这次codex更新的app-server，sdk等继续放弃不用，还是只用codex cli吗`
6. `2. OpenCreator MCP 这一层很容易让人误解，这不应该是Codex runtime封装层吗`
7. `3. 把Codex当做安装包安装进OpenCreator，如果机器本身就有Codex了，会不会冲突`
8. `1. 需要升级Codex到最新版本，按照最新的开源代码架构设计OpenCreator的兼容方案，我理解是不是统一用Codex cli的app server`
9. `2. OpenCreator支持将Codex打包进去，就是你讲的方案，和本机已安装的Codex不冲突。`
10. `3. 让OpenCreator的Agent能真正运行起来，不要再运行demo了，也不存在兜底用demo的mock数据，这是一个完整的功能。`
11. `4. Creator Tool Server就按你的建议去设计。`
12. `给出完整的设计方案，使用 $zhiyu-brainstorm 去完成`

四段设计分别在完整内容展示后由用户确认：

| 顺序 | 展示内容 | 紧随其后的用户确认 |
| --- | --- | --- |
| D-1 | 总体边界与技术选型 | `没问题，继续` |
| D-2 | Codex Runtime 打包、版本和兼容 | `没问题，继续` |
| D-3 | 真实 Agent 与 Creator Tool Server | `没问题，继续` |
| D-4 | 迁移、异常、测试与验收 | `没问题，继续` |

## 3. 独立审核包

### 3.1 审核类型

V1 因审核输入不完整得到 `BLOCKED`，没有产生技术结论；V2 补齐审核基线后完成技术审核，原始结论为 `REVISE`；V3 按四个 Major 的关闭条件完成修订，并保留全部原始结论。

### 3.2 直接影响清单

| 范围 | 当前直接证据 |
| --- | --- |
| Codex Host 与事件 | `apps/daemon/src/codex/app-server-host-2026-07-28.ts`、`apps/daemon/src/runs/persistent-app-server-executor-2026-07-28.ts`、`apps/daemon/src/codex/app-server-runner.ts` |
| Creator Agent | `apps/daemon/src/creator/agent/codex-adapter.ts`、`apps/daemon/src/creator/agent/agent-service.ts`、`apps/daemon/src/api/routes.creator.ts` |
| Creator 状态与调度 | `apps/daemon/src/creator/service.ts`、`repository.ts`、`stage-runner.ts`、`apps/daemon/src/storage/migrations.ts`、`packages/protocol/src/creator.ts` |
| Creator Tool | `apps/daemon/src/agent-tools/creator-tools.ts`、`mcp-routes.ts`、`internal-routes.ts`、`capability-token.ts` |
| Web 双侧交互 | `VideoTranslationWorkspace.tsx`、`VideoTranslationAgentPanel.tsx`、`CreatorAgentPanel.tsx`、`creator-session-store.tsx`、`creator-sse.ts` |
| Desktop Runtime 打包 | `apps/desktop/src/main/codex-resolver.ts`、`daemon-manager.ts`、`bootstrap-controller.ts`、`electron-builder.yml`、`scripts/package-release.mjs`、`scripts/verify-package.mjs` |
| KrillinAI | `KrillinAI/internal/cli/commands.go`、`internal/router/router.go`、`internal/service/subtitle_service.go`、`internal/pipeline/manifest.go`、`apps/daemon/src/creator/krillin/*` |
| 最新 Codex 协议 | `codex/codex-rs/app-server/README.md`、`codex/codex-rs/app-server-protocol/schema/typescript/v2/*`、稳定标签 `rust-v0.149.0` |
| 直接测试 | `apps/daemon/test/unit/creator-*.test.ts`、`apps/daemon/test/integration/creator-api.test.ts`、`apps/desktop/test/codex-resolver.test.ts`、`creator-runtime-package.test.mjs`、`apps/desktop/e2e/creator-packaged-app.spec.ts`、`apps/web/e2e/web-desktop-parity.spec.ts` |

关键协议核验命令：

```powershell
git -C codex show rust-v0.149.0:codex-rs/app-server/README.md
git -C codex show rust-v0.149.0:codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts
git -C codex show rust-v0.149.0:codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts
git -C codex show rust-v0.149.0:codex-rs/app-server-protocol/schema/typescript/v2/TurnStartParams.ts
```

### 3.3 审核排除项

1. 不审核内容发布、平台上传、审批发布和发布数据分析。
2. 不审核多人实时协作、CRDT、组织权限和云端多租户部署。
3. 不要求本方案阶段实现 Claude Code Adapter，只审核替换边界是否成立。
4. 不把 P3 功能尚未实现视为当前代码缺陷，但审核其方案是否可继续指导开发。
5. 不审核与 Creator、Codex Runtime、安装包和 KrillinAI 无直接关系的旧功能。

## 4. 用户确认记录

| 设计部分 | 已确认决定 | 用户确认原话 |
| --- | --- | --- |
| D-1 总体边界与技术选型 | 内置 Codex CLI；交互式 Agent 统一使用 app-server；Creator Core 是业务状态源；Creator Tool Server 是业务工具层；生产环境禁止 Demo 兜底。 | `没问题，继续` |
| D-2 Codex Runtime 打包、版本和兼容 | 固定 Codex `0.149.0`；使用绝对路径和隔离 `CODEX_HOME`；默认不读取本机 Codex；按 scope 管理常驻 Host；升级可回滚。 | `没问题，继续` |
| D-3 真实 Agent 与 Creator Tool Server | Agent 由 Creator 状态、Activity 和 Codex 对话共同组成；REST 与 Agent Tool 共用 Command Dispatcher；模板、上下文和 Skill 分层；历史持久化恢复。 | `没问题，继续` |
| D-4 迁移、异常、测试与验收 | 按 Runtime、同步、真实视频流程、模板扩展分阶段实施；失败不得伪造成成功；必须完成真实安装包和恢复测试。 | `没问题，继续` |

## 5. 事实基线

### 5.1 Codex

1. 本地 Codex 源码位于 `codex/`，当前检出的提交为 `d8ec270183ffb341fb0211c5ee8335419ea67cc7`。
2. 2026-08-21 可采用的最新稳定版本为 `0.149.0`；`0.150.0-alpha` 和源码 `main` 不进入正式安装包。
3. 稳定标签 `rust-v0.149.0` 对应提交 `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`；协议生成和兼容测试必须基于该标签，而不是当前 `main`。
4. app-server 已提供稳定的 JSON-RPC 主链路，包括：
   - `initialize`
   - `account/read` 与登录流程
   - `model/list`
   - `skills/list`、`skills/extraRoots/set`
   - `thread/start`、`thread/resume`、`thread/read`
   - `turn/start`、`turn/steer`、`turn/interrupt`
   - Thread、Turn、Item、审批和工具调用通知
5. 仓库中普通 Agent 已存在较早的 app-server Host 和持久执行器实现，但 Creator Agent 仍按 Turn 临时启动 app-server，且历史主要保存在内存中。

### 5.2 OpenCreator

1. `apps/daemon/src/creator/agent/codex-adapter.ts` 仍是 Creator Agent 的临时适配实现。
2. `apps/daemon/src/creator/agent/agent-service.ts` 使用进程内 `Map` 保存消息和运行状态，Daemon 重启后无法恢复。
3. `VideoTranslationAgentPanel` 仍包含本地消息、字符串意图识别、固定回答或演示结果路径。
4. Creator Tool 已能调用 CreatorService，但 REST、工具调用和 Stage 调度之间仍存在行为分叉风险。
5. Desktop 当前优先发现本机 Codex，安装包尚未形成固定版本、哈希、Schema 和隔离 Home 的完整合同。

### 5.3 KrillinAI

1. KrillinAI 是媒体能力提供方，OpenCreator 是业务编排与状态所有者。
2. 当前 KrillinAI CLI 能力比既有 HTTP Server 完整；既有 Server 的内存任务、全局配置和恢复能力不足以直接作为正式 OpenCreator 服务合同。
3. 正式目标是补齐并托管一个本地常驻 KrillinAI 服务；在该合同完成前，CLI 只能作为真实阶段执行的迁移适配器，不能返回 Demo 结果。

## 6. 目标与非目标

### 6.1 目标

1. Agent 可以连续对话、调用 Creator Tool、接收流式事件、处理中断和审批，并在重启后恢复。
2. 工作台和 Agent 是同一个 Creator Job 的两个入口，双方读取同一状态源，而不是互相复制两套状态。
3. 工作台操作会立即在 Agent 区域形成状态变化或 Activity，但不会因此自动消耗一次 Codex Turn。
4. Agent 通过 Creator Tool 修改 Job 后，工作台通过同一 Creator 事件通道立即更新。
5. 视频下载、字幕、翻译、TTS 和渲染返回真实任务、进度、错误和 Artifact。
6. Codex、Creator Tool Server、KrillinAI 和 AI Provider 的边界清晰，可独立升级和诊断。

### 6.2 非目标

1. 不建设另一套通用 Agent Harness；Codex app-server 已经承担 Agent loop。
2. 不让 Codex Thread、Skill、聊天消息或 KrillinAI Task 成为 Creator Job 的业务状态源。
3. 不在 P0 引入消息队列、事件溯源、CRDT、微服务集群或多用户协同协议。
4. 不默认复用用户全局 Codex 配置、MCP、Skills、凭据或本机未知版本二进制。
5. 不把 Codex 登录凭据转换成 KrillinAI 所需的 OpenAI-compatible API Key。
6. 不保留生产 Demo Agent、规则 Agent、固定回复或假 Artifact 作为“容错”。

## 7. 核心原则

1. **一个业务状态源**：Creator Core 是 Job、revision、Stage、Artifact 和 Activity 的唯一权威。
2. **一个交互式 Agent 主链路**：所有 OpenCreator 交互式 Agent 使用 app-server；`codex exec` 只保留给独立、非交互、无需恢复的后台任务或兼容工具。
3. **一个业务命令入口**：工作台 REST Action 和 Agent Tool Action 最终都进入 Creator Command Dispatcher。
4. **状态共享，不做双向复制**：工作台和 Agent 订阅同一个 Snapshot 与事件流，不设计两边互相通知和合并。
5. **模板高于 Runtime**：模板属于 OpenCreator；Skill 只描述某个 Runtime 可复用的操作知识。
6. **真实失败优于假成功**：Runtime、Provider 或媒体服务不可用时明确失败，不降级为 Demo 数据。
7. **版本固定、协议生成、升级可退**：安装包绑定 Codex 版本、二进制哈希和生成 Schema。

## 8. 全局架构

下面的图只表达“谁拥有状态、谁负责执行”，箭头不代表复制数据：

```text
┌──────────────────────────── OpenCreator UI ────────────────────────────┐
│                                                                        │
│  左侧工作台                       右侧 Agent                           │
│  编辑参数、字幕、产物              状态摘要 + Activity + Codex 对话    │
│          │                                  │                          │
│          └────────── 共同订阅 Creator Snapshot / Events ──────────────┘
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP + SSE
┌──────────────────────── OpenCreator Daemon ────────────────────────────┐
│                                    │                                   │
│  Creator API ───────┐              │              ┌─ Agent API         │
│                     ▼              ▼              ▼                    │
│              Creator Command Dispatcher                               │
│                     │                                                  │
│                     ▼                                                  │
│  Creator Core：Job / revision / Stage / Artifact / Activity / Template│
│          │                         │                                   │
│          │                         └──── Stage Runner ─── Krillin Host  │
│          │                                                │            │
│          │                                                ▼            │
│          │                                      KrillinAI 常驻服务      │
│          │                                                             │
│          └──── Agent Context Projection                                │
│                         │                                              │
│                         ▼                                              │
│                 Codex Runtime Adapter                                  │
│                         │ JSON-RPC                                     │
│                         ▼                                              │
│              内置 codex app-server Host                               │
│                         │ MCP / Tool Call                              │
│                         ▼                                              │
│                 Creator Tool Server                                    │
│                         │                                              │
│                         └──── 回到 Creator Command Dispatcher           │
└────────────────────────────────────────────────────────────────────────┘
```

这个结构中没有“工作台状态”和“Agent 状态”两套业务数据。右侧 Agent 只是把三类数据组合展示：

1. Creator Job 当前快照。
2. Creator Activity 时间线。
3. Codex Thread/Turn/Item 对话记录。

## 9. 模块职责

| 模块 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| Desktop Bootstrap | 定位应用资源、启动 Daemon、展示启动诊断 | 不实现 Creator 业务 |
| Codex Runtime Manager | 校验、启动、复用、回收和升级内置 Codex Host | 不保存 Creator Job |
| Codex AppServer Host | 维护一个 app-server 子进程和 JSON-RPC 连接 | 不解释模板或直接调用 KrillinAI |
| Codex Runtime Adapter | 将 OpenCreator AgentContract 映射到 app-server 方法和事件 | 不持有业务状态 |
| Agent Service | 管理 Creator Job 与 Codex Thread 的映射、Turn 和展示历史 | 不伪造回答 |
| Creator Core | 持有模板、Job、revision、Stage、Artifact、Activity | 不执行 Codex Agent loop |
| Creator Command Dispatcher | 统一校验并提交 Creator Action | 不区分调用来自 UI 还是 Agent |
| Creator Tool Server | 向 Runtime 暴露稳定的业务工具 | 不等同于 Codex Runtime 封装层 |
| Stage Runner | 将 Creator Stage 映射到媒体执行器并登记结果 | 不允许 Agent 绕过 Creator Core |
| Krillin Runtime Host | 托管 KrillinAI 服务进程、健康检查和重启 | 不决定模板流程 |
| Provider Config Store | 保存文本、ASR、TTS、图片、视频和代理配置 | 不把密钥写入 Agent 上下文 |

## 10. Codex Runtime 设计

### 10.1 打包目录

建议安装包结构：

```text
resources/
  runtime/
    codex/
      manifest.json
      schema/
        app-server.schema.json
        app-server.types.ts
      win32-x64/codex.exe
      darwin-arm64/codex
      linux-x64/codex
    opencreator-skills/
      opencreator-runtime/SKILL.md
```

`manifest.json` 至少包含：

```ts
type BundledCodexManifest = {
  version: '0.149.0';
  protocolSchemaVersion: string;
  platform: string;
  arch: string;
  sha256: string;
  sourceCommit: string;
  builtAt: string;
};
```

正式构建只打包当前平台对应二进制，不在用户机器上执行全局安装。

### 10.2 隔离规则

1. 通过安装包绝对路径启动，例如 `<resources>/runtime/codex/win32-x64/codex.exe app-server`。
2. 设置独立 `CODEX_HOME=<OpenCreatorUserData>/runtime/codex/home`。
3. 不修改 PATH，不调用 `npm install -g`，不覆盖用户全局 Codex。
4. 默认不复制 `~/.codex/config.toml`、凭据、MCP 或 Skills。
5. 本机 Codex 继续由用户在终端独立使用，两者进程、Home 和升级互不影响。
6. 内置 Runtime 失败时不搜索 PATH 兜底。
7. 外部 Codex 只能在高级设置中显式启用，并在启用前完成版本和协议检查。

### 10.3 启动检查

Runtime Manager 按顺序执行：

1. 校验 manifest、平台、架构和二进制 SHA-256。
2. 读取 `codex --version`，必须与兼容矩阵匹配。
3. 启动 `codex app-server` 并完成 `initialize`。
4. 调用 `model/list`、`skills/list`、`account/read`。
5. 调用 `skills/extraRoots/set` 加载应用内置 Skill 根目录。
6. 将结果写入 Runtime Readiness，不把未登录误报成二进制损坏。

### 10.4 Host 范围与生命周期

Runtime Manager 维护两种 scope：

```text
project:<projectId>             普通项目 Agent
creator-job:<creatorJobId>      创作工作台 Agent
```

规则如下：

1. 同一 scope 复用一个 Host，避免每次 Turn 重启 app-server。
2. Host 可以恢复多个 Thread，但同一 Host 同时只允许一个活动 Turn；Runtime Manager 对同 scope 的 Turn 串行排队。Creator Job 默认映射一个主 Thread。
3. Host 启动时通过现有 Capability Token Store 的 `issueProcess` 创建一个固定 Process Capability Lease，并把进程 Token 注入 Creator MCP Server 环境。Token 不随 Turn 替换。
4. 每个 Turn 调用 `turn/start` 前，使用 `activate` 将该 Lease 临时绑定到 `runId`、`threadId`、`creatorJobId` 和最小 scopes；Turn 进入任一终态后立即 `deactivate`。
5. 未激活、已停用、过期、Job 不匹配或 scope 超出的 Creator Tool 请求必须被拒绝。Host 关闭或 Daemon 重启时 `revoke` 旧 Lease，并为新进程生成新 Token。
6. Turn 运行期间 Host 不得被空闲回收。
7. 空闲 Host 超过阈值后优雅关闭；上限到达时只回收最久未使用且没有活动 Turn 的 Host。
8. Host 崩溃后自动重启一次，并对已持久化的 Codex Thread 执行恢复对账；未确认完成的 Turn 不自动重新提交。
9. MCP URL、命令、工具集合或启动配置发生变化时必须重启 Host。`config/mcpServer/reload` 只用于实际写入隔离 `config.toml` 的配置变化，不用于刷新启动参数或进程环境。

### 10.5 版本和 Schema

1. 每个 OpenCreator 版本只声明一个默认 Codex 版本和一组经过测试的兼容版本。
2. TypeScript 协议类型从固定 Codex 源码生成并提交，不手写宽泛 `any` 协议。
3. app-server 未知通知可以记录并忽略；已使用字段缺失、类型不兼容或关键方法缺失必须使 Readiness 失败。
4. Codex 升级随 OpenCreator 发布，先写入新版本目录，校验成功后原子切换 active manifest。
5. 保留上一个已验证版本；新版本启动检查失败时回滚并记录诊断。

## 11. 真实 Agent 设计

### 11.1 Runtime Adapter

OpenCreator 内部只依赖以下接口：

```ts
interface AgentRuntimeAdapter {
  startOrResumeThread(input: StartThreadInput): Promise<RuntimeThread>;
  startTurn(input: StartTurnInput): Promise<RuntimeTurn>;
  steerTurn(input: SteerTurnInput): Promise<void>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;
  subscribeEvents(scopeId: string, listener: AgentEventListener): Unsubscribe;
  readHistory(threadId: string): Promise<RuntimeHistory>;
  closeScope(scopeId: string): Promise<void>;
}
```

CodexAdapter 分别映射到 `thread/start|resume|read`、`turn/start|steer|interrupt` 和 app-server 通知。未来 Claude Code Adapter 可以实现同一个接口，无需修改 Creator Core、模板和工作台。

### 11.2 持久化模型

新增或补齐：

```text
creator_agent_sessions
  id, creator_job_id, runtime, runtime_thread_id,
  host_scope, process_generation, status, last_turn_id,
  created_at, updated_at

creator_agent_turns
  id, session_id, runtime_turn_id, client_message_id,
  status, input_summary, error_code, started_at, finished_at

creator_agent_items
  id, turn_id, runtime_item_id, seq, kind,
  payload_json, created_at, completed_at

creator_agent_events
  id, session_id, turn_id, seq, type,
  payload_json, created_at

creator_agent_approvals
  id, session_id, turn_id, runtime_request_id,
  process_generation, status, payload_json,
  created_at, resolved_at

creator_command_receipts
  id, job_id, idempotency_key, request_hash,
  status, receipt_json, error_json, stage_run_id,
  created_at, completed_at
```

Creator Agent 的 `Map` 只能作为活动连接缓存，不能再承担历史真相源。

约束：

1. `creator_agent_items` 对 `(turn_id, runtime_item_id)` 建唯一约束；事件使用可重放序号或稳定事件键去重。
2. `creator_command_receipts` 对 `(job_id, idempotency_key)` 建唯一约束。
3. approval 保存 app-server 请求 ID 和 `process_generation`；请求只能回写给仍存活且 generation 相同的 Host。

### 11.3 消息执行流程

```text
1. 用户在右侧 Agent 输入消息。
2. Web 先 flush 当前工作台草稿，确保 Creator revision 已提交。
3. Agent Service 读取最新 Job 并生成 Context Projection。
4. Adapter 通过 `thread/start` 或 `thread/resume` 启动/恢复 Creator Job 对应 Codex Thread，并在该 Thread 设置强制 `developerInstructions`。
5. Adapter 调用 `turn/start`，只在用户输入中传入本轮消息和动态 Creator Context Projection；`TurnStartParams` 不承载 `developerInstructions`。
6. app-server 流式返回 Turn、Item、工具、审批和文本事件。
7. Agent Event Normalizer 持久化事件，并通过现有 Creator SSE 通道推送给 Web。
8. Creator Tool Call 进入 Creator Command Dispatcher；成功后产生新 revision 和 Activity。
9. 工作台与 Agent 同时收到新的 Creator Snapshot/Events。
10. turn/completed 后保存最终状态；失败或取消同样保存终态和结构化错误。
```

### 11.4 事件归一化

UI 不直接依赖 Codex 原始 JSON-RPC。Daemon 将其转换为稳定事件：

```ts
type OpenCreatorAgentEvent =
  | { type: 'turn.started'; turnId: string }
  | { type: 'message.delta'; itemId: string; text: string }
  | { type: 'message.completed'; itemId: string; text: string }
  | { type: 'tool.started'; itemId: string; name: string; input: unknown }
  | { type: 'tool.completed'; itemId: string; output: unknown; isError: boolean }
  | { type: 'approval.required'; requestId: string; action: unknown }
  | { type: 'usage.updated'; usage: unknown }
  | { type: 'turn.completed'; turnId: string }
  | { type: 'turn.failed'; turnId: string; code: string; message: string }
  | { type: 'turn.canceled'; turnId: string };
```

原始事件可以作为脱敏诊断记录保留，但不得成为 Web 协议。

### 11.5 重启对账与审批恢复

页面刷新和进程崩溃采用不同语义：

1. **仅页面刷新**：Daemon 和 app-server 仍存活。Web 从 SQLite/SSE replay 恢复对话，并从审批 API 读取当前 generation 的 pending approval；用户仍可对原 JSON-RPC 请求作答。
2. **Daemon 或 app-server 重启**：旧 JSON-RPC 连接和 approval request ID 已失效。所有旧 generation 的 pending approval 标记为 `expired`，禁止向旧 request ID 回写。
3. 新 Host 启动后先调用 `thread/read({ includeTurns: true })`，用稳定 Thread/Turn/Item ID 与本地数据库对账并幂等补齐已完成事件，再调用 `thread/resume` 恢复后续对话。
4. 若远端历史表明 Turn 已完成或失败，本地补齐对应终态；若本地仍为 `running` 或 `waiting_approval` 且无法从存活 Host 证明仍在运行，则转为 `interrupted`。
5. 只有同一存活 Host 明确报告活动 Turn 时才重新订阅该 Turn；进程死亡后不尝试恢复旧审批或自动重放旧 Turn。
6. 用户可以基于已恢复 Thread 发起一个新 Turn 继续，但该动作必须是显式提交，并使用新的 `clientUserMessageId` 和命令幂等键。

专项验收必须覆盖：页面刷新后继续审批、Daemon 重启、app-server 在审批中崩溃、重复 Item/Event 回放，以及不存在永久 `waiting_approval` 或 `running`。

### 11.6 快捷动作

右侧快捷入口必须区分两类：

1. **确定性 Creator Action**：例如“重新生成字幕”“切换竖屏”“撤销上次字幕修改”。直接执行 Dispatcher，可在 Activity 中显示“由用户从 Agent 面板触发”，但不伪装成 Codex 回答。
2. **真实 Agent Turn**：例如“把字幕改得更口语化”“根据当前视频给三种封面方向”。必须启动真实 Turn，并展示真实工具调用和结果。

## 12. 工作台与 Agent 的共享状态

### 12.1 同步模型

不采用“左侧通知右侧、右侧再通知左侧”的双向消息复制。两侧共享以下服务端数据：

```text
Creator Snapshot = Job + revision + current Stage + Artifact 摘要
Creator Activity = 已提交的语义操作记录
Agent Conversation = Codex Thread/Turn/Item
```

前端 CreatorSessionStore 是这些数据在当前页面的缓存和草稿层，Creator Core 才是持久权威。

### 12.2 工作台操作规则

| 操作 | Creator 状态 | Agent 区域表现 | 是否启动 Codex |
| --- | --- | --- | --- |
| 输入字幕文字 | 实时更新本地草稿，短 debounce 提交 | 状态摘要更新；聚合后产生一次 Activity | 否 |
| 修改语言、比例或音色 | 提交 Action 和新 revision | 显示一条结构化 Activity | 否 |
| 启动翻译或渲染 | 创建 StageRun | 显示任务开始与进度 | 否 |
| 选择 Artifact | 更新当前关注项 | Agent Context 的当前选择变化 | 否 |
| 向 Agent 提问 | flush 草稿并启动 Turn | 显示真实 Codex 对话 | 是 |

Activity 必须按 `actionId` 去重。类似“左侧工作台设置已同步”的重复提示属于同一操作被多次消费，最终实现必须通过服务端事件 ID 和前端已应用序号消除。

### 12.3 revision 冲突

所有修改携带 `expectedRevision`：

1. revision 匹配：原子提交并返回新 revision。
2. 首次冲突：Agent 重新读取 Creator Context，并最多重试一次。
3. 第二次冲突：停止自动写入，Turn 进入 `needs_user_resolution`，展示冲突字段和最新值。
4. UI 冲突：保留用户草稿，提示刷新后的差异，不直接覆盖。

## 13. Creator Tool Server

### 13.1 定位

Creator Tool Server 是 OpenCreator Daemon 内的业务工具入口。它可以通过 MCP 暴露给 Codex，也可以通过未来 Runtime 的原生 Tool API 暴露；因此模块名、日志和文档不再使用容易误解的“OpenCreator MCP 层”。

关系如下：

```text
Codex Runtime Adapter ─ MCP ─┐
Claude Runtime Adapter ─ Tool API ─┼─ Creator Tool Server ─ Dispatcher
内部自动化任务 ─ Native Call ─────┘
```

Codex `0.149.0` 的 P0 稳定接入沿用现有 Host 的做法：Runtime Manager 在启动隔离 app-server 时通过 Codex 配置覆盖注入唯一的 Creator MCP Server，Creator Tool Server 使用 Daemon 本地受保护路由。不使用仍标记为 experimental 的 `dynamicTools` 作为正式主链路，也不修改用户全局 `config.toml`。

认证采用 Process Capability Lease：Host 环境中只有固定进程 Token，真正的 Job、Thread、Turn 和 scopes 在每个 Turn 开始前由 Daemon 激活，结束后停用。MCP 启动配置改变时重启 Host；`config/mcpServer/reload` 不能用于替换命令行覆盖或环境变量。

### 13.2 P0 工具

```ts
creator_get_context({ jobId, projection?, sinceRevision? })
creator_get_artifact({ jobId, artifactId, format?, range? })
creator_apply_action({ jobId, expectedRevision, action, idempotencyKey })
```

设计约束：

1. `creator_get_context` 默认返回摘要，不返回完整字幕、媒体二进制和全部历史。
2. `creator_get_artifact` 按需读取大内容，并限制路径只能位于当前 Creator Job 授权目录。
3. `creator_apply_action` 只接受 TemplateDefinition 声明的 Action Schema。
4. Tool Server 不提供 `run_shell`、任意文件路径或直接 KrillinAI 调用。
5. 每次调用绑定 `creatorJobId`、Thread、Turn 和 capability token。
6. 写操作要求 `expectedRevision` 和 `idempotencyKey`。

### 13.3 Command Dispatcher

REST 与 Tool 必须共用：

```ts
dispatchCreatorCommand({
  jobId,
  actor,
  expectedRevision,
  idempotencyKey,
  action,
}): Promise<CreatorActionReceipt>
```

Dispatcher 统一完成：

1. Action Schema 和权限校验。
2. revision 与幂等检查。
3. Job 状态修改。
4. 下游 Artifact stale 传播。
5. Activity 写入。
6. StageRun 创建与真实调度。
7. Creator Snapshot/Event 发布。

现有 `run-stage` 只修改状态而未可靠启动 Stage 的分叉必须消失；状态变更和调度意图在同一个数据库事务中提交，再由可恢复的 Stage 调度器领取执行。

幂等语义固定如下：

1. Dispatcher 开启数据库事务后先按 `(job_id, idempotency_key)` 查询 `creator_command_receipts`。
2. 同键、同 `request_hash` 且已完成：直接重放原 `receipt_json` 或原结构化错误，不再次修改 revision、创建 Activity 或 StageRun。
3. 同键、不同 `request_hash`：拒绝并返回 `creator_idempotency_key_reused`。
4. 新命令通过校验后，在同一事务内提交 revision、Activity、StageRun/调度意图和 committed receipt；响应丢失不影响后续重放。
5. revision 冲突等确定性拒绝可以保存 rejected receipt；Agent 重新读取后使用新的 idempotencyKey 提交新尝试。
6. 事务提交前的进程或数据库失败不留下可见 receipt，调用方可以用原键重试。

测试必须覆盖并发相同请求、同键不同载荷、响应丢失后重试和 Daemon 重启后重试，并证明只产生一次 Activity、StageRun 和 Artifact 执行链。

## 14. 模板、上下文与 Skills

### 14.1 三者关系

```text
TemplateDefinition：OpenCreator 业务生产合同
  决定阶段、输入、Action、依赖、产物和 UI Schema

Agent Context Projection：某一时刻从 Creator Job 派生的动态事实
  告诉 Agent 当前任务、revision、选择、最近变化和允许动作

Runtime Skill：面向某个 Agent Runtime 的稳定操作知识
  告诉模型如何理解 OpenCreator 工具、错误和操作习惯
```

模板不是 Skill，模板也不需要每次完整塞给 Codex。

### 14.2 每次 Turn 传什么

每次 Turn 只传：

1. Job ID、template ID/version 和当前 revision。
2. 当前阶段、选择项和用户正在看的 Artifact。
3. 最近有限条 Activity。
4. 当前可执行 Action 的名称和简要约束。
5. 与当前问题直接相关的小型数据摘要。
6. 必要时提示 Agent 使用 `creator_get_context` 或 `creator_get_artifact` 获取更多内容。

完整字幕、全部模板 Schema、所有历史版本和媒体数据不进入基础 Prompt。

### 14.3 强制规则放在哪里

以下内容在 `thread/start` 或 `thread/resume` 时通过 app-server `developerInstructions` 注入，而不是依赖 Skill 是否被模型触发：

1. 修改 Creator Job 必须使用 Creator Tool。
2. 不得通过文件编辑绕过 revision。
3. 工具失败不得宣称任务成功。
4. revision 冲突处理规则。
5. 当前 Job 和允许访问的目录范围。

### 14.4 Skill 的安装与加载时机

用户不参与 Skill 安装：

1. OpenCreator 构建时将稳定 Skills 打入安装包资源目录。
2. Daemon 首次初始化内置 Runtime 时校验 manifest 和 Skill 版本。
3. 每个 app-server Host 启动后调用 `skills/extraRoots/set`，以只读额外根目录加载这些 Skills。
4. OpenCreator 升级时随安装包原子更新；不复制到用户全局 `CODEX_HOME/skills`。
5. `skills/list` 启动检查确认 Skill 可见；不可见时给出 Runtime 诊断，但模板和业务状态仍不迁移进 Skill。

因此，Skill 不是“每轮把全部内容作为 Prompt 发送”，也不是要求用户手动安装到自己的 Codex。它是 OpenCreator 内置 Runtime 的版本化资源，并由 app-server 原生发现。

### 14.5 替换 Claude Code

替换 Runtime 时：

1. Creator Core、TemplateDefinition、Context Projection 和 Creator Tool Contract 保持不变。
2. 新增 ClaudeRuntimeAdapter，将 Thread、Turn、事件、审批和工具映射到同一 AgentRuntimeAdapter。
3. 将 `opencreator-runtime` 的稳定知识转换为 Claude 可加载的项目指令或 Skill 形式。
4. 强制规则仍由 Adapter 作为 developer/system 指令注入，不能只依赖可选 Skill。

## 15. KrillinAI 与多模态 Provider

### 15.1 正式运行方式

正式目标是常驻服务，而不是每个动作都让 Agent 调 CLI：

```text
Creator Stage Runner
        │ local RPC
        ▼
Krillin Runtime Host
        │ 启动、健康、重启、日志
        ▼
KrillinAI OpenCreator Service
        ├─ download / probe
        ├─ subtitle / ASR / translation
        ├─ TTS
        ├─ horizontal / vertical render
        └─ task status / cancel / result
```

需要在 KrillinAI 补齐的最小服务合同：

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/tasks
GET  /v1/tasks/:id
POST /v1/tasks/:id/cancel
GET  /v1/tasks/:id/events
```

任务请求只携带 `jobId`、`stageId`、阶段类型、Artifact ID、非敏感参数和幂等键；不得接受客户端提供的任意绝对工作目录。服务根据 Host 授予的 Creator Jobs 根目录自行解析真实路径。服务返回结构化 task ID、状态、事件和 Manifest；任务状态至少持久化到对应 Job 目录，不能只在内存中保存。

### 15.2 本地服务安全边界

1. Krillin Runtime Host 让操作系统分配随机 loopback 端口，仅绑定 `127.0.0.1`；命名管道或 Unix Domain Socket 可作为后续平台优化，但 P0 不同时维护两套协议。
2. 每次服务进程启动生成至少 256 bit 的随机进程 Token，通过受控环境变量传入，不放在 argv、URL、日志或配置文件中。
3. 所有 `/v1/*` 请求都必须携带 Bearer Token；无 Token、错误 Token 或旧进程 Token统一拒绝。`/v1/health` 也不匿名暴露内部配置。
4. Host 只授予 `<OpenCreatorUserData>/creator/jobs` 作为数据根。服务通过 `jobId` 和 Artifact ID 解析路径，对 canonical path、父目录和符号链接逐级校验，禁止跨 Job 和根目录逃逸。
5. OpenCreator service mode 不挂载旧 `/api/config`、`/api/file`、静态 UI 和任意路径下载接口。
6. Provider 凭据由 Host 从 Keyring 读取后，经认证本地请求作为任务期内存配置传入；服务不持久化、不回显，并在任务结束或进程退出时释放。
7. 请求、事件、Manifest 和日志执行统一脱敏；API Key、Authorization、代理凭据和完整 Provider 配置不得进入任务目录、诊断包或崩溃日志。
8. 服务重启时轮换 Token；旧任务恢复只依赖持久 task metadata 和幂等键，不依赖旧 Token。

集成测试必须覆盖无 Token、错误/旧 Token、任意路径输入、`..` 逃逸、符号链接逃逸、跨 Job 访问、旧路由不可用、日志泄漏和崩溃后凭据清理。

### 15.3 为什么采用常驻服务

1. 避免每次执行重新发现依赖、初始化本地 ASR 和建立重复的管理通道。
2. 统一取消、进度、日志、并发和恢复语义。
3. Stage Runner 不需要解析不同 CLI 命令的 stdout 文案。
4. OpenCreator 可以明确展示服务 readiness 和能力矩阵。

迁移期允许 Krillin Service 内部调用现有 CLI command handler 复用能力，但 OpenCreator 只依赖服务合同。若某阶段尚未进入服务，Stage Runner 可以使用显式的真实 CLI Adapter；该 Adapter 必须返回真实结果和错误，并在服务版本完成后删除，不能成为长期双主链路。

### 15.4 配置所有权

OpenCreator 统一保存以下逻辑能力配置：

```text
agent_runtime       Codex 登录、模型和推理设置
text_generation     字幕翻译、摘要、改写所用 Provider
asr                 云端转录或本地 Whisper
tts                 配音 Provider
image_generation    封面与图片 Provider
video_generation    后续生视频 Provider
proxy               下载和外部服务代理
```

规则：

1. Codex 登录只服务交互式 Agent，不自动变成 KrillinAI 的 OpenAI API Key。
2. 小规模交互式文本修改可以由 Codex Agent 完成；批量字幕翻译作为可重试 Stage 时使用 `text_generation` Provider。
3. 转录按配置能力选择：配置云端 ASR 时使用云端；未配置且本地 Whisper 可用时使用本地；两者都不可用才报缺少转录能力。
4. Provider Config Store 使用系统 Keyring；传给 KrillinAI 时使用进程内请求或临时受限配置，不写入 Creator Job、Agent Prompt 和普通日志。
5. 启动 Stage 前执行 capability preflight，并明确指出缺失的是 ASR、翻译、TTS、下载还是渲染能力。

## 16. 失败和恢复

| 场景 | 处理 |
| --- | --- |
| Codex 文件缺失或哈希错误 | Runtime Readiness 失败，禁止 Agent 启动，提示修复安装 |
| app-server 初始化失败 | 自动重启一次；仍失败则记录 `CODEX_APP_SERVER_UNAVAILABLE` |
| app-server 在 Turn 中崩溃 | 恢复 Thread；未确认 Turn 不自动重放 |
| 用户取消 Turn | 调用 `turn/interrupt`，持久化 canceled 终态 |
| 页面刷新且原 Host 存活 | Turn 保持 waiting_approval，UI 可继续响应当前 generation 的审批 |
| Daemon/app-server 在审批中崩溃 | 旧审批标记 expired，无法确认的 Turn 标记 interrupted，不回写旧 request ID |
| Creator revision 首次冲突 | 重新读取后最多重试一次 |
| Creator revision 再次冲突 | 进入 `needs_user_resolution` |
| Creator Tool 失败 | Tool Item 保存结构化错误，Agent 不得宣称成功 |
| KrillinAI 服务崩溃 | Host 重启；执行中 Stage 标记 interrupted，按幂等键恢复或由用户重试 |
| Provider 配置缺失 | Stage 启动前失败，指出具体能力，不生成假任务 |
| 网络或模型失败 | 保存 retryable 与 provider error，保留已有 Artifact |
| 上游内容变化 | 保留旧 Artifact，并将受影响下游标记 stale |

终态必须明确：`completed`、`failed`、`canceled`、`interrupted` 或 `needs_user_resolution`，不得永久停留在无解释的 `running`。

## 17. 数据与历史迁移

1. 为 Agent Session、Turn、Item 和 Event 增加带版本号的 SQLite migration。
2. 旧 Demo 会话标记为 `legacy_demo`，不写入 Codex Thread，也不显示成真实模型回答。
3. 现有 Creator Job 可迁移输入、配置和可验证 Artifact；无法证明来源的演示 Artifact 标记为 demo，不能成为正式 Stage 依赖。
4. 升级前创建数据库备份；失败时回滚 Schema 和 active runtime manifest。
5. 首次启动新版本时执行 Codex、Creator Tool 和 KrillinAI readiness 检查，但登录缺失只影响 Agent，不应破坏已有 Creator 数据浏览。

## 18. 分阶段实施

### P0：Codex Runtime 基础闭环

1. 打包 Codex `0.149.0`、manifest、哈希和生成 Schema。
2. 实现隔离 `CODEX_HOME`、Runtime Readiness、应用内登录和模型列表。
3. 将普通 Agent 与 Creator Agent 都接入共享的常驻 app-server Host 管理。
4. 持久化 Thread、Turn、Item 和归一化事件。
5. 删除生产规则回答、固定回复和 mock 结果。

验收：连续真实对话、流式输出、中断、刷新恢复和 Daemon 重启恢复全部可用。

### P1：Creator Agent 与共享状态

1. 完成 Creator Command Dispatcher。
2. 工作台 REST 与 Agent Tool 使用同一 Action 合同。
3. Agent 面板统一展示 Creator Snapshot、Activity 和真实 Codex 对话。
4. 完成 Activity 去重、revision 冲突和 Artifact stale。
5. 删除 `VideoTranslationAgentPanel` 的本地历史与字符串意图识别。

验收：从任一侧修改任务，另一侧实时看到同一结果；工作台操作不自动启动 Codex。

### P2：Creator Tool Server 与真实视频流程

1. 上线三个 P0 Creator Tool。
2. 补齐 KrillinAI 常驻服务合同与 Runtime Host。
3. 打通真实下载、字幕、转录、翻译、TTS、横屏和竖屏渲染。
4. 完成统一 Provider 配置桥接和 capability preflight。
5. 修复 `run-stage` 状态与调度分叉。

验收：输入真实 YouTube/Bilibili/本地素材，产生可验证的真实任务、字幕、媒体和 Artifact。

### P3：模板与多模态扩展

1. 完成 Template Context Projection 和 Action Schema 自动暴露。
2. 增加封面、生图和后续生视频 Provider。
3. 增加模板版本迁移、能力声明和兼容检查。
4. 实现外部 Codex 高级模式及兼容矩阵。
5. 为 Claude Code 等 Runtime 验证 Adapter 可替换性。

验收：新增模板无需修改 Agent 基础协议；更换 Runtime 不修改 Creator Core。

## 19. 测试策略

### 19.1 协议与单元测试

1. Codex `0.149.0` Schema 生成快照与关键方法解析。
2. Runtime manifest、哈希、版本、平台和回滚。
3. Host 复用、空闲回收、活动 Turn 保护和崩溃恢复。
4. Event Normalizer 对 Thread、Turn、Item、审批、工具和未知通知的映射。
5. Dispatcher 的 revision、幂等、Activity、stale 和调度事务。
6. Context Projection 不泄露密钥、不携带不必要大数据。
7. Process Capability Lease 的 activate/deactivate/revoke、Job/Thread/Turn 绑定和非活动请求拒绝。
8. Command Receipt 的同键同载荷重放、同键不同载荷拒绝和唯一约束。

### 19.2 集成测试

1. 真实 `codex app-server` initialize、account、model、skill、Thread 和 Turn。
2. Creator Tool Server 经 MCP 调用 Dispatcher，并验证同一 Host 连续两个 Turn 分别激活正确的 Job/Run/scopes，旧绑定和非活动请求均被拒绝。
3. SQLite 重启恢复 Agent 历史和 Creator Job 映射，并覆盖 `thread/read(includeTurns:true)` 对账、重复事件回放和旧 generation 审批失效。
4. 并发重复命令、响应丢失和 Daemon 重启后重试只创建一次 Activity、StageRun 和执行链。
5. KrillinAI health、task、events、cancel、重启和结果校验。
6. KrillinAI 本地服务覆盖无 Token、错误/旧 Token、路径与符号链接逃逸、跨 Job 访问、旧路由不可用、日志脱敏和崩溃清理。
7. 云端 ASR、本地 Whisper 和无转录能力三种路径。

测试夹具可以使用 fake app-server 或 fake provider 验证异常，但生产构建不得引用这些入口。

### 19.3 端到端与安装包测试

1. 无本机 Codex时，内置 Runtime 正常工作。
2. 本机已有其他 Codex 版本时，两者 Home、PATH、配置和进程互不影响。
3. 未登录、登录、退出和令牌过期状态正确。
4. 视频翻译从链接输入到真实 Artifact 完成。
5. 工作台修改后 Agent Activity 只出现一次。
6. Agent 修改字幕后工作台立即更新。
7. 页面刷新、Daemon 重启、app-server 崩溃和 KrillinAI 重启后状态可解释并可恢复。
8. Web 与 Desktop 使用同一 Web 构建和 Daemon API，完成相同内容视口截图与行为对比。
9. 安装包校验内置 Codex、KrillinAI、yt-dlp nightly、FFmpeg、Schema 和 manifest。
10. 页面刷新时可继续存活审批；Daemon/app-server 在审批中崩溃时旧审批失效且 Turn 进入 interrupted，不存在永久 waiting_approval/running。

## 20. 发布门禁与最终验收

以下条件必须全部满足，才能声明真实 Agent 改造完成：

1. Agent 的回答来自真实 Codex Turn，不存在生产 mock 或规则兜底。
2. Creator Agent 不再为每个 Turn 临时启动一个 app-server。
3. 工作台和 Agent 共享同一 Creator Job、revision、Activity 和 Artifact。
4. 工作台操作会立即在 Agent 区域形成一条可理解且不重复的状态体现。
5. Agent 执行 Creator Action 后，工作台立即展示真实变化。
6. 刷新和重启后能够恢复 Creator 状态和 Codex 对话。
7. 视频翻译产生真实 KrillinAI Task 和文件，失败时保留真实错误。
8. 转录正确执行云端 ASR、本地 Whisper 或明确失败的能力选择逻辑。
9. 内置 Codex 不修改或依赖用户本机 Codex 环境。
10. Codex、Creator Tool Server 和 KrillinAI 均有明确 readiness 与诊断。
11. Web 与 Desktop 通过同源构建、行为测试和实际安装包测试。
12. 任一 Runtime、Tool 或 Provider 失败都不会显示 Demo 成功结果。
13. 同一常驻 Host 的工具权限严格绑定当前活动 Turn，旧 Turn 和非活动请求无法访问 Creator Tool。
14. 相同幂等命令在并发、丢响应和重启重试后只执行一次。
15. KrillinAI 服务仅接受认证的 loopback 请求，不能访问授权 Creator Jobs 根以外的路径或泄露 Provider 凭据。

## 21. 关键风险

| 风险 | 影响 | 控制措施 |
| --- | --- | --- |
| Codex app-server 协议仍快速演进 | 升级可能破坏类型或事件解析 | 固定版本、生成 Schema、兼容矩阵、未知事件容忍、回滚 |
| Tool 重放导致重复 Stage | 重复计费或覆盖 Artifact | idempotencyKey、调度事务、Turn 不自动重放 |
| Context Projection 过少或过多 | Agent 判断不足或 Token 浪费 | 默认摘要、按需工具读取、上下文体积测试 |
| KrillinAI 常驻服务改造范围扩大 | P2 工期增加 | 复用现有 command handler；先建立最小 task 合同 |
| 双侧同步出现重复 Activity | 用户误以为执行了两次 | 服务端 actionId/seq、前端幂等消费、专项 E2E |
| Provider 配置与 Codex 登录混淆 | 已配置仍提示缺失，或错误复用凭据 | 分能力 readiness、独立配置域、执行前能力解释 |

## 22. 已排除方案

1. 继续只使用 `codex exec --json` 承担交互式 Agent。
2. 直接采用当前 TypeScript SDK 作为主集成层；它目前主要封装 exec，不能替代 app-server 完整控制面。
3. 每个 Creator Turn 启动和销毁一次 app-server。
4. 默认发现并使用 PATH 中任意 Codex。
5. 把完整模板和全部 Job 内容每轮塞入 Prompt。
6. 为每个模板生成一份 Skill，并让 Skill 保存业务流程状态。
7. Agent 直接调用 KrillinAI CLI 或 HTTP 接口。
8. 工作台和 Agent 各维护一份状态，再通过相互通知合并。
9. Runtime 失败后回退到规则回答或 Demo Artifact。

## 23. Reviewer 修订记录

V2 独立审核原始结论为 `REVISE`，无未决产品问题。关闭情况如下：

| Reviewer 问题 | V3 修订 | 关闭证据 |
| --- | --- | --- |
| R-01 Host MCP Token 无法按 Turn 换绑 | 固定 Process Capability Lease；Turn 前 activate、终态 deactivate；同 Host 串行 Turn；配置变化重启 Host | 10.4、13.1、19.1-19.2、最终验收 13 |
| R-02 Thread resume 不能恢复死亡连接上的审批 | 增加 approval/process generation；页面刷新与进程崩溃分流；`thread/read` 对账；旧审批 expired，未知 Turn interrupted | 11.2、11.5、16、19.2-19.3 |
| R-03 idempotencyKey 没有持久权威 | 增加 `creator_command_receipts`、唯一约束、request hash、事务内收据和结果重放语义 | 11.2、13.3、19.1-19.2、最终验收 14 |
| R-04 KrillinAI 常驻服务缺少安全边界 | 随机 loopback 端口、进程 Token、授权根解析、符号链接检查、旧路由禁用、凭据内存化和脱敏 | 15.1-15.2、19.2、最终验收 15 |

流程结论为 `PASS`：四项 Major 均已转化为唯一技术合同和可执行测试，不需要用户新增产品决策。Reviewer 未运行测试、构建或服务；这是方案审核结论，不代表代码已经实现或验收通过。

## 24. 方案结论

OpenCreator 不需要再建设一个新的 Agent Harness，也不应继续把 Codex CLI 当成一次性命令执行器。最简单且完整的方案是：内置并隔离固定版本 Codex CLI，由 Runtime Manager 常驻管理 `codex app-server`；Creator Core 继续拥有全部创作业务状态；Creator Tool Server 通过统一 Dispatcher 把真实 Agent 操作连接到同一 Creator Job；KrillinAI 作为被托管的常驻媒体服务执行真实 Stage。

该方案的关键不是增加更多同步机制，而是删除重复状态源和假执行路径。工作台、Activity 与 Codex 对话各自表达不同信息，但共同围绕唯一 Creator Job 运行。
