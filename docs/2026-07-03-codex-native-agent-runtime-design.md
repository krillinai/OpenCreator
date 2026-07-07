# Codex-native 自有 Agent Runtime 技术方案

## 0. 文档状态

本文件是 Codex-native 自有 Agent Runtime 的基础蓝图，描述产品方向、总体架构和长期演进路线。

具体运行契约、Codex CLI 兼容策略、日志脱敏、安全边界、Run 状态机、Scheduler 语义和实施里程碑，以 `docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md` 为准。若两份文档存在差异，后者优先。

## 1. 背景

本方案面向一个本地运行的自有 Agent 产品。产品最终需要拥有自己的入口、界面、任务中心、Skills 管理、MCP 管理和定时任务能力，但第一版先收敛为 Agent Runtime 内核，优先验证底层执行、事件、状态、日志和调度能力。

核心原则是：**能用 Codex 的就用 Codex，不重新实现一套 Agent loop、Skills runtime 或 MCP runtime**。第一版 Runtime 只做 Codex 原生环境适配、进程生命周期、事件转发、日志、状态持久化和定时触发，为后续 UI 产品层打基础。

## 2. 第一版目标

第一版目标是实现一个可长期演进的本地 Agent Runtime 内核。它可以被命令行 harness、本地 API、后续桌面 UI 或其它产品入口调用，但第一版验收不绑定桌面 UI。

1. 默认复用 Codex 原生全局环境，优先遵循用户已有的 `$CODEX_HOME`，否则使用 Codex 默认的 `~/.codex`。
2. 使用 `codex exec --json` 作为唯一执行内核，保留 Codex 原生 Agent 能力。
3. 通过 stdin 向 Codex 输入 prompt，通过 stdout JSONL 接收 Codex 事件。
4. 提供稳定的本地 Run API、Thread API 和 SSE 事件流，让后续 UI 不直接依赖 Codex 原始事件格式。
5. 固化 Run 状态机、取消、超时、崩溃恢复、并发锁和本地鉴权。
6. 保存 run 元数据、脱敏原始日志、归一化事件、脱敏 stderr 和 diagnostics，便于诊断和后续审计。
7. 通过 Codex 原生目录和命令透传 Skills、MCP、login、doctor 等能力，但第一版只做 Runtime API 和命令层契约，不做最终 UI 管理界面。
8. 通过本地 Scheduler 最小化补齐定时触发能力，到点后仍然执行普通 Codex run。

## 3. 第一版非目标

第一版明确不做：

1. 不实现自研 Agent loop。
2. 不实现自研 Skills runtime。
3. 不实现自研 MCP runtime。
4. 不实现长期记忆系统。
5. 不做企业登录、租户、审批、复杂权限和审计治理。
6. 不做多 Agent 协作编排。
7. 不做云端 Agent 执行服务。
8. 不 fork Codex UI 作为产品底座。
9. 第一版不设计和实现完整桌面 UI；UI 在 Runtime 内核稳定后单独设计。
10. 第一版不做 Electron 打包和安装器；可保留后续桌面产品方向。

这些能力可以在 Runtime 稳定后逐步演进。

## 4. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│             Future Product UI / CLI Harness / API Client       │
│ Chat / Runs / Skills / MCP / Schedules / Settings / Logs       │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP + SSE
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Local Runtime Daemon                       │
│                                                              │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │ Run Manager  │  │ Codex Home Mgr │  │ Scheduler        │  │
│  └──────┬───────┘  └───────┬────────┘  └────────┬─────────┘  │
│         │                  │                    │            │
│  ┌──────▼───────┐  ┌───────▼────────┐  ┌────────▼─────────┐  │
│  │ Codex Runner │  │ Pass-through   │  │ Event Normalizer │  │
│  │ spawn codex  │  │ skills/mcp/etc │  │ JSONL -> 事件协议 │  │
│  └──────┬───────┘  └────────────────┘  └────────┬─────────┘  │
└─────────┼───────────────────────────────────────┼────────────┘
          │ spawn / stdin / stdout                │ SSE events
          ▼                                       ▼
┌──────────────────────────────────────────────────────────────┐
│                           Codex CLI                           │
│ codex exec --json / codex mcp / codex plugin / codex login     │
│                                                              │
│ 原生能力：Agent loop / Skills / MCP / Tools / 文件读写 / Shell │
└───────────────────────────────┬──────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                    Codex Global CODEX_HOME                    │
│ $CODEX_HOME 或 ~/.codex：config / skills / MCP / session state │
└──────────────────────────────────────────────────────────────┘
```

## 5. 技术栈

| 模块 | 技术 |
|---|---|
| 本地 Runtime Daemon | Node.js + TypeScript |
| HTTP API | Fastify 或 Hono |
| 实时事件 | SSE |
| 本地数据库 | SQLite |
| DB 访问 | Drizzle 或 Kysely |
| Codex 进程 | `child_process.spawn` |
| 配置读写 | TOML parser |
| 定时任务 | SQLite + croner/node-cron |
| 单元测试 | Vitest |
| 集成测试 | fake Codex binary + 真实 Codex smoke fixture |
| API/E2E 测试 | Vitest 或 Playwright API mode |

第一版推荐 TypeScript。原因是 Codex CLI 托管、JSONL、SSE、MCP、文件系统、SQLite 和后续 Electron UI 都与 Node.js 生态契合，能最大化降低实现复杂度。桌面 UI 技术栈暂不进入第一版 Runtime 内核验收。

## 6. 本地目录设计

默认数据目录：

```text
~/.your-agent/
  app.sqlite
  workspaces/
    thread-<id>/
    run-<id>/
  runs/
    run-<id>/
      meta.json
      raw.redacted.ndjson
      events.ndjson
      stderr.redacted.log
  schedules/
    schedules.json
```

Codex 原生目录默认不放在 `~/.your-agent/` 下。Runtime 默认解析并使用用户现有的 `$CODEX_HOME`；如果环境变量未设置，则使用 Codex 默认目录 `~/.codex`。只有用户显式开启隔离模式时，才使用类似 `~/.your-agent/codex-home/` 的独立 `CODEX_HOME`。

目录职责：

| 目录 | 职责 |
|---|---|
| `$CODEX_HOME` / `~/.codex` | Codex 原生配置、profile、skills、MCP 和 session 状态的默认真相源，不属于本 app 数据目录 |
| `workspaces/thread-<id>/` | managed Chat/thread 的固定工作目录，保证同一多轮会话的文件连续性 |
| `workspaces/run-<id>/` | 独立 run 的默认工作目录，用于不属于 Chat thread 的一次性执行 |
| `runs/` | run 元数据、脱敏后的原始事件、归一化事件和脱敏错误日志 |
| `app.sqlite` | 本地索引数据库，保存 runs、profiles、schedules、settings 等可查询状态 |

## 7. 分层职责

### 7.1 Runtime Client

Runtime Client 是第一版 Runtime 的调用方，可以是命令行 harness、API 测试、脚本或后续 UI。第一版只要求 API 和事件契约稳定，不要求完整界面。

职责：

1. 发起普通 run。
2. 查看 run 实时输出。
3. 查看工具调用和结果。
4. 通过 Runtime API 管理 Codex profiles。
5. 通过 Runtime API 管理 Codex skills。
6. 通过 Runtime API 管理 Codex MCP servers。
7. 通过 Runtime API 配置定时任务。
8. 查看历史 runs、日志和失败原因。

不做：

1. 不直接 spawn Codex。
2. 不直接编辑底层 runtime 状态。
3. 不直接依赖 Codex 原始 JSONL 事件格式。

### 7.2 Local Runtime Daemon

Local Runtime Daemon 是本地常驻服务，定位类似 Codex 本地运行时的薄封装。

职责：

1. 提供本地 HTTP API。
2. 管理 run 生命周期。
3. 解析并使用 Codex 原生 `CODEX_HOME`。
4. 调用 Codex 原生命令。
5. 启动和停止 Codex 进程。
6. 提供 SSE 事件流。
7. 运行本地 Scheduler。
8. 保存日志和状态。

不做：

1. 不重写 Codex agent loop。
2. 不解释 Skills 执行语义。
3. 不实现 MCP server 业务逻辑，除非后续作为企业 Gateway 的入口。

### 7.3 Run Manager

Run Manager 是 run 生命周期状态机。

状态：

```text
queued -> running -> succeeded
                  -> failed
                  -> canceled
```

职责：

1. 创建 run id。
2. 创建默认 workspace。
3. 写入 `runs/run-<id>/meta.json`。
4. 记录 stdout、stderr、raw JSONL 和 normalized events。
5. 管理活动子进程句柄。
6. 支持 cancel。
7. 支持 run 状态查询。

### 7.4 Codex Home Adapter

Codex Home Adapter 是 Codex 原生环境的解析、索引和安全操作层。

职责：

1. 解析实际 `CODEX_HOME`：优先 `$CODEX_HOME`，否则 `~/.codex`。
2. 读取 base `config.toml` 和 profile 配置。
3. 索引 `skills/` 目录。
4. 通过 Codex 原生命令管理 MCP、login、doctor 等能力。
5. 为 Codex 子进程传递与当前环境一致的 `CODEX_HOME`。
6. 支持检测 Codex CLI、版本、doctor 状态。
7. 启动 Codex 前检查 config 是否可能导致 CLI 启动失败。
8. 统一展开 `~`，确保 daemon 侧、诊断侧和子进程 env 侧看到同一个路径。

设计原则：

1. `CODEX_HOME` 是 Codex 原生能力的真相源。
2. Profile 直接映射 Codex profile。
3. Skills 直接落到 Codex 原生 `skills/` 目录。
4. MCP 直接落到 Codex 原生 config 或通过 `codex mcp` 命令管理。
5. 默认模式下 Runtime 不拥有 `CODEX_HOME`，修改全局 Codex 配置前必须让用户明确知道影响范围。
6. 独立 `CODEX_HOME` 仅作为隔离模式，用于测试、企业隔离或用户显式选择的独立环境。
7. 隔离模式的目录可以放在 `~/.your-agent/codex-home/`，但必须在设置和诊断中明确标注它不是用户全局 Codex 环境。

### 7.5 Skills Pass-through

Skills Pass-through 只管理文件，不实现 skill runtime。

职责：

1. 扫描 `CODEX_HOME/skills/*/SKILL.md`。
2. 安装 skill 文件夹。
3. 删除 skill 文件夹。
4. 展示 skill 名称、描述和触发词。
5. 允许后续接企业 Skills 市场作为安装源。

第一版安装方式：

```text
选择本地 skill 文件夹 -> 复制到当前 CODEX_HOME/skills/<skill-id>/
```

后续演进：

```text
企业 Skills 市场 -> 下载 skill 包 -> 校验签名/版本 -> 安装到当前 CODEX_HOME/skills/
```

### 7.6 MCP Pass-through

MCP Pass-through 优先调用 Codex 原生命令。

支持命令：

```bash
codex mcp list
codex mcp get <name>
codex mcp add ...
codex mcp remove <name>
codex mcp login <name>
codex mcp logout <name>
```

添加 stdio MCP server 时使用 Codex 原生命令形态：

```bash
codex mcp add <name> --env KEY=VALUE -- <command> <args...>
```

探测已安装 server 使用 `codex mcp get <name>` 的退出码，MCP 管理命令需要短超时，候选值为 30 秒。

职责：

1. 将客户端请求映射到 Codex MCP 命令。
2. 读取 Codex MCP 列表并返回给客户端。
3. 保存操作日志。
4. 处理命令失败、未登录、配置错误。

第一版不实现自研 MCP runtime。Codex 调用 MCP 的行为由 Codex 原生能力负责。

### 7.7 Scheduler

Scheduler 是 Codex 没有本地后台定时守护能力时的最小补齐层。

它不执行任务，只触发 Codex run。

Schedule 结构：

```ts
type Schedule = {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  profile: string;
  cwd?: string;
  prompt: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  createdAt: string;
  updatedAt: string;
};
```

触发流程：

```text
到点 -> 创建 run -> 使用 schedule 中的 profile/cwd/model/reasoning/sandbox/prompt -> codex exec --json
```

如果未来 Codex 提供稳定原生 scheduler，则本层可以降级为配置壳或迁移器。

### 7.8 Codex Runner

Codex Runner 是进程托管层。

职责：

1. 构建 Codex args。
2. 设置 env，包括 `CODEX_HOME`。
3. 使用 `child_process.spawn` 启动 Codex。
4. 将 prompt 写入 stdin。
5. 读取 stdout JSONL。
6. 读取 stderr。
7. 支持 cancel、timeout 和进程清理。

启动形态：

```bash
CODEX_HOME=<resolved-codex-home> \
codex exec \
  --json \
  --skip-git-repo-check \
  -p <profile> \
  -C <workspace> \
  --sandbox workspace-write \
  --model <model>
```

prompt 必须走 stdin，不放 argv，避免跨平台命令行长度限制；stdin 形态不追加裸 `-` 哨兵。reasoning 通过 `-c model_reasoning_effort=...` 传递。resume run 的参数形态与 create run 不同，具体以详细契约为准。

### 7.9 Event Normalizer

Event Normalizer 将 Codex 原始 JSONL 转成 Runtime 自有事件协议。

Codex 常见事件映射：

| Codex 原始事件 | 自有事件 |
|---|---|
| `thread.started` | `status: initializing` |
| `turn.started` | `status: running` |
| `item.started command_execution` | `tool_use` |
| `item.completed command_execution` | `tool_result` |
| `item.completed agent_message` | `assistant_message` |
| `turn.completed usage` | `usage` |
| `turn.failed` / `error` | `error` |

自有事件类型：

```ts
type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'assistant_message'; text: string; format: 'plain_text'; delivery: 'message' | 'delta' }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; source: 'stream_cumulative' | 'rollout_best_effort' }
  | { type: 'diagnostic'; code: string; severity: 'info' | 'warning' | 'error'; message: string }
  | { type: 'error'; code?: string; message: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'canceled' };
```

原始 JSONL 必须保存，便于兼容 Codex 后续协议变化。

## 8. 本地 API 设计

### 8.1 Runs

```http
POST /runs
GET  /runs
GET  /runs/:id
GET  /runs/:id/events
POST /runs/:id/cancel
POST /threads
GET  /threads
GET  /threads/:id
GET  /threads/:id/runs
PATCH /threads/:id
POST /threads/:id/archive
```

Run 请求：

```ts
type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: 'new_thread' | 'resume_thread';
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  images?: string[];
};
```

规则：

1. 未传 `threadId` 时，`POST /runs` 创建独立 run，默认使用 `workspaces/run-<id>/`。
2. 传入 `threadId` 时，run 属于对应 Chat thread；managed thread 使用 `workspaces/thread-<id>/`，external thread 使用创建时固化的 `cwd`。
3. thread run 的 `profile`、`cwd`、`model`、`reasoning` 和 `sandbox` 以 thread 创建时固化配置为准，不能被每次 run 请求覆盖。
4. `resumeMode`、thread API 的完整字段和错误语义以详细契约文档为准。

Run 创建响应：

```ts
type RunCreateResponse = {
  runId: string;
  status: 'queued';
};
```

Run 状态：

```ts
type RunStatus = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  profile: string;
  cwd: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  error?: string;
};
```

### 8.2 Codex Status

```http
GET /codex/status
POST /codex/doctor
POST /codex/login
POST /codex/logout
POST /codex/update
```

状态内容：

```ts
type CodexStatus = {
  available: boolean;
  bin?: string;
  version?: string;
  codexHome: string;
  authStatus?: 'ok' | 'missing' | 'unknown';
};
```

### 8.3 Profiles

```http
GET    /codex/profiles
POST   /codex/profiles
GET    /codex/profiles/:name
PATCH  /codex/profiles/:name
DELETE /codex/profiles/:name
```

Profile 本质是 `CODEX_HOME/<name>.config.toml`。

### 8.4 Skills

```http
GET    /codex/skills
POST   /codex/skills/install
DELETE /codex/skills/:id
```

第一版安装本地目录：

```ts
type InstallSkillRequest = {
  sourcePath: string;
  id?: string;
};
```

### 8.5 MCP

```http
GET    /codex/mcp
GET    /codex/mcp/:name
POST   /codex/mcp/add
DELETE /codex/mcp/:name
POST   /codex/mcp/:name/login
POST   /codex/mcp/:name/logout
```

这些接口是 Codex MCP 命令的薄封装。

### 8.6 Schedules

```http
GET    /schedules
POST   /schedules
GET    /schedules/:id
PATCH  /schedules/:id
DELETE /schedules/:id
POST   /schedules/:id/run-now
```

## 9. 运行流程

### 9.1 普通 run

```text
1. 客户端提交 prompt。
2. 客户端调 `POST /runs`。
3. Daemon 创建 runId。
4. Daemon 选择 profile 和 workspace。
5. Codex Runner 构建 args。
6. Daemon spawn codex exec --json。
7. Daemon 将 prompt 写入 stdin。
8. Codex 执行原生 Agent loop。
9. Daemon 保存 stdout raw JSONL。
10. Event Normalizer 生成自有 AgentEvent。
11. 客户端通过 SSE 实时接收事件。
12. 子进程退出，Run Manager 标记最终状态。
```

### 9.2 定时 run

```text
1. Scheduler 启动时加载 enabled schedules。
2. cron 到点。
3. Scheduler 调 Run Manager 创建 run。
4. 后续流程与普通 run 完全一致。
```

### 9.3 MCP 管理

```text
1. 客户端请求添加 MCP server。
2. 客户端调 `POST /codex/mcp/add`。
3. Daemon 调 codex mcp add。
4. Codex 更新原生 config。
5. 客户端重新拉取 `/codex/mcp`。
```

### 9.4 Skill 安装

```text
1. 客户端提交本地 skill 目录。
2. Daemon 校验 SKILL.md 存在。
3. Daemon 在请求包含确认标记后复制目录到当前 CODEX_HOME/skills/<id>/。
4. 客户端刷新 skills 列表。
5. 后续 Codex run 原生加载 skill。
```

## 10. Codex 透传策略

| 能力 | 第一版处理方式 |
|---|---|
| Agent loop | 交给 `codex exec --json` |
| Skills | 安装到当前 `CODEX_HOME/skills`，交给 Codex 原生加载 |
| MCP | 通过 `codex mcp` 或 Codex 原生 config 管理 |
| Profiles | 使用 `codex -p <profile>` |
| Model | 使用 `--model` |
| Reasoning | 使用 Codex config override，例如 `-c model_reasoning_effort=...` |
| Sandbox | 使用 `--sandbox` |
| Images | 使用 Codex `--image` 能力 |
| Login | 调 `codex login` |
| Doctor | 调 `codex doctor` |
| Plugin | 后续通过 `codex plugin` 透传 |
| Scheduler | Codex 无后台调度时，由本地 daemon 触发 run |
| Memory | 第一版不做；Codex 自有状态保留在当前 Codex `CODEX_HOME` |

## 11. 错误处理

错误统一返回结构：

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

核心错误码：

| 错误码 | 含义 |
|---|---|
| `CODEX_NOT_FOUND` | 找不到 Codex CLI |
| `CODEX_AUTH_REQUIRED` | Codex 未登录或凭证不可用 |
| `CODEX_CONFIG_INVALID` | 当前 `CODEX_HOME` 配置无法被 Codex CLI 接受，且用户未确认修复或修复失败 |
| `RUN_NOT_FOUND` | run 不存在 |
| `THREAD_NOT_FOUND` | thread 不存在 |
| `RESUME_TARGET_NOT_FOUND` | Codex session/thread 不存在、过期或不可读 |
| `RUN_ALREADY_TERMINAL` | run 已结束，不能取消 |
| `SPAWN_FAILED` | 启动 Codex 失败 |
| `CODEX_EXIT_NON_ZERO` | Codex 非零退出 |
| `CODEX_STREAM_ERROR` | Codex JSONL 解析或协议错误 |
| `RESUME_FAILED` | resume 调用失败且无法安全 reseed |
| `SKILL_INVALID` | skill 缺失 `SKILL.md` 或格式无效 |
| `MCP_COMMAND_FAILED` | `codex mcp` 命令失败 |
| `SCHEDULE_INVALID` | cron 或 schedule 配置无效 |

## 12. 安全边界

第一版虽然不做企业权限治理，但仍需保留本地安全底线：

1. 默认复用 Codex 全局 `CODEX_HOME`，任何会修改全局 Codex 配置的 API 都必须在响应或预检中明确返回影响范围，并要求调用方显式确认。
2. 默认 workspace 在 `~/.your-agent/workspaces`。
3. 不把用户系统敏感目录默认加入 `--add-dir`。
4. `danger-full-access` 需要调用方显式确认。
5. MCP server 添加需要展示 command、args 和 env。
6. run 日志里避免明文显示敏感 env。
7. 取消 run 时确保子进程和衍生资源清理。
8. sandbox 选择必须展示用户意图和实际执行策略；Windows/WSL/macOS/Linux 的可用边界以详细契约的能力矩阵为准。

## 13. 数据库模型

第一版可使用 SQLite。

核心表：

```text
runs
  id
  thread_id
  codex_thread_id
  status
  profile
  cwd
  prompt
  model
  reasoning
  sandbox
  timeout_ms
  inactivity_timeout_ms
  transcript_reseed_mode
  usage_source
  started_at
  ended_at
  error

run_events
  id
  run_id
  seq
  type
  payload_json
  created_at

schedules
  id
  name
  cron
  enabled
  profile
  cwd
  prompt
  model
  reasoning
  sandbox
  created_at
  updated_at

settings
  key
  value_json
```

Skills、MCP、profiles 的真相源优先是当前 Codex 原生文件和命令，SQLite 只做缓存或查询索引，不作为执行真相源。

## 14. 启动和运行形态

第一版 Runtime 启动流程：

```text
1. 命令行或测试 harness 启动 Local Runtime Daemon。
2. Daemon 绑定 127.0.0.1，并生成或读取本地 runtime token。
3. Daemon 检查 Codex CLI、CODEX_HOME、config.toml 和能力矩阵。
4. 客户端通过 HTTP API 和 SSE 连接 daemon。
5. 客户端可创建 run、订阅事件、取消 run、查询诊断。
```

daemon 运行形态：

1. 第一版使用 foreground daemon 或开发期命令行启动，便于验证和测试。
2. 后续桌面产品可以由 Electron main 启动和托管。
3. 更后续可以注册为 macOS LaunchAgent、Windows Service、Linux systemd user service。

## 15. 测试策略

### 15.1 单元测试

覆盖：

1. Codex args 构建。
2. JSONL parser。
3. Event normalizer。
4. Profile config 读写。
5. Skill 安装校验。
6. Schedule cron 校验。

### 15.2 集成测试

使用 fake Codex binary，模拟：

1. 成功输出。
2. 工具调用。
3. 非零退出。
4. stderr 输出。
5. 空输出。
6. JSONL 格式变化。
7. 长 prompt stdin。

### 15.3 端到端测试

覆盖：

1. API 创建 run。
2. API 接收实时事件。
3. API 取消 run。
4. API 安装 skill。
5. API 添加 MCP。
6. API 创建 schedule 并手动触发。

## 16. 实施里程碑

### P0：Codex Runner 内核

目标：

1. 能检测 Codex CLI。
2. 能解析当前 Codex `CODEX_HOME`，并支持可选隔离 `CODEX_HOME`。
3. 能运行 `codex exec --json`。
4. 能通过 stdin 写 prompt。
5. 能保存 raw JSONL。
6. 能解析 text/status/error。

验收：

```text
命令行调用本地 daemon API，能得到完整流式 Codex 输出。
```

### P1：Run API + SSE

目标：

1. 实现 `/runs`。
2. 实现 `/runs/:id/events`。
3. 实现 `/runs/:id/cancel`。
4. 命令行 harness 或 API 测试能创建和观察 run。

验收：

```text
通过本地 API 发起任务，能看到实时文本、工具调用和最终状态。
```

### P2：Profiles 和 Settings

目标：

1. 管理 `config.toml`。
2. 管理 `<profile>.config.toml`。
3. 支持模型、sandbox、approval policy。
4. 支持 `CODEX_BIN` 配置。

验收：

```text
不同 profile 可以使用不同 Codex 配置运行。
```

### P3：Skills Pass-through

目标：

1. 列出 `CODEX_HOME/skills`。
2. 安装本地 skill 目录。
3. 删除 skill。
4. API 返回 skill 元数据。

验收：

```text
安装 skill 后，后续 Codex run 可使用该 skill。
```

### P4：MCP Pass-through

目标：

1. 封装 `codex mcp list/add/remove/login/logout`。
2. API 管理 MCP servers。
3. 显示命令失败原因。

验收：

```text
通过 API 添加 MCP 后，Codex run 可发现并使用该 MCP server。
```

### P5：Scheduler

目标：

1. 创建 schedule。
2. 编辑、启用、禁用、删除 schedule。
3. 到点触发 run。
4. 支持 run-now。

验收：

```text
定时任务能按计划创建 Codex run，并可通过 Runs API 追踪。
```

### P6：Runtime 诊断和发布准备

目标：

1. 诊断包导出。
2. 日志清理策略。
3. managed workspace 清理策略。
4. Runtime 配置样例和启动脚本。
5. 为后续桌面 UI 输出稳定 API 文档和事件 fixture。

验收：

```text
通过命令行启动 Runtime 后可完整使用 P0-P5 能力，并能导出脱敏诊断包。
```

## 17. 长期企业演进路线

### 阶段 1：本地 Codex-native Agent

定位：

```text
个人或团队本地可用的自有 Agent 壳。
```

能力：

1. Codex runtime 适配和薄封装。
2. Skills 透传。
3. MCP 透传。
4. 定时任务。
5. Run 历史和日志。

### 阶段 2：企业 Skills 市场

在不改变 runtime 原则的前提下，增加市场治理：

1. 企业 skill 包格式。
2. 版本管理。
3. 签名校验。
4. 安装源管理。
5. 灰度发布。
6. 禁用和回滚。

执行仍然落到当前 `CODEX_HOME/skills`，Codex 原生执行。

### 阶段 3：企业 MCP Gateway

引入企业工具入口：

```text
Codex -> 本地/远端 MCP Gateway -> CRM/OA/ERP/知识库/内容系统
```

新增能力：

1. 工具目录。
2. 企业工具凭证托管。
3. 工具调用日志。
4. 敏感字段脱敏。
5. 写操作审批。

Codex 仍然只看到 MCP server。

### 阶段 4：身份和权限

新增企业治理：

1. 企业登录。
2. 用户和组织。
3. Agent profile 权限。
4. Skill 安装权限。
5. MCP 工具使用权限。
6. 审批策略。

### 阶段 5：记忆和知识上下文

新增独立 Memory Layer：

1. 用户偏好。
2. 项目背景。
3. 企业术语。
4. 历史 run 总结。
5. 知识库检索摘要。

第一原则仍然是：记忆存储和治理归自有系统，使用时注入给 Codex。

### 阶段 6：多 Agent 和工作流

新增：

1. 多 Agent registry。
2. Agent 模板。
3. 工作流节点。
4. 人工确认节点。
5. 多 run 编排。

Codex 可以作为其中一个 runtime，不排斥 Claude、Gemini、自研 HTTP Agent 等。

### 阶段 7：企业级运行保障

新增：

1. 观测和指标。
2. run 可重放。
3. 失败重试。
4. 版本兼容矩阵。
5. 配置备份和迁移。
6. 数据导出。
7. 安全审计。

## 18. 架构原则总结

1. Runtime 内核先控制进程、事件和状态；自有 UI 在后续阶段控制产品入口。
2. Local Runtime Daemon 控制进程和事件。
3. Codex CLI 控制 Agent 执行能力。
4. 当前 Codex `CODEX_HOME` 是 Codex 原生能力的真相源，默认不再创建第二套真相源。
5. Skills、MCP、profile 优先使用 Codex 原生机制。
6. Scheduler 是薄触发器，不是 Agent runtime。
7. 后续客户端依赖自有事件协议，不依赖 Codex 原始 JSONL。
8. 企业能力逐步叠加在壳和 Gateway 上，不侵入 Codex 执行内核。
