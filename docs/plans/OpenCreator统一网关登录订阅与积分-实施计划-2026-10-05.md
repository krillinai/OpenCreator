# OpenCreator 统一网关、登录、订阅与积分实施计划

> 状态：已授权执行；2026-10-05 开始实施。
> 体量判断：复杂，但保持一个交付。Go 网关与共享客户端需要共同完成登录、付款、积分及真实模型调用，不能按语言或目录拆成互相等待核心契约的独立 Plan。
> 来源方案：[已批准方案](../specs/OpenCreator统一网关登录订阅与积分-方案-2026-10-05.md)。
> 方案批准：2026-10-05，用户在一期简化结果之后回复“继续”。方案流程为 PASS（用户知情批准）；不是本计划的执行授权。
> 原始审核：方案独立 Reviewer 未执行；主 Agent 原始结论 REVISE。MA-1/MA-3 已移出一期，MA-2 收敛为同一订阅 Invoice 只发一次积分，MA-4 风险保留并由 TASK-1 优先验证。
> Plan Reviewer 原始结论：未执行；当前会话无 spawn_agent、wait_agent、close_agent，未启动、无 agent_id。
> 流程结论：PASS（用户知情授权执行）；独立审核未执行及 MA-4 遗留风险继续保留。
> 执行授权：2026-10-05，用户在看到计划与审核状态后明确回复“开始执行”。

## 1. 契约快照

交付一个 Go 网关和 OpenCreator 的共享客户端接入，用户流程为“登录 -> 月订阅付款 -> 积分到账 -> 使用多模态模型”。每个用户只有一把当前有效的云模型 Key，网关可以连接其他中转站，用户不填写各模态地址与密钥。账户与模型调用凭证分离，后续权益可在账户上扩展。

一期不交付套餐停售、历史套餐迁移、退款/拒付自动处理、跨 Invoice 权益合并、补充账单、团队、年付、充值包、优惠券、自动充值、免费试用积分或项目/文件云同步。不新建独立认证后端、第二套 Desktop 页面、模板专属 Agent Panel、Redis 或独立消息队列。不创建远程仓库、执行远程更名、推送、公开部署或真实生产付款。

### 1.1 功能与规则

| ID | 优先级 | 必须交付的行为 |
|---|---|---|
| FR-1 | P0 | 邮箱注册、验证、密码登录、找回，以及 Google、GitHub 登录 |
| FR-2 | P0 | 浏览器设备授权、可刷新会话、取消/超时/退出及重启恢复 |
| FR-3 | P0 | 同账户、全部模态及设备共享一把当前有效模型 Key；重新登录复用 |
| FR-4 | P0 | 登录后自动取得官方配置，配置和 Runtime 真正就绪后启用 |
| FR-5 | P0 | 文本、图片、视频、TTS、转写，以及 Agent 工具调用与流式协议；仅开放验证能力 |
| FR-6 | P0 | Stripe 个人月订阅、自动续费、取消/恢复续订及下一周期套餐变更 |
| FR-7 | P0 | 确认付款后发积分，模态共用余额，不足时拦截新生成 |
| FR-8 | P1 | 账户页面展示订阅、有效期、可用/预占积分、使用记录及订单 |
| FR-9 | P0 | 最小管理：套餐/模型价格、渠道、用户停用、待核对结算及带原因的账本调整；有权限和审计 |
| FR-10 | P0 | 原手动配置、本机能力及 BYOK 保留，旧用户不自动换模式，直连不扣网关积分 |
| FR-11 | P0 | 请求有稳定身份、可查询恢复状态；查询、重连和重启不重复提交 |
| FR-12 | P0 | 登录、配置、支付、余额和网关故障准确呈现；失败不伪装为零余额，不自动换服务 |
| BR-1 | P0 | 身份归属验证；同邮箱不自动合并；未验证身份不能获得模型凭证或购买 |
| BR-2 | P0 | 模型 Key 只用于模型及所属请求查询；不能管理账户/付款；重置旧值立即失效 |
| BR-3 | P0 | 同一已付款月订阅 Invoice 只发一次；当期积分不结转；取消保留当期，失败续费不发放，套餐下期变更；新账户零积分 |
| BR-4 | P0 | 同账户、操作、逻辑 ID 与参数复用原请求；参数冲突拒绝；只结算一次，查询和下载不重复收费 |
| BR-5 | P0 | 服务端以价格快照、可信用量和可执行消费上界原子预占、整数结算 |
| BR-6 | P0 | 受理或用量未知时持久化核对，无安全重试证据不重发，确认无消费才全部释放 |
| BR-7 | P0 | 已预占请求跨周期仍用原批次，过期部分释放后不恢复可用余额 |
| BR-9 | P0 | 活跃任务绑定原账户/模式；切换等其结束；退出拦截新请求，已提交任务继续结算，恢复需原账户 |
| NFR-1 | P0 | 原始凭证不进入页面、浏览器存储、授权 URL 或日志；本机和服务端的实际访问控制有证据 |
| NFR-2 | P0 | 登录、绑定、付款、结果和转发校验主体/来源/归属；不把上游凭证发送给用户指定主机 |
| NFR-3 | P0 | PostgreSQL 是计费事实来源，发放、预占、结算和恢复在并发及崩溃下保持一致 |
| NFR-4 | P0 | 官方 Runtime 和配置来源隔离，不覆盖个人 Codex 或手动凭证 |
| NFR-5 | P0 | 共享 Web/Daemon、唯一 Panel、规范进度及风险匹配的 Web/Desktop 门禁 |

BR-8 为后续事项，不是本期实现或验收任务；保留编号用于追溯。

### 1.2 不可替换的决策

| ID | 执行约束 |
|---|---|
| DEC-1 | Go 模块化单体、PostgreSQL、持久化后台处理；账户和最小管理页面由该 Go 服务托管 |
| DEC-2 | 浏览器会话、Daemon 设备会话、云模型 Key 分用途；浏览器一次性设备授权 |
| DEC-3 | Stripe 托管结账/管理；回调验签，Invoice 发放标记与积分同事务 |
| DEC-4 | 随机高熵模型 Key，摘要鉴权、独立主密钥加密副本；数据库限制每用户一个当前有效值 |
| DEC-5 | 网关对外稳定文本/图片/语音 API 和统一视频任务；渠道及 Adapter 隔离厂商协议 |
| DEC-6 | 整数最小积分单位、批次、原子预占和不可改写记录；受理时固定模型/渠道/价格/消费上界 |
| DEC-7 | 请求与计费状态分离，稳定逻辑 ID，未知受理/用量持久化核对及人工关闭 |
| DEC-8 | 共享 Daemon 解析官方来源，唯一模型 Key 单一私有存储、按调用注入；官方 Runtime 与原配置分离 |
| DEC-9 | 共享账户界面和现有 openExternal；沿用 Panel/Adapter/预检/错误；不把共享 Web 改动自动升级为 Desktop 打包 |

### 1.3 接口、状态与金额

网关账户路径和模型路径不能互认凭证。接口的管理对象从当前身份解析，禁止客户端指定任意 Customer/Subscription 或上游地址。

| 网关接口 | 输入、鉴权与输出 |
|---|---|
| POST /api/v1/auth/register、/verify-email、/login、/forgot-password、/reset-password | 浏览器账户流程；邮箱/密码或单次令牌；公共响应不泄露账户存在性；返回受验证会话或公开错误 |
| GET /api/v1/auth/oauth/{provider}/start、/callback | provider 只允许 google/github；state、适用 PKCE/nonce、身份验证；已有邮箱要求登录原账户后绑定 |
| POST /api/v1/auth/device/start、/approve、/cancel、/token | start 返回秘密、定位链接、10 分钟期限和初始 5 秒轮询间隔；approve 需要浏览器登录及 CSRF；token 仅发起端凭秘密单次领取设备会话 |
| POST /api/v1/auth/refresh、/logout | 设备账户会话；15 分钟访问凭证、30 天刷新凭证；刷新串行轮换和重放检测；退出只撤销当前设备 |
| GET /api/v1/me、/client/bootstrap | me 返回脱敏账户；bootstrap 只接受服务端确认 kind=daemon 的会话，返回 schemaVersion=1、账户、Key/版本、目录、默认模型和接口能力；不接受普通浏览器 Cookie 下发 Key |
| POST /api/v1/model-key/rotate | 所属账户与近期身份验证；事务停用旧值，建立唯一新值；其他设备重新 bootstrap |
| GET /api/v1/plans；POST /api/v1/billing/checkout | 配置套餐；checkout 需要已验证账户、planId 和 operationId；服务端解析金额、Price、Customer，返回原订单和托管 URL |
| POST /api/v1/billing/portal、/subscription/cancel、/subscription/resume、/subscription/change | 所属账户；portal 返回所属 Customer 的托管管理 URL，平台配置不能开放即时套餐变更；change 仅选择下期 planId；禁止立即补差价或新建第二份有效订阅 |
| GET /api/v1/billing/summary、/orders、/ledger | 所属账户与游标分页；订阅状态、到期时间、金额字符串、时间戳、原订单及消费明细 |
| POST /api/v1/webhooks/stripe | SDK 验证原始 body 签名，接收记录落库；月订阅创建/续费的已付款 Invoice 发放一次，其他支付事件不触发本期积分调整 |
| /api/v1/admin/plans、/models、/channels、/users、/requests、/ledger-adjustments | 独立管理员权限；有效配置、停用、带证据结算/释放/调整及审计；不包含停售/退款流程 |
| GET /v1/models；POST /v1/responses、/chat/completions | 模型 Key；合法模型与真实能力；Responses 保留工具、终态与流式事件，不能用未验证的 Chat 转换冒充 |
| POST /v1/images/generations、/images/edits、/audio/speech、/audio/transcriptions | 模型 Key；能力、大小和输入上限；图片结构、音频二进制及 multipart 转写保留协议 |
| POST /v1/video/jobs；GET /v1/video/jobs/{id}、/result | 模型 Key；稳定任务、归属、进度和可下载结果；创建收费，查询及下载不重复收费 |
| GET /v1/requests/{requestId} | 所属模型 Key；原请求状态、用量、计费状态及有效结果引用，不创建新生成 |

公共错误为 `{error:{code,message,requestId,recovery}}`，不含原始私有上游响应。401 表示凭证失效，403 表示停用/越权，402 表示有效积分不足，409 表示 request_id_conflict 或原请求进行中，400 表示参数/能力/版本不匹配。进入流式后使用相应协议的错误事件，原 requestId 仍可查询。

上述结构是云网关响应，不替换现有本地 ApiError。Daemon 使用 apiError，把网关错误分别映射为 GATEWAY_AUTH_REQUIRED、GATEWAY_ACCOUNT_DISABLED、GATEWAY_CREDITS_INSUFFICIENT、GATEWAY_REQUEST_CONFLICT、GATEWAY_SERVICES_NOT_READY、GATEWAY_UNAVAILABLE；保留经校验的 gatewayCode/requestId/recovery 于 details。PublicErrorFacts 分别使用 unauthorized、http-rejected、http-rejected、conflict、configuration、unavailable，附可信 httpStatus，避免把公开错误类型扩大为原始响应透传。

共享公开协议的最小类型如下；raw bootstrap 仅在 Daemon 内部解码，不能在此接口新增秘密字段：

```ts
export type ServiceSource = 'manual' | 'gateway';
export type GatewayAccountState = {
  source: ServiceSource;
  authState: 'signed_out' | 'authorizing' | 'signed_in' | 'signing_out' | 'expired' | 'disabled';
  activationState: 'inactive' | 'loading' | 'ready' | 'blocked';
  account: { id: string; email: string; verified: boolean } | null;
  bindingVersion: string | null;
  models: Array<{
    id: string;
    modality: 'text' | 'image' | 'video' | 'speech' | 'transcription';
    capabilities: string[];
  }>;
  activationError: { code: string; message: string } | null;
};
export type GatewayBalanceSnapshot = {
  availableUnits: string;
  reservedUnits: string;
  periodEnd: string | null;
  asOf: string;
};
export type GatewayBalanceState =
  | { status: 'ready'; value: GatewayBalanceSnapshot }
  | { status: 'unavailable'; lastKnown: GatewayBalanceSnapshot | null; code: string };
```

请求状态为 accepted/submitting/waiting_upstream/succeeded/failed/outcome_unknown/canceled；计费状态为 reserved/settled/released/reconciling/manual_review。设备状态为 pending/approved/consumed 或 denied/canceled/expired。同一请求结算、释放均受条件状态及唯一业务键约束。

积分 JSON 用十进制整数字符串：1 积分等于 1,000,000 最小单位。Go 用受溢出检查的整数/有理数，前端用字符串和 BigInt 处理，禁止浮点扣费。按价格快照计算 `reserve=ceil(sum(maxUnits*rate))`、`charge=ceil(sum(verifiedUnits*rate))`，只在请求总额处向上取整。缓存量是输入量的分类，不能再重复计入普通输入。超上界消费不向用户隐式透支，保留真实成本、暂停问题路由并核对。

### 1.4 数据约束与最小 Runtime 边界

Go 迁移按账户/支付/请求三个行为任务增加，不一次创建所有未来表。核心约束如下，所有时间用 UTC，积分有效期为半开区间 [start,end)：

| 数据 | 必须存在的约束 |
|---|---|
| users、identities、sessions、email_tokens、device_grants | 标准化邮箱唯一，provider+subject 唯一；会话 kind 明确；秘密只保存摘要；单次令牌领取和撤销原子化 |
| model_keys | account_id 上 current=true 的部分唯一索引；key_hash 唯一；key_ciphertext、nonce、master_key_version；停用旧 Key 和创建新值同事务 |
| plans、subscriptions、payment_operations、invoices、webhook_events | 使用订单/Price 快照；账户最多一个有效订阅；操作 ID、Stripe 标识唯一；Invoice 发放标记唯一；未付款不创建有效积分 |
| credit_batches、balances、credit_ledger | 批次保留 Invoice/周期来源；余额行锁与批次分配；账本业务键唯一且应用角色不得改写历史记录；投影与记录同事务 |
| model_routes、requests、reservations | 对外模型、能力、价格与渠道版本；requestId 稳定；account_id+operation+logical_id 唯一，指纹包含规范参数和媒体摘要；预占记录原批次 |
| 审计及结果 | 管理操作保留操作者、原因、相关账本/请求；媒体私有暂存、到期引用可识别，不作为长期云文件库 |

迁移使用明确唯一约束，不能只在 handler 内先查再写：

```sql
CREATE UNIQUE INDEX model_key_one_current
  ON model_keys (account_id) WHERE current = true;
CREATE UNIQUE INDEX invoice_identity ON invoices (stripe_invoice_id);
CREATE UNIQUE INDEX ledger_business_once ON credit_ledger (business_key);
CREATE UNIQUE INDEX request_logical_identity
  ON requests (account_id, operation, logical_id) WHERE logical_id IS NOT NULL;
```

grant 的 business_key 为 `invoice:<Stripe Invoice ID>`，结算为 `settle:<requestId>`，单独全部释放为 `release:<requestId>`；Settle 内的消费及未用预占释放仍属同一次事务，不允许通过分别重试造成二次释放。应用数据库角色可写余额投影和新账本，不能 UPDATE/DELETE 历史账本。

请求先事务受理及预占，再执行上游。worker 对 accepted 的状态转换只能成功一次；提交后崩溃转 unknown，不把过期租约当成可以重新收费提交的证据。已受理时固定 route/price/model/maxUnits，调价不改变原请求。到期仅过期未预占余额；已预占请求用原批次结算，剩余过期部分不得成为新余额。核对超期转 manual_review，不能按 TTL 自动释放。

MA-4 采用最小实现候选并优先实测：官方 Runtime 使用专用 home 和 provider env_key，云 Key 只从 Daemon 私有存储读入进程内存，不写入第二份 auth.json。官方配置不能复制个人 auth/config/provider；官方进程使用明确的基础环境，排除个人模型地址和凭证来源。Runtime 无稳定调用 ID 时关闭不安全的自动重发。

设备退出先关闭 Daemon 的新请求准入并撤销本机调用资格，再关闭所有持有该官方凭证的本机 Runtime；确认其退出后才返回退出成功。退出进行中显示状态，不提前宣告成功。已受理的云端请求保留身份和预占，云端继续核对/结算；停止本机等待不等于远端无消费。其他设备和账户级云 Key 不撤销。只用 invalidate 标记进程 stale 不足以证明退出权限已撤销。

该候选仅落实 BR-9/DEC-8，不增加独立本机代理服务。若实际 Runtime 不能满足环境凭证、重试或退出后的发起边界，TASK-1 停止官方模式启用并报告差异，不能自行切换架构或降低 AC。原生第三方进程的凭证行为尚未实测，这是已接受的方案遗留风险。

## 2. 基线、文件地图与公共命令

### 2.1 工作根目录和已核对事实

- OC：/Users/leggett/develop/github/open-creator；分支 feat-user-login，commit c4a21c0202478118d5501188b11d61b186cfb431，生成计划时工作区无业务 diff；遵守其 AGENTS.md。
- GW：执行时的本地目标目录 /Users/leggett/develop/github/open-creator-gateway，当前尚未创建或检查。2026-10-05 gh 查询 open-creator-gateway 不能解析，open-creator-auth 为私有空仓库、无默认分支。
- TASK-0 优先查询目标仓库；仍只有旧仓库时，以已授权的 git@github.com:wulien/open-creator-auth.git 克隆到 GW 本地目录。Go module 使用 github.com/wulien/open-creator-gateway；保留当时实际 origin，不擅自执行远程更名或推送。目录已有内容时先只读检查，禁止覆盖。
- Go 使用标准 net/http、html/template、crypto/aes、crypto/rand、pgx/v5、成熟 OAuth/OIDC 与密码哈希库及 Stripe 官方 Go SDK；依赖锁定 go.mod/go.sum。仅新增本行为所需依赖，不增加第三个业务后端。

| 已有文件/符号 | 已核对行为与任务影响 |
|---|---|
| packages/protocol/src/creator-services.ts、index.ts、errors.ts、issues.ts | 已有各模态配置、公开错误和导出；gateway 来源/公开账户类型应单独定义，不把云 Key 放进浏览器类型；沿用 apiError/PublicErrorFacts |
| apps/daemon/src/config/private-json-file.ts：readPrivateJsonFile、createPrivateJsonDocumentEntry | 原子私有文件能力；gateway 独立凭证文件避免覆盖原凭证；Windows 权限仍须实测 |
| apps/daemon/src/creator-services/config-store.ts：createOpenCreatorCreatorServicesConfigStore、createCreatorServicesConfigStoreWithTextModelFallback | 读取手动设置及个人 Codex fallback；官方源必须先于 fallback 解析，保存手动源仍走旧逻辑 |
| apps/daemon/src/codex/probe-home.ts：createCodexIsolatedHome；creator/agent/bootstrap.ts：bootstrapCreatorAgentRuntime | 当前会复制个人 auth/config；官方 bootstrap 必须另走隔离路径，不能据目录独立推断凭证独立 |
| apps/daemon/src/codex/app-server-runtime-manager.ts：createAppServerRuntimeManager、invalidate、closeScope、closeScopes、close | invalidate 对活跃进程只记 stale；设备退出必须真正关闭持有官方凭证的进程及待启动队列 |
| apps/daemon/src/codex/app-server-host-2026-07-28.ts：createCodexAppServerHost；runner.ts：startCodexExec | 当前继承 process.env；新增受控环境只能影响官方源，原手动源保持兼容 |
| apps/daemon/src/api/server.ts：buildServer、creatorAgentBootstrapInput、creatorAppServerRuntimeManager、creatorServicesConfigStore | 集中注入配置/Runtime；避免调用 personal provider 更新路径重启不相关任务 |
| apps/daemon/src/creator/provider-requests.ts：CreatorProviderRequestLedger | 已有 requestKey、指纹及未知受理状态；加入网关身份关联，沿用原恢复机制 |
| image-generation/provider.ts：generateImageContents；video-generation/service.ts：createVideoGenerationService；creator/article/model.ts：createWechatArticleModel；creator/krillin/config-bridge.ts：createKrillinConfigToml；creator/krillin/tts-service.ts：createKrillinTtsService | 图片/视频和 Krillin 的协议不同，视频需要统一网关分支；Krillin TOML 当前会写 Key，不能直接将云 Key 落入每任务配置 |
| creator/krillin/codex-llm-gateway.ts：createKrillinCodexLlmGateway | 已有 Daemon 本机调用通道和临时 token；可复用其边界供旧执行器按调用注入，不能另起认证/计费服务 |
| apps/web/src/app/AppController.tsx、features/settings/StartupAgentSetup.tsx、CreatorServicesSettingsView.tsx、SettingsPage.tsx | 实际共享入口和设置页；账户服务使用 RuntimeClient，不使用 hostBridge.kind 分叉 |
| apps/web/src/runtime/client.ts、services/creator-services-service.ts、host/bridge.ts | 现有 API/公开错误与 openExternal；账户服务沿用模式，授权链接始终可点击 |
| apps/web/e2e/web-desktop-parity.spec.ts、fixtures/runtime.ts；playwright.config.ts | 已有 Fake Daemon 和双 Bridge；浏览器内容视口固定，Desktop 实包验证按实际 diff 决定 |

以上路径除 packages 和 apps/web 前缀外，Daemon 相对路径均位于 OC/apps/daemon/src。新建文件在 TASK 中列出；新路径不表示当前已有实现。

### 2.2 命令

命令只在这里定义一次。DTEST/WTEST/PTEST 后追加任务列出的测试路径，路径相对于表中工作目录；退出 0 才算通过。现有 scripts 的 pretest/pretypecheck 会构建依赖包，这是已有编译边界，不能因此运行全仓测试或 Desktop 打包。

| 名称 | 工作目录 | 命令与用途 |
|---|---|---|
| PREP | OC | 依次执行 pnpm --filter @opencreator/protocol build、pnpm --filter @opencreator/config build、pnpm --filter @opencreator/skill-market build、pnpm --filter @opencreator/writing-templates build；只准备实际工作区编译依赖 |
| DTEST | OC/apps/daemon | pnpm exec vitest run；仅运行任务明确列出的测试 |
| WTEST | OC/apps/web | pnpm exec vitest run；仅运行任务明确列出的测试 |
| PTEST | OC/packages/protocol | pnpm exec vitest run；协议定向测试 |
| PTYPES | OC | pnpm --filter @opencreator/protocol typecheck |
| DTYPES | OC | pnpm --filter @opencreator/daemon typecheck |
| WTYPES | OC | pnpm --filter @opencreator/web typecheck |
| DBUILD | OC | pnpm --filter @opencreator/daemon build；Runtime/协议编译边界变化后运行 |
| GWTEST | GW | go test；追加相应包、-run 和 -count=1；并发测试另使用 -race |
| GWBUILD | GW | go build -o .local/open-creator-gateway ./cmd/gateway |
| GWDB | GW | docker compose up -d postgres；仅用于隔离本地 PostgreSQL，不启 Redis/队列 |
| GWSTART | GW | go run ./cmd/gateway；配置读取私有 .local/gateway.env，缺生产前置配置时保持对应能力关闭 |
| GWAC | GW | go test ./test/acceptance -run TestPublic -count=1；真实 HTTP 与 PostgreSQL，外部替身不替换业务逻辑 |
| UIAC | OC | pnpm exec playwright test apps/web/e2e/gateway-account.spec.ts --project=chromium-desktop；另以 chromium-mobile 运行账户入口/状态布局 |
| PARITY | OC | pnpm exec playwright test apps/web/e2e/gateway-web-desktop-parity.spec.ts --project=chromium-desktop |

先执行 PREP，再执行 DTEST/WTEST；协议变动后刷新对应编译依赖。每个新测试套件必须确认被发现且至少运行一项，不能把 passWithNoTests 当成通过。GW 使用 Go 1.24 或以上及 PostgreSQL 16 或以上；工具版本不满足时仅阻塞其依赖任务，不修复无关环境。

本地网关默认监听 127.0.0.1:19871，数据库测试端口 55432；启动前确认端口，已占用时在隔离配置中选择空闲端口。生产账户和 OAuth 对外使用 HTTPS；本地浏览器验收通过受信任测试 HTTPS 来源或测试夹具 TLS，不放宽生产 Cookie/证书规则。密钥不进入命令行参数、仓库或验收记录。

## 3. 追踪矩阵

| 任务 | 需求/规则 | 决策 | 自动化测试位置 | 功能验收 |
|---|---|---|---|---|
| TASK-1 | FR-4、FR-10、BR-9、NFR-1、NFR-4 | DEC-8 | gateway-runtime-bindings.test.ts、gateway-runtime-protocol.test.ts | AC-4、AC-10、AC-12 |
| TASK-2 | FR-1、BR-1、NFR-2 | DEC-1、DEC-2 | GW/internal/server/auth_test.go | AC-1 |
| TASK-3 | FR-2、FR-3、BR-2、NFR-1、NFR-2 | DEC-2、DEC-4 | GW/internal/server/device_test.go、modelkey_test.go | AC-2、AC-3、AC-12 |
| TASK-4 | FR-6、FR-7、BR-3、NFR-3 | DEC-1、DEC-3、DEC-6 | GW/internal/server/billing_test.go | AC-6 |
| TASK-5 | FR-5、FR-7、FR-11、BR-4、BR-5、BR-6、BR-7、NFR-2、NFR-3 | DEC-5、DEC-6、DEC-7 | GW/internal/server/requests_test.go | AC-5、AC-7、AC-11、AC-12 |
| TASK-6 | FR-5、FR-11、FR-12、BR-4、BR-6、NFR-2、NFR-3 | DEC-5、DEC-7 | GW/internal/server/modalities_test.go、recovery_test.go | AC-5、AC-11、AC-12 |
| TASK-7 | FR-2、FR-4、FR-10、FR-12、BR-9、NFR-1、NFR-4 | DEC-2、DEC-8 | gateway-account-contract.test.ts、gateway-account-service.test.ts、gateway-account-api.test.ts、creator-services-config-store.test.ts | AC-2、AC-4、AC-10、AC-12 |
| TASK-8 | FR-5、FR-10、FR-11、FR-12、BR-4、BR-9、NFR-4、NFR-5 | DEC-5、DEC-7、DEC-8、DEC-9 | creator-gateway-services.test.ts、creator-provider-requests.test.ts、krillin-codex-llm-gateway.test.ts | AC-5、AC-10、AC-11、AC-13 |
| TASK-9 | FR-4、FR-8、FR-12、NFR-5 | DEC-8、DEC-9 | GatewayAccountSettingsView.test.tsx、gateway-account-service.test.ts、StartupAgentSetup.test.tsx | AC-4、AC-8、AC-13 |
| TASK-10 | FR-8、FR-9、NFR-1、NFR-2 | DEC-1、DEC-3、DEC-6、DEC-7 | GW/internal/server/admin_test.go、account_pages_test.go | AC-8、AC-9、AC-12 |
| TASK-11 | FR-12、NFR-1、NFR-3、NFR-4、NFR-5 | DEC-1、DEC-8、DEC-9 | GW/internal/server/config_test.go、gateway-account-api.test.ts | AC-4、AC-6、AC-11、AC-12、AC-13 |
| TASK-12 | FR-1 至 FR-12、BR-1 至 BR-7、BR-9、NFR-1 至 NFR-5 | DEC-1 至 DEC-9 | GW/test/acceptance/public_test.go、gateway-account.spec.ts、gateway-web-desktop-parity.spec.ts | AC-1 至 AC-13 |

## 4. 行为任务

### TASK-0：确认 Plan 仍然有效

核对 OC 的分支/commit、上述文件、符号、命令和批准记录；运行 git status --short，保留已有用户改动。无关变化或不改变契约的路径/命名变化记录后继续；职责、接口、数据、DEC 或 AC 失效则停止，不静默重设计。

只读核对 GW 目标：gh repo view wulien/open-creator-gateway --json nameWithOwner,isEmpty,defaultBranchRef；不可解析时查询 open-creator-auth。本地目录不存在且仍只有空的旧仓库时，执行 git clone git@github.com:wulien/open-creator-auth.git /Users/leggett/develop/github/open-creator-gateway。已有目录先检查，不覆写，也不为本任务扫描父目录。克隆后读取 GW 自身 AGENTS.md（若存在），记录真实 origin、分支及 commit/空仓事实。

确认 PostgreSQL、Go、Node/pnpm 和实际 bundled Codex 路径；核对 OAuth、邮件、Stripe 测试环境、域名及各模态配置的可用性，不虚构值。缺外部凭证仍可进行替身下的实现和局部测试，但其真实验收标记 BLOCKED，不宣称完整交付。TDD 豁免：仅基线/环境检查，不改变产品行为。

### TASK-1：优先验证官方 Runtime 的隔离、重试与退出

依赖 TASK-0；在收费路由开放之前完成。

文件：创建 OC/apps/daemon/src/gateway/runtime-bindings.ts；修改 codex/app-server-host-2026-07-28.ts 和 codex/runner.ts 的官方环境输入边界；测试 OC/apps/daemon/test/unit/gateway-runtime-bindings.test.ts、test/integration/gateway-runtime-protocol.test.ts。这些 Daemon 路径均相对 apps/daemon/src 或 test。

代码边界：`createGatewayRuntimeBindings(input)` 返回 `prepare(): Promise<{codexHome:string; env:Record<string,string>; generation:number}>`、`beginLogout(): void`、`close(): Promise<void>`。prepare 从私有凭证 callback 获取 Key，写仅含官方 provider 配置的 home，provider env_key=OC_GATEWAY_MODEL_KEY，wire_api=responses；该 Key 只放入受控子进程环境。官方参数禁止从个人 home、process.env 模型字段或原 provider credential fallback 读取。给进程启动接口增加显式 baseEnvironment，缺省保持旧 manual 行为，官方使用基础环境 allowlist。

先对实际 bundled Runtime 验证该配置、零不安全自动重发及工具/流式协议。beginLogout 原子关闭发起 gate；close 关闭官方 manager 和待启动队列、等待进程退出并清除内存；只有 close 完成才允许退出 API 返回成功。普通 invalidate 不作为退出实现。进程 close 的已有超时/强制终止逻辑复用，不新增通用进程框架。

TDD 必须：namespace/dynamic import 新边界，断言缺少 createGatewayRuntimeBindings 的业务能力为 RED，不能把模块加载失败当 RED。TestRuntimeCannotStartAfterLogout 用两账户、带个人 Key 的父环境和可暂停的真实测试上游：首个请求受理后退出，再触发下一模型调用，期望成功退出后无新调用、无个人 Key、云 requestId 仍可查询。基线为现有 codex-app-server-client-shutdown.test.ts。GREEN 仅补受控环境、官方 home 与实际关闭 gate；DTEST 运行新两文件及上述基线。若 bundled Runtime 无法满足任一边界则本任务 BLOCKED，报告所需方案变化，不能自动引入第二种认证架构。

完成门：针对实际 Runtime 的结果满足 AC-4/AC-10/AC-12 对应部分；本任务不声称网关计费已完成。

### TASK-2：提供账户注册与三种浏览器登录

依赖 TASK-0，和 TASK-1 可独立开展，官方启用仍等待 TASK-1。

GW 创建 go.mod、cmd/gateway/main.go、internal/server/server.go、internal/auth/service.go、internal/auth/oauth.go、internal/storage/store.go、internal/storage/migrations/001_accounts.sql、web/templates/auth.html；测试 internal/server/auth_test.go，公共夹具 internal/testkit/harness.go。超过五个文件是空仓库中一个真实登录行为所需的启动、持久化、页面与外部身份边界，不按层另建交付。

先搭能运行的 NewServer(Dependencies) http.Handler、GET /healthz 和测试数据库夹具，再写认证 RED。用 pgx、标准模板、成熟 OAuth/OIDC 库及 bcrypt；浏览器 Cookie Secure/HttpOnly/SameSite、CSRF/origin；邮箱令牌单次和到期，邮件发送边界可替身但领取走真实路由。身份只认验证后的 provider/subject，同邮箱先证明原账户归属。注册硬编码普通用户角色；管理员不经公开注册授予。

TDD 必须：TestRegisterRequiresVerifiedEmail 经公开注册/验证/登录路由创建账户，验证前购买和模型凭证访问拒绝，消费验证令牌一次后登录成功；TestOAuthSameEmailDoesNotMerge 用受控 OAuth 声明证实需原账户绑定；错误 state、过期/重放令牌及重复回调均拒绝。RED 为真实路由尚未提供该行为，不是 Go 编译或依赖失败。GREEN 完成 auth handler 和事务，不 mock 账户判断。GWTEST ./internal/server -run 'TestRegister|TestOAuth|TestPasswordReset' -count=1；回归健康和迁移测试。

完成门：AC-1 的确定性 API/页面流程；真实 OAuth/邮件另在 TASK-12 验收。

### TASK-3：设备授权后下发用户唯一模型 Key

依赖 TASK-2。GW 修改 internal/auth/service.go、internal/server/server.go；创建 internal/modelkey/service.go、internal/storage/migrations/002_device_model_key.sql、web/templates/device.html；测试 internal/server/device_test.go、modelkey_test.go。

实现设备状态、频率/轮询约束与原子单次领取。sessions 用 kind 区分浏览器/Daemon；bootstrap 在服务端验证会话种类，返回完整 schemaVersion=1 快照。Key 使用 32 随机字节，摘要鉴权及 AES-GCM 加密副本、独立主密钥和 key version；并发领取在账户锁和唯一索引下取得同一当前值。rotate 在同事务替换旧值。刷新串行轮换，重放撤销相应设备令牌族；失效公开提示重新授权，迟到结果不能覆盖新尝试。

TDD 必须：TestDeviceConsumedOnce 并发领取只有一次得到会话；TestModelKeySharedAcrossDevices 两个 A 设备并发 bootstrap 得同一 Key，B 不同；TestModelKeyCannotManageAccount 尝试账单和管理接口被拒绝，rotate 后旧 Key 401，新 Key 仍能查询 A 原任务。浏览器 Cookie bootstrap 返回拒绝而不是 Key。GREEN 只实现用途隔离和持久化约束；GWTEST ./internal/server -run 'TestDevice|TestModelKey' -count=1，另以 -race 运行两项并发测试，回归 auth。

完成门：AC-2/AC-3 的网关部分和 AC-12 凭证响应边界。

### TASK-4：月订阅付款后发放一次当期积分

依赖 TASK-3。GW 创建 internal/billing/service.go、internal/billing/stripe.go、internal/credits/service.go、internal/storage/migrations/003_subscription_credits.sql；修改 internal/server/server.go；测试 internal/server/billing_test.go。

加入套餐/订单快照、账户唯一有效订阅及 payment operation 幂等。调用 Stripe 官方 SDK 托管 Checkout，服务端选择 Price/Customer；下期套餐变更、取消/恢复作用于同一订阅。验签接收记录落库后处理合法已付款月订阅 Invoice：事务检查 Invoice 发放标记，创建批次、grant 账本并更新余额；并发冲突返回原发放结果。新续费 Invoice 创建新一期；网页跳回、订阅创建或未付款 Invoice 不发放。保留持久化接收/重试状态，不建立外部队列。

TDD 必须：TestPaidInvoiceGrantsOnlyOnce 用真实 PostgreSQL，20 个并发已验签付款通知指向同一 Invoice，expect 批次/发放记录各一条、余额只增加套餐额度；TestCheckoutReturnDoesNotGrant 访问成功页面余额仍零；TestRenewalAndPeriodEnd 成功新 Invoice 发放、失败续费零增量、旧未用余额过期、取消保留当期、下期变更符合新快照。Stripe 外部调用可替身，签名及业务处理不 mock。GWTEST ./internal/server -run 'TestPaidInvoice|TestCheckout|TestRenewal' -count=1；并发用 -race；回归 device/modelkey。

完成门：AC-6 的确定性公开 API/数据库部分，不新增退款、停售或跨 Invoice 合并。

### TASK-5：带积分预占与结算的文本模型请求

依赖 TASK-4；官方 Runtime 联调另依赖 TASK-1。GW 创建 internal/models/adapter.go、internal/models/compatible.go、internal/requests/service.go、internal/storage/migrations/004_model_requests.sql；修改 internal/credits/service.go、internal/server/server.go；测试 internal/server/requests_test.go。多文件是同一“余额约束下的真实模型请求”事务与传输边界。

定义 Adapter 的 Capabilities、Quote、Submit、Query 边界，输入携带 operation、外部 model ID、规范参数/媒体摘要和限制；Quote 返回可信输入量及可执行最大量，Submit 返回受理身份/状态/可信用量。JSON、multipart、SSE 与 Token 计量采用结构化解析及适用的成熟协议/计量实现。先实现原生 Responses 和 Chat-compatible 路由，不将无工具/Responses 的渠道标记可用。内部接口定义片段：

```go
type ModelCall struct {
    Operation, Model, MediaDigest string
    Params json.RawMessage
    Media io.ReadSeeker
    MaxUnits map[string]int64
}
type Channel struct { ID, BaseURL, APIKey string }
type Receipt struct {
    UpstreamID, State, ContentType string
    Usage map[string]int64
    Result json.RawMessage
    Body io.ReadCloser
}
type Adapter interface {
    Capabilities() map[string]bool
    Quote(context.Context, ModelCall) (map[string]int64, error)
    Submit(context.Context, ModelCall, Channel) (Receipt, error)
    Query(context.Context, string, Channel) (Receipt, error)
}
```

Quote 的单位集合与固定价格快照对应；媒体先在受限私有暂存中计算摘要，Quote 后 rewind，恢复时重新打开同一原始媒体，不能重用已耗尽的输入流。Channel 仅由服务器解密构造，不参与公开 JSON。Receipt 的 Body 由请求 worker 消费并关闭，边转发边用结构化协议解析终态/usage，客户端断开不丢弃后台记录。

统一 Admit(ctx,account,operation,logicalID,payload) 返回稳定 requestId、请求快照及原子预占；无 external logicalID 的原生调用每次实际请求新建 ID。相同逻辑 ID/指纹读原结果，冲突 409。数据库 commit 前禁止 Submit。输入计量、输出 Token 或媒体上限由已验证 Adapter 与真实发送参数约束，不能证明上界的路由拒绝启用。后台读完可信终态/usage，再 Settle(ctx,requestId,usage) 单次消费与释放；不因客户端断开直接退回预占。

TDD 必须：TestConcurrentAdmissionNeverOverspends 余额只够一个上界请求，两个并发请求只有一个触达假上游；TestLogicalRequestReused 相同 ID/参数重放只一次提交和结算，改参数 409；TestPriceSnapshotAndExpiry 请求后调价/跨期仍用旧快照，过期释放不回可用；TestUnknownUsageKeepsReservation 流中断且无 usage 时为 reconciling。GREEN 保持 SQL 事务、状态与计量核心真实；GWTEST ./internal/server -run 'TestConcurrentAdmission|TestLogicalRequest|TestPriceSnapshot|TestUnknownUsage|TestResponses' -count=1，并发项 -race；回归 billing。

完成门：AC-5 文本/工具/流式、AC-7、AC-11 核心路径。

### TASK-6：其余模态、视频任务与重启恢复

依赖 TASK-5。GW 创建 internal/models/media.go、internal/models/video.go、internal/requests/worker.go、internal/requests/results.go；修改 internal/server/server.go；测试 internal/server/modalities_test.go、recovery_test.go。

兼容图像和音频路由保留请求/响应协议，适用编辑按能力开放；服务端解析媒体时长/规格及大小，不信客户端声明。视频 Adapter 首条使用现有 Seedance 协议事实映射统一 Create/Query/Result，后续可配置其他中转站。所有模态走同一 Admit/Settle，只有实际请求收费。返回网关稳定结果引用或标准协议内容，下载验证归属/来源、解析地址、重定向、大小及有效期，禁止把鉴权头带去任意媒体主机。

worker 从 PostgreSQL 恢复 accepted/query/reconciling 状态；提交开始后失去回执转 unknown，安全查询或幂等证据成立才允许下一动作。lease 不授权盲重发，核对期限到后转人工。模型进度映射标准字段，无远程取消能力时区分停止本地等待与实际远端取消。

TDD 必须：TestAllModalitiesUseSameBalance 对一账户完成图像、TTS、转写和视频，检查同一积分账户和请求账本；TestRestartDoesNotResubmitAcceptedVideo 在提交后/回执落库前两处注入崩溃，重启只恢复原身份或 unknown；TestResultOwnershipAndRedirect B 查 A 结果拒绝，内部地址/重定向不泄漏上游 token，过期不自动生成。GREEN 只增加这四类适配和持久化恢复；GWTEST ./internal/server -run 'TestAllModalities|TestRestart|TestResult' -count=1；回归 requests。

完成门：AC-5 其余模态、AC-11/AC-12；真实能力在 TASK-12 小样本验证。

### TASK-7：Daemon 登录、自动配置及官方 Runtime 激活

依赖 TASK-1/TASK-3，付款状态依赖 TASK-4。OC 创建 packages/protocol/src/gateway-account.ts；在 index.ts 导出并扩展 errors.ts 的公开网关错误；创建 apps/daemon/src/gateway/client.ts、account-service.ts、config-store.ts、apps/daemon/src/api/routes.gateway-account.ts；修改 api/server.ts、creator/agent/bootstrap.ts；测试 packages/protocol/test/gateway-account-contract.test.ts、Daemon 的 gateway-account-service.test.ts、gateway-account-api.test.ts 及 creator-services-config-store.test.ts。多文件连接一次设备授权到实际 Runtime 激活，不按协议/页面另拆交付。

公开协议定义 ServiceSource='manual'|'gateway'；GatewayAccountState 含 account、authState、activationState、公开模型目录及错误；所有金额为 string，公开类型没有 modelKey/accessToken/refreshToken。私有 GatewayCredentials 含账户会话、模型 Key/version/bindingVersion，仅存在 Daemon 文件与内存；public bootstrap 单独由 secret 快照脱敏。

createGatewayAccountService 提供 startAuthorization、cancelAuthorization、readState、refresh、activate、logout；API 使用现有 requireAuth。共享本地路径为 GET /gateway/account、POST /gateway/auth/start、/cancel、/logout、/activate，PATCH /gateway/source，GET /gateway/billing，POST /gateway/billing/checkout、/portal。start 返回公开授权 URL/尝试 ID，秘密只在 Daemon。轮询慢退避/过期、attempt generation 与刷新队列避免迟到覆盖。

私有文件 dataDir/config/gateway-credentials.json，公开模式/快照 dataDir/config/gateway.json；复用私有原子文件 helper，不合写或覆盖手动凭证。用 bindingVersion 检查两个快照一致，最后提交 activation ready；写入或 Runtime 失败保持已登录/未就绪。manual 默认兼容旧数据。只给官方 home 写 provider/env 配置，不调用个人 provider config/batchWrite。logout 顺序按 TASK-1，重启仅在私有会话有效且快照一致时恢复，失败不 fallback 到个人 Key。

TDD 必须：TestLateAuthorizationCannotReplaceAccount 暂停旧尝试后新授权成功，迟到结果不覆盖；TestBootstrapFailureDoesNotActivate 注入文件/Runtime 失败，模式不假就绪、手动文件哈希不变、Web 响应无秘密；TestLogoutClosesOfficialRuntimeButNotOtherDevice 用存活 host、排队请求和第二设备证明退出完成后新请求拒绝；协议测试验证六类错误映射、公开状态及金额字符串，没有秘密字段。新公开导出通过 namespace import 判断行为，不制造加载失败。PTEST 运行 test/gateway-account-contract.test.ts、test/error-facts.test.ts；DTEST 运行新两测试和 creator-services-config-store.test.ts，PTYPES/DTYPES；回归 creator-services-api.test.ts 和 codex-provider-config.test.ts 的旧路径。

完成门：AC-2/AC-4/AC-10/AC-12 的 Daemon 部分，MA-4 实现证据由最终真实边界验收确认。

### TASK-8：现有创作调用使用同一官方来源并保留 BYOK

依赖 TASK-5/TASK-6/TASK-7。OC 创建 apps/daemon/src/gateway/creator-service-source.ts；修改 creator-services/config-store.ts、image-generation/provider.ts、video-generation/service.ts、creator/provider-requests.ts、creator/krillin/config-bridge.ts、creator/krillin/codex-llm-gateway.ts、api/server.ts；测试 test/integration/creator-gateway-services.test.ts、test/unit/creator-provider-requests.test.ts、krillin-codex-llm-gateway.test.ts。跨文件是同一配置来源在五模态既有调用方的接入，保持原实现职责。

resolveCreatorServiceSource 为每个新任务取得 immutable {source,accountId,bindingVersion,models,capabilities}，绑定原来源后再执行。文本/图片/OpenAI 语音沿用现有接口，注入 gateway endpoint/model 和按调用读取的 Key，不保存到手动配置。视频增加统一网关 Create/Query/Result 分支，不伪造 Seedance/Kling 的旧认证字段。源选择位于共享 Daemon，Workspace 不拥有账户或第二套 SSE。

Krillin 复用已有本机调用通道，任务配置只持有可撤销的本机 capability token；实际云 Key 由 Daemon 校验原账户后注入上游请求。扩展既有通道的 Chat/语音必要路径，供 config-bridge 输出兼容 TOML；不得在每任务 TOML 复制云 Key。该 token 不是第二把用户云 Key，不承载新计费后端。继承的工具调用/子阶段各自计量，不能用单个预估覆盖整个 Agent 链。

受控调用保存稳定 logicalID、gateway requestId/accountId/模式快照与原 CreatorProviderRequestLedger 的关联。相同账户 Key 更新只换鉴权不换任务；切账户/来源前检查活跃任务，结束后再切。保留手动 fallback 只用于 manual；gateway 能力失效准确预检，不静默选择个人源。登录/余额等 UI 变化不写 Activity。

TDD 必须：TestGatewaySourceReachesAllModalities 通过真实 Creator API 发各模态，观察假网关请求、稳定身份和本地产物，原手动文件不变；TestManualSourceBypassesGateway 相同操作走原服务且网关账本无变化；TestModeSwitchWaitsForActiveTask 暂停任务后切换拒绝/等待，不重启当前消费者；TestKrillinConfigDoesNotContainCloudKey 检查 TOML，实际转发才携带 Key，注销本机资格后新调用拒绝。DTEST 新集成及两回归、DTYPES，实际编译边界变化运行 DBUILD。

完成门：AC-5/AC-10/AC-11/AC-13 对应调用方部分。

### TASK-9：共享客户端登录、订阅与账户视图

依赖 TASK-7/TASK-8。OC 创建 apps/web/src/services/gateway-account-service.ts、features/settings/GatewayAccountSettingsView.tsx、gateway-account-settings.css；修改 app/AppController.tsx、features/settings/StartupAgentSetup.tsx、CreatorServicesSettingsView.tsx、SettingsPage.tsx；测试 GatewayAccountSettingsView.test.tsx、services/gateway-account-service.test.ts、StartupAgentSetup.test.tsx。统一入口/账户视图是同一用户流程；不复制 Desktop UI。

沿用 RuntimeClient 和现有 localized copy。服务来源用官方/自带服务的 segmented control；登录、订阅、重试为明确命令。账户显示身份、订阅时间、可用/预占积分及入口；金额不可损失精度。authState 与 activationState 分开；过期、零积分、付款处理中、查询故障及退出进行中均对应后台事实。查询失败保留上一成功时间，不以 0 替代。打开授权/付款 URL 调用 openExternal，同时始终给可点击链接，不以 Promise<void> 宣告浏览器已打开。

登录入口不必先填 Key/地址；原本机 Codex 和自带服务保留。登录成功不能单靠 UI 切到 ready，必须使用 Daemon 激活结果。Bootstrap/Key 不进入页面 props、浏览器存储或截图。沿用 quiet settings 布局与 lucide 图标，不新建营销页、另一个 Panel 或平台分叉。

TDD 必须：未登录点击登录会发公开 API；已登录但激活失败显示未就绪且可重试；余额查询失败不显示零；待确认订单不显示到账；退出进行中按钮状态稳定；原配置用户升级保持 manual。WTEST 新两测试及 StartupAgentSetup.test.tsx、CreatorServicesSettingsView.test.tsx；WTYPES。真实交互由 UIAC 和 PARITY，不因纯页面改动构建或重启 Vite。

完成门：AC-4/AC-8/AC-13 对应页面部分。

### TASK-10：网关账户网站和最小管理员操作

依赖 TASK-4/TASK-6。GW 创建 internal/admin/service.go、web/templates/account.html、web/templates/admin.html；修改 internal/server/server.go；测试 internal/server/admin_test.go、account_pages_test.go。

账户页读 summary/orders/ledger，Stripe 托管管理入口仅开放取消/恢复和允许的下期变更，不绕过 BR-3。配置管理只处理当前计划所需的套餐、模型价格与渠道；不增加停售工作流。普通账户/模型 Key 无管理权限；管理员启用能力须通过参数、协议和计量校验。待核对请求仅凭证据单次结算/释放；任意余额修正写独立 adjustmentId/reason/actor，不能 UPDATE 历史消费。

TDD 必须：TestUserCannotAdmin 三类凭证越权拒绝；TestManualReconciliationIsAudited 同 requestId 和 adjustmentId 重复操作仍只写一次且有原记录引用；TestAccountPageFailureDoesNotShowZero 查询故障准确呈现。GWTEST ./internal/server -run 'TestUserCannotAdmin|TestManualReconciliation|TestAccountPage' -count=1；回归账本和结果归属。

完成门：AC-8/AC-9/AC-12；不增加退款页面或后台退款状态机。

### TASK-11：测试环境、能力开关与可回滚运行

依赖 TASK-2 至 TASK-10。GW 创建 internal/config/config.go、compose.yaml、.env.example、README.md；修改 cmd/gateway/main.go；测试 internal/server/config_test.go。OC 的 gateway client/origin 配置只在共享 Daemon 来源读取，测试 gateway-account-api.test.ts。数据库迁移只新增必要表，不模拟空仓库不存在的旧云账户迁移。

私有 .local/gateway.env 提供数据库、加密主密钥、HTTPS/OAuth/邮件/Stripe 测试环境、套餐/模型/渠道及各限制。公开 .env.example 只放变量名和非敏感说明，不虚构商户/域名/模型。生产启动验证环境隔离，缺能力配置只关闭该能力并给稳定状态；凭证和数据库核心配置缺失则服务不进入 ready。compose 默认仅 PostgreSQL，Go worker 同服务运行，模型结果临时目录挂载独立私有 volume。

发放/结算和后台核对可保持运行，生成路由有总开关。测试回滚：关闭新官方调用，保留账本/inbox/预占和已受理查询/worker，客户端仍能显式切回旧源；禁止删账本或重新发周期积分。所有服务操作先查 PID/命令/端口；仅重启本次改变的服务及直接依赖，健康检查 GET /healthz（Go）和 /healthz（Daemon）。Vite 正常热更新不重启。

TDD 必须：TestInvalidProductionConfigDoesNotBecomeReady、TestDisabledGenerationKeepsRecovery；前者给测试商户/缺密钥/非法能力组合，后者关闭调用但旧任务可查询并结算。GWTEST ./internal/server -run 'TestInvalidProductionConfig|TestDisabledGeneration' -count=1，GWBUILD；OC 回归 gateway-account-api.test.ts、DTYPES/DBUILD。配置部署操作可豁免 RED，但以上业务准入测试不可豁免。

完成门：相关 AC-4/AC-6/AC-11/AC-12/AC-13；只准备测试环境，不擅自公开部署。

### TASK-12：执行完整功能验收

依赖所有前置任务；先完成主 Agent 本地实现差异自审，不启动 Reviewer。查看两个仓库 git diff --stat 和相关 diff，对照快照/追踪/TASK 检查漏项、范围扩张、接口漂移、过度抽象、权限、兼容及测试质量。只修本次相关问题，按 TDD 重跑受影响验证；最后一次相关修改后重新检查差异和相关验收。

创建 GW/test/acceptance/public_test.go、OC/apps/web/e2e/gateway-account.spec.ts、gateway-web-desktop-parity.spec.ts。这些验收从真实网络 API、Go 页面和 OpenCreator 页面进入真实认证/计费/Daemon 业务，不能重命名单元测试充当交付证据。采用既有 Fake Daemon 的双 Bridge 夹具；真实联调另用测试网关及实际 Daemon。

按第 5 节执行 GWAC、UIAC、PARITY、真实 OAuth/邮件/Stripe/模型小样本及条件命中的 Desktop 门禁；记录 PASS/FAIL/BLOCKED、时间、命令、目录、退出状态与输出摘要。保留既有 Playwright 截图/trace 产物，其他结果留在执行会话，不额外新建实施报告或流程日志文件。

## 5. 最终功能验收矩阵

公共准备：隔离 PostgreSQL、A/B 两账户及两个 A 设备、可控制的 clock/假上游、Stripe 测试商户、真实 OAuth 应用/邮件、实际 bundled Runtime、原手动配置快照。假上游仅替换外部服务，真实 SQL/账本/HTTP/Daemon/页面不 mock。真实渠道用专用账户和受控小样本，禁止生产账户/大规模消费。

| AC | 优先级 | 前置条件与操作 | 独立预期及证据 |
|---|---|---|---|
| AC-1 | P0 | 经 Go 页面及 API 完成邮箱验证、登录/找回和 Google/GitHub；尝试同邮箱绑定、错 state、重放及未验证购买 | 三种真实登录成立；单次令牌一次有效；绑定证明原归属；无未验证凭证/购买。HTTP/邮件领取与实际 OAuth 回调证据，缺配置标 BLOCKED |
| AC-2 | P0 | OpenCreator 发起/取消/过期设备授权、重复领取，刷新并重启 Daemon；在旧尝试延迟时开新尝试 | 发起端单次得到会话，旧响应不覆盖；刷新/重启恢复；退出仅撤销当前设备。页面与真实 API/session 记录 |
| AC-3 | P0 | 两个 A 设备并发首次领取/重登，B 登录；重置后用旧值、模型 Key 调账户/管理和 B 任务 | A 共用唯一当前值、B 不同；旧值立即失效，模型 Key 无管理权，归属拒绝；Key 不在浏览器。并发 SQL/API 与脱敏观测 |
| AC-4 | P0 | 新用户登录，已配个人 Codex/手动源的老用户登录；注入 bootstrap/文件/Runtime 失败后恢复与切回 | 真正就绪后无需手填可调用；失败显示已登录未就绪；原文件哈希不变，升级仍 manual。真实 Runtime/API、前后文件哈希和页面 |
| AC-5 | P0 | 每模态至少一个真实启用路由；Agent 工具/流式、业务文本、图片及适用编辑、视频创建查询下载、TTS、转写；尝试不支持能力 | 全流程/产物/可信用量完整；不支持拒绝；无不安全自动重发。每模态受控真实请求与本地产物，替身不证明厂商能力 |
| AC-6 | P0 | Stripe 测试环境购买；重放/并发同 Invoice 付款通知；正常新月 Invoice、失败/补缴、取消/恢复、下期变更和到期 | 同 Invoice 一次 grant，新合法 Invoice 新一期；未付款/跳回页面不给积分；规则正确、旧余额不结转。真实 Checkout/回调/周期与 SQL 账本证据，无退款/停售用例 |
| AC-7 | P0 | 已知余额/价格，公开模型 API 并发；不足提交、重复结算、执行后调价、超上界、跨期完成/释放 | 无超支，不足不触达上游；一次结算、原价格，过期释放不回余额，无隐式债务；投影可核对。真实 PostgreSQL/上游收件与公开查询 |
| AC-8 | P1 | 账户页有消费/预占/订单；模拟付款处理中及 summary 故障，随后恢复 | 正确归属和金额，预占区别消费；待确认非到账；故障非零、保留更新时间、入口可操作。Go/OpenCreator 真实页面和 API |
| AC-9 | P0 | 普通用户、模型 Key 和管理员；修改配置、停用用户、带证据核对/调整并重复提交 | 权限拒绝、非法能力不开；停用拦截新请求；核对/调整一次及完整审计，历史不可改写。真实管理 API 和 SQL |
| AC-10 | P0 | 有活跃任务和两设备；切账户/模式、退出，任务结束后切回，并调用 manual | 切换不换当前任务身份；成功退出后持凭证进程结束且无新调用，其他设备正常；原服务恢复，直连不扣网关积分。实际进程/上游收件/API/页面，不以 stale 标志证明退出 |
| AC-11 | P0 | 稳定 ID、远端回执与暂停/崩溃点；冲突、重复/重连/查询下载、流中断、回执前崩溃、worker 重启、超期及同账户恢复 | 原任务只提交/结算一次；未知不盲重发/释放，后台恢复及人工关闭；B 不能恢复；无 ID 原生调用不猜幂等。真实 HTTP/SQL/实际 Runtime 故障注入 |
| AC-12 | P0 | 带标记的测试秘密、恶意来源/媒体/重定向及目标 OS；检查 Web 响应、页面/storage/URL/日志和文件权限，尝试 CSRF/越权/SSRF | 标记不进入禁止位置；实际访问控制成立；错误拒绝且认证头不随重定向泄漏。公开 API/浏览器/文件边界；Windows 无证据不宣称该平台通过 |
| AC-13 | P0 | 同 Fake Daemon、账户/任务/偏好，内容视口 1280x800；Browser/Desktop Bridge 执行账户、登录入口、模式、模型及模板预检 | 文案/DOM/关键尺寸/状态/请求/持久化一致；现有 Bridge 真调用；唯一 Panel、标准 Activity/进度。PARITY 证据；Desktop 包按下面条件另验 |

AC-12 表中操作与预期应按同一公开边界记录，不将安全检查泛化成无关审计。每个 AC 的实际证据包括本次执行时间、环境、命令/操作和观察结果；未执行不能写 PASS。

运行真实 API 验收时用独立网关/Daemon 数据目录与测试账户。验收后只清理测试夹具及专用数据库 schema/账号，不删除用户数据、订阅事实或未知上游任务。外部请求未知先核对后清理，不能靠删库隐藏预占。主 Agent 自审和最终 AC 必须在最后一次相关代码修改后进行。

Desktop 升级门：只有实际 diff 触及 apps/desktop、Host Bridge、Preload/IPC、Daemon 启动/代理、打包资源，或交付目标包含 Desktop 包时，才执行当前 Web 重建、实际 desktop:package、packaged App E2E 和内嵌 Web 文件/哈希一致性。若命中，读取仓库当时实际打包脚本及验证入口并运行其真实命令；不创建第二套实现。未命中只验相关双 Bridge 与共享调用，不能宣称实际 App 已验证。

## 6. 偏差、失败熔断及最终报告

执行必须先写行为 RED，确认失败来自业务缺失，再最小 GREEN、相关回归；已有兼容基线可先绿但不能当 RED。新公开模块不能用静态具名 import 的加载错误冒充行为失败。Go 先具备可编译的 handler/夹具，RED 从真实路由或断言产生，不以编译失败代替。

GREEN 后每次修复先记录失败证据、根因假设、最小改动。同一根因经过两次有实质差异的修复仍失败，立即停止该 TASK 标为 BLOCKED，报告实现/测试/环境/契约分类和下一步；预期 RED 不计次数。禁止盲试、放宽断言、改 AC、自动启动子 Agent 或修复无关历史问题。

允许不改变契约的局部路径/命名调整，记录原因和影响；需要改变 FR/BR/NFR/DEC/AC、权限/账本/架构则停止并更新方案。缺真实凭证可以完成不依赖它的工作，但最终 P0 真实边界仍 BLOCKED。任何 P0 FAIL/BLOCKED 不宣称交付完成或可发布。

最终回复报告：完成/未完成任务、契约不变的偏差、主 Agent 差异自审及相关修复、实际 RED/GREEN/回归命令结果、AC 的本次证据/状态、测试环境与回滚状态及遗留风险。无提交、推送、tag、公开部署任务，除非用户另行明确授权。

## 7. 风险与审核记录

| ID | 原始状态/证据 | 处理与完成边界 |
|---|---|---|
| PLAN-ENV-1 | NOT_AVAILABLE；工具清单无三个 Agent 生命周期工具；无 spawn/agent_id/输出 | 独立 Plan 审核未执行，不冒充已审核；用户知情执行授权可推进，但保留风险 |
| MA-4 | 方案保留的 OPEN/Major，已知个人 auth 复制、进程继承环境及 invalidate 延迟关闭行为 | TASK-1 优先测实际 Runtime，TASK-7/TASK-8 实现，AC-4/AC-10/AC-12 验收；达不到则不启用官方收费调用 |
| PLAN-EXT-1 | 目标新仓库名当前不可查询，旧仓库为空；域名/商户/OAuth/邮件/渠道尚未实测 | TASK-0 定位，外部缺失只阻塞其真实验收；不凭文档或替身声称已上线 |

第一版 Plan 审核范围：本计划列出的 FR-1 至 FR-12、BR-1 至 BR-7/BR-9、NFR-1 至 NFR-5、DEC-1 至 DEC-9、AC-1 至 AC-13，以及 TASK-0 至 TASK-12。直接证据为第 2 节的具体路径/符号/命令及任务测试，允许仅检查一层直接调用影响。用户原文为来源方案第 2 节五条输入，分段确认是 D-1 至 D-4，最终方案批准原话为“继续”。原文未由摘要替代，独立审核恢复时将该章节连同上述审核包提交。

明确排除：BR-8、停售/退款/扩展发票模型、未变化模板业务、项目/文件云同步、系统窗口/托盘/通知、插件/市场、无关历史问题，以及 TASK 中未触及的旧能力。不得扩展成全库审查。

2026-10-05：当前会话未提供 spawn_agent、wait_agent、close_agent，尚不能调用 zhiyu-reviewer；没有 unknown agent_type，因此不启动默认 Agent 回退。不使用 Codex CLI 或子进程模拟 Reviewer。主 Agent 对路径、追踪、任务依赖、TDD 和验收进行文档一致性自查；这不是独立审核，也不是功能验证。

本轮文档检查已通过：25 条一期需求、9 项决策、13 项 AC 的任务映射；TASK-0 至 TASK-12 定义与依赖；表格、文档链接、编号和尾随空白。该结果不证明 Go/Runtime/支付/真实渠道或任何 Desktop 包已经通过。

用户在看到本 Plan 和上述状态后明确说“开始执行”或等价指令，记录授权和日期；仍有风险时流程记 PASS（用户知情授权执行），原始 Reviewer 状态不改。随后从 TASK-0 原生执行，不再增加豁免或重复确认。
