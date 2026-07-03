# Codex-native 自有 Agent Runtime 技术方案

## 1. 背景

本方案面向一个本地运行的自有 Agent 产品。产品需要拥有自己的入口、界面、任务中心、Skills 管理、MCP 管理和定时任务能力，但底层 Agent 执行能力尽量复用 Codex 原生能力。

核心原则是：**能用 Codex 的就用 Codex，不重新实现一套 Agent loop、Skills runtime 或 MCP runtime**。自有系统只做薄壳，负责入口、配置托管、进程生命周期、事件转发、日志和定时触发。

## 2. 第一版目标

第一版目标是实现一个可长期演进的本地 Agent Runtime 基座：

1. 提供自有 Agent UI，而不是把用户入口交给 Codex UI。
2. 托管一个独立的 `CODEX_HOME`，使该 Agent 拥有自己的 Codex 配置、profile、skills、MCP 和会话状态。
3. 使用 `codex exec --json` 作为唯一执行内核，保留 Codex 原生 Agent 能力。
4. 通过 stdin 向 Codex 输入 prompt，通过 stdout JSONL 接收 Codex 事件。
5. 提供稳定的本地 Run API 和 SSE 事件流，前端不直接依赖 Codex 原始事件格式。
6. 通过 Codex 原生目录和命令透传 Skills、MCP、plugin、login、doctor 等能力。
7. 通过本地 Scheduler 最小化补齐定时触发能力，到点后仍然执行普通 Codex run。
8. 保存 run 元数据、原始日志、归一化事件和 stderr，便于诊断和后续审计。

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

这些能力可以在 Runtime 稳定后逐步演进。

## 4. 总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                         自有 Agent UI                         │
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
│  │ spawn codex  │  │ skills/mcp/etc │  │ JSONL -> UI事件   │  │
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
│                       Managed CODEX_HOME                      │
│ config.toml / <profile>.config.toml / skills/ / session state  │
└──────────────────────────────────────────────────────────────┘
```

## 5. 技术栈

| 模块 | 技术 |
|---|---|
| 桌面壳 | Electron |
| 前端 UI | React + Vite + TypeScript |
| 本地 Runtime Daemon | Node.js + TypeScript |
| HTTP API | Fastify 或 Hono |
| 实时事件 | SSE |
| 本地数据库 | SQLite |
| DB 访问 | Drizzle 或 Kysely |
| Codex 进程 | `child_process.spawn` |
| 配置读写 | TOML parser |
| 定时任务 | SQLite + croner/node-cron |
| 单元测试 | Vitest |
| UI 测试 | Playwright |
| 打包 | Electron Builder 或 Electron Forge |

第一版推荐全 TypeScript。原因是 Codex CLI 托管、JSONL、SSE、MCP、文件系统和 Electron 都与 Node.js 生态契合，能最大化降低实现复杂度。

## 6. 本地目录设计

默认数据目录：

```text
~/.your-agent/
  app.sqlite
  codex-home/
    config.toml
    default.config.toml
    sales.config.toml
    content.config.toml
    skills/
      skill-a/
        SKILL.md
      skill-b/
        SKILL.md
  workspaces/
    run-<id>/
  runs/
    run-<id>/
      meta.json
      raw.ndjson
      events.ndjson
      stderr.log
  schedules/
    schedules.json
```

目录职责：

| 目录 | 职责 |
|---|---|
| `codex-home/` | 自有 Agent 专属 `CODEX_HOME`，承载 Codex 原生配置、profile、skills、MCP 和 session 状态 |
| `workspaces/` | 每次 run 的默认工作目录，Codex 在其中读写文件 |
| `runs/` | run 元数据、原始事件、归一化事件和错误日志 |
| `app.sqlite` | 本地索引数据库，保存 runs、profiles、schedules、settings 等可查询状态 |

## 7. 分层职责

### 7.1 Agent UI

Agent UI 是用户入口。

职责：

1. 发起普通 run。
2. 查看 run 实时输出。
3. 查看工具调用和结果。
4. 管理 Codex profiles。
5. 管理 Codex skills。
6. 管理 Codex MCP servers。
7. 配置定时任务。
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
3. 托管 `CODEX_HOME`。
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

### 7.4 Codex Home Manager

Codex Home Manager 是 Codex 原生能力的配置托管层。

职责：

1. 创建和迁移 `~/.your-agent/codex-home`。
2. 管理 base `config.toml`。
3. 管理 `<profile>.config.toml`。
4. 管理 `skills/` 目录。
5. 为 Codex 子进程设置 `CODEX_HOME`。
6. 支持检测 Codex CLI、版本、doctor 状态。

设计原则：

1. `CODEX_HOME` 是 Codex 原生能力的真相源。
2. Profile 直接映射 Codex profile。
3. Skills 直接落到 Codex 原生 `skills/` 目录。
4. MCP 直接落到 Codex 原生 config 或通过 `codex mcp` 命令管理。

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
选择本地 skill 文件夹 -> 复制到 CODEX_HOME/skills/<skill-id>/
```

后续演进：

```text
企业 Skills 市场 -> 下载 skill 包 -> 校验签名/版本 -> 安装到 CODEX_HOME/skills/
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

职责：

1. 将 UI 操作映射到 Codex MCP 命令。
2. 读取 Codex MCP 列表并返回给 UI。
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
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  createdAt: string;
  updatedAt: string;
};
```

触发流程：

```text
到点 -> 创建 run -> 使用 schedule 中的 profile/cwd/prompt -> codex exec --json
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
CODEX_HOME=~/.your-agent/codex-home \
codex exec \
  --json \
  -p <profile> \
  -C <workspace> \
  --sandbox workspace-write \
  --model <model>
```

prompt 必须走 stdin，不放 argv，避免跨平台命令行长度限制。

### 7.9 Event Normalizer

Event Normalizer 将 Codex 原始 JSONL 转成自有 UI 协议。

Codex 常见事件映射：

| Codex 原始事件 | 自有事件 |
|---|---|
| `thread.started` | `status: initializing` |
| `turn.started` | `status: running` |
| `item.started command_execution` | `tool_use` |
| `item.completed command_execution` | `tool_result` |
| `item.completed agent_message` | `text_delta` |
| `turn.completed usage` | `usage` |
| `turn.failed` / `error` | `error` |

自有事件类型：

```ts
type AgentEvent =
  | { type: 'status'; label: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError: boolean }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
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
```

Run 请求：

```ts
type RunRequest = {
  prompt: string;
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  images?: string[];
};
```

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
1. 用户在 UI 输入 prompt。
2. UI 调 POST /runs。
3. Daemon 创建 runId。
4. Daemon 选择 profile 和 workspace。
5. Codex Runner 构建 args。
6. Daemon spawn codex exec --json。
7. Daemon 将 prompt 写入 stdin。
8. Codex 执行原生 Agent loop。
9. Daemon 保存 stdout raw JSONL。
10. Event Normalizer 生成自有 AgentEvent。
11. UI 通过 SSE 实时展示。
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
1. 用户在 UI 添加 MCP server。
2. UI 调 POST /codex/mcp/add。
3. Daemon 调 codex mcp add。
4. Codex 更新原生 config。
5. UI 重新拉取 /codex/mcp。
```

### 9.4 Skill 安装

```text
1. 用户选择本地 skill 目录。
2. Daemon 校验 SKILL.md 存在。
3. Daemon 复制目录到 CODEX_HOME/skills/<id>/。
4. UI 刷新 skills 列表。
5. 后续 Codex run 原生加载 skill。
```

## 10. Codex 透传策略

| 能力 | 第一版处理方式 |
|---|---|
| Agent loop | 交给 `codex exec --json` |
| Skills | 安装到 `CODEX_HOME/skills`，交给 Codex 原生加载 |
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
| Memory | 第一版不做；Codex 自有状态保留在托管 `CODEX_HOME` |

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
| `RUN_NOT_FOUND` | run 不存在 |
| `RUN_ALREADY_TERMINAL` | run 已结束，不能取消 |
| `SPAWN_FAILED` | 启动 Codex 失败 |
| `CODEX_EXIT_NON_ZERO` | Codex 非零退出 |
| `CODEX_STREAM_ERROR` | Codex JSONL 解析或协议错误 |
| `SKILL_INVALID` | skill 缺失 `SKILL.md` 或格式无效 |
| `MCP_COMMAND_FAILED` | `codex mcp` 命令失败 |
| `SCHEDULE_INVALID` | cron 或 schedule 配置无效 |

## 12. 安全边界

第一版虽然不做企业权限治理，但仍需保留本地安全底线：

1. 默认使用独立 `CODEX_HOME`，不污染用户全局 Codex。
2. 默认 workspace 在 `~/.your-agent/workspaces`。
3. 不把用户系统敏感目录默认加入 `--add-dir`。
4. `danger-full-access` 需要 UI 明确提示。
5. MCP server 添加需要展示 command、args 和 env。
6. run 日志里避免明文显示敏感 env。
7. 取消 run 时确保子进程和衍生资源清理。

## 13. 数据库模型

第一版可使用 SQLite。

核心表：

```text
runs
  id
  status
  profile
  cwd
  prompt
  model
  sandbox
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
  sandbox
  created_at
  updated_at

settings
  key
  value_json
```

Skills、MCP、profiles 的真相源优先是 Codex 原生文件和命令，SQLite 只做缓存或 UI 索引，不作为执行真相源。

## 14. 打包和启动

桌面应用启动流程：

```text
1. Electron main 进程启动。
2. 检查 Local Runtime Daemon 是否已运行。
3. 未运行则启动 daemon。
4. UI 连接 daemon。
5. Daemon 检查 Codex CLI、CODEX_HOME、config.toml。
6. UI 展示初始化状态。
```

daemon 运行形态：

1. 第一版可以由 Electron 启动和托管。
2. 后续可以注册为 macOS LaunchAgent、Windows Service、Linux systemd user service。

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

1. UI 创建 run。
2. UI 接收实时事件。
3. UI 取消 run。
4. UI 安装 skill。
5. UI 添加 MCP。
6. UI 创建 schedule 并手动触发。

## 16. 实施里程碑

### P0：Codex Runner 内核

目标：

1. 能检测 Codex CLI。
2. 能创建独立 `CODEX_HOME`。
3. 能运行 `codex exec --json`。
4. 能通过 stdin 写 prompt。
5. 能保存 raw JSONL。
6. 能解析 text/status/error。

验收：

```text
命令行调用本地 daemon API，能得到完整流式 Codex 输出。
```

### P1：Run API + UI Chat

目标：

1. 实现 `/runs`。
2. 实现 `/runs/:id/events`。
3. 实现 `/runs/:id/cancel`。
4. UI 能创建和观察 run。

验收：

```text
桌面 UI 中发起任务，能看到实时文本、工具调用和最终状态。
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
4. UI 展示 skill 元数据。

验收：

```text
安装 skill 后，后续 Codex run 可使用该 skill。
```

### P4：MCP Pass-through

目标：

1. 封装 `codex mcp list/add/remove/login/logout`。
2. UI 管理 MCP servers。
3. 显示命令失败原因。

验收：

```text
通过 UI 添加 MCP 后，Codex run 可发现并使用该 MCP server。
```

### P5：Scheduler

目标：

1. 创建 schedule。
2. 编辑、启用、禁用、删除 schedule。
3. 到点触发 run。
4. 支持 run-now。

验收：

```text
定时任务能按计划创建 Codex run，并在 Runs 页面可追踪。
```

### P6：桌面打包

目标：

1. Electron 打包。
2. 自动启动 daemon。
3. 基础日志导出。
4. 初始化向导。

验收：

```text
非开发环境安装后可完整使用 P0-P5 能力。
```

## 17. 长期企业演进路线

### 阶段 1：本地 Codex-native Agent

定位：

```text
个人或团队本地可用的自有 Agent 壳。
```

能力：

1. Codex runtime 托管。
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

执行仍然落到 `CODEX_HOME/skills`，Codex 原生执行。

### 阶段 3：企业 MCP Gateway

引入企业工具入口：

```text
Codex -> 本地/远端 MCP Gateway -> CRM/OA/ERP/知识库/内容系统
```

新增能力：

1. 工具目录。
2. 统一凭证托管。
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

1. 自有 UI 控制产品入口。
2. Local Runtime Daemon 控制进程和事件。
3. Codex CLI 控制 Agent 执行能力。
4. `CODEX_HOME` 是 Codex 原生能力的真相源。
5. Skills、MCP、profile 优先使用 Codex 原生机制。
6. Scheduler 是薄触发器，不是 Agent runtime。
7. 前端依赖自有事件协议，不依赖 Codex 原始 JSONL。
8. 企业能力逐步叠加在壳和 Gateway 上，不侵入 Codex 执行内核。

