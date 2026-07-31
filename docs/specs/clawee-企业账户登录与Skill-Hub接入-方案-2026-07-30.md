# Clawee 企业账户登录与 Skill Hub 接入方案

> 状态：草案
> 体量判断：复杂。该交付同时涉及外部认证、系统安全凭据、Web/Desktop 共用状态、企业 Skill 分发、本地安装事务、来源冲突和发布安全；登录与企业 Skill Hub 不能独立验收，因此保持一份内聚方案。
> 设计确认：已完成（D-1 至 D-3）
> Reviewer 原始结论：REVISE
> 流程结论：PASS
> 用户批准：已批准（2026-07-30）

## 背景、目标与非目标

Clawee 已具备 Web/Desktop 共用 React 界面、本地 Daemon Runtime API、公共 Skill 市场和本地 Skill 安装事务。本方案在不阻断本地工作流的前提下，接入企业服务的普通账号注册、登录、会话恢复和企业 Skill Hub。

### 目标

1. 用户可以注册或登录企业账户，并在应用重启后恢复有效会话。
2. 未登录或企业服务不可用时，Clawee 本地功能和公共插件市场继续可用。
3. 公共市场与企业 Skill Hub 在同一插件页面按来源明确分区。
4. 企业 Token 只存在于 Daemon 和操作系统安全凭据存储，不进入渲染进程。
5. 企业 Skill 的查询、下载、校验、安装、更新和回滚全部由 Daemon 完成。
6. Web 与 Desktop 使用同一 Runtime API、状态模型和界面行为。

### 非目标

1. 找回密码、验证码、OAuth、SSO、Refresh Token 和跨设备会话同步。
2. 企业管理员、发布、上传、下架或 `/api/v1/admin/*` 能力。
3. 以企业登录限制 Clawee 本地项目、对话、任务、设置或公共市场。
4. 用企业 Skill Hub 替换公共市场，或改变公共市场已有目录和安装规则。
5. 向普通用户开放企业服务 Origin 编辑。
6. 首版下载进度事件、自动重试安装、企业 Skill 排行榜或视觉封面体系。

## 用户需求原文

1. `$zhiyu-brainstorm 开始设计登录功能,你是一名优秀的设计师,你来设计clawee的登录,登录接口在docs/api/clawee-agent登录与Skill-Hub接口接入.md`
2. `1`
3. `没问题,继续`
4. `没问题,继续`
5. `没问题,继续`

## 事实基线与假设

### 事实基线

| 证据 | 已确认事实 |
| --- | --- |
| `docs/api/clawee-agent登录与Skill-Hub接口接入.md` | 企业服务提供注册、登录、`/me`、注销和企业 Skill 列表/详情/包接口；Daemon 是唯一企业服务调用方。 |
| `apps/web/src/features/shell/ClaweeSidebar.tsx` | 侧栏底部已有“设置 / 账户”语义入口，但当前仅打开设置。 |
| `apps/web/src/features/plugins/SkillMarketView.tsx` | 公共市场已具备搜索、筛选、详情、安装、更新和“使用”交互。 |
| `apps/web/src/app/AppController.tsx` | 页面状态、Runtime Service、公共市场操作和创建 Skill 对话目前集中编排于 AppController。 |
| `apps/web/src/runtime/client.ts` | Web/Desktop 通过统一 RuntimeClient 携带本地 Runtime Token 调用 Daemon。 |
| `apps/daemon/src/api/server.ts` | Daemon 使用 Fastify 注册统一 Runtime API，并持有 SQLite、SkillManager 与市场管理器。 |
| `apps/daemon/src/codex/skills/market-manager.ts` | 公共市场安装已复用 Skill 写事务、回滚和安装记录。 |
| `apps/daemon/src/storage/migrations.ts` | 当前已有公共市场安装记录表，但没有企业会话或企业 Skill 安装记录。 |
| `apps/daemon/src/security/redaction.ts`、`apps/daemon/src/diagnostics/redactor.ts` | 已有通用敏感字段和诊断脱敏能力，但需要覆盖企业认证字段与外部 HTTP 日志。 |
| `AGENTS.md` | Web/Desktop 通用能力必须共用 Web、Daemon、API 和 Service，并通过同视口自动化与实际打包 App、Runtime 代理和嵌入资源哈希验证。 |

### 假设

1. 企业服务继续遵守接口文档中的响应包装、错误码和固定路径。
2. 支持企业登录的正式发布平台能够提供操作系统安全凭据后端；不可用时禁止持久化 Token。
3. 企业 Skill ZIP 的根结构能够通过现有 Skill 校验器收敛为单个有效 Skill。
4. 当前固定 HTTP Origin 仅用于受控联调；面向正式用户发布前必须切换 HTTPS。

## 设计确认记录

| 设计部分 | 核心决定 | 用户确认原话 |
| --- | --- | --- |
| D-1 产品边界与入口 | 采用可选登录；侧栏账户区与设置分离；插件页按公共市场和企业 Skill Hub 分区；企业账户使用工作区内独立页面。 | `没问题,继续` |
| D-2 登录、注册与会话状态流 | 登录/注册分段表单；注册后自动登录；四态会话模型；Daemon 固定企业请求参数并持有安全凭据；注销失败不误清本地 Token。 | `没问题,继续` |
| D-3 企业 Skill Hub、异常处理与验收 | 企业 Hub 使用紧凑列表；Daemon 合并远端、本地扫描和来源记录；安装更新执行摘要校验和事务回滚；HTTP 仅用于受控联调并设置 HTTPS 发布门。 | `没问题,继续` |

## 需求与业务规则

| ID | 类型 | 优先级 | 描述 |
| --- | --- | --- | --- |
| FR-1 | 功能需求 | P0 | 未登录时，Clawee 本地项目、对话、任务、设置和公共市场仍可完整使用。 |
| FR-2 | 功能需求 | P0 | 用户可从侧栏账户区进入企业账户页面，并完成登录或注册并登录。 |
| FR-3 | 功能需求 | P0 | 应用可展示、刷新并恢复 `signed_out`、`checking`、`signed_in`、`service_unavailable` 四种企业会话状态。 |
| FR-4 | 功能需求 | P0 | 插件页提供公共市场与企业 Skill Hub 两个来源视图，公共市场保持默认且现有行为不变。 |
| FR-5 | 功能需求 | P0 | 已登录用户可浏览企业 Skill，查看详情，并按合并状态安装、更新或使用。 |
| FR-6 | 功能需求 | P0 | 企业 Skill 下载后必须完成 SHA-256、ZIP 安全、Skill 结构和名称校验后才能写入本机。 |
| FR-7 | 功能需求 | P0 | 企业 Skill 安装或更新失败时不留下半安装状态，更新失败可恢复旧 Skill。 |
| FR-8 | 功能需求 | P1 | 已安装企业 Skill 在注销、远端离线或远端下架后仍保留在本机并可按本地有效性继续使用。 |
| BR-1 | 业务规则 | P0 | 注册请求不得传 `client_id`；注册成功后由 Daemon 使用 `client_id=clawee-agent` 自动登录。 |
| BR-2 | 业务规则 | P0 | 只有注册、后续登录和 `/auth/me` 权限验证都成功时，注册流程才进入 `signed_in`；注册响应 Cookie 必须丢弃。 |
| BR-3 | 业务规则 | P0 | 登录和注销不得自动重试；安装和更新不得在未知结果后自动重复本地写入。 |
| BR-4 | 业务规则 | P0 | 登录、启动恢复和手动刷新仅在 `/auth/me` 返回 active 账号且 `applications.frontend=true` 时进入 `signed_in`；`401`、非 active 账号或 `frontend=false` 均清除会话并进入 `signed_out`；网络错误或 `5xx` 保留 Token 并进入 `service_unavailable`。 |
| BR-5 | 业务规则 | P0 | 注销返回 `204` 或 `401` 时清除本地会话；网络失败时保留 Token，不能误报注销成功。 |
| BR-6 | 业务规则 | P0 | 企业 Skill 的安装状态以本地扫描、企业安装记录、安装后内容摘要和当前远端发布元数据共同计算。 |
| BR-7 | 业务规则 | P0 | 同名未知来源、已被本地修改或属于其他来源的 Skill 不得被企业安装、更新静默覆盖；安装和更新必须在 Skill 写锁内、文件写入前重新核验。 |
| BR-8 | 业务规则 | P1 | 企业列表和详情可有限退避重试；`401/403/404/409`、参数错误和写操作不按网络错误循环重试。 |
| NFR-1 | 安全约束 | P0 | 企业 Token 不得出现在 React 状态、Runtime API 响应、浏览器存储、SQLite 明文字段、普通设置或诊断包中。 |
| NFR-2 | 安全约束 | P0 | 密码不得持久化或写入日志、诊断和缓存；提交成功、页面卸载或模式切换时清理密码状态。 |
| NFR-3 | 安全约束 | P0 | 企业 Token 只允许写入操作系统安全凭据存储；安全存储不可用时不得降级为明文持久化。 |
| NFR-4 | 兼容约束 | P0 | Web 与 Desktop 必须复用相同 Protocol 类型、Daemon API、Service 和 React 页面，不在 Desktop Bridge 中复制企业业务；一致性必须通过同 Fake Daemon、同内容视口的自动化对比和当前工作区实际打包 App 验证。 |
| NFR-5 | 发布约束 | P0 | 当前 HTTP Origin 仅允许受控联调；账户页不展示连接协议说明；面向正式用户发布前必须切换 HTTPS。 |

## 方案比较与推荐

### 登录边界

| 方案 | 影响 | 结论 |
| --- | --- | --- |
| 可选登录 | 本地功能不依赖企业可用性，只对企业 Hub 建立认证门槛。 | 采用 |
| 启动强制登录 | 企业服务故障会阻断 Clawee 本地工作，扩大外部依赖故障面。 | 排除 |
| 首次可跳过引导 | 增加首次启动状态和引导维护，但不改善核心任务。 | 首版排除 |

### 登录承载方式

| 方案 | 影响 | 结论 |
| --- | --- | --- |
| 工作区内账户页面 | 可承载登录、注册、离线、账户摘要和注销，移动端也沿用现有导航。 | 采用 |
| 登录弹窗 | 注册部分成功、离线和账户管理状态过多，弹窗会变得拥挤且难以恢复上下文。 | 排除 |
| 独立全屏登录壳 | 视觉上接近强制登录，破坏可选登录边界。 | 排除 |

### 企业 Skill 展示方式

| 方案 | 影响 | 结论 |
| --- | --- | --- |
| 独立来源 Tab + 紧凑列表 | 保持公共市场视觉体验，同时准确承载企业接口的有限字段和操作状态。 | 采用 |
| 混入公共市场卡片 | 来源、版本、作者、风险和安装状态语义会混淆。 | 排除 |
| 独立顶级导航 | 夸大功能层级，并与现有“插件”入口重复。 | 排除 |

## 关键设计决策

| DEC ID | 决策 | 理由 | 约束范围 |
| --- | --- | --- | --- |
| DEC-1 | 企业认证采用可选登录，永不作为 Clawee 本地工作区启动门。 | 隔离企业服务故障，符合公共市场共存边界。 | 路由、启动恢复、页面门槛 |
| DEC-2 | 企业账户为工作区内独立视图；侧栏底部拆为账户区与独立设置图标。 | 保留稳定入口，容纳完整会话状态，避免弹窗膨胀。 | Web UI、移动端导航 |
| DEC-3 | Daemon 是企业服务和企业 Token 的唯一所有者；Runtime API 只返回脱敏会话和业务数据。 | 保证 Web/Desktop 复用并阻止 Token 进入渲染进程。 | Protocol、Daemon、Web/Desktop |
| DEC-4 | 会话使用四态模型；仅 active 账号且 `applications.frontend=true` 可进入 `signed_in`，认证或应用权限不满足时清除会话，网络故障保留安全存储中的 Token。 | 区分无会话、验证中、有效会话、权限失效和服务暂不可用，保证登录、恢复与刷新语义一致。 | 登录、启动恢复、手动刷新、401、权限撤销、5xx |
| DEC-5 | 企业 Skill 状态由远端目录、本地 Skill 扫描、带来源安装记录和本地内容摘要合并计算，并在写锁内重新核验。 | 文件系统是真实安装状态，来源记录和内容摘要负责版本、手工修改与竞态冲突语义。 | 列表、详情、安装、更新 |
| DEC-6 | 企业安装复用现有 Skill 写事务，但下载器和记录模型与公共市场来源分离；任何覆盖前必须在写锁内验证来源归属和已安装内容摘要。 | 复用成熟回滚边界，同时阻止下载期间的手工替换或其他来源占用被静默覆盖。 | Daemon 安装器、数据库、并发写入 |
| DEC-7 | HTTP 仅允许受控联调，账户页保持简洁；HTTPS 是正式发布硬门。 | 当前接口固定为 HTTP，客户端无法补偿链路明文风险，安全边界由受控环境和发布门保证。 | 配置、UI、发布验收 |

## 详细设计

### 信息架构与界面

1. 增加 `account` 视图，使用现有 WorkbenchLayout，不建立独立全屏外壳。
2. 侧栏展开时，账户区显示头像缩写、名称或邮箱和会话状态；设置使用独立齿轮图标按钮。
3. 侧栏收起时，账户与设置均为固定尺寸图标按钮，使用 Tooltip 和无障碍名称。
4. 未登录账户页默认显示“登录”，并以分段控件切换“注册”。
5. 登录字段为邮箱、密码；注册字段为名称、邮箱、密码、确认密码。
6. 注册按钮文案为“注册并登录”；注册成功但自动登录失败时切到登录模式、预填邮箱并明确提示账号已创建。
7. 已登录账户页展示名称、邮箱、会话有效期和退出登录；不展示 Token、后台角色、权限或服务端内部 ID。
8. 插件页增加“公共市场 / 企业 Skill Hub”来源 Tab；公共市场默认选中，现有筛选和卡片行为保持不变。
9. 未登录的企业 Tab 显示登录门槛；从此处登录成功后返回企业 Tab。
10. 企业列表使用搜索、状态筛选、刷新和紧凑行；详情弹窗展示描述、版本、更新时间、更新日志和本地状态。

### Runtime API

所有接口继续使用本地 Runtime Token 鉴权；请求和响应使用 Clawee Protocol 的 `camelCase`，由企业 HTTP Client 在边界映射企业服务 `snake_case`。

```ts
type EnterpriseSessionStatus =
  | "signed_out"
  | "checking"
  | "signed_in"
  | "service_unavailable";

type EnterpriseSessionResponse = {
  status: EnterpriseSessionStatus;
  account?: {
    email: string;
    name: string;
  };
  expiresAt?: string;
};

type EnterpriseLoginRequest = {
  email: string;
  password: string;
};

type EnterpriseRegisterRequest = {
  email: string;
  name?: string;
  password: string;
};
```

| Runtime API | 行为 |
| --- | --- |
| `GET /enterprise/session` | 返回 Daemon 当前会话快照；若启动验证仍在进行则返回 `checking`。 |
| `POST /enterprise/session/refresh` | 使用已保存 Token 手动执行 `/auth/me`；无 Token 时返回 `signed_out`。 |
| `POST /enterprise/register` | 先注册并丢弃响应 Cookie，再使用同一邮箱密码登录；只返回最终会话状态。 |
| `POST /enterprise/login` | 固定 `client_id=clawee-agent` 登录，通过 `/auth/me` 验证应用权限后安全保存 Token。 |
| `POST /enterprise/logout` | 按远端结果决定是否清理本地安全凭据。 |
| `GET /enterprise/skills` | 返回远端目录、本地扫描和安装记录合并后的企业 Skill 列表。 |
| `GET /enterprise/skills/:skillId` | 返回当前发布详情和本地状态。 |
| `POST /enterprise/skills/:skillId/install` | 重新获取详情后安装当前发布版本。 |
| `POST /enterprise/skills/:skillId/update` | 重新获取详情后更新当前发布版本。 |

企业服务 Origin 固定由 Daemon 配置提供。前端不能提交 Origin、`client_id`、下载 URL、`versionId`、摘要或本地目标路径。

### 会话状态流

```text
Daemon 启动
  -> 安全存储无 Token
     -> signed_out
  -> 安全存储有 Token
     -> checking
     -> /auth/me 200 且 account.active 且 applications.frontend=true
        -> signed_in
     -> /auth/me 200 且 account 非 active
        -> 删除 Token 和账号缓存
        -> signed_out + ENTERPRISE_ACCOUNT_INACTIVE
     -> /auth/me 200 且 applications.frontend=false
        -> 删除 Token 和账号缓存
        -> signed_out + ENTERPRISE_FRONTEND_FORBIDDEN
     -> /auth/me 401
        -> 删除 Token 和账号缓存
        -> signed_out + ENTERPRISE_SESSION_EXPIRED
     -> 网络错误或 5xx
        -> 保留 Token 和最近账号缓存
        -> service_unavailable
```

登录、注册后的自动登录、启动恢复和手动刷新必须共用同一会话判定函数。只有 Token 类型为 `Bearer`、账号状态为 `active`、`/auth/me` 返回 `applications.frontend=true` 且 Token 安全写入成功后，登录或注册流程才成立。权限验证失败时不保存 Token 并尝试撤销本次远端会话；恢复或刷新时发现权限不满足则删除既有 Token 和账号缓存。安全凭据写入失败时同样撤销本次远端会话；若远端撤销也失败，返回安全存储失败并记录不含 Token 的诊断阶段，不能把会话暴露为 `signed_in`。

账户显示信息可以保存为不含 Token 的本地缓存，用于 `service_unavailable` 展示；注销成功或认证失效时删除。

Web 收到 `checking` 后以短间隔读取会话快照，最长等待一次 `/auth/me` 的 15 秒超时窗口；进入任一终态后停止读取。超过窗口仍未收敛时展示“验证时间过长”和手动重新检测，不建立持续轮询。

### 表单交互

1. 提交期间锁定字段、分段控件和提交按钮，阻止重复请求。
2. 前端只做必填、邮箱形态、密码至少 8 字符和确认密码一致校验；业务判断依赖 Runtime 错误码。
3. `401 unauthorized` 保留邮箱、清空并聚焦密码。
4. 网络或服务错误保留当前表单输入，允许用户手动重试。
5. 登录成功、注册成功、模式切换和页面卸载时清理密码与确认密码。
6. 登录、注销和写操作不自动重试。

### 凭据与日志边界

1. 新增 Daemon `EnterpriseCredentialStore`，仅暴露读取、写入和删除企业 Token。
2. 生产后端必须使用操作系统安全凭据能力；没有安全后端时返回明确的 `ENTERPRISE_SECURE_STORAGE_UNAVAILABLE`。
3. 不允许以文件权限、SQLite、环境变量或普通配置作为持久化降级。
4. 企业 HTTP Client 记录方法、路径模板、状态码、请求 ID、耗时和失败阶段；不记录请求体、Authorization、Cookie 或原始敏感 URL。
5. 通用脱敏规则增加 `access_token`、`expires_at`、`enterprise` 认证对象和 Bearer Header 覆盖测试。

### 企业 Skill 聚合状态

Daemon 读取远端列表、本地 Skill 扫描、公共市场记录和企业安装记录，并按以下顺序计算。企业记录除远端包摘要外，还保存安装后规范化文件树摘要，用于识别手工修改和下载期间的状态变化：

| 状态 | 判定 | UI 行为 |
| --- | --- | --- |
| `not_installed` | 本地无同名 Skill | 安装 |
| `invalid` | 本地同名 Skill 无效 | 显示无效，禁止覆盖 |
| `installed_unknown_source` | 本地有效但无 Clawee 来源记录 | 显示“使用本地版本”，禁止企业更新覆盖 |
| `name_conflict` | 本地记录属于其他来源 | 显示冲突，不在企业条目中“使用”或覆盖 |
| `installed` | 企业记录摘要等于远端摘要 | 使用 |
| `update_available` | 企业记录摘要与远端不同 | 更新 |
| `unpublished` | 企业记录存在、本地有效，但远端列表已无此 Skill | 显示“使用本地版本”，不允许更新 |

企业 Skill “使用”复用公共市场现有项目选择和新对话创建逻辑，插入 `$skill-name `，不自动发送。

### 安装与更新

```text
用户发起安装或更新
  -> 获取当前详情
  -> 记录 skillId/versionId/packageSha256
  -> 按 skillId + versionId 流式下载 ZIP
  -> 增量计算 SHA-256 并限制 50 MiB
  -> 安全解压到 Daemon 临时目录
  -> 校验单个 SKILL.md、普通文件、目录名和远端 name
  -> 对排序后的规范化相对路径和文件字节计算 installedContentSha256
  -> 进入现有 Skill 写锁与事务
  -> 在锁内重新读取本地 Skill、公共市场记录和企业记录
  -> 安装要求同名 Skill 仍不存在
  -> 更新要求记录仍属于目标企业 skillId，且本地文件树摘要仍等于记录值
  -> 任一前置条件变化则返回来源或本地修改冲突，不执行文件写入
  -> 安装或备份后覆盖
  -> 写入企业来源安装记录及 installedContentSha256
  -> 成功后提交并刷新扫描
  -> 任一步失败则清理临时文件并回滚
```

ZIP 校验必须拒绝绝对路径、Windows 盘符、`..` 越界、反斜杠规范化冲突、重复路径、符号链接、非普通文件、条目超限、解压膨胀、缺失或重复 `SKILL.md` 以及声明名称不一致。

规范化文件树摘要按相对路径字节序排序，逐项写入规范化相对路径、文件长度和原始文件字节后计算 SHA-256；符号链接和非普通文件已在此前拒绝。企业更新在写锁内对当前目标目录使用相同算法重新计算摘要。摘要不一致返回 `ENTERPRISE_SKILL_LOCAL_CHANGED`；公共市场记录、未知来源目录或企业记录不属于目标 `skillId` 时返回 `ENTERPRISE_SKILL_SOURCE_CONFLICT`。

`409 version_changed` 只刷新元数据并要求用户重新发起；摘要不一致时删除临时文件并重新读取一次元数据，但不自动重试安装。

### 错误映射

| 企业结果 | Daemon / UI 行为 |
| --- | --- |
| `400 invalid_request` | 返回字段或表单级错误，不重试。 |
| `401 unauthorized` | 清除 Token，切换 `signed_out`；安装中止且不写本地。 |
| `403 forbidden` | 保留会话，企业 Hub 显示无权限。 |
| `/auth/me` 返回非 active 账号 | 清除 Token 和账号缓存，返回 `ENTERPRISE_ACCOUNT_INACTIVE`，切换 `signed_out`。 |
| `/auth/me` 返回 `applications.frontend=false` | 清除 Token 和账号缓存，返回 `ENTERPRISE_FRONTEND_FORBIDDEN`，切换 `signed_out`。 |
| `404 not_found` | 刷新目录并终止当前详情、安装或更新。 |
| `409 version_changed` | 刷新版本，由用户重新发起。 |
| `413 package_too_large` | 终止操作，不重试。 |
| `429 rate_limited` | 仅读取请求遵循 `Retry-After`；写操作不自动重试。 |
| `500/502/503` 或网络错误 | 保留 Token；会话进入 `service_unavailable` 或条目显示可重试错误。 |
| 锁内来源归属变化 | 返回 `ENTERPRISE_SKILL_SOURCE_CONFLICT`，不写文件或记录。 |
| 锁内本地内容摘要变化 | 返回 `ENTERPRISE_SKILL_LOCAL_CHANGED`，不写文件或记录。 |
| 安全存储失败 | 不进入持久登录，返回明确错误并尝试撤销远端会话。 |
| 校验、解压、安装、记录失败 | 删除临时内容，保持或恢复原本地 Skill 与记录。 |

## 异常、兼容、迁移与回滚

### 数据迁移

1. 新增企业 Skill 安装记录表，使用独立企业字段：`skill_id`、`name`、`version_id`、`version`、`package_sha256`、`installed_content_sha256`、`installed_at`、`updated_at`。
2. 公共市场已有记录不自动迁移为企业来源；同名时按 `name_conflict` 处理。
3. 企业 Token 不进入 SQLite，因此不存在 Token 数据迁移。
4. 新表迁移只新增结构，不改变现有公共市场表和本地 Skill 文件。

### 兼容

1. Protocol 新增企业类型和错误码，不改变现有 Runtime API。
2. 公共市场默认 Tab、目录、安装和使用行为保持不变。
3. 企业服务响应新增未知字段时忽略；不依赖字段顺序或中文错误文案。
4. Desktop 继续加载同一 Web 产物并代理同一 Daemon，不增加企业专用 IPC 业务。
5. Desktop 打包前必须重新构建当前工作区 Web，并校验 `apps/web/dist` 与 App 内嵌 Web 文件列表及内容哈希完全一致。

### 发布

1. 先在固定 HTTP Origin 的受控环境完成接口联调；账户页面保持简洁，不展示连接协议说明。
2. 正式用户发布前必须将配置切换到 HTTPS 并通过注册、登录、下载和注销验收。
3. 企业登录或企业 Hub 故障不阻止应用启动，也不需要关闭公共市场。

### 回滚

1. UI 可通过移除企业入口回滚，不影响本地项目和公共市场数据。
2. Daemon 企业路由停用后，现有企业 Skill 文件和安装记录保留，不自动删除。
3. 数据库新增表保持向后兼容，旧版本忽略即可。
4. 单次 Skill 更新失败由写事务恢复旧 Skill；安装失败不保留新目录或记录。

## 验收标准

| AC ID | 关联需求 | 前置条件 | 操作 | 可观察结果 | 验证层级 |
| --- | --- | --- | --- | --- | --- |
| AC-1 | FR-1、DEC-1 | 无企业 Token或企业服务离线 | 启动应用并使用本地功能、公共市场 | 应用不显示全局登录门；本地功能和公共市场可操作 | Web 集成 / E2E |
| AC-2 | FR-2、BR-1、BR-2 | 使用未注册邮箱 | 在注册模式提交有效名称、邮箱和密码 | Daemon 注册时不传 `client_id` 且丢弃 Cookie，再以 `clawee-agent` 登录并通过 `/auth/me` 权限验证；全部成功才显示已登录 | Daemon 集成 / Web 集成 |
| AC-3 | FR-3、BR-4、NFR-1 | 安全存储分别为空、有效 Token、失效 Token、非 active 账号、`frontend=false`、网络失败 | 执行登录、启动恢复和手动刷新 | 三条入口使用同一判定：有效权限得到 `signed_in`；失效、非 active 或无 frontend 权限均清 Token/缓存并以对应提示进入 `signed_out`；网络失败保留 Token 并进入 `service_unavailable` | Daemon 单元 / 集成 / Web 组件 |
| AC-4 | BR-5 | 已登录 | 分别模拟注销 `204`、`401`、网络失败 | 前两者清理本地会话；网络失败保留 Token 并显示未完成 | Daemon 集成 / Web 集成 |
| AC-5 | NFR-1、NFR-2、NFR-3 | 完成登录、失败请求和诊断导出 | 检查 Runtime 响应、浏览器存储、SQLite、设置、日志和诊断 | 不出现密码、Token、Authorization 或 Cookie；Token 仅存在安全凭据后端 | 安全测试 |
| AC-6 | FR-4、NFR-4 | Browser Bridge 与 Desktop Bridge 使用同一 Fake Daemon、账号、Skill 数据、偏好和内容视口 | 完成登录、会话恢复、来源 Tab 切换、企业列表和一次安装或使用操作 | 两端主要 DOM、可见文案、关键尺寸、状态、Runtime 请求和持久化结果一致；平台专属入口不影响通用流程 | Web/Desktop 一致性自动化 |
| AC-7 | FR-5、BR-6、BR-7 | 构造各类本地 Skill 与来源记录，并允许下载期间改变本地状态 | 加载企业列表后发起安装或更新 | 七种状态及按钮符合状态表；写锁内发现手工替换、公共市场占用、未知来源或企业记录变化时返回稳定冲突，文件和原记录均不改变 | Daemon 并发/事务单元 / Web 组件 |
| AC-8 | FR-6 | 企业包包含摘要错误、越界路径、符号链接、重复路径、超限或无效 Skill | 发起安装 | 每种包均被拒绝，临时文件被清理，本地 Skill 和记录不改变 | Daemon 安全测试 |
| AC-9 | FR-7、BR-7、DEC-6 | 已有可更新企业 Skill 和记录的本地内容摘要 | 分别在锁内前置核验、覆盖、记录写入和清理阶段注入来源变化、手工修改或失败 | 冲突发生时不写入；事务失败时旧 Skill 可恢复；企业记录、内容摘要和最终文件一致，无半安装目录 | Daemon 并发 / 事务集成 |
| AC-10 | FR-8 | 已安装企业 Skill | 注销、断网或远端下架后使用 Skill | 本地 Skill 不被删除；有效 Skill 仍可通过对话调用；下架项不可更新 | Daemon / Web 集成 |
| AC-11 | BR-3、BR-8 | 模拟登录、注销、429、409 和网络错误 | 执行对应操作 | 登录、注销、安装、更新不自动重复；读取请求仅按规则有限重试 | Daemon 单元 |
| AC-12 | NFR-5、DEC-7 | Origin 为 HTTP 或 HTTPS | 打开账户页并执行发布验收 | 账户页不展示连接协议说明；HTTP 只允许联调目录；正式发布配置为 HTTPS 时通过安全门 | Web 组件 / 发布验收 |
| AC-13 | NFR-4 | 从当前工作区重新构建 Web 和实际 Desktop App | 启动打包 App，访问 `clawee-app://`，通过 Runtime 代理执行注册或登录、会话恢复、企业列表及至少一次企业操作，并校验嵌入资源 | Preload Bridge、Runtime 代理和通用流程可用；`apps/web/dist` 与 App 内嵌 Web 文件列表及内容哈希完全一致 | 实际打包 App E2E / 打包校验 |

## 测试策略

1. Protocol 测试覆盖请求、响应、状态联合类型、企业错误码和 Token 字段缺失约束。
2. Daemon HTTP Client 使用可控假服务验证 `snake_case` 映射、超时、Retry-After、错误包装和日志脱敏。
3. 会话测试使用可替换的安全凭据 Store，覆盖启动恢复、401 清理、5xx 保留、注册部分成功、安全写入失败和注销网络失败。
4. 企业 Skill 聚合测试覆盖远端列表、本地扫描、公共记录和企业记录的组合，不以数据库记录替代文件系统真相。
5. 安装器测试使用真实 ZIP 字节覆盖摘要、路径、文件类型、条目数量、膨胀、名称、事务提交和回滚。
6. Web 组件测试覆盖登录/注册、提交锁、字段错误、离线账户、来源 Tab、列表状态、详情和可访问性焦点。
7. Web/Desktop 一致性测试必须使用同一 Fake Daemon、相同企业账号和 Skill 数据、相同本地偏好及相同内容视口，分别通过 Browser Bridge 和 Desktop Bridge 验证登录、会话恢复、来源 Tab、企业列表、一次企业操作、可见文案、关键尺寸、Runtime 请求和持久化结果。
8. 实际打包 App E2E 必须从当前工作区重新构建 Web 和 Desktop，验证 Preload Bridge、`clawee-app://`、Runtime 代理、注册或登录、会话恢复、企业列表和至少一次企业操作，并比较 `apps/web/dist` 与 App 内嵌 Web 文件列表和内容哈希。
9. 真实企业服务只用于受控契约冒烟，不在测试资产中保存账号密码；未完成实际打包 App 验证时不得声明 Web/Desktop 已一致或功能可发布。

## 风险与未决问题

### 风险

1. 当前企业 Origin 使用 HTTP，密码和 Token 在网络链路中为明文；仅允许在受控联调环境使用，并由 HTTPS 发布硬门阻止正式发布，客户端无法补偿。
2. 操作系统安全凭据后端涉及平台差异；缺少后端的平台将无法持久登录，但不得回退明文。
3. 企业 Skill ZIP 是可执行工作流内容；即使来自企业服务，仍必须保留本地安全校验和来源冲突保护。
4. AppController 当前已承担较多编排职责；实现应保持企业领域 Service 边界，避免继续把 HTTP、状态计算和凭据语义堆入 UI 控制器。

### 未决问题

无阻塞性未决问题。安全凭据后端的具体平台适配库和文件拆分属于实施计划选择，但不得改变 DEC-3、DEC-4 与 NFR-3 的行为契约。

## 独立审核记录

### Reviewer 原始输出

```text
## 审核结论
REVISE

## 覆盖摘要
- 已确认方案保持“可选登录”边界，未登录和企业服务故障不会阻断本地功能或公共市场。
- 注册、登录、会话恢复、注销、企业目录、详情、下载、摘要校验和安装回滚均有对应契约与 AC。
- Token 所有权、安全存储、密码清理、HTTP 联调边界、HTTPS 发布门禁及 Web/Desktop 共用边界已形成明确决策。
- 存在 3 个会影响认证正确性、来源冲突保护和 P0 交付验收的 Major 问题。

### R-01 [Major] `/auth/me` 权限不满足时缺少完整状态转移
- 证据：启动状态流只处理 `200 + account.active`、`401`、网络错误和 `5xx`，但登录成立条件另要求 `applications.frontend=true`；AC-3 未覆盖非 active 账户或 `frontend=false`。
- 影响：启动恢复或手动刷新可能错误进入 `signed_in` 或停留在 `checking`。
- 建议：登录、启动恢复及手动刷新共用完整 `/auth/me` 判定，仅 `active && frontend=true` 进入 `signed_in`。
- 关闭条件：修改 DEC-4、会话状态流和错误映射；扩展 AC-3 验证非 active 与 `frontend=false` 的状态、Token/缓存处理和 UI 提示。

### R-02 [Major] 来源冲突只在聚合阶段判断，写锁内没有要求重新核验
- 证据：BR-7 禁止覆盖未知或其他来源 Skill，但安装流程在下载后进入写事务时未重新读取本地 Skill 和来源记录。
- 影响：下载期间的手工替换、公共市场安装或来源记录变化可能被企业更新静默覆盖。
- 建议：写锁内、文件写入前重新读取本地扫描、公共记录和企业记录，并验证目标仍属于待更新企业 Skill。
- 关闭条件：在 DEC-5/DEC-6 或安装事务中规定锁内前置条件和冲突错误；AC-7 或 AC-9 覆盖下载期间来源变化、手工替换和公共市场占用。

### R-03 [Major] Web/Desktop 验收没有明确承接实际打包 App 强制门禁
- 证据：NFR-4 要求 Web/Desktop 共用实现，但 AC-6 和测试策略未明确实际打包 App、`clawee-app://`、Runtime 代理和嵌入 Web 哈希。
- 影响：不能证明企业 Runtime 路由、安全凭据后端和共享 Web 产物在实际 App 中可用。
- 建议：将注册、会话恢复、企业列表及至少一次企业操作纳入真实打包 App E2E，并验证 Runtime 代理与嵌入资源哈希。
- 关闭条件：修改或新增关联 NFR-4 的 AC，明确当前工作区实际 App、同内容视口、共享 Fake Daemon、Runtime 一致性和 `dist` 哈希证据。

## 未决问题
无。上述问题均可依据现有用户确认和项目规则修订，无需新增用户决策。
```

### 问题处理

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
| --- | --- | --- | --- | --- | --- |
| R-01 | Major | 采纳并关闭 | BR-4、DEC-4、会话状态流、错误映射、AC-3 | Reviewer 关闭条件要求所有 `/auth/me 200` 权限分支一致。方案现规定登录、恢复、刷新共用判定；非 active 与 `frontend=false` 均清 Token/缓存进入 `signed_out`，AC-3 逐项验证。 | 无 |
| R-02 | Major | 采纳并关闭 | BR-6、BR-7、DEC-5、DEC-6、企业 Skill 聚合状态、安装与更新、数据迁移、错误映射、AC-7、AC-9 | Reviewer 关闭条件要求写锁内复核并覆盖手工替换。方案新增 `installed_content_sha256`，规定锁内重读本地 Skill 和双方来源记录、复算文件树摘要；来源或内容变化返回稳定冲突且不写入，AC-7/AC-9 覆盖。 | 规范化文件树摘要算法必须在安装记录写入和更新复核中使用同一实现。 |
| R-03 | Major | 采纳并关闭 | 事实基线、NFR-4、兼容、AC-6、AC-13、测试策略 | Reviewer 关闭条件要求真实打包 App 和哈希证据。方案现要求同 Fake Daemon、同内容视口的 Browser/Desktop 自动化，并以当前工作区重建实际 App，验证 `clawee-app://`、Runtime 代理、企业流程和嵌入 Web 文件哈希。 | 实际打包 App 验证成本较高，但属于完成和发布硬门。 |
