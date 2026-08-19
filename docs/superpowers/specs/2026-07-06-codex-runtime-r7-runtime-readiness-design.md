# Codex Runtime R7 Runtime Readiness 设计

## 1. 背景

R0-R6 已经让 Agent Runtime 具备 run、SSE、thread/resume、profile、skills、MCP 和 scheduler 的后端能力。R7 不代表产品发布、部署或 UI 交付，而是对 Runtime 后端做第一版可长期运行收口：

1. 出问题时能导出足够的诊断信息。
2. 诊断导出不会轻易泄漏 token、secret、auth header、MCP env value。
3. Runtime 自己产生的本地数据可以安全预览和确认清理。
4. 有明确的 readiness 验收命令，供后续 UI/桌面壳依赖。

因此 R7 命名为：

**Runtime Readiness：诊断、安全导出和本地清理收口。**

## 2. 目标

第一版 R7 需要完成：

1. 增强 `/runs/:id/diagnostics` JSON API。
2. 默认诊断包包含：
   - `meta.json`
   - `events.ndjson`
   - `stderr.redacted.log`
   - `diagnostics.json`
   - `codexStatusSnapshot`
3. `raw.redacted.ndjson` 默认不导出，只有 `includeRawRedacted=true` 时导出。
4. 诊断导出层对所有文件内容做二次脱敏。
5. 增加 Runtime 本地清理 dry-run API。
6. 增加 Runtime 本地清理 confirm delete API。
7. 清理只允许作用于 Runtime 自己生成的 `dataDir`：
   - `dataDir/runs/run_*`
   - `dataDir/workspaces/thread_*`
8. 所有删除必须先 dry-run，再显式 `confirm=true`。
9. 补齐自动化测试和 readiness 命令。

## 3. 非目标

第一版 R7 不做：

1. 产品发布、打包、部署。
2. UI。
3. zip 诊断包导出。
4. 未脱敏 raw/stderr 保存或导出模式。
5. 后台自动定时清理。
6. daemon 启动时自动清理。
7. external cwd 清理。
8. 用户项目目录清理。
9. 用户全局 `~/.codex` 清理。
10. SQLite 历史记录删除。
11. 按 ID 删除作为主路径。

## 4. 当前实现基线

当前已有：

1. `apps/daemon/src/api/routes.diagnostics.ts`
   - `collectRunDiagnostics(dataDir, runId)`
   - `GET /runs/:id/diagnostics`
2. 现有诊断导出默认收集：
   - `meta.json`
   - `events.ndjson`
   - `stderr.redacted.log`
   - `diagnostics.json`
3. 已有 path traversal 和 symlink 防护。
4. 已有 diagnostics integration tests。
5. `raw.redacted.ndjson` 已落盘，但当前不进入诊断包。
6. harness 已有 `diagnostics --output`，可把 JSON 结果写到本地文件。

缺口：

1. 没有 `codexStatusSnapshot`。
2. 没有 `includeRawRedacted` 参数。
3. 导出层没有集中二次脱敏模块。
4. 合法但不存在的 run 当前返回空 files，不利于 UI 区分错误。
5. 没有清理 API。
6. 没有本地 Runtime 数据 retention/dry-run 语义。

## 5. 总体架构

R7 拆成四个后端模块，API 层只负责参数解析、鉴权后调用 service、错误映射。

### 5.1 DiagnosticsCollector

职责：

1. 校验 `runId` 格式。
2. 通过 repository 确认 run 是否存在。
3. 限定读取范围在 `dataDir/runs/<runId>`。
4. 默认读取允许文件：
   - `meta.json`
   - `events.ndjson`
   - `stderr.redacted.log`
   - `diagnostics.json`
5. 当 `includeRawRedacted=true` 时额外读取：
   - `raw.redacted.ndjson`
6. 对缺失文件返回 warning，不让整个诊断请求失败。
7. 拒绝 path traversal、symlink、非文件对象和 realpath 越界。

### 5.2 DiagnosticsRedactor

职责：

1. 对诊断导出的所有文本内容再跑一次脱敏。
2. 第一版复用现有 `redactText()`，不另起一套规则。
3. 处理方式为“文件内容作为文本输入 -> 脱敏文本输出”。
4. 不承诺识别所有秘密，响应中固定返回 best-effort warning。

设计理由：

1. Runtime 落盘层已经做了 redaction，但导出是新的安全边界，需要二次防护。
2. 结构化 JSON redaction 可以后续增强，第一版不牺牲稳定性。

### 5.3 CodexStatusSnapshotProvider

职责：

1. 生成诊断导出时刻的 Codex 状态快照。
2. 输出字段沿用 `/codex/status` 的稳定结构：
   - `codexBin`
   - `codexVersion`
   - `codexHome`
   - `codexHomeMode`
   - `codexHomeSource`
   - `codexHomeWritable`
   - `capabilities`
   - `diagnostics`
3. 快照是导出时刻状态，不等同于 run 启动时状态。

run 启动时的 `codexBin/codexHome/codexVersion` 仍以 run metadata 和 DB 快照为准。

### 5.4 CleanupService

职责：

1. 扫描 Runtime 可清理对象。
2. 只扫描：
   - `dataDir/runs`
   - `dataDir/workspaces`
3. 只接受 Runtime 命名规则：
   - `run_*`
   - `thread_*`
4. dry-run 返回候选项、路径、大小、最后修改时间和原因。
5. confirm delete 执行删除。
6. 删除前重新扫描，不信任历史 preview 结果。
7. 删除失败不导致整个请求失败，失败项进入 `failed[]`。
8. 不删除 SQLite 记录。

### 5.5 模块依赖

模块依赖保持显式传入，避免读取全局状态：

1. `DiagnosticsCollector`
   - `dataDir`
   - run repository
2. `DiagnosticsRedactor`
   - redaction function，第一版使用现有 `redactText()`
3. `CodexStatusSnapshotProvider`
   - `codexBin`
   - resolved Codex home
   - capability matrix
4. `CleanupService`
   - `dataDir`
   - run repository
   - thread repository
   - clock

## 6. API 设计

### 6.1 增强诊断 API

```http
GET /runs/:id/diagnostics?includeRawRedacted=false
```

响应：

```json
{
  "runId": "run_xxx",
  "files": [
    { "name": "meta.json", "content": "..." },
    { "name": "events.ndjson", "content": "..." },
    { "name": "stderr.redacted.log", "content": "..." },
    { "name": "diagnostics.json", "content": "..." }
  ],
  "codexStatusSnapshot": {
    "codexBin": "codex",
    "codexVersion": "unknown",
    "codexHome": "/Users/example/.codex",
    "codexHomeMode": "global",
    "codexHomeSource": "default",
    "codexHomeWritable": false,
    "capabilities": {},
    "diagnostics": []
  },
  "warnings": [
    "Diagnostics are redacted on a best-effort basis."
  ]
}
```

行为：

1. `includeRawRedacted` 缺省为 `false`。
2. `includeRawRedacted=true` 时附加 `raw.redacted.ndjson`。
3. 非法 run id 返回 `400 VALIDATION_FAILED`。
4. 合法但不存在的 run 返回 `404 RUN_NOT_FOUND`。
5. run 存在但部分文件缺失返回 `200`，并在 `warnings[]` 中说明。
6. 所有导出文件内容都经过二次脱敏。

### 6.2 清理预览 API

```http
GET /runtime/cleanup/preview?olderThanDays=30
```

响应：

```json
{
  "olderThanDays": 30,
  "items": [
    {
      "type": "run_logs",
      "id": "run_xxx",
      "path": "/runtime/data/runs/run_xxx",
      "sizeBytes": 12345,
      "lastModifiedAt": "2026-07-06T00:00:00.000Z",
      "reason": "run logs older than 30 days"
    },
    {
      "type": "managed_thread_workspace",
      "id": "thread_xxx",
      "path": "/runtime/data/workspaces/thread_xxx",
      "sizeBytes": 98765,
      "lastModifiedAt": "2026-07-06T00:00:00.000Z",
      "reason": "archived managed thread workspace older than 30 days"
    }
  ],
  "totalSizeBytes": 111110,
  "warnings": []
}
```

规则：

1. `olderThanDays` 必须是正整数。
2. 只返回 Runtime-owned 候选项。
3. active thread 的 managed workspace 不返回。
4. external workspace 不返回。
5. 非 `run_*` / `thread_*` 命名目录不返回。
6. 路径或 realpath 校验失败的候选项不返回，并记录 warning。

### 6.3 确认清理 API

```http
POST /runtime/cleanup
```

请求：

```json
{
  "olderThanDays": 30,
  "confirm": true
}
```

响应：

```json
{
  "deleted": [
    {
      "type": "run_logs",
      "id": "run_xxx",
      "path": "/runtime/data/runs/run_xxx",
      "sizeBytes": 12345
    }
  ],
  "failed": [],
  "totalDeletedBytes": 12345,
  "warnings": []
}
```

行为：

1. `confirm !== true` 返回 `400 VALIDATION_FAILED`。
2. 执行前重新扫描候选项。
3. 删除只作用于重新扫描出的安全候选项。
4. 单项删除失败进入 `failed[]`。
5. 删除完成后不删除 DB 记录。
6. 被清理 run 的 diagnostics API 后续仍可返回 `200`，但 `files` 可能为空并带 warning，因为 run 记录仍存在。

## 7. 清理候选判定

### 7.1 run 日志

候选路径：

```text
dataDir/runs/run_*
```

必须满足：

1. 目录名匹配 `run_*`。
2. realpath 位于 `dataDir/runs` 下。
3. 目录不是 symlink。
4. DB 中存在对应 run。
5. run 非 active 状态：
   - 非 `queued`
   - 非 `running`
   - 非 `canceling`
6. `lastModifiedAt` 早于 `now - olderThanDays`。

`lastModifiedAt` 第一版使用目录树最大 mtime。这样即使某个诊断文件最近被写入，也不会被错误清理。

### 7.2 managed thread workspace

候选路径：

```text
dataDir/workspaces/thread_*
```

必须满足：

1. 目录名匹配 `thread_*`。
2. realpath 位于 `dataDir/workspaces` 下。
3. 目录不是 symlink。
4. DB 中存在对应 thread。
5. thread `workspaceMode = managed`。
6. thread `status = archived`。
7. `lastModifiedAt` 早于 `now - olderThanDays`。

明确不清理：

1. active thread workspace。
2. external cwd。
3. 不在 `dataDir/workspaces` 下的任何目录。
4. 非 `thread_*` 命名目录。

## 8. 安全设计

文件读取和删除必须同时做：

1. ID 格式校验。
2. `resolve()` 路径规整。
3. `realpathSync()` 边界校验。
4. symlink 拒绝。
5. 文件/目录类型校验。
6. Runtime 命名规则校验。

脱敏策略：

1. 落盘层仍保留现有 redaction。
2. 导出层再次调用 `redactText()`。
3. `raw.redacted.ndjson` 默认不导出。
4. 响应保留 best-effort 脱敏 warning。
5. 不提供未脱敏 raw/stderr 模式。

权限边界：

1. 所有新增 API 继续走现有 bearer token 鉴权。
2. 不新增无需认证的诊断或清理接口。
3. 清理接口不接收任意 path 参数。
4. 清理接口不清理 `~/.codex`。

## 9. 错误处理

错误码：

| 错误码 | HTTP | 场景 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 参数非法，例如 run id、olderThanDays、confirm |
| `RUN_NOT_FOUND` | 404 | 诊断目标 run 不存在 |
| `CLEANUP_FAILED` | 500 | 清理 service 非预期失败 |
| `INTERNAL_ERROR` | 500 | 未分类内部错误 |

局部失败策略：

1. 单个诊断文件缺失不导致请求失败，进入 `warnings[]`。
2. 单个清理候选删除失败不导致请求失败，进入 `failed[]`。
3. 越界路径、symlink、非 Runtime 命名目录一律跳过，并记录 warning。

## 10. 测试计划

### 10.1 单元测试

新增或扩展：

1. `apps/daemon/test/unit/diagnostics-collector.test.ts`
2. `apps/daemon/test/unit/diagnostics-redactor.test.ts`
3. `apps/daemon/test/unit/cleanup-service.test.ts`

覆盖：

1. 默认诊断文件列表不包含 `raw.redacted.ndjson`。
2. `includeRawRedacted=true` 包含 `raw.redacted.ndjson`。
3. 非法 run id 拒绝。
4. path traversal 拒绝。
5. symlink 拒绝。
6. 文件缺失返回 warning。
7. 二次脱敏能处理 token、secret、Authorization header、MCP env value。
8. dry-run 列出过期 run 日志。
9. dry-run 只列出 archived managed thread workspace。
10. active thread workspace 不列出。
11. external cwd 不列出。
12. 非 `run_*` / `thread_*` 目录不列出。
13. `confirm=false` 或缺失时返回 `400 VALIDATION_FAILED`，且不删除。
14. confirm=true 删除候选目录。
15. 删除失败进入 `failed[]`。

### 10.2 集成测试

扩展：

1. `apps/daemon/test/integration/diagnostics.test.ts`
2. `apps/daemon/test/integration/api.test.ts`

覆盖：

1. `GET /runs/:id/diagnostics` 返回增强诊断包。
2. 未授权仍返回 401。
3. `includeRawRedacted` 默认关闭。
4. 显式开启后包含 `raw.redacted.ndjson`。
5. 不存在 run 返回 404。
6. 非法 run id 返回 400。
7. `codexStatusSnapshot` 进入响应。
8. 导出层二次脱敏生效。
9. `GET /runtime/cleanup/preview` 参数校验。
10. preview 只返回 Runtime-owned 候选项。
11. active/external 对象跳过。
12. `POST /runtime/cleanup` 无 `confirm=true` 拒绝。
13. confirm 后删除文件系统目录。
14. confirm 后不删除 DB 记录。
15. 删除后的 run diagnostics 返回 200 + warning/files 缺失。

### 10.3 Readiness 命令

R7 完成时必须运行：

```bash
pnpm typecheck
pnpm test
pnpm --filter @opencreator/daemon test -- test/integration/diagnostics.test.ts
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
git diff --check
```

可选真实 Codex gate：

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"
```

## 11. 完成口径

R7 完成后可以表述为：

> Runtime 后端已经具备第一版诊断导出、导出层脱敏、本地 Runtime 数据清理和 readiness 验收能力，可以作为后续 UI/桌面壳的基础后端继续推进。

不能表述为：

1. 完整产品发布完成。
2. 所有平台发布完成。
3. 所有敏感信息都能 100% 脱敏。
4. 自动清理已经完成。
5. 未脱敏 raw 诊断模式已完成。

## 12. 后续扩展

R7 第一版之后可以单独设计：

1. zip 诊断包导出。
2. 按 run/thread ID 精确清理。
3. 后台自动清理。
4. daemon 启动时清理一次。
5. 未脱敏 raw 显式诊断模式。
6. SQLite 历史裁剪和 vacuum 策略。
7. UI 的诊断包下载和清理确认交互。
