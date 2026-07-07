# Codex Runtime 已实现功能回归测试方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans when turning this plan into new automated tests. 本文当前用途是执行现有实现的功能验收，不要求补未实现功能。

**Goal:** 只验证当前代码已经实现的 Codex Runtime 后端能力，确认 R-1 子集、R0/R1 和 R2 后端最小闭环在当前环境可用。

**Architecture:** 测试分四层执行：静态检查、fake Codex 自动化、real Codex gated smoke、本地 daemon + harness E2E。验收结果只对已实现功能负责，不把 UI、Profile 管理、Skills 管理、MCP 管理、Scheduler CRUD 等未实现项计入本轮失败。

**Tech Stack:** pnpm, Vitest, TypeScript, Fastify inject, fake Codex helper, real Codex CLI, harness CLI, temporary workspace.

---

## 1. 本轮测试范围

### 1.1 纳入验收的已实现功能

| 功能区 | 验收能力 | 主要测试入口 |
|---|---|---|
| Protocol shape | API 类型、错误码、事件 envelope 的基础兼容 | `apps/daemon/test/unit/protocol-shape.test.ts` |
| Storage schema | runs、threads、run_events、diagnostics 基础持久化和 migration | `apps/daemon/test/unit/storage.test.ts` |
| Codex argv | `codex exec`、`codex exec resume`、MCP argv helper | `codex-argv.test.ts`, `mcp-argv.test.ts` |
| Codex capability | help parser、resume capability gate、`/codex/status` 注入矩阵 | `codex-capabilities.test.ts`, `api.test.ts` |
| CODEX_HOME 解析 | 全局、环境变量、隔离路径解析 | `codex-home.test.ts` |
| Event parser/normalizer | JSONL 解析、Runtime 事件归一化、unknown event 降级 | `events.test.ts` |
| Codex runner | stdin prompt、stdout/stderr 分离、spawn fail、timeout、SIGTERM/SIGKILL 兜底 | `codex-runner.test.ts` |
| Run manager | create、success、failure、cancel、timeout、inactivity、orphan、diagnostics、thread run | `run-manager.test.ts` |
| Run API/SSE | auth、run create/list/get/cancel、SSE replay/tail/heartbeat、content-type | `api.test.ts` |
| Thread API | thread create/list/detail/history/archive、配置不可变、codexThreadId 绑定 | `thread-manager.test.ts`, `api.test.ts` |
| Thread resume | auto resume、resume argv、同 thread queue、queued cancel、resume 失败映射 | `run-manager.test.ts`, `api.test.ts`, real smoke |
| Diagnostics | diagnostics 导出、resume metadata、queued cancel metadata、symlink 防护 | `diagnostics.test.ts` |
| Scheduler helper | misfire helper 纯函数 | `scheduler.test.ts` |
| Real Codex smoke | version/help、exec JSONL、command execution、resume context continuity | `real-codex-smoke.test.ts` |
| Harness CLI | history、run、events、diagnostics 的真实 daemon smoke | 手工 E2E 命令 |

### 1.2 本轮明确排除

以下能力还没有完整实现，不作为本轮“功能失败”判断：

1. UI / 桌面壳。
2. messages 表和完整 Chat transcript 产品模型。
3. Profile / Settings CRUD、配置写锁、原子写入、备份和缓存同步。
4. Skills scan/install/delete/pass-through 管理。
5. MCP 管理 API、真实 `codex mcp add/remove/login/logout` pass-through。
6. Scheduler CRUD、run-now、cron、timezone、DST、concurrency policy。
7. workspace 全局写锁。
8. 可提交的版本化 real Codex fixture。
9. usage/failure/sandbox/image 的完整真实 Codex ABI 矩阵。
10. 进程树强杀专项和多平台矩阵。

## 2. 测试环境要求

| 项目 | 要求 |
|---|---|
| Node/pnpm | 使用仓库当前 lockfile 支持的版本，命令通过 `pnpm` 执行 |
| Codex CLI | `codex` 必须在 PATH 中可执行 |
| CODEX_HOME | 默认复用当前用户 Codex 环境；本轮只跑非破坏性 smoke |
| Workspace | harness E2E 使用临时目录，并使用 `read-only` sandbox |
| 网络/认证 | real Codex smoke 依赖当前 Codex 登录态和模型可用性 |

如果 real Codex 因外部认证、网络或额度失败，自动化单元/集成测试仍可判断 Runtime 后端逻辑，但本轮真实 ABI 状态必须标记为 `BLOCKED_ENV` 或 `FAIL_REAL_CODEX_SMOKE`。

## 3. 执行命令

### 3.1 静态和自动化基线

```bash
pnpm typecheck
pnpm test
```

通过标准：

1. `pnpm typecheck` exit code 为 0。
2. `pnpm test` exit code 为 0。
3. daemon 当前应显示 95 个测试通过，real Codex smoke 默认 skipped。

### 3.2 受影响功能专项回归

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/codex-capabilities.test.ts \
  test/integration/api.test.ts \
  test/integration/run-manager.test.ts \
  test/integration/diagnostics.test.ts
```

通过标准：

1. capability parser、`/codex/status`、resume gate 相关测试通过。
2. Run API、Thread API、auto resume、queue、diagnostics 相关测试通过。
3. 不出现 flaky timeout 或未处理 promise。

### 3.3 Real Codex gated smoke

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

通过标准：

1. `codex --version`、`codex exec --help`、`codex exec resume --help`、`codex mcp --help`、`codex mcp add --help` 均 exit 0。
2. 最小 `codex exec --json` stdout 每行可解析为 JSON。
3. command execution smoke 能观察到 `command_execution` 事件。
4. resume smoke 第一轮捕获 `thread.started.thread_id`。
5. resume smoke 第二轮回复包含第一轮 marker。
6. resume smoke 无 malformed JSONL，且本测试场景无工具/命令事件。

### 3.4 本地 daemon + harness E2E

启动 daemon：

```bash
pnpm daemon:dev
```

记录 stdout JSON 中的 `address` 和 `token`，设置环境变量：

```bash
export CLAWEE_DAEMON_URL="<address>"
export CLAWEE_DAEMON_TOKEN="<token>"
export CLAWEE_TEST_CWD="$(mktemp -d)"
```

执行 smoke：

```bash
pnpm harness history --limit 5
pnpm harness run --cwd "$CLAWEE_TEST_CWD" --sandbox read-only --prompt "Reply with OK only."
pnpm harness events <run_id> --after-seq 0
pnpm harness diagnostics <run_id> --output "$CLAWEE_TEST_CWD/diagnostics.json"
```

另用 curl 验证鉴权和 status：

```bash
curl -sS "$CLAWEE_DAEMON_URL/healthz"
curl -sS -H "authorization: Bearer $CLAWEE_DAEMON_TOKEN" "$CLAWEE_DAEMON_URL/codex/status"
curl -sS -o /tmp/clawee-unauth.json -w "%{http_code}" "$CLAWEE_DAEMON_URL/runs"
```

通过标准：

1. daemon 能启动并输出 `address`、`token`。
2. `history` 返回 JSON。
3. `run` 返回 `202` 语义的 run JSON，包含 `id`。
4. `events` 能 replay 到 terminal event。
5. `diagnostics --output` 写出 JSON 文件。
6. `/healthz` 无鉴权返回 `{ "ok": true }`。
7. `/codex/status` 鉴权后返回 `codexVersion`、`codexHome`、`capabilities`。
8. 未授权 `/runs` 返回 401。

## 4. 失败分级

| 失败类型 | 含义 | 处理 |
|---|---|---|
| `FAIL_STATIC` | typecheck 失败 | 必须修复后才能继续 |
| `FAIL_FAKE_CODEX` | fake Codex 单元/集成失败 | Runtime 逻辑回归，必须修复 |
| `FAIL_REAL_CODEX_SMOKE` | real Codex smoke 失败 | 先区分环境问题和 ABI 回归 |
| `FAIL_HARNESS_E2E` | daemon/harness smoke 失败 | API 或真实 daemon 组装路径有问题 |
| `BLOCKED_ENV` | 认证、网络、平台导致无法测试 | 记录环境原因，不宣称通过 |

## 5. 最终报告模板

执行完成后输出：

```text
已实现功能回归结论：
- 静态检查：
- 自动化测试：
- Real Codex smoke：
- Harness E2E：

已验证能力：
- ...

未纳入本轮：
- ...

剩余风险：
- ...
```

本轮只有全部命令通过时，才能声明“当前已实现的 R0/R1/R2 后端功能在本机通过回归测试”。不能声明“完整 Codex-native Runtime 全功能完成”。
