# Agent Runtime API v1 前端接入文档

## 1. 范围

本文描述当前已实现 Agent Runtime 后端可供 UI 接入的 HTTP API 和 SSE 事件协议。当前 Runtime 是本机 Codex CLI 的契约层：默认复用当前全局 Codex 环境，即进程环境中的 `$CODEX_HOME`，否则使用 Codex 默认 `~/.codex`。

当前 protocol 包版本为 `0.1.0`。前端实现应优先复用 `@clawee/protocol` 导出的类型；本文用于说明真实路由行为、产品边界和 UI 接入约束。

第一版 UI 可以接入：

1. Codex 状态和能力检测。
2. Run 创建、取消、历史、详情和 SSE 事件流。
3. Thread 创建、列表、详情、归档和 thread 下 run 历史。
4. Profiles 读取和 run/thread 绑定校验。
5. Skills 扫描、安装、删除和操作日志。
6. MCP server 管理和操作日志。
7. Schedules CRUD、run-now 和操作日志。
8. Run diagnostics 导出。
9. Runtime cleanup preview/delete。

当前 Runtime 不提供：

1. 文件树浏览 API。
2. 文件读取/保存 API。
3. git diff、patch review、回滚 API。
4. 权限审批 API。
5. UI 专用项目管理 API。
6. Profile 全局写入确认能力。当前全局 profile 写入会返回 `CODEX_HOME_READ_ONLY`，UI 第一版应只做读取和选择。
7. 图片输入能力。`RunRequest.images` 在 protocol 中有预留，但当前 `/runs` 路由不会解析或传递图片。

## 2. 连接和认证

daemon 启动后 stdout 会输出：

```json
{
  "address": "http://127.0.0.1:60855",
  "token": "runtime-token"
}
```

除 `GET /healthz` 外，所有接口都需要：

```http
Authorization: Bearer <token>
```

JSON 请求需要：

```http
Content-Type: application/json
```

错误响应统一形态：

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

前端建议：

1. `401 UNAUTHORIZED`：回到连接设置或提示 daemon token 已失效。
2. `400 VALIDATION_FAILED`：表单校验错误。
3. `404 *_NOT_FOUND`：刷新列表并提示资源不存在。
4. `409 *_CONFIRMATION_REQUIRED`：展示确认弹窗后重试。
5. `422 *_INVALID`：配置内容损坏或不可被 Codex 接受。
6. `502 MCP_COMMAND_FAILED`：展示 Codex MCP 命令失败详情入口。

## 3. 基础状态

### `GET /healthz`

不需要鉴权。

响应：

```json
{ "ok": true }
```

### `GET /codex/status`

返回当前 Runtime 看到的 Codex 环境。

响应：

```ts
type CodexStatusResponse = {
  codexBin: string;
  codexVersion: string;
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  codexHomeSource: "env" | "default" | "isolated";
  codexHomeWritable: boolean;
  capabilities: unknown;
  diagnostics: string[];
};
```

UI 用法：

1. 顶部连接状态显示 `codexVersion`、`codexHome`。
2. 如果 `capabilities.warnings` 或 `diagnostics` 非空，在状态页展示。
3. `codexHomeMode = "global"` 是正常生产路径。
4. 不要把 `codexHomeWritable = false` 理解为 skills/MCP 不可写；skills/MCP 有自己的显式确认策略。

## 4. Run API

### `POST /runs`

创建一次 Codex run，立即返回，不等待完成。

请求：

```ts
type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: "auto" | "new_thread" | "resume_thread";
  cwd?: string;
  profile?: string;
  model?: string;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};
```

独立 run 默认值：

1. `cwd`: daemon 当前工作目录。
2. `profile`: `"default"`。
3. `sandbox`: `"read-only"`。

thread run 规则：

1. 如果传 `threadId`，Runtime 使用 thread 固化的 `cwd/profile/model/reasoning/sandbox`。
2. thread run 请求里覆盖这些字段会返回 `THREAD_CONFIG_IMMUTABLE`。
3. archived thread 返回 `THREAD_ARCHIVED`。
4. 同一 thread 的多个 run 会串行，后续 run 先进入 `queued`。

响应：

```ts
type RunResponse = {
  id: string;
  threadId?: string;
  codexThreadId?: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
};
```

HTTP：`202`

### `GET /runs?limit=50`

返回最近 run，按创建时间倒序。

当前后端对 `limit` 做宽松解析；前端仍应按 1 到 100 的整数约束，避免异常参数造成不可预期的列表规模。

响应：

```ts
type RuntimeRun = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  cwd: string;
  profile: string;
  sandbox: string;
  createdBy: string;
  sourceId?: string | null;
  timeoutMs?: number | null;
  createdAt: string;
  updatedAt: string;
  terminationReason?: string;
  exitCode?: number | null;
  signal?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type RunListResponse = { runs: RuntimeRun[] };
```

### `GET /runs/:id`

返回单个 run 详情。不存在返回 `RUN_NOT_FOUND`。

### `POST /runs/:id/cancel`

取消 running 或 queued run。

响应：

```json
{ "id": "run_xxx", "canceled": true }
```

HTTP：

1. `202`：已接受取消。
2. `404 RUN_NOT_FOUND`。
3. `409 RUN_ALREADY_TERMINAL`：run 已结束。

## 5. Run SSE 事件流

### `GET /runs/:id/events?fromSeq=0`

返回 `text/event-stream`。兼容 query：

1. `fromSeq`
2. `afterSeq`
3. `Last-Event-ID` header

语义：只返回 `seq > fromSeq` 的事件。终态 `done` 发送后连接会关闭。运行中连接每 15 秒发送 heartbeat comment：

```text
: heartbeat
```

SSE frame 示例：

```text
id: 4
event: assistant_message
data: {"id":"evt_run_1_4","runId":"run_1","seq":4,"ts":"...","type":"assistant_message","payload":{...},"normalizerVersion":1}
```

事件类型：

```ts
type AgentEventEnvelope = {
  id: string;
  runId: string;
  seq: number;
  ts: string;
  type:
    | "status"
    | "assistant_message"
    | "tool_use"
    | "tool_result"
    | "usage"
    | "diagnostic"
    | "error"
    | "unknown_event"
    | "done";
  payload: AgentEventPayload;
  normalizerVersion: number;
  rawEventId?: string;
};
```

payload：

```ts
type AgentEventPayload =
  | {
      type: "status";
      label: "queued" | "initializing" | "running" | "canceling" | "finalizing";
      threadId?: string;
      codexThreadId?: string;
    }
  | {
      type: "assistant_message";
      text: string;
      format: "plain_text";
      delivery: "message" | "delta";
    }
  | {
      type: "tool_use";
      toolCallId: string;
      name: string;
      input: { command?: string; args?: string[]; raw?: unknown };
    }
  | {
      type: "tool_result";
      toolCallId: string;
      output: string;
      exitCode?: number | null;
      isError: boolean;
    }
  | {
      type: "usage";
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
      source: "stream_cumulative" | "rollout_best_effort";
    }
  | {
      type: "diagnostic";
      code: string;
      severity: "info" | "warning" | "error";
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      type: "error";
      code: string;
      message: string;
      details?: Record<string, unknown>;
    }
  | {
      type: "unknown_event";
      rawEventId: string;
      codexType?: string;
    }
  | {
      type: "done";
      status: "succeeded" | "failed" | "canceled";
      terminationReason:
        | "completed"
        | "user_canceled"
        | "timeout"
        | "spawn_timeout"
        | "inactivity_timeout"
        | "spawn_failed"
        | "codex_exit_non_zero"
        | "stream_error"
        | "daemon_restart"
        | "process_kill_failed";
    };
```

前端渲染建议：

1. `status`：更新 run 状态条。
2. `assistant_message`：追加 Agent 文本。当前 Codex 主要是整块 message，不承诺 token 级 delta。
3. `tool_use/tool_result`：渲染为可折叠步骤。
4. `diagnostic/error`：渲染为警告或错误卡片。
5. `unknown_event`：默认隐藏，可在诊断模式展示。
6. `done`：关闭 loading，刷新 run/thread 列表。

前端断线重连：

1. 记录最后一个 `seq`。
2. 重连 `GET /runs/:id/events?fromSeq=<lastSeq>`。
3. 如果返回 404，刷新 run 列表。

## 6. Thread API

### `POST /threads`

创建一个 Runtime thread。

请求：

```ts
type CreateThreadRequest = {
  title?: string;
  cwd?: string;
  workspaceMode?: "managed" | "external";
  profile?: string;
  model?: string;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};
```

默认值：

1. `workspaceMode`: `"managed"`。
2. `cwd`: managed 时为 Runtime 创建的 workspace；external 时默认 daemon 当前目录。
3. `profile`: `"default"`。
4. `sandbox`: `"read-only"`。

响应：

```ts
type ThreadResponse = {
  id: string;
  title?: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: "managed" | "external";
  profile: string;
  model?: string | null;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh" | null;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

type CreateThreadResponse = { thread: ThreadResponse };
```

### `GET /threads?status=active&limit=50`

query：

1. `status`: `active | archived | all`
2. `limit`: 1 到 100

响应：

```ts
type ThreadListResponse = { threads: ThreadResponse[] };
```

### `GET /threads/:id`

响应：

```ts
{ thread: ThreadResponse }
```

### `GET /threads/:id/runs?limit=50`

响应：

```ts
type ThreadRunsResponse = {
  runs: Array<{
    id: string;
    threadId?: string;
    codexThreadId?: string | null;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  }>;
};
```

### `POST /threads/:id/archive`

归档 thread。若 thread 有 active/queued run，返回 `THREAD_HAS_ACTIVE_RUN`。

响应：

```ts
{ thread: ThreadResponse }
```

UI 建议：

1. 新对话先 `POST /threads`，再用 `POST /runs` 传 `threadId`。
2. 同一 thread 下发送下一条消息时传同一个 `threadId` 和默认 `resumeMode = "auto"`。
3. 如果用户想重开上下文，传 `resumeMode = "new_thread"`。
4. thread 的 cwd/profile/sandbox 在创建后不可被 run 覆盖，UI 应把这些设置放在创建 thread 前。

## 7. Profiles API

### `GET /codex/profiles`

响应：

```ts
type CodexProfile = {
  name: string;
  status: "valid" | "invalid";
  config: Record<string, string | number | boolean | Array<string | number | boolean>>;
  diagnostics: string[];
  source: `${string}.config.toml`;
  codexHomeMode: "global" | "isolated";
  updatedAt?: string;
};

type CodexProfileListResponse = {
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  writable: boolean;
  baseConfigValid: boolean;
  profiles: CodexProfile[];
  diagnostics: string[];
};
```

### `GET /codex/profiles/:name`

响应：

```ts
{ profile: CodexProfile }
```

### `POST /codex/profiles`

### `PATCH /codex/profiles/:name`

### `DELETE /codex/profiles/:name`

这些接口已存在，但当前全局 Codex 环境下写入会返回：

```json
{
  "error": {
    "code": "CODEX_HOME_READ_ONLY",
    "message": "Codex home is read-only"
  }
}
```

UI 第一版建议：

1. 只做 profile 列表、详情和 run/thread 创建时选择。
2. 创建、编辑、删除入口先隐藏，或显示“后端待开放全局写入确认”。
3. `status = "invalid"` 的 profile 不允许用于创建 run/thread。

## 8. Skills API

### `GET /codex/skills`

响应：

```ts
type CodexSkillResponse = {
  id: string;
  name?: string;
  description?: string;
  status: "valid" | "invalid";
  diagnostics: string[];
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  skillsPath: string;
  skillPath: string;
  skillFilePath: string;
  updatedAt?: string;
};

type CodexSkillListResponse = {
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  skillsPath: string;
  skillsWritable: boolean;
  requiresWriteConfirmation: boolean;
  skills: CodexSkillResponse[];
  diagnostics: string[];
};
```

### `GET /codex/skills/:id`

响应：

```ts
{ skill: CodexSkillResponse }
```

### `POST /codex/skills/install`

安装本地 skill 目录到当前 Codex skills 目录。

请求：

```ts
type InstallCodexSkillRequest = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};
```

全局 Codex 环境写入必须传：

```json
{ "confirmWriteToCodexHome": true }
```

响应：

```ts
{
  skill: CodexSkillResponse;
  operation: CodexSkillOperationResponse;
}
```

### `DELETE /codex/skills/:id?confirmWriteToCodexHome=true`

响应：

```ts
{
  deleted: true;
  backupPath: string | null;
  operation: CodexSkillOperationResponse;
}
```

### `GET /codex/skills/operations?limit=50`

响应：

```ts
type CodexSkillOperationResponse = {
  id: string;
  operation: "install" | "overwrite" | "delete";
  skillId: string;
  codexHome: string;
  skillsPath: string;
  sourcePath?: string | null;
  targetPath: string;
  backupPath?: string | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

type CodexSkillOperationListResponse = {
  operations: CodexSkillOperationResponse[];
};
```

UI 建议：

1. 默认展示 skills 列表、valid/invalid 状态和 diagnostics。
2. 安装/删除前展示会写入的 `skillsPath`。
3. 全局写入必须用确认弹窗，并在确认后传 `confirmWriteToCodexHome: true`。

## 9. MCP API

### `GET /codex/mcp`

响应：

```ts
type CodexMcpServerResponse = {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  status: "configured" | "missing" | "invalid" | "unknown";
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  hasSecrets: boolean;
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  diagnostics: string[];
  raw?: string;
};

type CodexMcpListResponse = {
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  requiresWriteConfirmation: boolean;
  servers: CodexMcpServerResponse[];
  diagnostics: string[];
};
```

### `GET /codex/mcp/:name`

响应：

```ts
{ server: CodexMcpServerResponse }
```

### `POST /codex/mcp/add`

stdio 请求：

```ts
{
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  confirmWriteToCodexHome?: true;
}
```

http/sse 请求：

```ts
{
  name: string;
  transport: "http" | "sse";
  url: string;
  env?: Record<string, string>;
  oauthClientId?: string;
  oauthResource?: string;
  bearerTokenEnvVar?: string;
  confirmWriteToCodexHome?: true;
}
```

响应：

```ts
{
  server: CodexMcpServerResponse;
  operation: CodexMcpOperationResponse;
}
```

### `DELETE /codex/mcp/:name?confirmWriteToCodexHome=true`

响应：

```json
{ "removed": true }
```

### `POST /codex/mcp/:name/login`

### `POST /codex/mcp/:name/logout`

确认方式二选一：

1. query：`?confirmWriteToCodexHome=true`
2. body：`{ "confirmWriteToCodexHome": true }`

响应：

```ts
{ operation: CodexMcpOperationResponse }
```

### `GET /codex/mcp/operations?limit=50`

响应：

```ts
type CodexMcpOperationResponse = {
  id: string;
  operation: "add" | "remove" | "login" | "logout" | "get" | "list";
  serverName?: string | null;
  codexHome: string;
  command: string[];
  status: "succeeded" | "failed";
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

type CodexMcpOperationListResponse = {
  operations: CodexMcpOperationResponse[];
};
```

UI 注意：

1. `env` value 不会明文返回，UI 只能展示 `envKeys` 和 `hasSecrets`。
2. MCP 管理通过 Codex 原生命令完成，失败时看 `operation.command/errorCode/errorMessage`。
3. 当前 Runtime 不保证模型运行期 MCP tool 调用有完整可视化事件。

## 10. Schedules API

### `GET /schedules`

响应：

```ts
type ScheduleResponse = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh" | null;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number | null;
  concurrencyPolicy: "skip" | "queue" | "parallel";
  misfirePolicy: "skip";
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: "queued" | "running" | "succeeded" | "failed" | "canceled" | "skipped" | null;
  pendingTrigger: boolean;
  createdAt: string;
  updatedAt: string;
};

type ScheduleListResponse = {
  schedules: ScheduleResponse[];
};
```

### `POST /schedules`

请求：

```ts
type CreateScheduleRequest = {
  name: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  prompt: string;
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number;
  concurrencyPolicy?: "skip" | "queue" | "parallel";
  misfirePolicy?: "skip";
};
```

默认值：

1. `enabled`: `true`
2. `profile`: `"default"`
3. `cwd`: daemon 当前目录
4. `sandbox`: `"workspace-write"`
5. `timeoutMs`: `null`
6. `concurrencyPolicy`: `"skip"`
7. `misfirePolicy`: `"skip"`

响应：`ScheduleResponse`，HTTP `201`。

### `GET /schedules/:id`

返回详情，包含完整 prompt：

```ts
type ScheduleDetailResponse = ScheduleResponse & {
  prompt: string;
};
```

### `PATCH /schedules/:id`

请求：

```ts
type UpdateScheduleRequest = Partial<CreateScheduleRequest> & {
  model?: string | null;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh" | null;
  timeoutMs?: number | null;
};
```

响应：`ScheduleResponse`。

### `DELETE /schedules/:id`

响应：

```json
{ "deleted": true }
```

### `POST /schedules/:id/run-now`

响应：

```ts
type RunScheduleNowResponse = {
  run: {
    id: string;
    threadId?: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  } | null;
  schedule: ScheduleResponse;
  skipped: boolean;
  queued: boolean;
};
```

### `GET /schedules/:id/operations?limit=50`

响应：

```ts
type ScheduleOperationResponse = {
  id: string;
  operation:
    | "create"
    | "update"
    | "delete"
    | "run_now"
    | "timer_trigger"
    | "skip_misfire"
    | "skip_concurrency"
    | "queue_trigger"
    | "run_queued";
  scheduleId: string;
  status: "succeeded" | "failed" | "skipped" | "queued";
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

type ScheduleOperationListResponse = {
  operations: ScheduleOperationResponse[];
};
```

UI 注意：

1. 睡眠/离线错过触发按 `skip` 处理，不补跑。
2. `run-now` 创建的 run 可继续用 `/runs/:id/events` 订阅。
3. `queue` policy 下可能返回 `queued: true` 且 `run: null`。

## 11. Diagnostics API

### `GET /runs/:id/diagnostics?includeRawRedacted=false`

响应：

```ts
type RunDiagnosticsResponse = {
  runId: string;
  files: Array<{
    name: string;
    content: string;
  }>;
  codexStatusSnapshot: CodexStatusResponse;
  warnings: string[];
};
```

默认不包含 `raw.redacted.ndjson`。需要时传：

```text
includeRawRedacted=true
```

UI 建议：

1. 详情页展示文件列表：`meta.json`、`events.ndjson`、`stderr.redacted.log`、`diagnostics.json`。
2. 默认折叠大文件。
3. 不要把 diagnostics 当作普通用户聊天内容展示。

## 12. Cleanup API

### `GET /runtime/cleanup/preview?olderThanDays=30`

响应：

```ts
type CleanupPreviewResponse = {
  olderThanDays: number;
  items: Array<{
    type: "run_logs" | "managed_thread_workspace";
    id: string;
    path: string;
    sizeBytes: number;
    lastModifiedAt: string;
    reason: string;
  }>;
  totalSizeBytes: number;
  warnings: string[];
};
```

### `POST /runtime/cleanup`

请求：

```ts
{
  olderThanDays: number;
  confirm: true;
}
```

响应：

```ts
type CleanupDeleteResponse = {
  deleted: Array<{
    type: "run_logs" | "managed_thread_workspace";
    id: string;
    path: string;
    sizeBytes: number;
  }>;
  failed: Array<{
    type: "run_logs" | "managed_thread_workspace";
    id: string;
    path: string;
    sizeBytes: number;
    error: string;
  }>;
  totalDeletedBytes: number;
  warnings: string[];
};
```

UI 注意：

1. 必须先 preview，再让用户确认 delete。
2. 不要给 `olderThanDays = 0`。
3. cleanup 不删除 SQLite，不删除 external workspace。

## 13. 推荐前端数据流

### 新对话

1. `POST /threads` 创建 thread。
2. `POST /runs`，body 包含 `threadId` 和 prompt。
3. 打开 `GET /runs/:id/events?fromSeq=0`。
4. 收到 `done` 后刷新 `/threads/:id`、`/threads/:id/runs` 和 `/runs/:id`。

### 继续对话

1. 使用已有 `threadId`。
2. `POST /runs`，body 包含 `threadId`、`prompt`、`resumeMode: "auto"`。
3. 如果返回 `RESUME_CAPABILITY_UNVERIFIED` 或 `RESUME_TARGET_NOT_FOUND`，UI 提供“开启新上下文继续”，重试 `resumeMode: "new_thread"`。

### 独立一次性任务

1. 直接 `POST /runs`，不传 `threadId`。
2. 适合 status 检查、计划任务 run-now 或一次性命令。

### Skills/MCP 写入

1. 先展示 `codexHome` 和目标路径。
2. 用户确认后传 `confirmWriteToCodexHome: true`。
3. 成功后刷新 list 和 operations。
4. 失败时展示 `ApiError.error.code/message`，并提供 diagnostics 入口。

## 14. 当前 UI 不应承诺的能力

1. 文件树来自真实工作区。
2. 保存右侧编辑器会写入磁盘。
3. Agent 写文件前会出现 Runtime 权限审批。
4. MCP 工具调用过程可完整可视化。
5. Profile 可在全局 Codex 环境中创建/编辑/删除。
6. Scheduler 在睡眠后补跑错过任务。

这些能力需要后续 API 或明确产品设计后再接入。
