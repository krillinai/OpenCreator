# Codex Runtime R4 Skills Pass-through 设计

## 1. 状态

状态：草案，等待实施计划。

本设计补充 `2026-07-03-codex-native-runtime-contract-design.md` 的 R4 里程碑。R4 只处理 Codex 原生 Skills 目录的扫描、安装、删除、诊断和操作日志，不进入 UI、MCP、Scheduler 或企业 Skills 市场。

## 2. 目标

R4 第一版目标：

1. 扫描当前 `CODEX_HOME/skills/*/SKILL.md`。
2. 返回 skill 元数据、状态、路径、诊断信息和当前影响范围。
3. 安装本地 skill 目录到当前 `CODEX_HOME/skills/<skill-id>/`。
4. 删除当前 `CODEX_HOME/skills/<skill-id>/`。
5. 覆盖和删除前保留备份。
6. 无效 skill 标记为 `invalid`，daemon 不崩溃。
7. 写操作使用 skills 写锁，避免并发安装、覆盖、删除互相踩踏。
8. 写操作记录到 SQLite 操作日志。
9. 为后续 UI 提供稳定 API。
10. 通过 gated 真实 Codex smoke 验证安装后新 run 能被 Codex 原生发现。

## 3. 非目标

R4 第一版不做：

1. 不实现自研 skill runtime。
2. 不解释 skill 的触发和执行语义。
3. 不做 UI。
4. 不做企业 Skills 市场。
5. 不做远程下载安装。
6. 不做 skill 版本升级策略。
7. 不做跨机器同步。
8. 不把 SQLite 作为 skill 真相源。
9. 不承诺模型一定按 skill 内容产生可预测行为，除非 gated smoke 在当前环境可验证。

## 4. 设计决策

### 4.1 直接管理 Codex 原生 skills 目录

R4 的真相源是当前 `CODEX_HOME/skills`：

```text
CODEX_HOME/skills/<skill-id>/SKILL.md
```

Runtime 不创建第二套 Skills 数据源。`GET /codex/skills` 每次触发轻量扫描，确保用户手动修改 `~/.codex/skills` 后 Runtime 能看到最新状态。

### 4.2 Skills 和 Profiles 的写入策略分治

R3 profile 写入保持保守策略，因为 profile/config 写错可能导致 Codex CLI 启动或配置解析失败。

R4 skills 写入采用 Codex 原生目录管理策略：

1. 默认 `CODEX_HOME` 是全局 `~/.codex` 或环境变量 `$CODEX_HOME` 时，也允许安装、覆盖、删除 skills。
2. isolated `CODEX_HOME` 继续用于自动化测试、企业隔离和用户显式隔离场景。
3. 全局写操作必须在请求中显式确认，防止脚本或测试误删用户真实 skill。
4. `codexHomeWritable` 继续代表配置/profile 层面的写入策略，不代表 skills 写入策略。
5. skills API 使用独立字段 `skillsWritable` 和 `requiresWriteConfirmation` 表达当前 skills 写入能力。

全局写操作确认字段：

```ts
type ConfirmCodexHomeWrite = {
  confirmWriteToCodexHome: true;
};
```

这不是全局只读限制。正常产品调用全局写 API 时应始终传入该字段。

### 4.3 SQLite 只记录操作日志

SQLite 不保存 skill 真相源。skill 是否存在、是否有效，以 `CODEX_HOME/skills` 文件系统扫描结果为准。

SQLite 第一版只记录写操作日志：

```sql
CREATE TABLE IF NOT EXISTS codex_skill_operations (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  codex_home TEXT NOT NULL,
  skills_path TEXT NOT NULL,
  source_path TEXT,
  target_path TEXT NOT NULL,
  backup_path TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
```

字段约束：

| 字段 | 含义 |
|---|---|
| `operation` | `install`、`overwrite` 或 `delete` |
| `status` | `succeeded` 或 `failed` |
| `source_path` | install/overwrite 的本地来源目录 |
| `backup_path` | overwrite/delete 前生成的备份目录 |
| `target_path` | `CODEX_HOME/skills/<skill-id>` |

## 5. 模块边界

建议新增模块：

```text
apps/daemon/src/api/routes.skills.ts
apps/daemon/src/codex/skills/manager.ts
apps/daemon/src/codex/skills/scanner.ts
apps/daemon/src/codex/skills/installer.ts
apps/daemon/src/codex/skills/validator.ts
apps/daemon/src/codex/skills/types.ts
```

职责：

| 模块 | 职责 |
|---|---|
| `routes.skills.ts` | HTTP 请求校验、错误码映射、响应组装 |
| `manager.ts` | skills 用例入口，协调 scan/install/delete/log |
| `scanner.ts` | 扫描 `CODEX_HOME/skills/*/SKILL.md` |
| `installer.ts` | 写锁、安装、覆盖、删除、备份、原子 rename |
| `validator.ts` | skill id、目录、`SKILL.md` frontmatter、symlink 安全校验 |
| `types.ts` | daemon 内部响应和诊断类型 |

`buildServer` 注入 `skillManager`，并注册 `registerSkillRoutes`。`skillManager` 使用当前 `ResolvedCodexHome`，但不直接复用 `ResolvedCodexHome.writable` 作为 skills 可写判断。

## 6. API 设计

### 6.1 `GET /codex/skills`

返回当前 `CODEX_HOME/skills` 的扫描结果。

```ts
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

### 6.2 `GET /codex/skills/:id`

返回单个 skill。不存在返回 `CODEX_SKILL_NOT_FOUND`。

### 6.3 `POST /codex/skills/install`

安装本地 skill 目录。

```ts
type InstallCodexSkillRequest = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};
```

规则：

1. `sourcePath` 必须是本机目录。
2. `sourcePath/SKILL.md` 必须存在且可读。
3. `id` 可选；未传时从源目录名推导。
4. `id` 只能包含字母、数字、`_`、`-`、`.`。
5. `id` 不能是空字符串、`.` 或 `..`。
6. 目标已存在且 `overwrite !== true` 时返回 `CODEX_SKILL_EXISTS`。
7. 当前 `CODEX_HOME` 是 global 时，缺少 `confirmWriteToCodexHome: true` 返回 `CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED`。
8. 成功返回安装后的 `skill` 和 `operation`。

### 6.4 `DELETE /codex/skills/:id`

删除 skill。

全局 `CODEX_HOME` 删除必须显式确认：

```http
DELETE /codex/skills/:id?confirmWriteToCodexHome=true
```

规则：

1. `id` 必须合法。
2. 不存在返回 `CODEX_SKILL_NOT_FOUND`。
3. 删除前备份目标目录。
4. 成功返回 `deleted=true`、`backupPath` 和 `operation`。

### 6.5 `GET /codex/skills/operations`

返回最近的 skill 写操作日志。

```ts
type CodexSkillOperationListResponse = {
  operations: CodexSkillOperationResponse[];
};
```

查询参数：

```text
limit: 默认 50，最大 200
```

## 7. 响应模型

```ts
type CodexSkillStatus = "valid" | "invalid";

type CodexSkillResponse = {
  id: string;
  name?: string;
  description?: string;
  status: CodexSkillStatus;
  diagnostics: string[];
  codexHome: string;
  codexHomeMode: "global" | "isolated";
  skillsPath: string;
  skillPath: string;
  skillFilePath: string;
  updatedAt?: string;
};

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
```

`name` 和 `description` 来自 `SKILL.md` frontmatter：

```md
---
name: brainstorming
description: "..."
---
```

如果 `SKILL.md` 缺失、不可读、frontmatter 不合法、`name` 缺失或 `description` 类型错误，列表中仍返回该目录，但 `status = "invalid"`，并提供 diagnostics。

## 8. 错误码

新增协议错误码：

```ts
| "CODEX_SKILL_NOT_FOUND"
| "CODEX_SKILL_EXISTS"
| "CODEX_SKILL_INVALID"
| "CODEX_SKILL_WRITE_FAILED"
| "CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED"
```

HTTP 映射：

| 错误码 | HTTP | 场景 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 请求体、query、id 格式错误 |
| `CODEX_SKILL_NOT_FOUND` | 404 | skill 不存在 |
| `CODEX_SKILL_EXISTS` | 409 | 目标已存在且未允许覆盖 |
| `CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED` | 409 | 全局写操作缺少确认 |
| `CODEX_SKILL_INVALID` | 422 | 源 skill 或目标 skill 不合法 |
| `CODEX_SKILL_WRITE_FAILED` | 500 | 文件系统写入失败 |

不使用旧文档里的 `SKILL_INVALID`，统一采用 `CODEX_SKILL_*`，避免未来产品内 skill、企业 skill 和 Codex skill 混淆。

## 9. 文件写入策略

### 9.1 安装流程

```text
1. 校验请求。
2. 解析 sourcePath 为真实路径。
3. 确认 sourcePath 是目录。
4. 校验 sourcePath/SKILL.md 存在且可读。
5. 解析 SKILL.md 元数据。
6. 确定 skill id。
7. 校验 id。
8. 获取 CODEX_HOME skills 写锁。
9. 复制到临时目录 CODEX_HOME/skills/.tmp-install-<id>-<pid>-<time>。
10. 校验临时目录中的 SKILL.md。
11. 如果目标已存在：
    - overwrite=false 返回 CODEX_SKILL_EXISTS。
    - overwrite=true 先备份目标目录。
12. rename 临时目录到 CODEX_HOME/skills/<id>。
13. 写入操作日志。
14. 返回安装后的 skill 元数据。
```

### 9.2 删除流程

```text
1. 校验 id。
2. 校验全局写确认。
3. 获取 CODEX_HOME skills 写锁。
4. 确认 CODEX_HOME/skills/<id> 存在。
5. 备份目标目录。
6. 删除 CODEX_HOME/skills/<id>。
7. 写入操作日志。
8. 返回 deleted=true 和 backupPath。
```

### 9.3 备份路径

备份放在：

```text
CODEX_HOME/backups/skills/<id>.<timestamp>.bak/
```

不放在 `CODEX_HOME/skills/.backups`，避免后续扫描 `skills/*/SKILL.md` 时误识别备份目录。

### 9.4 原子性和失败处理

规则：

1. 写操作先复制到 `CODEX_HOME/skills` 下的临时目录。
2. 临时目录校验通过后再 rename 到正式目录。
3. 覆盖前先把旧目标 rename 或 copy 到备份目录。
4. 任一步失败都要尽力清理临时目录。
5. 失败也记录 `codex_skill_operations`，包含 `error_code` 和 `error_message`。
6. 如果覆盖流程在备份后失败，目标恢复能力由备份目录保证，第一版不自动回滚复杂中间态。

## 10. 文件安全策略

安全规则：

1. `id` 禁止 `/`、`\`、空字符串、`.`、`..`。
2. 安装目标必须经过路径归一化和前缀校验，确保位于 `CODEX_HOME/skills` 下。
3. `sourcePath` 可以来自任意本地目录，但必须是目录且包含 `SKILL.md`。
4. skill 目录内存在 symlink 时第一版直接拒绝，返回 `CODEX_SKILL_INVALID`。
5. 不跟随 symlink 复制，避免逃逸 source 根目录。
6. 目标存在时默认不覆盖。
7. 覆盖和删除都先备份。
8. 全局写操作必须带 `confirmWriteToCodexHome: true`。
9. 所有写操作共享同一个 skills 写锁。

第一版拒绝 skill 目录内 symlink，是为了把安全边界做清楚。真实 skills 通常由 markdown、脚本、模板和 assets 组成，不应该依赖 symlink。

## 11. 能力矩阵

扩展 `RuntimeCapabilityMatrix`：

```ts
type RuntimeCapabilityMatrix = {
  skillsScan: boolean;
  skillsInstall: boolean;
  skillsDelete: boolean;
  skillsGlobalWrite: boolean;
  skillsRuntimeDiscoveryVerified: boolean;
  skillsRuntimeBehaviorVerified: boolean;
};
```

含义：

| 字段 | 含义 |
|---|---|
| `skillsScan` | Runtime 能扫描 `CODEX_HOME/skills` |
| `skillsInstall` | Runtime 提供安装 API |
| `skillsDelete` | Runtime 提供删除 API |
| `skillsGlobalWrite` | 当前策略允许写全局 `CODEX_HOME/skills` |
| `skillsRuntimeDiscoveryVerified` | gated real Codex smoke 验证过 Codex 能发现安装后的 skill |
| `skillsRuntimeBehaviorVerified` | gated real Codex smoke 验证过模型实际按 skill 行为响应 |

`GET /codex/status` 继续返回 `codexHomeWritable`，但这不代表 R4 skills 可写性。skills 可写性由 `/codex/skills` 的 `skillsWritable`、`requiresWriteConfirmation` 和能力矩阵字段表达。

## 12. 测试方案

### 12.1 单元测试

覆盖：

1. skill id 校验。
2. `SKILL.md` frontmatter 解析。
3. 缺 name、缺 description、非法 frontmatter。
4. invalid skill 诊断。
5. `sourcePath` 校验。
6. symlink 拒绝。
7. 目标路径逃逸拒绝。

### 12.2 集成测试

使用临时 isolated `CODEX_HOME`：

1. `GET /codex/skills` 空列表。
2. 扫描 valid skill。
3. 扫描 invalid skill。
4. 安装本地 skill 目录。
5. 重复安装返回 `CODEX_SKILL_EXISTS`。
6. `overwrite=true` 备份旧目录并覆盖。
7. 删除 skill 会备份并删除。
8. 删除不存在返回 `CODEX_SKILL_NOT_FOUND`。
9. 全局写操作缺确认返回 `CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED`。
10. 写操作记录可通过 `GET /codex/skills/operations` 查询。

### 12.3 全局 skills 非破坏性测试

默认自动化只做全局读测试：

1. 使用默认 `CODEX_HOME` 启动 daemon。
2. `GET /codex/skills` 能扫描用户真实 `~/.codex/skills`。
3. 响应返回 `codexHomeMode = "global"`。
4. 响应返回 `skillsPath = "~/.codex/skills"` 展开后的绝对路径。
5. 测试不修改任何全局文件。

全局写测试作为手动测试或显式 opt-in 测试，不进入默认自动化。

### 12.4 真实 Codex smoke

真实运行 smoke 使用当前全局 Codex 环境，因为产品目标是套壳用户本机 Codex CLI，而不是证明空白 isolated home 也具备认证态。

```text
1. 生成唯一测试 skill id，例如 r4_smoke_skill_<timestamp>。
2. 写入最小测试 skill 到 sourcePath。
3. 通过 Runtime API 安装到当前全局 CODEX_HOME/skills/<id>，请求必须带 confirmWriteToCodexHome: true。
4. 启动真实 codex exec，不覆盖 CODEX_HOME。
5. prompt 显式引用该 skill。
6. 从 stdout/stderr/events 判断 Codex 是否发现或使用 skill。
7. finally 中通过 Runtime API 删除测试 skill，并保留备份/操作日志。
```

命令建议：

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-skills-smoke.test.ts
```

验收分层：

| 层级 | 要求 |
|---|---|
| layout smoke | 使用 isolated `CODEX_HOME` 验证 Runtime 安装出的 `skills/<id>/SKILL.md` 布局、扫描、删除和备份，不调用模型 |
| global ABI smoke | 确认 Codex 在当前全局 `CODEX_HOME` 下会扫描 Runtime 安装的测试 skill |
| behavior smoke | 确认模型按 prompt 实际使用 skill 内容 |

第一版必须完成 layout smoke 和 global ABI smoke。behavior smoke 可能受模型、网络、账号状态和 Codex 事件可观测性影响。如果当前 Codex 版本没有稳定事件证明 skill 被加载，测试报告必须标记为 `UNVERIFIED_BEHAVIOR` 或 `BLOCKED_ENV`，不能假装通过。

## 13. 完成定义

R4 完成必须满足：

1. `GET /codex/skills` 能扫描全局和 isolated skills。
2. valid 和 invalid skill 都能稳定返回。
3. `POST /codex/skills/install` 支持安装本地目录。
4. `POST /codex/skills/install` 支持显式覆盖并备份旧目录。
5. `DELETE /codex/skills/:id` 支持删除并备份旧目录。
6. 全局写 API 缺少 `confirmWriteToCodexHome` 时拒绝。
7. 写操作有锁、备份和操作日志。
8. symlink 和 path traversal 被拒绝。
9. `/codex/status` 能暴露 skills 能力矩阵。
10. `GET /codex/skills/operations` 能返回最近操作记录。
11. gated real Codex smoke 能在全局 Codex 环境中验证文件布局和发现能力；isolated 只作为布局/写入安全测试夹具。
12. 如果行为验证受环境阻塞，报告必须明确标记，不能声称 R4 行为 smoke 全通过。
