# Codex Runtime R3 Profiles / Settings / CODEX_HOME 设计

## 1. 状态

状态：草案，等待实施计划。

本设计补充 `2026-07-03-codex-native-runtime-contract-design.md` 的 R3 里程碑。R0/R1/R2 后端最小闭环已经通过真实 Codex 和真实 daemon 测试；R3 只处理 Profiles / Settings / `CODEX_HOME` 适配，不进入 UI、Skills、MCP 管理或 Scheduler。

## 2. 目标

R3 第一版目标：

1. 明确当前 Runtime 使用的 `CODEX_HOME` 路径、来源、模式和可写性。
2. 读取 Codex 原生 profile 配置。
3. 在全局 `CODEX_HOME` 下只读 profile，禁止写入。
4. 在 isolated `CODEX_HOME` 下允许 profile 创建、编辑、删除。
5. profile 写入必须有写锁、原子写入和备份。
6. profile 配置损坏时 daemon 不崩溃，并能通过 API 返回诊断。
7. profile 修改只影响新 run，不影响已经创建的 run 或 thread。
8. 为后续 UI 提供稳定 API，但本阶段不做 UI。

## 3. 非目标

R3 第一版不做：

1. 不修改用户真实 `$CODEX_HOME` 或 `~/.codex`。
2. 不自动修复全局 `config.toml`。
3. 不实现 Skills 管理。
4. 不实现 MCP 管理 API。
5. 不实现 Scheduler CRUD。
6. 不扫描或展示用户所有 Codex 历史 session。
7. 不实现复杂 base config 修复或 normalize 策略。
8. 不实现桌面 UI。
9. 不把 SQLite 作为 profile 真相源。

## 4. 设计决策

### 4.1 全局 Codex 是生产真相源，隔离只作测试夹具

默认模式继续复用 Codex 原生全局环境：

1. 如果进程环境存在 `$CODEX_HOME`，使用该路径。
2. 否则使用 Codex 默认路径 `~/.codex`。
3. 这两种都属于 `global` 模式。

产品目标不是再管理一套 Clawee profile，而是操作 Codex 原生 profile overlay 文件。全局模式是生产路径，profile 写入最终应该允许，但必须满足：

1. 请求显式确认会写入全局 Codex 环境。
2. 写入前获取 Codex 配置写锁。
3. 写入前备份原文件。
4. 使用临时文件加 rename 的原子写入。
5. 操作失败不能破坏原 profile 或基础 `config.toml`。
6. 操作日志记录影响的 `CODEX_HOME`、profile 名称、备份路径和失败原因。

当前 R3 实现仍把全局 profile 写入作为只读保护并返回 `CODEX_HOME_READ_ONLY`。这只能视为阶段性安全保守实现，不应作为最终产品原则。后续补齐 profiles 写入时，应与 R4 skills、R5 MCP 一样采用“全局可写 + 显式确认 + 备份 + 审计”的策略。

isolated 模式只在 Runtime 测试注入显式 isolated home 时启用。它用于单元/集成测试验证写锁、原子写入、备份和损坏恢复，不作为真实 Codex 可用性的验收环境。

### 4.2 使用 Codex 当前原生 profile overlay 结构

R3 不创建 `profiles/<name>.toml` 这样的第二套 profile 体系。profile 真相源是当前 Codex CLI 原生的 profile overlay 文件：

```text
CODEX_HOME/<profile>.config.toml
```

Codex 0.142.5 的 `codex --help` 显示 `--profile <name>` 会将 `$CODEX_HOME/<name>.config.toml` 叠加到基础用户配置上。实测中旧式 `profile = "<name>"` 或 `[profiles.<name>]` 会被 Codex 拒绝，并提示迁移到 `<name>.config.toml`。

基础 `CODEX_HOME/config.toml` 仍属于 Codex 原生基础配置，但它不是 profile 列表或 profile 真相源。R3 第一版只管理 `<profile>.config.toml` 文件。

示例：

```text
CODEX_HOME/review.config.toml
```

```toml
model = "gpt-5.3-codex"
model_reasoning_effort = "medium"
```

实施必须以真实 Codex 行为为准。R3 ABI smoke 可以用 isolated `CODEX_HOME` 写入 `<name>.config.toml`，再通过真实 Codex CLI 的 `-p <name>` 加载路径验证 profile overlay 文件结构；该 ABI 验证不依赖模型网络请求。真实运行 smoke 必须使用用户当前全局 Codex 环境，不能用空 isolated `CODEX_HOME` 代表生产可用性。

### 4.3 SQLite 是缓存，不是真相源

SQLite 可以保存 profile cache、状态和最后一次扫描时间，但 run 执行仍以 `CODEX_HOME/config.toml` 加 `<profile>.config.toml` overlay 为准。

规则：

1. API 查询 profile 时先轻量扫描当前 `CODEX_HOME/*.config.toml`，排除基础 `config.toml`、临时文件和备份目录。
2. 文件内容和缓存冲突时，以文件内容为准。
3. 基础 `config.toml` 或 profile 文件和缓存冲突时，以文件内容为准。
4. 缓存刷新失败不能导致 daemon 崩溃。
5. run 创建时保存 profile 名称和 Codex 快照，后续 profile 修改不改变历史 run。

## 5. API 设计

### 5.1 `GET /codex/status`

扩展现有响应：

```ts
type CodexStatusResponse = {
  codexBin: string;
  codexVersion: string;
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  codexHomeSource: "env" | "default" | "isolated";
  codexHomeWritable: boolean;
  capabilities: RuntimeCapabilityMatrix;
  diagnostics: string[];
};
```

含义：

| 字段 | 含义 |
|---|---|
| `codexHomeMode` | 当前 Codex home 是否全局或隔离 |
| `codexHomeSource` | 路径来源：环境变量、默认路径或显式 isolated |
| `codexHomeWritable` | 当前 Runtime 是否允许写该 home |

全局模式下 `codexHomeWritable = false`。isolated 模式下 `codexHomeWritable = true`。

### 5.2 `GET /codex/profiles`

返回当前 `CODEX_HOME` 中可识别的 profile 列表。

```ts
type CodexProfileListResponse = {
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  writable: boolean;
  profiles: CodexProfileResponse[];
  diagnostics: string[];
};
```

### 5.3 `GET /codex/profiles/:name`

返回单个 profile。不存在返回 `CODEX_PROFILE_NOT_FOUND`。

### 5.4 `POST /codex/profiles`

只在 isolated 模式允许。创建新 profile。

请求：

```ts
type CreateCodexProfileRequest = {
  name: string;
  config: Record<string, unknown>;
};
```

规则：

1. `name` 只能包含字母、数字、`_`、`-`、`.`。
2. `name` 不能是空字符串。
3. 已存在返回 `CODEX_PROFILE_EXISTS`。
4. 全局模式返回 `CODEX_HOME_READ_ONLY`。

### 5.5 `PATCH /codex/profiles/:name`

只在 isolated 模式允许。替换或 merge profile 配置。

第一版采用全量替换策略：

```ts
type UpdateCodexProfileRequest = {
  config: Record<string, unknown>;
};
```

选择全量替换是为了避免深层 merge 语义不清。后续 UI 可以先读取 profile，再提交完整配置。

### 5.6 `DELETE /codex/profiles/:name`

只在 isolated 模式允许。删除 `<name>.config.toml`。

规则：

1. 不存在返回 `CODEX_PROFILE_NOT_FOUND`。
2. 删除前备份当前 `<name>.config.toml`。
3. 删除后新 run 不再能使用该 profile。

## 6. Profile 响应模型

```ts
type CodexProfileStatus = "valid" | "invalid";

type CodexProfileResponse = {
  name: string;
  status: CodexProfileStatus;
  config: Record<string, unknown>;
  diagnostics: string[];
  source: "<name>.config.toml";
  codexHomeMode: "global" | "isolated";
  updatedAt?: string;
};
```

`status = invalid` 表示 Runtime 能从文件名识别 profile 名称，但 profile overlay TOML 无法安全用于 run。基础 `config.toml` 解析失败时不生成 profile invalid 项，而是在 list 响应 diagnostics 和 run/thread 校验中返回 `CODEX_CONFIG_INVALID`。

## 7. 文件写入策略

R3 引入 Codex profile 写锁。所有写 `CODEX_HOME/<name>.config.toml` 的操作必须串行执行。

写入步骤：

1. 获取写锁。
2. 读取当前 `<name>.config.toml`；create 时文件必须不存在，update/delete 时文件必须存在。
3. 解析基础 `config.toml`；如果基础配置损坏，写操作返回 `CODEX_CONFIG_INVALID`，不尝试自动修复。
4. create/update 时校验并序列化 profile overlay TOML。
5. delete 时不生成新 overlay 文件。
6. 写入同目录临时文件。
7. 重新读取临时文件并解析，确认 TOML 合法。
8. 如果旧 `<name>.config.toml` 存在，备份旧文件。
9. create/update 用 rename 临时文件覆盖正式文件；delete 备份后删除正式文件。
10. 刷新 profile cache。
11. 释放写锁。

备份路径建议：

```text
CODEX_HOME/backups/<name>.config.toml.<timestamp>.bak
```

第一版只要求保留最近一次备份；可以清理更旧备份，也可以先保留多份但不提供管理 API。

## 8. 配置损坏策略

如果 `config.toml` 解析失败：

1. daemon 不崩溃。
2. `GET /codex/profiles` 仍尽量扫描 `<name>.config.toml` profile 列表，并在 diagnostics 中报告基础配置损坏。
3. `GET /codex/profiles/:name` 返回 `CODEX_CONFIG_INVALID`。
4. 写操作返回 `CODEX_CONFIG_INVALID`，不尝试自动修复。
5. 全局模式不提供修复 API。
6. isolated 模式后续可以提供显式 reset/replace，但不进入 R3 第一版。

如果单个 `<name>.config.toml` 解析失败：

1. daemon 不崩溃。
2. `GET /codex/profiles` 返回该 profile，`status = invalid`，并在该 profile 的 diagnostics 中报告解析失败。
3. `GET /codex/profiles/:name` 返回该 profile 及 diagnostics。
4. run/thread 显式指定该 profile 时返回 `CODEX_PROFILE_INVALID`。
5. isolated 写入该 profile 时，create 返回 `CODEX_PROFILE_EXISTS`，update 可以用新的完整配置替换损坏文件，但必须先备份损坏文件。

## 9. Run / Thread 联动

R3 不改变 R2 的 thread 配置固化规则。

规则：

1. independent run 创建时，如果指定 profile，Runtime 在启动前检查该 profile 是否存在且 valid。
2. 未指定 profile 时使用 `default`，但如果 `default` 不存在，不阻止 run；Codex 自身可能仍接受默认 profile。
3. thread 创建时，如果指定 profile，Runtime 检查 profile 是否存在且 valid。
4. thread 创建后，profile 名称固化在 thread 上。
5. profile 后续修改只影响新 run。
6. 已创建 run 的 `codexHome`、`profile`、`codexVersion` 快照不变。

是否强制要求 profile 存在：

| 场景 | 策略 |
|---|---|
| 请求显式指定非 default profile | 必须存在且 valid |
| 请求未指定 profile，使用 default | 不强制存在，交给 Codex 默认行为 |
| thread 指定 profile | 必须存在且 valid |

## 10. 错误码

新增错误码：

```ts
type R3ErrorCode =
  | "CODEX_HOME_READ_ONLY"
  | "CODEX_PROFILE_NOT_FOUND"
  | "CODEX_PROFILE_EXISTS"
  | "CODEX_PROFILE_INVALID"
  | "CODEX_CONFIG_INVALID"
  | "CODEX_CONFIG_WRITE_FAILED"
  | "CODEX_CONFIG_LOCKED";
```

HTTP 映射：

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `CODEX_HOME_READ_ONLY` | 409 | 当前 Codex home 是全局模式，禁止写入 |
| `CODEX_PROFILE_NOT_FOUND` | 404 | profile 不存在 |
| `CODEX_PROFILE_EXISTS` | 409 | profile 已存在 |
| `CODEX_PROFILE_INVALID` | 422 | profile 存在但配置不可用 |
| `CODEX_CONFIG_INVALID` | 422 | 基础 `config.toml` 无法解析或不安全 |
| `CODEX_CONFIG_WRITE_FAILED` | 500 | 写入、备份或 rename 失败 |
| `CODEX_CONFIG_LOCKED` | 409 | 写锁不可用或超时 |

## 11. 测试方案

### 11.1 Unit tests

新增测试：

1. `codex-home.test.ts`：覆盖 `source` 和 `writable` 推导。
2. `codex-profile-config.test.ts`：解析单个 profile overlay、空配置、非法 TOML、非法 name、非法文件名。
3. `codex-profile-writer.test.ts`：写锁、临时文件、备份、原子替换、失败不破坏原 profile 文件。

### 11.2 Integration tests

新增 API 测试：

1. 全局模式 `GET /codex/profiles` 可读。
2. 全局模式 `POST/PATCH/DELETE /codex/profiles` 返回 `CODEX_HOME_READ_ONLY`。
3. isolated 模式 create/list/get/patch/delete profile。
4. isolated 写入产生 `<name>.config.toml` 备份。
5. 基础 `config.toml` 或单个 profile overlay TOML 损坏时 API 返回 diagnostics，daemon 不崩溃。
6. 显式指定 invalid profile 创建 run 返回 `CODEX_PROFILE_INVALID`。
7. 显式指定 missing profile 创建 run 返回 `CODEX_PROFILE_NOT_FOUND`。
8. thread 创建指定 missing/invalid profile 被拒绝。
9. profile 修改后，新 run 使用修改后的 profile 名称。
10. 已有 thread 固化旧 profile，不受后续 profile 修改影响。

### 11.3 Real Codex smoke

新增 gated smoke 分两类：

1. ABI/layout smoke：使用 isolated `CODEX_HOME` 写入 `r3_smoke.config.toml`，执行 `CODEX_HOME=<isolated> codex -p r3_smoke features list --help`，断言 exit code 0，用于验证 profile overlay 文件结构，不依赖模型网络请求。
2. runtime smoke：使用当前全局 Codex 环境执行 `codex exec -p <existing-or-test-profile> --json --skip-git-repo-check --sandbox read-only "Reply OK only."`。如果要创建测试 profile，必须写入全局 Codex 前显式确认，使用唯一测试名称并在 finally 清理。

若 isolated ABI smoke 失败原因是 profile 文件被拒绝，必须停止修正方案。若全局 runtime smoke 失败原因是认证、网络、额度或模型不可用，应标记为 `BLOCKED_ENV`。

如果当前 Codex CLI 不接受 `<name>.config.toml` profile 结构，R3 实施必须先更新 parser/writer 以匹配真实结构。

## 12. 实施任务拆分

建议拆成 7 个任务：

1. 扩展 `ResolvedCodexHome` 和 `/codex/status`，返回 source/writable。
2. 增加 protocol 类型和 R3 错误码。
3. 增加 profile config parser，支持读取 `<name>.config.toml` overlay。
4. 增加 read-only Profile API。
5. 增加 profile writer：先用 isolated 测试夹具验证写锁、备份、原子写入，再补全全局写入确认和审计。
6. 将 run/thread 创建接入 profile validate。
7. 增加 real Codex profile ABI/layout smoke、全局 runtime smoke 和覆盖报告更新。

每个任务都应先写失败测试，再实现，再提交。

## 13. 验收标准

R3 完成后必须满足：

1. 全局 `CODEX_HOME` 下 profile 可读；全局写入在显式确认、备份和审计补齐前可以保持拒绝，但必须在覆盖报告中标为阶段性缺口。
2. isolated `CODEX_HOME` 下 profile CRUD 全部通过，作为写入安全测试夹具。
3. 写入失败不会破坏原 `<name>.config.toml` 或基础 `config.toml`。
4. 每次写入前都有备份。
5. 配置损坏时 daemon 不崩溃。
6. run/thread 显式指定 missing 或 invalid profile 会被拒绝。
7. profile 修改只影响新 run，不影响历史 run 或已有 thread。
8. real Codex profile ABI/layout smoke 通过；真实运行 smoke 使用全局 Codex 环境，不能用空 isolated `CODEX_HOME` 代表生产能力。

R3 完成后仍不能声明 Skills、MCP、Scheduler 或 UI 完成。
