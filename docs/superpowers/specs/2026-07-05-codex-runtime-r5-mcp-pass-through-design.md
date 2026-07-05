# Codex Runtime R5 MCP Pass-through 设计

## 1. 状态

状态：草案，等待实施计划。

本设计补充 `2026-07-03-codex-native-runtime-contract-design.md` 的 R5 里程碑。R5 只处理 Codex 原生 MCP server 的接入、管理、诊断和审计，不实现自研 MCP runtime、企业 MCP Gateway、MCP 市场或 UI 管理界面。

## 2. 目标

R5 第一版目标：

1. 通过 Runtime API 调用 `codex mcp list/get/add/remove/login/logout`。
2. 正确接入 Codex 原生 MCP 配置，使新 run 能由 Codex 自己发现和使用 MCP server。
3. 支持 stdio MCP server：`codex mcp add <name> --env KEY=VALUE -- <command> <args...>`。
4. 在当前 Codex CLI 支持时，支持 URL、bearer token env var 和 OAuth 参数。
5. API 展示 MCP server 的 name、transport、command、args、url、env key、状态和 diagnostics。
6. env value 在 API、日志、operation record、raw stdout/stderr 摘要中全部脱敏。
7. 全局 `CODEX_HOME` 写操作必须显式确认。
8. MCP 管理命令使用独立短超时，默认 30 秒。
9. 写操作和登录操作记录到 SQLite 操作日志。
10. 为后续 UI 提供稳定 API，但 R5 不实现 UI。
11. 使用 fake Codex 自动化覆盖成功、失败、超时、not found 和脱敏。
12. 使用 gated 真实 Codex smoke 验证 `codex mcp` 原生命令形态；真实模型使用 MCP 如受 auth 阻塞，明确标记 `BLOCKED_ENV`。

## 3. 非目标

R5 第一版不做：

1. 不实现自研 MCP runtime。
2. 不托管 MCP server 进程。
3. 不实现企业 MCP Gateway。
4. 不实现 MCP marketplace 或远程安装源。
5. 不解析 MCP 协议细节。
6. 不直接把 SQLite 作为 MCP 配置真相源。
7. 不把 MCP tool event 完整结构化可视化列为硬验收。
8. 不要求真实模型必须成功调用工具，除非当前机器 Codex auth 已恢复。
9. 不做 UI。

## 4. 设计决策

### 4.1 Codex 原生命令是写入路径

MCP 配置的真相源是 Codex 原生配置和 `codex mcp` 命令。Runtime 不直接手写 `config.toml` 的 MCP 段作为默认路径。

这样可以继承 Codex CLI 自身的参数校验、merge、dedupe、迁移和未来兼容逻辑。Runtime 负责把本地 API 映射为 Codex 命令，并提供参数校验、超时、脱敏、错误映射和审计。

### 4.2 Runtime 只做管理和诊断，不实现 MCP runtime

Runtime 不解释 MCP 协议，不承接工具调用，不模拟 MCP server。run 期间 MCP 能否被模型调用，由 Codex CLI 原生能力负责。

如果 Codex JSONL 中出现 MCP 或 tool 相关事件，R5 可以把它归类为 diagnostic 或 unknown event，并保证不泄漏 env value。完整工具名、入参摘要、结果摘要和错误摘要可作为后续增强，不作为 R5 第一版完成条件。

### 4.3 能力由 Codex help gate 决定

R5 不猜测 Codex CLI 参数。启动或 `/codex/status` 能力采集时读取：

```bash
codex mcp --help
codex mcp add --help
```

能力矩阵至少表达：

```ts
type RuntimeMcpCapabilities = {
  mcpList: boolean;
  mcpGet: boolean;
  mcpAdd: boolean;
  mcpRemove: boolean;
  mcpLogin: boolean;
  mcpLogout: boolean;
  mcpAddEnv: boolean;
  mcpAddUrl: boolean;
  mcpAddBearerTokenEnvVar: boolean;
  mcpAddOAuth: boolean;
  mcpRuntimeDiscoveryVerified: boolean;
  mcpRuntimeBehaviorVerified: boolean;
};
```

请求使用当前 Codex 不支持的 flag 时返回 `CODEX_INCOMPATIBLE`，不拼接未知参数。

### 4.4 全局写入需要显式确认

延续 R4 的安全策略。默认 `CODEX_HOME` 是全局或环境路径时，MCP 写操作允许执行，但必须传入：

```ts
confirmWriteToCodexHome: true
```

需要确认的操作：

1. `add`
2. `remove`
3. `login`
4. `logout`

只读操作 `list/get` 不需要确认。

### 4.5 SQLite 只记录操作日志

SQLite 不保存 MCP server 配置真相源。MCP 是否存在、配置内容是什么，以 `codex mcp list/get` 的结果为准。

SQLite 只记录操作日志，便于审计和后续 UI 展示。

## 5. 模块边界

建议新增模块：

```text
apps/daemon/src/api/routes.mcp.ts
apps/daemon/src/codex/mcp/argv.ts
apps/daemon/src/codex/mcp/manager.ts
apps/daemon/src/codex/mcp/parser.ts
apps/daemon/src/codex/mcp/runner.ts
apps/daemon/src/codex/mcp/operations.ts
apps/daemon/src/codex/mcp/types.ts
apps/daemon/src/codex/mcp/validator.ts
```

现有 `apps/daemon/src/codex/mcp.ts` 的 argv helper 可以迁移到 `codex/mcp/argv.ts`，或保留兼容导出后由新模块复用。

职责：

| 模块 | 职责 |
|---|---|
| `routes.mcp.ts` | HTTP 请求校验、错误码映射、响应组装 |
| `argv.ts` | 构造 `codex mcp` 参数，不做 shell 拼接 |
| `runner.ts` | 执行 `codex mcp`，处理 timeout、stdout/stderr、exit code 和脱敏 |
| `parser.ts` | 容错解析 `list/get` 输出 |
| `manager.ts` | MCP 用例入口，协调 validator、runner、parser、operations |
| `operations.ts` | SQLite 操作日志 repository |
| `types.ts` | daemon 内部类型 |
| `validator.ts` | name、env key、transport、url、command、args 校验 |

`buildServer` 创建 `mcpManager` 并注册 `registerMcpRoutes`。

## 6. API 设计

### 6.1 `GET /codex/mcp`

返回当前 `CODEX_HOME` 下 Codex 可见的 MCP server 列表。优先调用：

```bash
codex mcp list
```

如果当前 Codex 版本没有稳定 list 输出，返回空列表或部分解析结果，并在 diagnostics 中说明解析限制。`list` 失败不影响 `get/add/remove` 的可用性。

```ts
type CodexMcpListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  requiresWriteConfirmation: boolean;
  servers: CodexMcpServerResponse[];
  diagnostics: string[];
};
```

### 6.2 `GET /codex/mcp/:name`

调用：

```bash
codex mcp get <name>
```

规则：

1. exit 0 表示 server 存在。
2. exit 非 0 且输出含 not found、not configured、missing 等模式，返回 `MCP_SERVER_NOT_FOUND`。
3. exit 非 0 且不是 not found，返回 `MCP_COMMAND_FAILED`。
4. 输出无法完整解析时仍返回 `status: "unknown"` 和脱敏 raw 摘要。

### 6.3 `POST /codex/mcp/add`

添加 MCP server。

```ts
type AddCodexMcpRequest =
  | {
      name: string;
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: "http" | "sse";
      url: string;
      env?: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };
```

stdio 命令形态：

```bash
codex mcp add <name> --env KEY=VALUE -- <command> <args...>
```

URL/OAuth 命令形态按 capability gate 决定：

```bash
codex mcp add <name> --url <url>
codex mcp add <name> --bearer-token-env-var <ENV_NAME> --url <url>
codex mcp add <name> --oauth-client-id <id> --oauth-resource <resource> --url <url>
```

成功后可以调用 `get` 刷新展示；如果 `get` 输出不可解析，返回 add operation 和 diagnostics。

### 6.4 `DELETE /codex/mcp/:name`

调用：

```bash
codex mcp remove <name>
```

全局写入需要：

```http
DELETE /codex/mcp/:name?confirmWriteToCodexHome=true
```

不存在返回 `MCP_SERVER_NOT_FOUND`，其它非 0 退出返回 `MCP_COMMAND_FAILED`。

### 6.5 `POST /codex/mcp/:name/login`

调用：

```bash
codex mcp login <name>
```

第一版只做命令封装、超时、错误和日志。该命令可能需要浏览器或交互流程，R5 不承诺 UI 交互闭环。需要交互但当前环境无法完成时返回 `MCP_COMMAND_FAILED`，diagnostics 中保留脱敏 stdout/stderr 摘要。

### 6.6 `POST /codex/mcp/:name/logout`

调用：

```bash
codex mcp logout <name>
```

### 6.7 `GET /codex/mcp/operations`

返回 MCP 操作日志。

```ts
type CodexMcpOperationListResponse = {
  operations: CodexMcpOperationResponse[];
};
```

查询参数：

```text
limit: 默认 50，最大 200
```

## 7. 响应模型

```ts
type CodexMcpTransport = "stdio" | "http" | "sse" | "unknown";
type CodexMcpStatus = "configured" | "missing" | "invalid" | "unknown";

type CodexMcpServerResponse = {
  name: string;
  transport: CodexMcpTransport;
  status: CodexMcpStatus;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  hasSecrets: boolean;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  diagnostics: string[];
  raw?: string;
};
```

规则：

1. `envKeys` 只返回 key，不返回 value。
2. `hasSecrets` 表示配置或命令中存在 env value 或 token 类信息。
3. `raw` 必须脱敏后返回。
4. parser 不能识别完整结构时，`transport` 使用 `unknown`，`status` 使用 `unknown` 或 `configured`。

操作日志响应：

```ts
type CodexMcpOperationType =
  | "add"
  | "remove"
  | "login"
  | "logout"
  | "get"
  | "list";

type CodexMcpOperationStatus = "succeeded" | "failed";

type CodexMcpOperationResponse = {
  id: string;
  operation: CodexMcpOperationType;
  serverName?: string;
  codexHome: string;
  command: string[];
  status: CodexMcpOperationStatus;
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};
```

`command` 必须是脱敏后的 argv，例如：

```text
codex mcp add github --env GITHUB_TOKEN=[REDACTED] -- node server.js
```

## 8. SQLite 操作日志

新增表：

```sql
CREATE TABLE IF NOT EXISTS codex_mcp_operations (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  server_name TEXT,
  codex_home TEXT NOT NULL,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL,
  exit_code INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_codex_mcp_operations_created_at
  ON codex_mcp_operations(created_at);
```

约束：

1. `command_json` 保存脱敏 argv。
2. 不保存 env value。
3. `get/list` 可以记录为只读操作，也可以只记录写操作。第一版建议记录全部 MCP API 命令，便于排查 Codex 输出格式问题。
4. 日志不是 MCP 配置真相源。

## 9. 命令执行

统一使用 `McpCommandRunner`。

```ts
type McpCommandResult = {
  command: string[];
  redactedCommand: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  redactedStdout: string;
  redactedStderr: string;
  timedOut: boolean;
  errorMessage?: string | null;
};
```

执行规则：

1. 使用 `spawnSync` 或小型 async runner 执行 `codex`，不经 shell。
2. 默认 timeout 为 30 秒。
3. env 继承 daemon env，并显式设置 `CODEX_HOME`。
4. cwd 使用 daemon cwd，不从用户请求透传。
5. stdin 默认关闭。
6. stdout/stderr 分离保存。
7. 所有进入 API、log、diagnostics 的输出先脱敏。
8. timeout 返回 `timedOut: true`，HTTP 映射为 `504 MCP_COMMAND_FAILED`。

## 10. 解析策略

`codex mcp` 输出格式可能随 Codex 版本变化，parser 必须容错。

解析顺序：

1. 如果未来 Codex 支持 JSON 输出，优先解析 JSON。
2. 当前文本输出按行解析常见字段，如 name、command、args、url、env。
3. `get <name>` exit 0 是存在的最强信号。
4. `get <name>` exit 非 0 且输出匹配 not found、not configured、missing，映射为 missing。
5. 无法解析结构时仍返回脱敏 raw 摘要和 diagnostics。

parser 不允许因为输出格式未知而让 daemon 崩溃。

## 11. 参数校验和安全

### 11.1 name

MCP server name：

```text
^[A-Za-z0-9._-]{1,80}$
```

非法 name 返回 `VALIDATION_FAILED`。

### 11.2 env

env key：

```text
^[A-Za-z_][A-Za-z0-9_]*$
```

env value 允许空字符串，但不得在响应或日志中明文出现。

### 11.3 command 和 args

stdio command 必须是非空字符串。args 必须是字符串数组。

Runtime 不接受单个 shell command line，不做 shell 拼接。

### 11.4 url

URL transport 只允许：

1. `http:`
2. `https:`

其它协议返回 `VALIDATION_FAILED`。

### 11.5 脱敏

需要脱敏的位置：

1. API response
2. operation log
3. diagnostics
4. raw stdout/stderr
5. test fixture

脱敏规则：

1. `--env KEY=value` 中 value 替换为 `[REDACTED]`。
2. `KEY=value` 且 key 含 `TOKEN`、`SECRET`、`KEY`、`PASSWORD` 时替换 value。
3. URL query 中的 token、key、secret、password 参数替换 value。
4. bearer token 或 Authorization 字样后面的值替换。

## 12. 错误码

新增错误码：

```ts
| "MCP_SERVER_NOT_FOUND"
| "MCP_SERVER_EXISTS"
| "MCP_SERVER_INVALID"
| "MCP_WRITE_CONFIRMATION_REQUIRED"
```

保留并继续使用：

```ts
| "MCP_COMMAND_FAILED"
| "CODEX_INCOMPATIBLE"
| "VALIDATION_FAILED"
```

HTTP 映射：

| 场景 | HTTP | 错误码 |
|---|---:|---|
| 请求体或参数非法 | 400 | `VALIDATION_FAILED` |
| server 不存在 | 404 | `MCP_SERVER_NOT_FOUND` |
| add 已存在且 Codex 明确报冲突 | 409 | `MCP_SERVER_EXISTS` |
| 全局写入缺确认 | 409 | `MCP_WRITE_CONFIRMATION_REQUIRED` |
| 本地 MCP 参数语义非法 | 422 | `MCP_SERVER_INVALID` |
| 当前 Codex 不支持请求 flag | 501 | `CODEX_INCOMPATIBLE` |
| `codex mcp` 非 0 且非已知用户错误 | 502 | `MCP_COMMAND_FAILED` |
| `codex mcp` timeout | 504 | `MCP_COMMAND_FAILED` |

## 13. 测试方案

### 13.1 自动化测试

必须新增或扩展：

1. `apps/daemon/test/unit/mcp-argv.test.ts`
2. `apps/daemon/test/unit/codex-mcp-validator.test.ts`
3. `apps/daemon/test/unit/codex-mcp-runner.test.ts`
4. `apps/daemon/test/unit/codex-mcp-parser.test.ts`
5. `apps/daemon/test/unit/storage.test.ts`
6. `apps/daemon/test/integration/api.test.ts`

覆盖点：

1. `get/list/add/remove/login/logout` argv。
2. stdio `--env` 出现在 `--` 前。
3. URL/OAuth flag 受 capability gate 控制。
4. name、env key、url、command、args 校验。
5. runner timeout、非 0、stdout/stderr 分离、`CODEX_HOME` 注入。
6. command/stdout/stderr 脱敏。
7. parser 解析常见输出、not found、未知格式。
8. migration 创建 `codex_mcp_operations`。
9. operation insert/list/limit。
10. API auth、validation、成功路径、错误映射、全局写确认、env 不泄漏。

### 13.2 fake Codex 测试

fake Codex binary 必须模拟：

1. `codex mcp list`
2. `codex mcp get <name>`
3. `codex mcp add`
4. `codex mcp remove`
5. `codex mcp login`
6. `codex mcp logout`
7. timeout
8. non-zero
9. malformed output
10. not found
11. secret 泄漏输出

fake Codex 是 R5 的主验收手段，因为真实 Codex auth 当前可能不可用。

### 13.3 gated 真实 Codex smoke

扩展 `apps/daemon/test/smoke/real-codex-smoke.test.ts`：

1. `codex mcp --help`
2. `codex mcp add --help`
3. isolated `CODEX_HOME` 下添加本地 fake stdio MCP server
4. `codex mcp get <name>` 能探测到
5. `codex mcp remove <name>` 能移除
6. 可选：运行 `codex exec --json` 让模型尝试使用该 MCP

验收口径：

1. MCP 管理命令 add/get/remove 能在 isolated `CODEX_HOME` 下通过时，标 `PASS`。
2. `codex exec` 使用 MCP 需要真实模型 auth；当前如果 401 或 token 过期，标 `BLOCKED_ENV`。
3. runtime tool event 结构化解析不作为 R5 第一版硬验收。

## 14. Done Definition

R5 完成需要满足：

1. Runtime API 能添加、查看、删除、login/logout MCP server。
2. stdio MCP env 能传给 Codex，但 API/log 不泄漏 value。
3. 全局 `CODEX_HOME` 写操作必须显式确认。
4. Codex MCP 命令超时和失败有清晰错误码。
5. SQLite 有 MCP 操作审计日志。
6. `/codex/status` 能展示 MCP capability。
7. fake Codex 自动化覆盖成功、失败、超时、not found、脱敏。
8. gated real Codex smoke 至少验证 `codex mcp add/get/remove` 原生命令形态。
9. 模型 run 使用 MCP 如因 auth 失败，明确标记 `BLOCKED_ENV`。
10. 覆盖报告更新：R5 从 `PARTIAL/MISSING_IMPL` 改为 `PASS` 或 `PARTIAL/BLOCKED_ENV`，不能夸大真实模型验证。

## 15. 实施顺序建议

1. 协议类型、错误码和 capability matrix。
2. validator 和 argv builder。
3. runner 和脱敏。
4. parser。
5. SQLite operation repository。
6. manager。
7. API routes 和 server wiring。
8. fake Codex API 集成测试。
9. gated real Codex MCP smoke。
10. 覆盖报告更新。

这个顺序优先稳定参数、命令和脱敏，再暴露 API，最后做真实 smoke。不要先做 UI，也不要先写 `config.toml` MCP 段作为捷径。
