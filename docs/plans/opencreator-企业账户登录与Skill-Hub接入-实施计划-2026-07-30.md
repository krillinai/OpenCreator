# OpenCreator 企业账户登录与 Skill Hub 接入实施计划

> 状态：实施完成（受控联调验收通过；正式发布被 HTTPS 门阻塞）
> 来源方案：`docs/specs/opencreator-企业账户登录与Skill-Hub接入-方案-2026-07-30.md`
> 用户批准证据：用户在 D-1、D-2、D-3 后连续回复“没问题,继续”；来源方案记录为“已批准（2026-07-30）”
> 方案 Reviewer 原始结论：REVISE
> 方案流程结论：PASS（3 个 Major 已按关闭条件修订，用户随后批准）
> Plan Reviewer 原始结论：REVISE
> Plan 流程结论：PASS（3 个 Major 已按关闭条件修订；遵守单次审核约束，不再次复审）
> 执行授权：用户已于 2026-07-30 明确回复“开始执行”
> 正式发布状态：BLOCKED；当前默认企业 Origin 为 `http://1.13.175.31:1904`，必须切换并验证 HTTPS 后才能执行 `--dist/--release`
> 体量判断：复杂。交付同时包含外部认证、操作系统安全凭据、异步会话恢复、ZIP 安全边界、文件系统与 SQLite 跨介质事务、Web/Desktop 一致性和正式发布门；这些部分共享同一 Token 所有权和 AC-1 至 AC-13，不能独立发布，因此保持一份内聚 Plan。

## 执行边界

1. 本 Plan 是执行者的自包含实施合同，不要求回看聊天，也不得用“按方案实现”替代本文中的接口、状态、错误、测试和验收约束。
2. 所有开发在当前分支、当前工作区完成；禁止 `git worktree`，禁止创建 `.worktrees` 或其他额外工作树。
3. 当前工作区已有 `.tmp/`、`apps/desktop/.DS_Store` 和来源方案文档等未跟踪项。不得清理、回退、覆盖或夹带与本功能无关的改动。
4. 执行阶段按 TASK 顺序推进。每个行为任务先取得真实 RED，再做最小 GREEN、相关回归和任务完成门。
5. 不自动提交 Git commit，不新增实施报告、证据文档或流程日志。命令、时间、退出状态和验收证据记录在执行会话最终报告中。
6. Plan 允许调整不改变契约的局部命名和路径，但必须记录偏差。任何会改变 `FR/BR/NFR/DEC/AC`、Token 所有权、会话四态、来源覆盖规则或发布硬门的情况必须停止并退回方案阶段。

## 契约快照

### 目标

1. 用户可注册或登录企业账户，并在 Daemon 重启后通过安全凭据恢复有效会话。
2. 未登录、企业服务离线或认证失效时，本地项目、会话、任务、设置和公共市场继续可用。
3. 插件页保留默认公共市场，并增加独立的企业 Skill Hub 来源。
4. 企业 Token 只存在于 Daemon 内存和操作系统安全凭据存储，不进入 React、Runtime 响应、浏览器存储、SQLite、普通设置、日志或诊断。
5. 企业 Skill 由 Daemon 完成查询、下载、校验、安装、更新和回滚，并复用现有 Skill 写锁与写事务。
6. Browser Bridge 与 Desktop Bridge 复用同一 Protocol、Daemon API、Service 和 React UI，并通过同一 Fake Daemon、相同内容视口和实际打包 App 验证。

### 非目标

- 不实现找回密码、验证码、OAuth、SSO、Refresh Token 或跨设备同步。
- 不实现企业管理员、上传、发布、下架和 `/api/v1/admin/*`。
- 不以企业登录限制 OpenCreator 本地工作区或公共市场。
- 不改变公共市场已有目录、安装来源和交互规则。
- 不向普通用户开放企业 Origin 编辑。
- 不实现下载进度事件、自动重试安装、企业排行榜、封面或作者体系。

### 需求、规则与决策

| ID | 不可降低的执行约束 |
|---|---|
| FR-1 | 未登录或企业服务不可用时，本地功能与公共市场仍完整可用。 |
| FR-2 | 侧栏账户入口可进入工作区内企业账户页，完成登录或注册并登录。 |
| FR-3 | 会话公开状态固定为 `signed_out/checking/signed_in/service_unavailable`，支持启动恢复和手动刷新。 |
| FR-4 | 插件页提供“公共市场 / 企业 Skill Hub”来源 Tab，公共市场默认且现有行为不变。 |
| FR-5 | 已登录用户可浏览企业 Skill、查看详情，并按聚合状态安装、更新或使用。 |
| FR-6 | 企业包必须通过原始 ZIP SHA-256、ZIP 安全、Skill 结构和名称校验后才能写入。 |
| FR-7 | 安装或更新失败不得留下半安装状态；更新失败恢复旧 Skill。 |
| FR-8 | 注销、离线或下架不删除已安装企业 Skill；本地有效内容仍可使用。 |
| BR-1 | 注册不传 `client_id`；注册成功后固定以 `client_id=opencreator-agent` 自动登录。 |
| BR-2 | 注册 Cookie 丢弃；注册、自动登录、`/auth/me` 权限验证和安全写 Token 全部成功才进入 `signed_in`。 |
| BR-3 | 登录、注销、安装和更新不自动重试；未知写入结果不得重复本地写事务。 |
| BR-4 | 仅 active 账号且 `applications.frontend=true` 可登录；401、inactive 或无 frontend 权限清 Token/缓存并进入 `signed_out`；网络或 5xx 保留 Token 并进入 `service_unavailable`。 |
| BR-5 | 注销上游 204 或 401 清本地会话；网络失败保留 Token，不能误报注销成功。 |
| BR-6 | 企业 Skill 状态由远端目录、本地扫描、公共记录、企业记录和安装内容摘要共同计算。 |
| BR-7 | 未知来源、其他来源或本地已修改 Skill 不得被静默覆盖；进入写锁后、文件写入前必须再次核验。 |
| BR-8 | 列表和详情只对网络、5xx、受限 429 做有限退避；401/403/404/409、参数错误和写操作不循环重试。 |
| NFR-1 | Token、密码、Authorization、Cookie 不得进入渲染进程、普通存储、日志和诊断。 |
| NFR-2 | 密码不持久化；提交成功、模式切换和页面卸载时清理密码状态。 |
| NFR-3 | Token 只写操作系统安全凭据；安全后端不可用时禁止明文降级。 |
| NFR-4 | Web/Desktop 共用实现；一致性必须通过同 Fake Daemon、同内容视口和实际打包 App 证明。 |
| NFR-5 | 当前 HTTP 仅限受控联调；账户页不展示连接协议说明；正式 `dist/release` 必须以 HTTPS Origin 通过硬门。 |
| DEC-1 | 企业登录可选，永不成为本地工作区启动门。 |
| DEC-2 | 账户是工作区内独立页面；侧栏底部拆分账户入口和设置图标；企业 Hub 是插件页来源 Tab。 |
| DEC-3 | Daemon 是企业服务和 Token 唯一所有者，Desktop Bridge 不复制企业业务。 |
| DEC-4 | 登录、注册后登录、启动恢复和刷新共用同一 `/auth/me` 判定函数与四态状态机。 |
| DEC-5 | 企业状态以文件系统为真相，来源记录和内容摘要提供版本、来源、手改和竞态语义。 |
| DEC-6 | 企业安装复用 `SkillManager.withWriteTransaction`，下载器和企业记录与公共市场分离。 |
| DEC-7 | HTTP 仅用于受控联调且不增加账户页说明；面向正式用户的打包发布必须阻断非 HTTPS 配置。 |

### Runtime 公共契约

在 `packages/protocol/src/api.ts` 新增以下公开类型。Runtime 响应不包含 `userId`、`accessToken`、`tokenType`、`versionId`、`packageSha256`、下载 URL 或本地目标路径。

```ts
export type EnterpriseSessionStatus =
  | 'signed_out'
  | 'checking'
  | 'signed_in'
  | 'service_unavailable';

export type EnterpriseSessionReason =
  | 'session_expired'
  | 'account_inactive'
  | 'frontend_forbidden'
  | 'secure_storage_unavailable'
  | 'service_unavailable';

export type EnterpriseTransportSecurity =
  | 'insecure_http'
  | 'secure_https';

export type EnterpriseAccountSummary = {
  email: string;
  name: string;
};

export type EnterpriseSessionResponse = {
  status: EnterpriseSessionStatus;
  account?: EnterpriseAccountSummary;
  expiresAt?: string;
  reason?: EnterpriseSessionReason;
  transportSecurity: EnterpriseTransportSecurity;
};

export type EnterpriseLoginRequest = {
  email: string;
  password: string;
};

export type EnterpriseRegisterRequest = {
  email: string;
  name?: string;
  password: string;
};

export type EnterpriseSkillStatus =
  | 'not_installed'
  | 'invalid'
  | 'installed_unknown_source'
  | 'name_conflict'
  | 'installed'
  | 'update_available'
  | 'unpublished';

export type EnterpriseSkillIntegrity =
  | 'not_applicable'
  | 'verified'
  | 'local_changed'
  | 'unknown';

export type EnterpriseSkillAction = 'install' | 'update' | 'use';

export type EnterpriseSkillResponse = {
  skillId: string;
  name: string;
  description?: string;
  version?: string;
  installedVersion?: string;
  updatedAt?: string;
  status: EnterpriseSkillStatus;
  integrity: EnterpriseSkillIntegrity;
  actions: EnterpriseSkillAction[];
};

export type EnterpriseSkillListResponse = {
  skills: EnterpriseSkillResponse[];
  refreshedAt: string;
};

export type EnterpriseSkillDetailResponse = EnterpriseSkillResponse & {
  changelog?: string;
};

export type EnterpriseSkillMutationResponse = {
  skill: EnterpriseSkillResponse;
  localSkill: CodexSkillResponse;
  operation: CodexSkillOperationResponse;
};
```

`integrity` 是七种来源/版本状态之外的正交信号，不增加第八种主状态：

- 企业记录和本地内容摘要一致：`verified`。
- 企业记录存在但本地摘要已变化：`local_changed`，保留“使用”，移除“更新”。
- 未知来源、其他来源或无可验证记录：`unknown`。
- 本地不存在：`not_applicable`。

新增 Runtime 路由：

| 方法 | 路径 | 成功语义 |
|---|---|---|
| GET | `/enterprise/session` | 返回内存会话快照；启动验证未完成时为 `checking`。 |
| POST | `/enterprise/session/refresh` | 有 Token 时执行统一 `/auth/me` 判定，无 Token 返回 `signed_out`。 |
| POST | `/enterprise/register` | 注册、丢弃 Cookie、自动登录、验证权限并安全保存 Token。 |
| POST | `/enterprise/login` | 固定 `opencreator-agent` 登录，验证权限后保存 Token。 |
| POST | `/enterprise/logout` | 上游 204/401 后清凭据；网络错误返回失败并保留凭据。 |
| GET | `/enterprise/skills` | 返回远端、本地扫描及来源记录的聚合结果。 |
| GET | `/enterprise/skills/:skillId` | 返回当前发布详情及本地状态。 |
| POST | `/enterprise/skills/:skillId/install` | 重新取详情、下载、校验并安装当前版本。 |
| POST | `/enterprise/skills/:skillId/update` | 重新取详情、锁内复核并事务更新当前版本。 |

表单只提交 `email/name/password`。前端不得提交 Origin、`client_id`、Token、下载 URL、`versionId`、摘要或目标路径。

### Runtime 错误码

在 `packages/protocol/src/errors.ts` 增加：

```ts
| 'ENTERPRISE_INVALID_REQUEST'
| 'ENTERPRISE_UNAUTHORIZED'
| 'ENTERPRISE_REGISTERED_LOGIN_REQUIRED'
| 'ENTERPRISE_SESSION_EXPIRED'
| 'ENTERPRISE_ACCOUNT_INACTIVE'
| 'ENTERPRISE_FRONTEND_FORBIDDEN'
| 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE'
| 'ENTERPRISE_SERVICE_UNAVAILABLE'
| 'ENTERPRISE_FORBIDDEN'
| 'ENTERPRISE_SKILL_NOT_FOUND'
| 'ENTERPRISE_SKILL_VERSION_CHANGED'
| 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE'
| 'ENTERPRISE_RATE_LIMITED'
| 'ENTERPRISE_PROTOCOL_ERROR'
| 'ENTERPRISE_SKILL_PACKAGE_INVALID'
| 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH'
| 'ENTERPRISE_SKILL_SOURCE_CONFLICT'
| 'ENTERPRISE_SKILL_LOCAL_CHANGED'
| 'ENTERPRISE_SKILL_INSTALL_FAILED'
```

稳定映射：

| 条件 | HTTP | Runtime 错误/会话变化 |
|---|---:|---|
| 本地表单或参数无效 | 400 | `VALIDATION_FAILED` |
| 上游 `400 invalid_request` | 400 | `ENTERPRISE_INVALID_REQUEST` |
| 登录账号或密码错误 | 401 | `ENTERPRISE_UNAUTHORIZED`，不保存会话 |
| 注册已成功但自动登录或后续验证失败 | 409 | `ENTERPRISE_REGISTERED_LOGIN_REQUIRED`，details 只含规范化邮箱 |
| 已保存 Token 或 Skill 请求收到 401 | 401 | 清凭据，`signed_out/session_expired` |
| `/auth/me` 非 active | 403 | 清凭据，`signed_out/account_inactive` |
| `/auth/me applications.frontend=false` | 403 | 清凭据，`signed_out/frontend_forbidden` |
| 安全凭据读写不可用 | 503 | 不进入 `signed_in`，`secure_storage_unavailable` |
| 网络、超时或上游 5xx | 503 | 保留已有 Token，`service_unavailable` |
| Skill Hub 403 | 403 | `ENTERPRISE_FORBIDDEN`，保留登录 |
| Skill 404 | 404 | `ENTERPRISE_SKILL_NOT_FOUND` 并刷新目录 |
| 上游 409 | 409 | `ENTERPRISE_SKILL_VERSION_CHANGED`，不安装旧包 |
| 包超限 | 413 | `ENTERPRISE_SKILL_PACKAGE_TOO_LARGE` |
| 429 | 429 | `ENTERPRISE_RATE_LIMITED`；仅读取可有限重试 |
| ZIP/Skill 结构无效 | 422 | `ENTERPRISE_SKILL_PACKAGE_INVALID` |
| ZIP 摘要不一致 | 422 | `ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH`，重读一次元数据但不自动安装 |
| 锁内来源变化 | 409 | `ENTERPRISE_SKILL_SOURCE_CONFLICT`，不写文件或记录 |
| 锁内本地摘要变化 | 409 | `ENTERPRISE_SKILL_LOCAL_CHANGED`，不写文件或记录 |
| 文件、记录或回滚失败 | 500 | `ENTERPRISE_SKILL_INSTALL_FAILED` |

### Daemon 内部接口

安全凭据：

```ts
export type EnterpriseCredential = {
  accessToken: string;
  expiresAt: string;
};

export type EnterpriseCredentialStore = {
  read(): Promise<EnterpriseCredential | undefined>;
  write(credential: EnterpriseCredential): Promise<void>;
  delete(): Promise<void>;
};

export function createSystemEnterpriseCredentialStore(input?: {
  e2eRunId?: string;
}): EnterpriseCredentialStore;
```

生产实现使用 `@napi-rs/keyring@1.3.0` 的 `Entry.getPassword/setPassword/deletePassword`。默认 service 为 `com.opencreator.enterprise`，account 为 `opencreator-agent`。不提供任意 service/account 环境覆盖；实际打包 E2E 只允许传入规范 UUID `e2eRunId`，并固定派生 service=`com.opencreator.enterprise.e2e`、account=`opencreator-agent:<e2eRunId>`。安全后端异常统一包装为 `ENTERPRISE_SECURE_STORAGE_UNAVAILABLE`，禁止文件、SQLite、环境变量或普通配置降级。

实际打包 E2E 的授权契约固定为：

1. E2E 启动 App 时同时传入命令行参数 `--opencreator-enterprise-e2e=<UUID>` 和环境变量 `OPENCREATOR_ENTERPRISE_E2E_RUN_ID=<同一 UUID>`，并把 `OPENCREATOR_ENTERPRISE_ORIGIN` 指向本机 loopback Fake 服务。
2. Desktop Main 只在参数、环境 UUID 完全相等、格式合法且 Origin 为 `127.0.0.1/[::1]/localhost` 时生成 typed `enterpriseE2ERunId`；缺失一侧、不一致、非 UUID 或非 loopback 时在启动 Daemon 前返回 `ENTERPRISE_E2E_CONFIG_FORBIDDEN`。
3. `DaemonManager` 必须从继承环境中删除 `OPENCREATOR_ENTERPRISE_E2E_RUN_ID`、`OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED` 和任何 `OPENCREATOR_ENTERPRISE_KEYRING_SERVICE/ACCOUNT`，只根据已验证的 typed input 写入 `OPENCREATOR_ENTERPRISE_E2E_RUN_ID` 和 `OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED=packaged-app`。
4. Daemon 启动解析仅在授权值精确为 `packaged-app`、UUID 合法且企业 Origin 为 loopback 时接受 `e2eRunId`；否则拒绝启动。普通生产启动固定使用默认 Keyring 身份。
5. E2E 结束按派生 service/account 删除唯一测试项。日志和失败报告可记录 run ID 与派生身份，不得读取或输出 Token。

外部 HTTP Client：

```ts
export type EnterpriseHttpClient = {
  register(input: EnterpriseRegisterRequest): Promise<void>;
  login(input: EnterpriseLoginRequest): Promise<{
    account: EnterpriseAccountSummary;
    accessToken: string;
    tokenType: 'Bearer';
    expiresAt: string;
  }>;
  getMe(accessToken: string): Promise<{
    account: EnterpriseAccountSummary;
    status: string;
    frontendAllowed: boolean;
  }>;
  logout(accessToken: string): Promise<void>;
  listSkills(accessToken: string): Promise<EnterpriseRemoteSkill[]>;
  getSkillDetail(accessToken: string, skillId: string): Promise<EnterpriseRemoteSkillDetail>;
  downloadSkillPackage(input: {
    accessToken: string;
    skillId: string;
    versionId: string;
    expectedSha256: string;
    destinationPath: string;
  }): Promise<{ bytes: number; sha256: string }>;
};
```

Client 使用注入的 `fetch`、`AbortSignal.timeout` 和 `zod` 解析边界数据。注册响应不读取或转发 `Set-Cookie`；日志只允许方法、路径模板、状态码、请求 ID、耗时和失败阶段，不记录 body、Authorization、Cookie 或原始带 Query URL。

会话管理器：

```ts
export type EnterpriseSessionManager = {
  startRestore(): void;
  getSnapshot(): EnterpriseSessionResponse;
  refresh(): Promise<EnterpriseSessionResponse>;
  login(input: EnterpriseLoginRequest): Promise<EnterpriseSessionResponse>;
  register(input: EnterpriseRegisterRequest): Promise<EnterpriseSessionResponse>;
  logout(): Promise<EnterpriseSessionResponse>;
  requireAccessToken(): Promise<string>;
  invalidateUnauthorized(reason?: 'session_expired'): Promise<void>;
  close(): Promise<void>;
};
```

`login/register/startRestore/refresh` 必须调用同一个内部 `validateAuthenticatedSession`。只有 Bearer Token、active 账号、frontend 权限和安全写入全部成立时发布 `signed_in`。新登录的权限或安全写入失败时尝试远端注销；撤销失败只记录脱敏阶段信息，不得暴露为成功。

### 会话状态机

```text
Daemon 启动
  -> startRestore()
  -> 安全存储无 Token：signed_out
  -> 有 Token：checking
     -> /auth/me active && frontend=true：signed_in
     -> 401：删 Token，signed_out/session_expired
     -> inactive：删 Token，signed_out/account_inactive
     -> frontend=false：删 Token，signed_out/frontend_forbidden
     -> 网络/5xx：保留 Token，service_unavailable
     -> 安全存储不可用：signed_out/secure_storage_unavailable
```

- `GET /enterprise/session` 只读快照，不触发第二次并发验证。
- `checking` 最长受单次 15 秒 `/auth/me` 超时约束。Web 每 250ms 读取快照，最多 15 秒；终态后停止。
- 登录、注销和写操作无自动重试。
- `service_unavailable` 可携带进程内最近账号摘要；Daemon 重启且 `/auth/me` 失败时允许无账号摘要。
- 注销上游网络失败后状态设为 `service_unavailable`，保留 Token 和账号摘要；用户可手动重试。

### 企业 Skill 数据与摘要

SQLite 新表：

```sql
CREATE TABLE IF NOT EXISTS enterprise_skill_installs (
  skill_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  version_id TEXT NOT NULL,
  version TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  installed_content_sha256 TEXT NOT NULL,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enterprise_skill_installs_updated_at
  ON enterprise_skill_installs(updated_at DESC, skill_id ASC);
```

Token、密码、Authorization、Cookie、远端下载 URL 和账号内部 ID 不得出现在此表。公共市场记录不迁移；同名公共记录按 `name_conflict` 处理。

规范化内容摘要算法只有 `apps/daemon/src/enterprise/skill-content-digest-2026-07-30.ts` 一个实现：

1. `lstat` 递归拒绝符号链接和非普通文件。
2. 相对路径统一为 `/`，编码为 UTF-8，按 `Buffer.compare` 排序。
3. 对每个文件依次写入 4 字节大端路径长度、路径字节、8 字节大端文件长度和原始文件字节。
4. 使用流式 SHA-256，输出 64 位小写十六进制。
5. 安装源目录、安装后目标目录和更新前锁内复核必须调用同一函数。

状态聚合顺序：

1. 本地无同名目录：`not_installed`，动作 `install`。
2. 本地同名 Skill 无效：`invalid`，无写动作。
3. 本地有效但无 OpenCreator 来源记录：`installed_unknown_source`，动作 `use`。
4. 公共市场记录存在，或企业记录的 `skillId/name` 不属于当前条目：`name_conflict`，无动作。
5. 企业记录属于当前条目且本地摘要与记录不同：保持远端版本主状态，`integrity=local_changed`，只允许 `use`。
6. 企业记录摘要与本地一致，`package_sha256` 等于远端：`installed/verified`，动作 `use`。
7. 企业记录摘要与本地一致，`package_sha256` 不等于远端：`update_available/verified`，动作 `update/use`。
8. 企业记录和本地有效内容存在，且本次远端列表成功返回但已无该条目：`unpublished`，动作 `use`。

只有远端列表成功返回后，才能根据“列表中缺少既有企业记录”判定 `unpublished`。网络、超时、429 或 5xx 失败必须保留最近已知状态并报告服务不可用，不能把全部企业安装记录误判为下架。

### 下载、ZIP 与事务边界

新增依赖 `yauzl@3.4.0` 和 `@types/yauzl@3.4.0`。限制固定为：

```ts
export const ENTERPRISE_PACKAGE_MAX_BYTES = 50 * 1024 * 1024;
export const ENTERPRISE_ARCHIVE_MAX_ENTRIES = 2_048;
export const ENTERPRISE_ARCHIVE_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
export const ENTERPRISE_ARCHIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
```

下载先检查合法 `Content-Length`，再流式写临时 ZIP、增量计算 SHA-256 并按实际字节强制 50 MiB 上限。摘要不一致时删除 ZIP，重新读取一次详情用于返回最新版本提示，但不得自动重下或进入写锁。

解压使用 `yauzl` 的 lazy entry 流。必须拒绝：

- 空名、NUL、绝对路径、UNC、Windows 盘符、反斜杠、`..` 越界和规范化后空路径。
- 规范化重复路径、文件/目录同名、重复 `SKILL.md`。
- 符号链接、设备、FIFO、socket 和其他非普通文件。
- 条目数、单文件声明/实际字节和总解压字节超限。
- CRC、截断、声明大小与实际流大小不一致。
- 缺失或多于一个有效 Skill 根。
- `SKILL.md` 解析失败、目录 ID 非法或 metadata `name` 与远端 `name` 不一致。

允许 ZIP 以 Skill 文件为根，或只有一个顶层目录；两者都归一为单个临时 `sourcePath`。

安装/更新流程：

```text
重新获取详情
-> 流式下载和 ZIP SHA-256
-> 安全解压并验证 name
-> 计算 sourceContentSha256
-> SkillManager.withWriteTransaction
   -> 重读本地 Skill、公共记录、企业记录
   -> install：确认同名仍不存在且无来源占用
   -> update：确认企业记录仍属于 skillId/name
              且当前本地摘要仍等于 installed_content_sha256
   -> transaction.installSkill
   -> 计算目标目录摘要并确认等于 sourceContentSha256
   -> 完成所有必须成功的 ZIP/解压工作目录清理
   -> 以单条 SQLite upsert 写企业记录，作为最后提交点
-> upsert 之前或 upsert 本身失败：rollbackSkillInstall；原子 upsert 保留操作前记录
-> finally 仅做幂等兜底清理，不再包含会改变成功结果的必需步骤
```

来源或摘要冲突发生在 `transaction.installSkill` 前，不允许创建备份、目标临时目录或记录。安装成功后若目标摘要、记录写入或必须的临时清理失败，必须在同一写锁内回滚。

`upsertRecord` 必须是单条原子 SQLite 语句：新安装写入失败时仍无企业记录，更新写入失败时旧记录保持不变。成功 upsert 后不得再执行可能把操作改判为失败的步骤；因此无需增加记录删除/恢复补偿接口。

### Web 交互约束

- 新增 `#/account`，使用现有 AppLayout。
- 侧栏展开时账户区显示头像缩写、名称/邮箱和会话状态；设置使用独立齿轮图标按钮。收起时两者是固定尺寸图标按钮并有 Tooltip/无障碍名称。
- 登录字段：邮箱、密码；注册字段：名称、邮箱、密码、确认密码。前端只校验必填、邮箱形态、密码至少 8 字符、确认一致。
- 注册按钮文案“注册并登录”。若收到 `ENTERPRISE_REGISTERED_LOGIN_REQUIRED`，切换登录模式、预填邮箱、清空密码并提示账号已创建。
- 401 保留邮箱，清空并聚焦密码；网络错误保留输入；提交期间锁定字段、分段控件和按钮。
- 登录成功、模式切换和页面卸载清空密码与确认密码。
- 插件路由支持 `#/plugins?source=enterprise`；省略时默认公共市场。未登录企业 Tab 的登录入口使用该返回路由，登录成功后回到企业 Tab。
- 企业 Hub 使用紧凑行、搜索、状态筛选、刷新、详情弹窗和明确动作。公共市场现有 `SkillMarketView` 不重写、不混入企业条目。
- 企业“使用”复用现有项目选择和创建对话逻辑，只插入 `$skill-name `，不自动发送。
- 账户页不展示 HTTP/HTTPS 协议说明；传输安全差异由打包模式和正式发布 HTTPS 硬门处理。

## 基线与文件地图

### Git 与工作区

| 项目 | 基线 |
|---|---|
| 分支 | `codex-native-runtime-kernel` |
| 生成 Plan 时 HEAD | `456834dfd00fc6a3e0a7ff0234df074d581a3d50` |
| 最近提交 | `456834d update opencreator skill hub api docs` |
| 既有未跟踪项 | `.tmp/`、`apps/desktop/.DS_Store`、来源方案文档 |
| 包管理器 | `pnpm@9.15.0` |
| Node/Electron | Daemon Node 22 语义；Desktop `electron@43.1.1` utility process |

### 已确认入口与复用点

| 区域 | 当前文件/符号 | 实施含义 |
|---|---|---|
| Protocol | `packages/protocol/src/api.ts`、`errors.ts`、`index.ts` | 新类型从现有公开入口导出。 |
| Server 装配 | `apps/daemon/src/api/server.ts` - `BuildServerInput`、`buildServer` | 注入 HTTP Client、CredentialStore、SessionManager；注册企业路由和关闭钩子。 |
| 生产启动 | `apps/daemon/src/startup.ts`、`main.ts` | 解析固定 Origin；校验受限 E2E run ID 并派生凭据身份；启动异步恢复。 |
| 数据迁移 | `apps/daemon/src/storage/migrations.ts` - `migrate` | 新增企业安装记录表和索引，不迁移公共记录。 |
| Skill 写事务 | `apps/daemon/src/codex/skills/manager.ts` - `SkillManager.withWriteTransaction`、`SkillWriteTransaction` | 锁内来源/摘要复核和安装回滚的唯一边界。 |
| 本地扫描 | `apps/daemon/src/codex/skills/scanner.ts` | 文件系统安装状态真相源。 |
| 公共来源 | `market-manager.ts`、`market-records.ts` | 企业聚合需读取公共记录，禁止同名覆盖；公共写入逻辑保持不变。 |
| Skill 校验/安装 | `installer.ts`、`validator.ts` | 复用 Skill ID、SKILL.md 和无符号链接校验。 |
| 脱敏 | `security/redaction.ts`、`diagnostics/redactor.ts` | 扩展企业认证字段和 Bearer/Cookie 覆盖测试。 |
| Web 路由/状态 | `apps/web/src/app/routes.ts`、`app-state.ts`、`AppController.tsx` | 增加账户视图、企业 Service 与返回企业 Tab 的导航。 |
| 侧栏 | `apps/web/src/features/shell/OpenCreatorSidebar.tsx` | 拆分账户入口和设置按钮。 |
| 公共市场 | `SkillMarketView.tsx`、`skill-market-service.ts` | 作为公共 Tab 原样复用；“使用”流程抽取为来源无关函数。 |
| Desktop Daemon | `apps/desktop/src/main/main.ts`、`bootstrap-controller.ts`、`daemon-manager.ts` | 校验 E2E 参数/环境双信号，清洗继承环境后向 utility process 传递 typed 企业配置；不增加企业 IPC。 |
| 打包 | `prepare-daemon.mjs`、`package-release.mjs`、`verify-package.mjs` | 部署并校验 Keyring 平台 `.node`；非 HTTPS 阻断正式打包。 |
| Desktop E2E | `apps/desktop/e2e/packaged-app.ts`、`package-artifact.ts`、`desktop.spec.ts` | 复用实际包启动、重启、Runtime 代理和 `opencreator-app://` 断言。 |

### 新增文件

所有新增文件名按项目规则附加 `2026-07-30`：

```text
packages/protocol/test/enterprise-contract-2026-07-30.test.ts

apps/daemon/src/enterprise/config-2026-07-30.ts
apps/daemon/src/enterprise/credential-store-2026-07-30.ts
apps/daemon/src/enterprise/http-client-2026-07-30.ts
apps/daemon/src/enterprise/session-manager-2026-07-30.ts
apps/daemon/src/enterprise/install-records-2026-07-30.ts
apps/daemon/src/enterprise/skill-content-digest-2026-07-30.ts
apps/daemon/src/enterprise/skill-package-2026-07-30.ts
apps/daemon/src/enterprise/skill-manager-2026-07-30.ts
apps/daemon/src/api/routes.enterprise-2026-07-30.ts

apps/daemon/test/unit/enterprise-credential-store-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-session-manager-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-install-records-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-skill-content-digest-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-skill-package-2026-07-30.test.ts
apps/daemon/test/unit/enterprise-skill-manager-2026-07-30.test.ts
apps/daemon/test/integration/enterprise-api-2026-07-30.test.ts

apps/web/src/services/enterprise-service-2026-07-30.ts
apps/web/src/services/enterprise-service-2026-07-30.test.ts
apps/web/src/features/account/EnterpriseAccountPage-2026-07-30.tsx
apps/web/src/features/account/EnterpriseAccountPage-2026-07-30.test.tsx
apps/web/src/features/plugins/EnterpriseSkillHubView-2026-07-30.tsx
apps/web/src/features/plugins/EnterpriseSkillHubView-2026-07-30.test.tsx
apps/web/e2e/support/fake-enterprise-daemon-2026-07-30.ts
apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts

apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts
```

### 依赖选择

| 依赖 | 版本 | 用途 | 发布约束 |
|---|---:|---|---|
| `@napi-rs/keyring` | `1.3.0` | macOS/Windows/Linux 操作系统凭据 | 生产依赖；`pnpm deploy --prod` 必须包含当前平台 optional package 和 `keyring.<platform>.node`。 |
| `yauzl` | `3.4.0` | lazy ZIP entry 流、安全解压 | 生产依赖；不允许一次性把完整 ZIP 解压到内存。 |
| `@types/yauzl` | `3.4.0` | TypeScript 类型 | Daemon devDependency。 |

### 公共验证命令

| 名称 | 运行目录与命令 | 预期 |
|---|---|---|
| V-PROTOCOL | 根目录：`pnpm --filter @opencreator/protocol test && pnpm --filter @opencreator/protocol typecheck && pnpm --filter @opencreator/protocol build` | 退出 0 |
| V-DAEMON-UNIT | 根目录：`pnpm --filter @opencreator/daemon test -- test/unit/<目标文件>` | 退出 0 |
| V-DAEMON-API | 根目录：`pnpm --filter @opencreator/daemon test -- test/integration/enterprise-api-2026-07-30.test.ts` | 退出 0 |
| V-DAEMON | 根目录：`pnpm --filter @opencreator/daemon test && pnpm --filter @opencreator/daemon typecheck && pnpm --filter @opencreator/daemon build` | 退出 0 |
| V-WEB-TARGET | 根目录：`pnpm --filter @opencreator/web test -- <目标测试文件>` | 退出 0 |
| V-WEB | 根目录：`pnpm --filter @opencreator/web test && pnpm --filter @opencreator/web typecheck && pnpm --filter @opencreator/web build` | 退出 0 |
| V-CONSISTENCY | 根目录：`pnpm exec playwright test apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts` | Browser/Desktop Bridge 对比退出 0 |
| V-PACKAGE | 根目录：`pnpm desktop:package` | 当前平台实际可运行目录生成且 `verify-package` 退出 0 |
| V-DESKTOP-E2E | 根目录：`pnpm --filter @opencreator/desktop exec playwright test --config playwright.config.ts e2e/enterprise-packaged-2026-07-30.spec.ts` | 实际打包 App 企业流程退出 0 |
| V-ALL | 根目录：`pnpm test && pnpm typecheck && pnpm build && git diff --check` | 全部退出 0 |

## 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
|---|---|---|---|---|
| TASK-1 | FR-2..FR-6、BR-1..BR-8、NFR-1、NFR-4 | DEC-3..DEC-7 | Protocol contract test | AC-2..AC-13 |
| TASK-2 | FR-3、NFR-1..NFR-3 | DEC-3、DEC-4 | Credential store unit/security | AC-3、AC-5、AC-13 |
| TASK-3 | BR-1..BR-5、BR-8、NFR-1、NFR-5 | DEC-3、DEC-4、DEC-7 | HTTP client contract/retry/redaction | AC-2..AC-5、AC-11、AC-12 |
| TASK-4 | FR-1..FR-3、BR-1..BR-5、NFR-1、NFR-4 | DEC-1..DEC-4 | Session manager + Runtime API | AC-1..AC-5 |
| TASK-5 | FR-5、FR-8、BR-6、BR-7 | DEC-5、DEC-6 | Migration/repository/digest | AC-7、AC-9、AC-10 |
| TASK-6 | FR-6、FR-7、BR-3、BR-7、BR-8 | DEC-6 | Real ZIP security tests | AC-8、AC-9、AC-11 |
| TASK-7 | FR-4..FR-8、BR-3、BR-6..BR-8、NFR-1 | DEC-3、DEC-5、DEC-6 | Hub manager/route/concurrency | AC-5、AC-7..AC-11 |
| TASK-8 | FR-2、FR-3、BR-1..BR-5、NFR-1、NFR-2、NFR-5 | DEC-2、DEC-4、DEC-7 | Account component/service | AC-2..AC-5、AC-12 |
| TASK-9 | FR-1..FR-3、NFR-4 | DEC-1、DEC-2、DEC-4 | Route/sidebar/App integration | AC-1..AC-4、AC-6 |
| TASK-10 | FR-4、FR-5、FR-8、BR-6、BR-7 | DEC-2、DEC-5 | Enterprise Hub component/model | AC-6、AC-7、AC-10 |
| TASK-11 | FR-4、FR-5、BR-3、NFR-4 | DEC-2、DEC-5 | Controller/service/use integration | AC-6、AC-7、AC-11 |
| TASK-12 | FR-1、FR-2、FR-4、FR-5、FR-8、NFR-4 | DEC-1..DEC-3 | Same Fake Daemon Playwright | AC-1、AC-2、AC-6、AC-10 |
| TASK-13 | NFR-1、NFR-3..NFR-5 | DEC-3、DEC-7 | Package verify + packaged E2E | AC-5、AC-6、AC-12、AC-13 |
| TASK-14 | 全部 P0/P1 | DEC-1..DEC-7 | V-ALL + 公开边界验收 | AC-1..AC-13 |

## 失败熔断

1. 预期 RED 不计入失败次数；RED 必须因目标行为缺失失败，不能因语法、错误路径、模块加载或夹具损坏失败。
2. 进入 GREEN 后，每次修复前记录失败命令、关键输出、根因假设和本次最小改动。
3. 同一测试或命令因同一根因经过两次有实质差异的修复仍失败，立即停止当前 TASK 并标记 `BLOCKED`。
4. 熔断后判断为实现、测试/夹具、环境或 Plan/契约问题；不得放宽断言、删除用例、静默改设计或启动修复子 Agent。
5. 任一 P0 安全断言发现 Token/密码落入 React、SQLite、日志、诊断或包资源，立即停止后续 UI/发布任务，先修复泄漏并重跑 AC-5 全部证据。
6. 任一锁内冲突测试发生文件或记录写入，立即停止 TASK-7；不得以“最终回滚成功”替代“冲突前不写入”。
7. `dist/release` 在 HTTP Origin 下成功，或实际 App 未加载当前 `apps/web/dist`，立即阻止发布。

## 实施任务

### TASK-0：确认 Plan 仍然有效

**交付结果**

- 确认执行起点仍可按本文契约实施，没有遗漏用户改动或已失效的关键符号。

**实施步骤**

1. 运行 `git status --short --branch`、`git rev-parse HEAD`、`git log -5 --oneline`。
2. 核对来源方案仍为已批准且 `DEC-1..DEC-7`、`AC-1..AC-13` 未被后续文档替换。
3. 核对基线文件、符号、依赖版本和公共验证命令仍存在。
4. 读取当前未提交改动；只记录与本任务直接相交的变化，不回退用户改动。
5. 若只有路径或命名变化且契约不变，记录 Plan 偏差后继续；若职责、接口、数据、状态或 AC 已失效，停止并更新方案或 Plan。

**TDD**

- 策略：豁免。此任务不改变行为。
- 替代验证：Git/文件/符号/命令核对均通过。

**任务完成门**

- 生成基线、当前分支、相交改动和偏差记录完整；允许进入 TASK-1。

### TASK-1：冻结 Protocol 与错误契约 `[FR-2..FR-6, BR-1..BR-8, NFR-1, NFR-4, DEC-3..DEC-7]`

**交付结果**

- Daemon 与 Web 共用本文定义的会话、企业 Skill、动作和错误类型；公开类型无法表达 Token。

**文件与符号**

- 修改：`packages/protocol/src/api.ts` - 新增 `Enterprise*` 类型。
- 修改：`packages/protocol/src/errors.ts` - 新增企业错误码。
- 创建：`packages/protocol/test/enterprise-contract-2026-07-30.test.ts`。

**实施步骤**

1. 按“Runtime 公共契约”逐字建立联合类型和响应类型，不把上游 `snake_case` 类型暴露为 Runtime 契约。
2. 只从现有 `packages/protocol/src/index.ts` 通配导出，不增加第二个导出入口。
3. 合同测试通过 namespace import 检查公开入口，并构造合法会话/Skill 响应；序列化后断言不含 `accessToken/token/password/authorization/cookie/packageSha256/versionId`。
4. 为 `RuntimeErrorCode` 增加完整错误集合，不复用含义不一致的 Codex 市场错误。

**TDD**

- 策略：必须。
- RED：`exports enterprise session and skill contracts without credential fields`。从 `@opencreator/protocol` 公开入口导入并构造类型 fixture，先运行 V-PROTOCOL；预期因类型或错误码不存在而在 typecheck 阶段失败。此处是纯 TypeScript 契约被擦除后的受限例外，允许以 typecheck RED 证明缺失；会话、Hub 和账户运行时行为必须分别由 TASK-4、TASK-7、TASK-8 的业务断言取得真实 RED。
- GREEN：新增最小类型和错误码后运行 V-PROTOCOL，预期退出 0。
- REFACTOR：只允许整理相邻 Skill 类型顺序；再次运行 V-PROTOCOL。

**任务完成门**

- V-PROTOCOL 通过；类型与本文签名一致；对应 AC-2 至 AC-13 的请求/响应字段可被后续任务直接使用。

### TASK-2：实现安全凭据后端 `[FR-3, NFR-1..NFR-3, DEC-3, DEC-4]`

**交付结果**

- Daemon 可通过可注入接口读写企业 Token；生产实现只使用系统 Keyring，失败时明确拒绝持久登录。

**文件与符号**

- 修改：`apps/daemon/package.json` - 增加 `@napi-rs/keyring@1.3.0`。
- 修改：`pnpm-lock.yaml` - 锁定主包与平台 optional package。
- 创建：`apps/daemon/src/enterprise/credential-store-2026-07-30.ts` - `EnterpriseCredentialStore`、`createSystemEnterpriseCredentialStore`。
- 创建：`apps/daemon/test/unit/enterprise-credential-store-2026-07-30.test.ts`。

**实施步骤**

1. Keyring value 只保存 `{accessToken,expiresAt}` JSON；读取时严格校验对象、非空 Token 和 RFC 3339 时间。
2. `getPassword()` 返回 `null` 时视为无凭据；解析失败先尝试删除损坏条目，再返回安全存储错误，不能把损坏内容记录到错误消息。
3. `setPassword/deletePassword` 的原始错误只保留阶段和错误类型，统一抛出 `ENTERPRISE_SECURE_STORAGE_UNAVAILABLE`。
4. 凭据身份解析只接受无参数的生产默认值，或规范 UUID `e2eRunId` 派生出的固定 E2E service/account；不得接受调用方提供任意 service/account。
5. 测试通过注入最小 `EntryLike` 替身覆盖无条目、读写删除、损坏 JSON、读取失败、写入失败和删除失败；断言错误字符串不含测试 Token。

**TDD**

- 策略：必须。
- RED-1：`never falls back to plaintext when the keyring backend fails`。让替身 `setPassword` 抛错，断言 Store 以稳定码失败、错误不含测试 Token，且未调用任何明文持久化 fallback 替身；预期因 Store 不存在失败。SQLite、文件、环境和打包资源的全局无泄漏证据由 AC-5 安全扫描负责。
- RED-2：`derives a constrained packaged-e2e keyring identity without arbitrary overrides`。断言无 run ID 时使用生产默认项，合法 UUID 只能派生固定 E2E service/account，非法 UUID 和任意 service/account 输入不可表达或被拒绝。
- GREEN：实现最小 Keyring 适配器并运行 V-DAEMON-UNIT 指向本测试，预期全部通过。
- REFACTOR：抽取无敏感数据的错误包装；运行本测试和 `diagnostics-redactor.test.ts`。

**任务完成门**

- Credential Store 和身份派生单元测试通过；普通生产固定默认身份，实际包 E2E 只能进入派生命名空间；工作区搜索新增代码和测试产物不出现真实测试 Token 明文；AC-5 的存储边界已具备。

### TASK-3：实现企业 HTTP Client 和安全日志边界 `[BR-1..BR-5, BR-8, NFR-1, NFR-5, DEC-3, DEC-4, DEC-7]`

**交付结果**

- Daemon 以固定路径和 `snake_case` 调用企业服务，正确处理超时、错误包装、有限读取重试输入和流式下载。

**文件与符号**

- 创建：`apps/daemon/src/enterprise/config-2026-07-30.ts` - `DEFAULT_ENTERPRISE_ORIGIN`、超时和 Origin 校验。
- 创建：`apps/daemon/src/enterprise/http-client-2026-07-30.ts` - `EnterpriseHttpClient`、`EnterpriseHttpError`、响应 schema。
- 创建：`apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts`。
- 修改：`apps/daemon/src/security/redaction.ts`、`apps/daemon/src/diagnostics/redactor.ts`。
- 修改：`apps/daemon/test/unit/diagnostics-redactor.test.ts`。

**实施步骤**

1. Origin 只接受无 credentials、path、query、hash 的 `http:`/`https:` URL；默认保持接口文档当前 HTTP 地址，测试通过注入 Origin。
2. 注册 body 仅有 `email/name/password`；登录固定附加 `client_id: 'opencreator-agent'`；注册响应 Cookie 不读取、不转发。
3. `/me` 只解析 account status 和 `applications.frontend`；未知字段忽略，缺失必需字段返回 `ENTERPRISE_PROTOCOL_ERROR`。
4. JSON 请求超时 15 秒，下载 120 秒。Client 本身只执行一次请求；是否重试由上层 Skill Manager 决定。
5. 下载使用 Web Stream 到 Node Stream 的流式管道，同时强制内容长度和实际字节上限、增量 SHA-256；任何失败删除目标临时文件。
6. 外部错误对象只保留 status、业务 code、Retry-After、requestId 和阶段，不保留 body、headers、Token 或完整 URL。
7. 脱敏规则覆盖 `access_token`、`expires_at`、`Authorization` 任意认证方案、Cookie/Set-Cookie 和嵌套 `enterprise` 认证对象。

**TDD**

- 策略：必须。
- RED-1：`register omits client_id and discards set-cookie before automatic login can run`。Fake fetch 捕获请求并返回带 Cookie 的注册响应；断言请求字段和 Client 返回值均无 Cookie，预期因 Client 不存在失败。
- RED-2：`streams a bounded package and deletes it on sha256 mismatch`。构造分块 Response，断言正确摘要成功、超限和摘要错误删除文件，预期因下载器不存在失败。
- RED-3：`redacts enterprise bearer cookie and token fields from diagnostics`。输入嵌套 JSON/文本，断言秘密全部消失，预期现有脱敏对 Cookie 或 JSON key 至少一项失败。
- GREEN：实现最小 Client/schema/下载器并运行目标 Client 测试和脱敏测试。
- REFACTOR：把请求构造、错误解析和日志元数据拆成私有纯函数；运行 V-DAEMON-UNIT 两个目标测试。

**任务完成门**

- 精确路径、字段、超时、下载上限和脱敏测试通过；无登录/注销自动重试；AC-2、AC-5、AC-11、AC-12 的 Client 证据具备。

### TASK-4：实现会话状态机、Runtime 路由和启动恢复 `[FR-1..FR-3, BR-1..BR-5, NFR-1, NFR-4, DEC-1..DEC-4]`

**交付结果**

- Daemon 启动后异步恢复会话；登录、注册、刷新、注销共享统一状态语义，并通过 Runtime API 提供无 Token 快照。

**文件与符号**

- 创建：`apps/daemon/src/enterprise/session-manager-2026-07-30.ts`。
- 创建：`apps/daemon/src/api/routes.enterprise-2026-07-30.ts` - 本任务先注册五个会话路由。
- 修改：`apps/daemon/src/api/server.ts` - `BuildServerInput`、`buildServer`、`onClose`。
- 修改：`apps/daemon/src/startup.ts`、`apps/daemon/src/main.ts`。
- 修改：`apps/daemon/test/unit/startup.test.ts`。
- 创建：`apps/daemon/test/unit/enterprise-session-manager-2026-07-30.test.ts`。
- 创建：`apps/daemon/test/integration/enterprise-api-2026-07-30.test.ts` - 本任务先覆盖会话 API。

该任务超过 5 个文件，因为会话行为必须同时贯通状态机、依赖注入、生产启动和公开 API；拆开会产生无法通过公共边界验证的中间状态。

**实施步骤**

1. `BuildServerInput` 增加可注入 `enterpriseCredentialStore`、`enterpriseHttpClient`、`enterpriseOrigin` 和已验证的 `enterpriseE2ERunId`；测试不触发真实 Keyring 或公网。
2. `resolveProductionServerEnvironment` 读取 `OPENCREATOR_ENTERPRISE_ORIGIN`，并按“实际打包 E2E 的授权契约”校验 `OPENCREATOR_ENTERPRISE_E2E_RUN_ID`、`OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED`、UUID 和 loopback Origin；任何不完整或越权组合在构造 Store 前失败。
3. `buildServer` 构造 SessionManager，调用 `startRestore()` 后立即继续本地 Server 启动；企业服务慢或离线不得阻塞 `/healthz` 和本地路由。
4. 使用 generation/AbortController 防止迟到的启动恢复覆盖后续登录、注销或手动刷新。
5. `validateAuthenticatedSession` 实现 Bearer、active、frontend 和安全写入顺序；恢复/刷新只验证既有凭据，不重复写相同 Token。
6. 注册成功后若自动登录、权限验证或安全写入失败，清理密码引用，尝试撤销已创建远端会话，并返回 `ENTERPRISE_REGISTERED_LOGIN_REQUIRED`。
7. 注销 204/401 删除凭据；网络/5xx 保留凭据并切换 `service_unavailable`。
8. `onClose` 先停止 SessionManager 的未完成请求，再按现有顺序关闭其余资源。
9. 路由校验 email/name/password，不把请求 body 写日志；`GET /enterprise/session` 永远只返回 Protocol 快照。

**TDD**

- 策略：必须。
- RED-1：`restores valid sessions without blocking local server startup`。Credential Store 返回 Token，`getMe` 延迟；先断言 `/healthz` 可用和 session=`checking`，再完成 `/me` 并断言 `signed_in`。
- RED-2：`uses one validation rule for login restore and refresh`。参数化 active/frontend/401/network，断言三入口状态、Token 删除/保留完全一致。
- RED-3：`preserves the token when logout cannot reach the enterprise service`。断言 503、Store 未 delete、snapshot=`service_unavailable`。
- RED-4：`returns registered-login-required without exposing the password`。注册成功后登录失败，断言 409 details 只有规范化邮箱。
- RED-5：`rejects unauthorized enterprise e2e credential identities before opening keyring`。断言无 E2E 变量的普通生产启动成功且不产生 `enterpriseE2ERunId`；参数化缺失授权值、非法 UUID 和非 loopback Origin，断言返回 `ENTERPRISE_E2E_CONFIG_FORBIDDEN` 且 Entry factory 未调用；只有完整授权组合可得到 `enterpriseE2ERunId`。
- GREEN：实现状态机、注入和五个路由，运行 SessionManager 单元测试与 V-DAEMON-API。
- REFACTOR：合并重复判定到 `validateAuthenticatedSession`，运行本任务全部测试和现有 `startup.test.ts`、`api.test.ts` 的 health/auth 基线。

**任务完成门**

- 会话单元/API 测试通过；普通生产与受限 E2E 启动身份边界通过；企业离线不阻塞本地 Server；Runtime JSON 和错误中无 Token/密码；AC-1 至 AC-5 可由 API 观察。

### TASK-5：实现企业安装记录和统一内容摘要 `[FR-5, FR-8, BR-6, BR-7, DEC-5, DEC-6]`

**交付结果**

- SQLite 持久化企业来源与安装后摘要；同一摘要实现可验证安装源、目标和锁内当前目录。

**文件与符号**

- 修改：`apps/daemon/src/storage/migrations.ts` - `migrate`。
- 修改：`apps/daemon/test/unit/storage.test.ts`。
- 创建：`apps/daemon/src/enterprise/install-records-2026-07-30.ts`。
- 创建：`apps/daemon/src/enterprise/skill-content-digest-2026-07-30.ts`。
- 创建：`apps/daemon/test/unit/enterprise-install-records-2026-07-30.test.ts`。
- 创建：`apps/daemon/test/unit/enterprise-skill-content-digest-2026-07-30.test.ts`。

该任务超过 5 个文件，因为 Schema、Repository 和摘要共同构成来源记录的不可分割一致性边界。

**实施步骤**

1. 新表和索引使用 `IF NOT EXISTS`；旧数据库升级不修改公共表、不删除文件。
2. Repository 提供 `getBySkillId`、`getByName`、`listRecords`、`upsertRecord`；不提供删除/恢复补偿接口。时间映射复用公共记录的严格 SQLite UTC 解析语义。
3. `upsertRecord` 用单条 `INSERT ... ON CONFLICT DO UPDATE` 原子语句同时更新远端包摘要和 `installed_content_sha256`，保留首次 `installed_at`；语句失败时新安装仍无记录、更新仍保留旧记录。
4. 内容摘要按契约流式处理；拒绝符号链接、非普通文件和遍历期间消失/变化的文件。
5. 测试证明相同树创建顺序不影响摘要，而路径、长度、内容任一变化会改变摘要。

**TDD**

- 策略：必须。
- RED-1：`migrates enterprise install records without adding credential columns`。从旧数据库打开，断言表/索引/列精确集合；预期表不存在。
- RED-2：`hashes canonical file trees and rejects symlinks`。创建不同顺序的等价目录和内容变化目录，预期函数不存在。
- RED-3：`preserves the previous enterprise record when an atomic upsert aborts`。先写旧记录，再用测试 trigger 中止更新，断言旧行完整不变；新安装中止后仍无记录。
- GREEN：实现迁移、Repository 和摘要，运行两个目标单元测试及 `storage.test.ts`。
- REFACTOR：共享严格 UTC 解析函数时只在不改变公共记录行为的前提下进行；运行公共市场记录回归。

**任务完成门**

- 升级幂等；表中无凭据字段；摘要算法与契约一致；AC-7、AC-9、AC-10 的数据基础具备。

### TASK-6：实现安全 ZIP 解压和包验证 `[FR-6, FR-7, BR-3, BR-7, BR-8, DEC-6]`

**交付结果**

- 真实 ZIP 字节可在限额内安全解压为单一 Skill 源目录；恶意或损坏包在写锁前被拒绝并清理。

**文件与符号**

- 修改：`apps/daemon/package.json` - 增加 `yauzl@3.4.0`、`@types/yauzl@3.4.0`。
- 修改：`pnpm-lock.yaml`。
- 创建：`apps/daemon/src/enterprise/skill-package-2026-07-30.ts` - `extractEnterpriseSkillPackage`、限制常量。
- 创建：`apps/daemon/test/unit/enterprise-skill-package-2026-07-30.test.ts`。

**实施步骤**

1. 测试使用真实 ZIP 构造器生成普通文件、目录、重复路径、反斜杠、Zip Slip、符号链接、截断和大小欺骗样本；不得 Mock 被测 ZIP 解析。
2. lazy 读取每个 entry，先验证文件名和 external attributes，再创建目录/文件；写文件使用 exclusive create，防止重复覆盖。
3. 同时累计条目数、声明大小、实际流大小和总展开大小；任何超限中断读取并删除整个解压目录。
4. 解压完成后归一单根，调用现有 Skill validator；远端 `name` 同时匹配本地目录 ID和 `SKILL.md` metadata name。
5. 成功返回 `{sourcePath, contentSha256}`；调用方负责最终工作目录生命周期。

**TDD**

- 策略：必须。
- RED：`rejects every unsafe archive before a skill write can begin`。表驱动覆盖绝对路径、盘符、`..`、反斜杠、重复路径、symlink、非普通文件、条目超限、膨胀、缺失/重复 `SKILL.md`、名称不一致、CRC/截断；每例断言稳定错误、解压目录为空且写事务 spy 未调用。
- GREEN：实现最小安全解压器，运行目标测试。
- REFACTOR：把路径验证和 entry 类型判断保持为纯函数；重跑全部恶意样本和 V-DAEMON typecheck。

**任务完成门**

- 所有恶意 ZIP 样本稳定拒绝，合法两种根布局通过；失败后无临时内容；AC-8 具备完整自动化证据。

### TASK-7：实现企业 Skill 聚合、安装事务和 Runtime 路由 `[FR-4..FR-8, BR-3, BR-6..BR-8, NFR-1, DEC-3, DEC-5, DEC-6]`

**交付结果**

- 已登录用户可通过 Runtime 获取七种状态并安全安装/更新；注销、离线和下架不删除本地 Skill。

**文件与符号**

- 创建：`apps/daemon/src/enterprise/skill-manager-2026-07-30.ts` - `EnterpriseSkillManager`。
- 修改：`apps/daemon/src/api/routes.enterprise-2026-07-30.ts` - 增加四个 Skill 路由。
- 修改：`apps/daemon/src/api/server.ts` - 构造企业记录和 Skill Manager。
- 创建：`apps/daemon/test/unit/enterprise-skill-manager-2026-07-30.test.ts`。
- 修改：`apps/daemon/test/integration/enterprise-api-2026-07-30.test.ts`。

**实施步骤**

1. Manager 依赖 SessionManager、HTTP Client、SkillManager、公共记录、企业记录和 `dataDir`；没有有效 Token 时不调用上游。
2. 列表/详情读取最多初始请求加 2 次重试，退避 250ms/500ms；429 遵循有效 `Retry-After` 但单次等待最多 2 秒。401/403/404/409 和所有写操作不重试。
3. 401 调用 `invalidateUnauthorized`；403 保留 session；404/409 触发一次目录刷新但不继续当前安装。
4. 列表合并远端条目与企业记录中的下架条目，按“状态聚合顺序”计算 status/integrity/actions。
5. install/update 调用 TASK-3 下载和 TASK-6 解压，再按“下载、ZIP 与事务边界”进入 `withWriteTransaction`。
6. 锁内重新读取 `transaction.getSkill(name)`、公共记录、企业记录和当前摘要；任何来源或摘要变化在文件操作前失败。
7. 安装成功后目标摘要必须等于源摘要；在企业记录写入前完成所有必须成功的工作目录清理，清理失败使用 `rollbackSkillInstall` 恢复。
8. `upsertRecord` 是锁内最后一个提交点；失败时回滚文件且依靠单条 SQLite 语句保留操作前记录，成功后不再执行可能把操作改判为失败的步骤。
9. 日志不记录 ZIP 内容、SKILL.md、Token、Authorization 或完整 Query URL。

**TDD**

- 策略：必须。
- RED-1：`computes all seven statuses and orthogonal local integrity`。组合远端、本地扫描、公共记录、企业记录和摘要，断言 status/actions。
- RED-2：`rechecks source ownership inside the write lock before installing`。下载完成后、锁取得前注入未知目录、公共记录和其他 enterprise skillId，断言 `SOURCE_CONFLICT` 且 install spy 未调用。
- RED-3：`blocks an update when the local tree changed during download`。下载前摘要匹配，锁内修改文件，断言 `LOCAL_CHANGED`、无备份/安装/记录写入。
- RED-4：`rolls back new installs and updates before the final record commit`。分别对新安装和更新注入目标摘要、记录写入前强制清理、最终原子 upsert 错误；断言文件树和企业记录均等于操作前状态。另断言 upsert 成功后没有必需的可失败步骤。
- RED-5：`does not retry login logout install update or semantic 4xx`，并证明列表/详情网络错误只按上限重试。
- GREEN：实现 Manager、路由和错误映射，运行目标单元测试与 V-DAEMON-API。
- REFACTOR：共享聚合纯函数和回滚包装，但不修改公共市场 Manager；运行公共市场 Manager/route 回归和 V-DAEMON。

**任务完成门**

- 七种状态、锁内冲突、回滚、下架保留、重试上限和路由状态码测试通过；AC-7 至 AC-11 可从 Runtime API 观察。

### TASK-8：实现账户 Service 和账户页交互 `[FR-2, FR-3, BR-1..BR-5, NFR-1, NFR-2, NFR-5, DEC-2, DEC-4, DEC-7]`

**交付结果**

- React 账户页简洁呈现登录、注册、checking、signed-in 和离线状态，密码生命周期符合 NFR-2。

**文件与符号**

- 创建：`apps/web/src/services/enterprise-service-2026-07-30.ts` - `createEnterpriseService`。
- 创建：`apps/web/src/services/enterprise-service-2026-07-30.test.ts`。
- 创建：`apps/web/src/features/account/EnterpriseAccountPage-2026-07-30.tsx`。
- 创建：`apps/web/src/features/account/EnterpriseAccountPage-2026-07-30.test.tsx`。
- 修改：`apps/web/src/styles/app.css` - 账户页和侧栏账户区样式。

**实施步骤**

1. Service 只调用本文九个 Runtime 路由，登录/注册 body 不增补任何客户端字段。
2. AccountPage 使用分段控件切换登录/注册，提交期间锁定控件；由组件持有密码和确认密码，不写浏览器存储。
3. 401 映射为保留邮箱、清空并聚焦密码；注册部分成功切回登录并预填规范化邮箱。
4. 模式切换、成功 session 变为 `signed_in`、组件卸载时清空密码 state 和对应 input value。
5. `checking` 显示有限验证状态；超时后显示手动重新检测，不自行持续轮询。
6. `service_unavailable` 显示最近账号摘要（若有）和重试；`signed_in` 展示名称、邮箱、到期时间和注销。
7. 不展示 `transportSecurity` 或可编辑 Origin；账户页直接进入登录、注册或会话状态主体。

**TDD**

- 策略：必须。
- RED-1：`posts only account fields to exact enterprise runtime routes`。断言 Service 路径和 body 精确相等，预期 Service 不存在。
- RED-2：`clears passwords on mode change success and unmount`。输入密码后依次切换、rerender signed-in、unmount，通过 input value 和捕获引用断言清空。
- RED-3：`switches registered users back to login without retaining password`。回调返回 accountCreated 结果，断言邮箱预填、密码空、提示存在。
- RED-4：`shows insecure transport warning only for HTTP`。
- GREEN：实现 Service、组件和最小样式，运行两个目标测试。
- REFACTOR：只抽取表单校验和错误映射纯函数；重跑组件、Service 和 app CSS 测试。

**任务完成门**

- 账户页全部业务状态和密码生命周期测试通过；页面无协议说明，DOM/Storage 检查无 Token 字段；AC-2 至 AC-5、AC-12 的前端组件证据具备。

### TASK-9：接入账户路由、侧栏和会话控制 `[FR-1..FR-3, NFR-4, DEC-1, DEC-2, DEC-4]`

**交付结果**

- 用户可从独立账户入口进入 `#/account`，设置仍是独立图标；Runtime 连接后会话恢复和 15 秒有限轮询生效。

**文件与符号**

- 修改：`apps/web/src/app/routes.ts`、`routes.test.ts`。
- 修改：`apps/web/src/app/app-state.ts`、`app-state.test.ts`。
- 修改：`apps/web/src/features/shell/OpenCreatorSidebar.tsx`、`OpenCreatorSidebar.test.tsx`。
- 修改：`apps/web/src/app/AppController.tsx`、`App.test.tsx`。

该任务超过 5 个文件，因为账户导航、侧栏入口和会话生命周期必须作为一个可见纵向流程上线，不能留下可导航但无状态的中间页面。

**实施步骤**

1. `AppRoute`、`ActiveView` 和 route/state reducer 增加 `account`。
2. Sidebar props 增加脱敏 `enterpriseSession` 和 `onOpenAccount`；展开/收起两种布局分别验证固定尺寸、Tooltip、aria-current 和不溢出。
3. AppController 创建 EnterpriseService，维护 session、提交/刷新/注销操作和 generation；Runtime 断开时停止请求，不影响本地状态加载。
4. 连接后先读 session；若 `checking`，每 250ms 重读，最多 15 秒。旧 Runtime generation 的迟到响应不得覆盖新连接。
5. 登录/注册成功更新 session；企业 Tab 发起登录时保存返回路由 `#/plugins?source=enterprise`，成功后导航返回。
6. 账户入口不替代设置入口；设置行为和现有测试保持。

**TDD**

- 策略：必须。
- RED-1：`round-trips the account route and keeps settings separate`。预期 route 和 Sidebar 新入口不存在。
- RED-2：`polls checking only until a terminal state or fifteen seconds`。Fake timers 返回 checking 后 signed-in/持续 checking，断言次数、停止条件和手动刷新。
- RED-3：`does not gate local navigation while enterprise restore is unavailable`。企业 session 请求 503，本地项目、对话和公共市场仍可打开。
- GREEN：接入路由、Sidebar、Controller 和 AccountPage，运行对应目标测试。
- REFACTOR：把 session generation 判断保持为局部 helper，禁止把 Token 或密码提升到 AppController；运行 V-WEB-TARGET 和现有设置/侧栏回归。

**任务完成门**

- 账户路由、独立设置、有限轮询、Runtime 重连和本地不阻断测试通过；AC-1、AC-3、AC-4、AC-6 的 Web 集成部分具备。

### TASK-10：实现企业 Skill Hub 视图和来源 Tab `[FR-4, FR-5, FR-8, BR-6, BR-7, DEC-2, DEC-5]`

**交付结果**

- 插件页默认公共市场，并可切换到基于 Daemon 聚合结果的企业紧凑列表、详情和登录门槛。

**文件与符号**

- 修改：`apps/web/src/features/plugins/PluginsPage.tsx` - 从重导出改为来源容器。
- 创建：`apps/web/src/features/plugins/EnterpriseSkillHubView-2026-07-30.tsx`。
- 创建：`apps/web/src/features/plugins/EnterpriseSkillHubView-2026-07-30.test.tsx`。
- 修改：`apps/web/src/features/plugins/skill-market.css`。
- 修改：`apps/web/src/features/plugins/SkillMarketView.test.tsx` - 公共市场 characterization。

**实施步骤**

1. `PluginsPage` 只负责来源分段控件和两个现有/新增 View，不把企业数据塑造成公共市场卡片。
2. 公共 Tab 默认，原公共搜索、分类、分页、详情、安装、更新和使用 DOM/行为保持。
3. 企业 Tab 未登录显示账户入口；`checking/service_unavailable` 分别显示验证/离线状态和刷新。
4. 已登录列表支持搜索、状态筛选、刷新和紧凑行；根据 `actions` 渲染安装/更新/使用，`local_changed/name_conflict/invalid/unpublished` 显示明确原因。
5. 详情弹窗按需加载 `GET /enterprise/skills/:id`，展示描述、版本、更新时间、changelog 和本地状态；关闭恢复焦点。
6. 变更操作进行中锁定同一条目和全局企业写动作，防止重复提交。

**TDD**

- 策略：必须。
- 基线：先运行现有 `SkillMarketView.test.tsx`，记录公共市场测试通过；这是兼容基线，不是 RED。
- RED-1：`defaults to the public market and gates enterprise skills by session`。预期 `PluginsPage` 仍只是公共市场重导出。
- RED-2：`renders all enterprise statuses with the exact allowed actions`。表驱动七状态和 `local_changed` integrity。
- RED-3：`loads detail on demand and restores trigger focus`。
- GREEN：实现来源容器和企业 View，运行企业组件测试与公共市场基线。
- REFACTOR：企业行/详情可共享小型状态展示函数，不修改公共 Card 模型；运行 V-WEB-TARGET 两个测试。

**任务完成门**

- 公共市场无回归；企业七状态、详情、焦点和登录门槛通过；AC-6、AC-7、AC-10 的组件部分具备。

### TASK-11：接入企业 Hub 数据、写操作和“使用”流程 `[FR-4, FR-5, BR-3, NFR-4, DEC-2, DEC-5]`

**交付结果**

- AppController 在企业 Tab 按需加载列表/详情，安装或更新后刷新状态；企业 Skill 可复用公共市场的项目选择和草稿插入流程。

**文件与符号**

- 修改：`apps/web/src/services/enterprise-service-2026-07-30.ts`、对应测试。
- 修改：`apps/web/src/app/routes.ts`、`routes.test.ts` - `plugins.source` Query。
- 修改：`apps/web/src/app/AppController.tsx`、`App.test.tsx`。
- 修改：`apps/web/src/features/plugins/SkillMarketView.tsx` 或相邻现有 helper - 抽取来源无关“使用 Skill”入口时保持公共 props 兼容。

**实施步骤**

1. Service 增加 list/detail/install/update 精确路径；操作只传路径参数，不传远端版本或摘要。
2. `#/plugins?source=enterprise` 可解析、格式化和刷新恢复；非法 source 回退公共市场。
3. AppController 只在企业 Tab 且 `signed_in` 时加载目录；切换 Runtime/session 使用 generation 丢弃迟到响应。
4. 401 更新全局 session 为 `signed_out`；403 保留 session 并显示 Hub 无权限；404/409 刷新目录但不自动重复写。
5. 安装/更新成功后读取新列表；失败保持条目和可手动重试状态。
6. 抽取 `useSkillByName(name,title,projectId)`，公共市场和企业 Hub 都创建 Thread、导航并插入 `$name `；不自动发送。

**TDD**

- 策略：必须。
- RED-1：`restores the enterprise source route and loads skills only when signed in`。
- RED-2：`posts enterprise mutations without version or digest fields and refreshes once`。
- RED-3：`turns enterprise unauthorized into signed-out without affecting public market`。
- RED-4：`uses an enterprise skill through the same project dialog and composer draft path`，断言 Thread API、导航和 `$name `。
- GREEN：实现 Service/route/Controller 接入，运行企业 Service、routes 和 App 目标测试。
- REFACTOR：公共/企业“使用”只共享真正相同的创建对话函数，不合并两个目录模型；运行公共市场 App 回归和 V-WEB。

**任务完成门**

- 企业 Tab 路由恢复、按需加载、错误状态、安装/更新和使用通过；公共市场仍默认且行为不变；AC-6、AC-7、AC-11 的 Web 集成部分具备。

### TASK-12：建立同 Fake Daemon 的 Web/Desktop 一致性门 `[FR-1, FR-2, FR-4, FR-5, FR-8, NFR-4, DEC-1..DEC-3]`

**交付结果**

- 在相同业务数据、偏好和前端内容区尺寸下，Browser Bridge 与 Desktop Bridge 的账户和企业 Hub 主流程具有相同 DOM、文案、尺寸、Runtime 请求和结果。

**文件与符号**

- 创建：`apps/web/e2e/support/fake-enterprise-daemon-2026-07-30.ts`。
- 创建：`apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts`。
- 修改：根 `playwright.config.ts` 或现有 Web E2E 配置，仅在当前配置无法启动共享 Web server 时调整。

**实施步骤**

1. Fake Daemon 只实现 Runtime 公开边界，不模拟 React 业务；提供会话四态、登录/注册、企业目录/详情/安装和请求日志。
2. 两轮运行使用同一 Fake Daemon 实现和同一 seed；每轮前 reset 到相同账号、Skill、项目、偏好和安装状态。
3. Browser 页面通过 `/.opencreator/runtime-config` 获取同源 Runtime；Desktop 页面在应用脚本加载前注入最小 `window.opencreatorDesktop`，其 `readConnectionConfig` 指向同一 Runtime，其他原生能力只提供真实标识所需实现。
4. 两端都使用 `1280x800` 前端内容视口、相同 deviceScaleFactor 和字体环境。
5. 依次验证账户入口、登录、恢复、企业来源 Tab、列表、详情、一次安装和一次使用；捕获主要 DOM、可见文案、关键元素 bounding boxes、Runtime 请求序列和 Fake Daemon 最终状态。
6. 允许存在明确的平台专属设置入口差异，但账户/Hub 主体不得按 `hostBridge.kind` 分叉。

**TDD**

- 策略：一致性验收/characterization 门，明确豁免 TDD RED。TASK-8 至 TASK-11 已先用行为测试取得各自 RED，因此本任务首次运行即通过不构成违规。
- BASELINE：新增一致性 spec 后直接运行 V-CONSISTENCY；若失败，失败必须指向 TASK-8 至 TASK-11 已实现行为的跨 Bridge 差异，并回到所属任务修复，不能制造人为 RED 或放宽归一断言。
- GREEN：V-CONSISTENCY 两端归一快照相等。
- REFACTOR：只稳定测试选择器和归一化平台专属字段，禁止删除主体 DOM/尺寸断言；重跑 V-CONSISTENCY 两次排除偶发性。

**任务完成门**

- V-CONSISTENCY 连续两次通过；证据包含两端截图、DOM/尺寸摘要、请求序列和最终持久状态；AC-6 自动化部分通过。

### TASK-13：完成 Keyring 打包、HTTPS 门和实际 App E2E `[NFR-1, NFR-3..NFR-5, DEC-3, DEC-7]` `[已完成]`

**交付结果**

- 实际 Desktop 包包含当前平台 Keyring `.node` 和当前 Web 产物；HTTP 只允许 `--dir` 联调，正式发布被 HTTPS 硬门保护；打包 App 可完成会话恢复和企业操作。

**文件与符号**

- 修改：`apps/desktop/scripts/prepare-daemon.mjs`。
- 修改：`apps/desktop/scripts/package-release.mjs`。
- 修改：`apps/desktop/scripts/verify-package.mjs`。
- 修改：`apps/desktop/src/main/main.ts`、`bootstrap-controller.ts`、`daemon-manager.ts` 及对应测试，仅用于校验并透传 typed 企业配置，不新增 IPC。
- 创建：`apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts`。

**实施步骤**

1. `prepare-daemon` 在 `pnpm deploy --prod` 后定位当前平台 `@napi-rs/keyring-*` optional package 和唯一 `keyring.<platform>.node`；缺失立即失败。`better-sqlite3` 仍按现有流程重建。
2. `verify-package` 在 App 的 `resources/daemon/node_modules` 中检查 Keyring loader、当前平台 optional package和 `.node`；继续执行现有 Web 文件列表/内容哈希比较。
3. `package-release` 在 Daemon 构建后读取打包使用的 `DEFAULT_ENTERPRISE_ORIGIN`。`--dir` 允许 HTTP 并记录 `insecure_http`；`--dist/--release` 若不是 HTTPS，在 electron-builder 前失败。
4. E2E 生成唯一 UUID，同时通过 `--opencreator-enterprise-e2e=<UUID>`、`OPENCREATOR_ENTERPRISE_E2E_RUN_ID=<UUID>` 和 loopback `OPENCREATOR_ENTERPRISE_ORIGIN` 启动实际 App；Desktop Main 按授权契约生成 typed `enterpriseE2ERunId`。
5. DaemonManager 清除继承环境中的所有企业 E2E/Keyring 身份变量，只从 typed input 写入 Origin、run ID 和 `OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED=packaged-app`；普通启动不得透传覆盖。
6. 打包 E2E 使用临时 CODEX_HOME 和由 UUID 派生的唯一 Keyring 项；通过 `opencreator-app://app` 依次注册或登录、关闭并重启 App 恢复会话、打开企业列表、安装一个真实 ZIP Skill、使用或检查本地文件、注销清凭据。
7. E2E 结束始终尝试注销和删除派生 Keyring 项；失败时记录残留 run ID/service/account，不输出 Token。
8. 运行实际包前必须重新执行 V-PACKAGE，禁止复用无法证明来源的旧包。

**TDD**

- 策略：打包脚本和 E2E 行为必须；原生 Keyring 本体由真实环境验证。
- RED-1：在部署目录删除/伪造 Keyring `.node`，运行脚本级测试或 verify helper，断言打包校验失败；预期现有脚本不检查。
- RED-2：以 HTTP 配置运行 `package-release --dist` 的可测试门函数，断言在 electron-builder 前失败；`--dir` 允许。
- RED-3：`rejects packaged e2e keyring configuration without the matching launch gate`。分别只给环境、只给参数、UUID 不同、非法 UUID 和非 loopback Origin，断言在 Daemon 启动前失败；合法组合只传递派生身份所需的 run ID。
- RED-4：实际 App spec 断言 `opencreator-app://`、Runtime 登录、重启恢复、企业列表和安装；预期功能或打包资源缺失失败。
- GREEN：更新脚本和 E2E 后运行 V-PACKAGE、V-DESKTOP-E2E。
- REFACTOR：平台 package 映射可抽成脚本内纯函数并加表驱动测试；重跑 `apps/desktop/test`、V-PACKAGE、V-DESKTOP-E2E。

**任务完成门**

- Keyring `.node`、Web 哈希、Runtime 代理、`opencreator-app://`、E2E 启动双信号、派生安全存储恢复和企业操作全部由当前工作区实际包证明；越权 E2E 配置在 Daemon 前失败，HTTP 正式发布失败、HTTPS 配置可继续；AC-5、AC-12、AC-13 通过。

### TASK-14：执行完整功能验收 `[已完成：联调 PASS / 发布 BLOCKED]`

**交付结果**

- 以最后一次相关修改后的新鲜证据证明 AC-1 至 AC-13；任一 P0 `FAIL/BLOCKED` 时不宣布完成或可发布。

**本地实现差异自审**

1. 运行 `git diff --stat`、`git diff -- packages/protocol apps/daemon apps/web apps/desktop pnpm-lock.yaml` 和 `git diff --check`。
2. 对照契约快照、追踪矩阵和 TASK-1 至 TASK-13，检查漏项、范围外实现、接口/数据/错误漂移和 AC 降级。
3. 检查 Token/密码边界、重试、generation、锁内前置检查、回滚、临时目录清理、HTTP 发布门和 Desktop/Web 分叉。
4. 检查是否产生重复企业状态模型、重复摘要实现、公共市场回归、过度抽象或无关格式化。
5. 自审发现问题时按所属 TASK 的 RED/GREEN 修复并重跑受影响测试；任何相关修改都会使旧验收证据失效。
6. 自审通过后再执行下面的功能验收，不启动 Reviewer。

**验收环境**

- Daemon 单元/集成：内存 Credential Store、受控 Fake Enterprise HTTP 服务、临时 SQLite、临时 CODEX_HOME、真实 ZIP 字节。
- Web 一致性：同一个 Fake Daemon 实现和 seed、`1280x800` 内容视口、Browser/Desktop Bridge 两轮运行。
- Desktop：当前工作区重新 `desktop:package` 的本机原生包、临时用户目录/CODEX_HOME、参数与环境双信号授权的唯一 E2E run ID、派生 Keyring 身份和本机 loopback Fake Enterprise 服务。
- HTTPS 发布门：测试配置使用本机 HTTPS Fake Origin 或脚本门纯函数；不得把当前 HTTP 默认误记为可发布。
- 清理：关闭 Server/App、删除临时目录、注销并删除 E2E Keyring 条目；不删除用户现有 Skill 或凭据。

**最终验收矩阵**

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 证据 |
|---|---|---|---|---|---|---|---|
| AC-1 | P0 | 未登录/企业离线不阻断 | 无 Token；Fake 企业服务离线 | 启动 Web 和实际 App，打开项目、会话、设置和公共市场 | 无全局登录门；本地页面和公共市场可操作 | V-CONSISTENCY + 打包 App UI | PASS/FAIL/BLOCKED、截图、请求摘要、时间 |
| AC-2 | P0 | 注册并登录 | 未注册邮箱；Fake 服务记录请求 | 注册有效名称/邮箱/密码 | 注册无 client_id、Cookie 未使用；随后 `opencreator-agent` 登录和 `/me` 验证；成功显示账户 | Runtime API + Web UI + 打包 App | 请求字段、状态流、截图 |
| AC-3 | P0 | 四态和权限判定 | Store 分别为空、有效、失效；账号 inactive/frontend=false；网络失败 | 登录、启动恢复、手动刷新 | 三入口判定一致；认证/权限失败清凭据，网络失败保留；无持续轮询 | Session API + Web fake timers + App 重启 | Store 调用、API 响应、轮询次数 |
| AC-4 | P0 | 注销语义 | 已登录 | 分别返回 204、401、网络失败 | 204/401 清凭据；网络失败保留并不显示成功 | Runtime API + Web UI | 状态码、Store 状态、可见提示 |
| AC-5 | P0 | 凭据与诊断安全 | 完成成功/失败认证、诊断导出和打包 | 检查 Runtime JSON、React/Storage、SQLite、日志、诊断、包资源 | 无密码、Token、Authorization、Cookie；Token 只在唯一 Keyring 项 | 安全测试 + 文件/DB/包扫描 | 扫描命令和 0 泄漏摘要 |
| AC-6 | P0 | Web/Desktop 一致性 | 同 Fake Daemon、seed、偏好、视口 | 登录、恢复、切来源、列表、安装或使用 | 主 DOM、文案、尺寸、状态、Runtime 请求和结果一致 | V-CONSISTENCY + 实际 App | 两端截图、归一快照、请求序列 |
| AC-7 | P0 | 七状态与并发来源变化 | 构造七状态；下载期间改变本地/记录 | 加载列表并安装/更新 | 状态/actions 正确；锁内变化返回稳定冲突且零写入 | Daemon Manager/API + Web UI | 状态表断言、写 spy、文件摘要 |
| AC-8 | P0 | 恶意 ZIP | 摘要错、Zip Slip、反斜杠、重复、symlink、超限、截断、无效 Skill | 发起安装 | 全部拒绝；临时内容清理；本地 Skill/记录不变 | 真实 ZIP 单元 + API | 表驱动结果、目录/DB 快照 |
| AC-9 | P0 | 安装/更新事务和回滚 | 新安装与已安装企业 Skill 两组夹具 | 在锁前置、覆盖后、目标摘要、记录写入前强制清理、最终原子 upsert 阶段注入失败 | 冲突前不写；最终 upsert 前失败回滚文件；upsert 失败保留操作前记录；成功 upsert 后无必需可失败步骤；无半安装目录 | 并发/事务集成 | 前后树摘要、记录、操作日志 |
| AC-10 | P1 | 注销/离线/下架后使用 | 已安装企业 Skill；下架场景保持登录且远端列表可成功返回 | 注销或企业服务离线后在普通对话直接调用已安装 `$skill-name`；恢复登录后让远端列表移除该条目并打开 Hub | 文件始终不删除；注销或离线时有效 Skill 仍可调用；只有成功列表缺少条目时显示 `unpublished`，只允许使用、不允许更新 | Runtime API + 普通对话 + Web/Desktop Hub | 文件存在、调用结果、`unpublished/use`、无更新动作 |
| AC-11 | P0 | 重试边界 | 模拟登录/注销、429、409、网络错误 | 执行读写操作 | 登录/注销/安装/更新一次；读取只在允许条件和上限内重试 | HTTP/Manager 单元 | 请求次数和等待序列 |
| AC-12 | P0 | 简洁账户页与 HTTPS 发布门 | HTTP/HTTPS 两种配置 | 打开账户页；运行 `--dir`、`--dist` 门 | 账户页不展示协议说明；HTTP 只允许联调目录；非 HTTPS dist/release 失败；HTTPS 继续 | Web UI + 打包脚本 | 截图、脚本退出码/阶段 |
| AC-13 | P0 | 实际打包 App | 当前工作区重建包；唯一 UUID、匹配启动参数/环境和 loopback Fake Origin | 访问 `opencreator-app://`，登录、重启恢复、列表、企业操作并校验包；另以不完整/越权 E2E 配置启动 | Preload/Runtime 代理可用；Keyring 从派生测试项恢复且生产项不受影响；越权配置在 Daemon 前失败；Web 文件列表/哈希一致 | V-PACKAGE + V-DESKTOP-E2E | 构建 manifest、verify JSON、派生身份、E2E trace |

**最终命令顺序**

1. V-PROTOCOL。
2. V-DAEMON。
3. V-WEB。
4. V-CONSISTENCY 连续两次。
5. V-ALL。
6. V-PACKAGE。
7. V-DESKTOP-E2E。
8. 最后再次运行 `git diff --check` 和安全字符串/SQLite Schema 扫描。

**任务完成门**

- 自审无未修问题。
- AC-1 至 AC-13 均记录新鲜 `PASS` 证据。
- 所有公共命令退出 0。
- 当前 HTTP 默认仍存在时，只能声明“受控联调完成”，不得声明正式发布可用；正式发布必须有 HTTPS 配置证据。

**执行结果（2026-07-30）**

- TASK-13：PASS。Desktop 企业启动双信号、Daemon 继承环境清洗、派生 Keyring 身份、Keyring/SQLite 原生模块打包、Web 哈希校验、HTTP/HTTPS 发布门和实际打包 App 企业流程均已实现并验证。
- TASK-14：受控联调验收 PASS；正式发布状态 BLOCKED。阻塞原因仅为当前默认企业 Origin 仍是 `http://1.13.175.31:1904`，发布门会以 `ENTERPRISE_RELEASE_REQUIRES_HTTPS` 阻止 `--dist/--release`。
- `pnpm -r typecheck`：退出 0。
- `pnpm -r test`：退出 0；Desktop 19 文件/83 测试，Web 84 文件/638 测试，Daemon 84 文件通过、2 文件跳过/762 测试通过、23 跳过，Protocol 1 测试，Skill Market 6 测试，Harness 3 测试。
- `pnpm -r build`：退出 0。
- V-CONSISTENCY：连续两次退出 0；每轮 Chromium Desktop 通过，移动项目按规格跳过。
- `pnpm desktop:package`：退出 0；账户页简化后重新生成的新鲜 `--dir` 包记录 `insecure_http`，构建清单 Web 哈希为 `ccb5c572f1287eef8cf7f032b6fe977f9b95b1de4c57b37bdc086c0470ece307`，文件数 39。
- `pnpm --filter @opencreator/desktop verify:package`：退出 0；包大小 531337447 字节，Daemon 43820011 字节，`@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node`、SQLite、Electron fuses 和隐私约束通过。
- Desktop 企业契约测试：3 文件、13 测试通过；覆盖不完整/不匹配/非法/非 loopback E2E 配置拒绝、大小写无关环境清洗、Keyring 产物和 HTTP/HTTPS 门。
- V-DESKTOP-E2E：完整套件曾 12/12 通过；账户页简化后的新鲜包再次运行企业实际包规格 1/1 通过，耗时 27.6 秒，完成 `opencreator-app://` 登录、重启恢复、真实 ZIP Skill 安装和使用、注销及再次重启保持未登录。
- AC-1 至 AC-4：PASS；由 Daemon 会话/API 测试、Web 测试、一致性规格和实际 App 登录/恢复/注销流程覆盖。
- AC-5：PASS；`git diff --check` 无输出，生产源码高熵凭据扫描无命中，App 包不包含企业 E2E 邮箱、密码或测试 Token，`enterprise_skill_installs` 仅含 Skill 身份、版本、摘要和时间字段。
- AC-6：PASS；同 Fake Daemon、同桌面内容视口下 Browser/Desktop Bridge 两轮一致性规格通过，实际 App 使用同一 Web 构建产物。
- AC-7 至 AC-11：PASS；七状态、锁内来源/摘要复核、恶意 ZIP、安装更新事务与回滚、下架后使用和重试边界由 Daemon 单元/集成测试覆盖。
- AC-12：PASS；账户页已移除协议说明，`--dir` 允许 HTTP 并在构建清单记录 `insecure_http`，HTTP `--dist/--release` 被硬门拒绝，HTTPS 配置可继续。当前部署配置尚未满足 HTTPS，因此不能发布。
- AC-13：PASS；当前工作区新鲜包通过包契约和完整实际 App E2E，测试 Keyring 项按 UUID 派生并在结束时清理。

## 发布、迁移与回滚

### 迁移

1. SQLite 只新增 `enterprise_skill_installs` 和索引；迁移幂等，旧版本忽略该表。
2. 公共市场记录不迁移、不改写；同名项由聚合状态保护。
3. Token 不进入 SQLite，因此没有 Token 数据迁移。
4. 生产 Keyring service/account 固定且升级后可读取同一凭据；E2E 仅用受限 run ID 派生隔离身份，不接受任意覆盖且不污染生产项。

### 发布

1. `desktop:package --dir` 可在固定 HTTP Origin 下用于受控联调，账户页不展示连接协议说明。
2. `desktop:dist` 和 `desktop:release` 在非 HTTPS Origin 下必须于 electron-builder 前失败。
3. 发布包必须包含当前平台 Keyring `.node`、当前 Daemon、当前 Web 产物和一致的构建 manifest。
4. 企业服务故障不得阻止 App 启动或公共市场使用。

### 回滚

1. UI 回滚可移除账户入口和企业 Tab，不删除本地企业 Skill 文件或记录。
2. Daemon 企业路由停用后，旧版本忽略新增表；Keyring Token 可由回滚前版本主动注销/删除，不能复制到明文。
3. 单次安装失败删除新目录；单次更新失败恢复旧目录和旧记录。
4. 已安装企业 Skill 不因远端下架、注销或功能回滚自动删除。

## 偏差规则与最终报告

### 允许偏差

- 不改变契约的局部文件拆分、私有函数名、测试 helper 位置。
- 依赖锁文件解析出的平台 optional package 名称差异。
- 现有测试基础设施要求的命令参数微调。

### 必须停止的偏差

- Token 进入 Renderer、SQLite、文件、普通配置或日志。
- 把安全存储失败降级为明文。
- 登录变为本地功能门槛。
- 改变四态、active/frontend 判定、注销保留语义。
- 企业更新可覆盖未知/其他来源或本地已修改内容。
- 删除锁内二次核验或安装回滚。
- 公共市场默认/行为改变。
- Desktop Bridge 增加企业业务 IPC。
- 降低同 Fake Daemon、实际包或 HTTPS 发布验收。

### 最终报告格式

执行完成后的用户回复必须包含：

1. 实施结果和未完成项。
2. Plan 偏差及是否改变契约。
3. 本地差异自审结论和已修问题。
4. 关键 RED、GREEN、回归命令及结果。
5. AC-1 至 AC-13 的 PASS/FAIL/BLOCKED 摘要和新鲜证据。
6. 安全存储、包校验、HTTPS 发布门和回滚状态。
7. 遗留风险；任一 P0 未通过时明确阻止完成/发布声明。

## 风险

1. 当前企业 Origin 是 HTTP，客户端无法补偿链路明文；只能受控联调，正式发布被硬门阻断。
2. Linux Keyring 依赖桌面 Secret Service/D-Bus；后端不可用时登录必须失败，不得降级。每个正式发布平台都需实际 Keyring E2E。
3. 企业 Skill 是可执行工作流内容；服务端已校验不能替代本地 ZIP、Skill 和来源校验。
4. 文件系统与 SQLite 无法形成单一原子事务，必须依靠现有备份/回滚和锁内记录顺序维持一致。
5. AppController 已较大；实现可抽取企业 Service、纯状态映射和来源无关“使用 Skill”函数，但不得引入第二套全局状态框架。

## 独立审核记录

### Reviewer 原始输出

Reviewer Agent ID：`019fb21a-e577-7c90-b44d-bd827b8cebd5`

```text
## 审核结论
REVISE

## 审核范围
- 本轮目标：只读审核企业账户登录与 Skill Hub 接入的代码级实施计划是否忠实、完整且可直接执行。
- 范围内契约：FR-1..FR-8、BR-1..BR-8、NFR-1..NFR-5、DEC-1..DEC-7、TASK-0..TASK-14、AC-1..AC-13。
- 已检查的直接影响：Protocol、Daemon 会话与 Skill 写事务、SQLite Repository、Web 路由与 Host Bridge、Desktop 打包脚本、实际包 E2E 基础设施及相关测试配置。
- 明确排除：用户列出的认证扩展、企业管理、公共市场重构、Desktop 企业 IPC、业务实现、测试执行、依赖安装、Git 操作和既有未跟踪文件。

## 覆盖摘要
- Plan 忠实保留了可选登录、Daemon Token 唯一所有权、四态会话、active/frontend 权限、注册后自动登录和注销失败保留 Token 等契约。
- 七状态、`unpublished` 成立条件、锁内二次核验、真实 ZIP 安全边界、HTTP 联调边界和 HTTPS 发布硬门均已映射到任务与 AC。
- Web/Desktop 同 Fake Daemon、相同 seed/偏好、`1280x800` 内容视口、实际打包 App 和 Web 资源哈希校验均有明确验收入口。
- 发现 3 个 Major，分别影响跨介质回滚、Keyring E2E 隔离安全和 TDD 执行顺序。

## 主要问题

### R-01 [Major] 企业记录写入后的失败缺少可执行回滚机制
- 关联 ID：FR-7、BR-7、DEC-5、DEC-6、TASK-5、TASK-7、AC-9。
- 证据：[实施计划](/Users/wulien/develop/opencreator/opencreator-agent/docs/plans/opencreator-企业账户登录与Skill-Hub接入-实施计划-2026-07-30.md:401) 规定先 `upsert` 企业记录、再清理临时目录，任一步失败都要恢复旧记录；但 TASK-5 的 Repository 仅定义 `getBySkillId/getByName/listRecords/upsertRecord`。现有 [`rollbackSkillInstall`](/Users/wulien/develop/opencreator/opencreator-agent/apps/daemon/src/codex/skills/manager.ts:158) 只恢复文件系统。
- 问题与影响：若企业记录已成功写入，随后强制清理失败，文件可以回滚，但新记录无法删除、旧记录无法恢复。TASK-7 的 RED-4 和 AC-9 所要求的“旧树和旧记录完全恢复”因此不能按当前接口实现。
- 建议：在唯一事务说明中明确选定一种补偿顺序。最小方案是把所有可能阻塞提交的临时清理放到企业记录写入前，使企业记录成为最后一步；若必须保留当前顺序，则为 Repository 明确定义记录快照、删除和恢复接口。
- 关闭条件：修改“下载、ZIP 与事务边界”、TASK-5、TASK-7 RED-4 和 AC-9，使操作顺序及 Repository 接口一致；测试分别证明新安装和更新在记录写入后续阶段失败时，文件树和企业记录均恢复到操作前状态。

### R-02 [Major] 打包 E2E 的 Keyring 覆盖缺少受限测试身份契约
- 关联 ID：NFR-1、NFR-3、NFR-4、DEC-3、TASK-2、TASK-4、TASK-13、AC-5、AC-13。
- 证据：[实施计划](/Users/wulien/develop/opencreator/opencreator-agent/docs/plans/opencreator-企业账户登录与Skill-Hub接入-实施计划-2026-07-30.md:261) 规定 service/account 环境覆盖只允许测试环境；TASK-13 又要求实际生产形态的打包 App 通过环境变量使用唯一 E2E Keyring 项，但未定义环境变量名、测试身份信号及生产环境拒绝规则。当前 [`resolveProductionServerEnvironment`](/Users/wulien/develop/opencreator/opencreator-agent/apps/daemon/src/startup.ts:7) 也没有可复用的测试模式判定。
- 问题与影响：执行者必须自行设计如何区分实际打包 E2E 与普通生产启动。直接接受环境覆盖会允许正式 App 任意改写凭据命名；拒绝覆盖则实际包 E2E 会污染生产 Keyring 项或无法执行。
- 建议：在契约快照和 TASK-2/TASK-4/TASK-13 中定义具体环境变量、唯一的 E2E 启用信号、Daemon 端校验规则及生产环境行为。
- 关闭条件：Plan 明确列出覆盖变量和授权条件；增加测试证明普通生产启动忽略或拒绝 service/account 覆盖，而带明确 E2E 信号的实际打包 App 使用唯一测试项，并在结束时删除该项。

### R-03 [Major] TASK-12 的 RED 与任务顺序矛盾
- 关联 ID：NFR-4、TASK-8、TASK-9、TASK-10、TASK-11、TASK-12、AC-6。
- 证据：[实施计划](/Users/wulien/develop/opencreator/opencreator-agent/docs/plans/opencreator-企业账户登录与Skill-Hub接入-实施计划-2026-07-30.md:1003) 要求 TASK-12 的一致性测试因“功能尚未实现”取得 RED，但 TASK-12 排在账户、路由、Hub 和写操作全部实现完成之后。
- 问题与影响：按 Plan 顺序执行时，新一致性测试可能首次运行即通过，无法取得规定的目标行为缺失 RED；若强制制造失败，则会形成无意义失败或诱导修改正确实现。TASK-12 完成门因此不可判定。
- 建议：要么把一致性 spec 的最小 RED 骨架前置到 TASK-8 之前，再在 TASK-12 完成跨平台 GREEN；要么将 TASK-12 明确标记为验收/characterization 门，豁免 TDD RED，并说明其首次通过不构成违规。
- 关闭条件：调整任务依赖或 TDD 策略，使 TASK-12 的首次失败原因与执行时点一致；任务文本不得再声称已完成的功能“尚未实现”。

## 未决问题
无。

REVISE
```

### 问题处理

| 问题 | 处理 | 关闭证据 | 状态 |
|---|---|---|---|
| R-01 | 将所有必须成功的工作目录清理前移，企业记录单条原子 upsert 成为锁内最后提交点；不新增无法保证一致性的记录补偿接口。 | “下载、ZIP 与事务边界”、TASK-5 RED-3、TASK-7 步骤 7-8/RED-4、AC-9 已同时覆盖新安装与更新，并证明 upsert 后无必需可失败步骤。 | 已关闭 |
| R-02 | 删除任意 service/account 覆盖，定义参数与环境双信号、UUID、loopback Origin、继承环境清洗、Daemon 授权值和固定派生身份。 | 安全凭据契约、TASK-2 RED-2、TASK-4 RED-5、TASK-13 RED-3/RED-4、AC-13 已覆盖普通生产、越权组合、实际包恢复和清理。 | 已关闭 |
| R-03 | 将 TASK-12 定义为一致性验收/characterization 门，明确豁免 RED；行为 RED 由 TASK-8 至 TASK-11 承担。 | TASK-12 的策略、BASELINE、GREEN 和完成门已删除“功能尚未实现”前提，允许首次通过，失败时回到所属行为任务修复。 | 已关闭 |

流程结论：`PASS`。Reviewer 原始结论为 `REVISE`，3 个 Major 均按关闭条件修订；根据第一版只审核一次的约束，不再次复审。
