# Codex Runtime UI Web App 设计审核意见

审核对象：`docs/superpowers/specs/2026-07-06-codex-runtime-ui-web-app-design.md`
审核日期：2026-07-06
审核角色：架构 / 前端
参照材料：`docs/runtime-api-for-ui-v1.md`、`docs/ui-prototype-runtime-review.md`、`index.html` 原型、`apps/daemon/src` 现有实现、`packages/protocol/src`

---

## 1. 总体评价

这份方案整体是可以落地的，方向也对。它做对了几件关键的事：

1. **分层清晰**：`RuntimeClient -> Services -> Feature Hooks -> Components`，组件不直连数据源，这是能长期维护的结构。
2. **真实/mock 边界显式化**：`source: "runtime" | "mock"` 贯穿数据模型，避免了 mock 数据伪装成真实状态，这是这份方案最有价值的决策。
3. **桌面兼容前置**：`HostBridge` 抽象把本机能力收拢到一个接口，避免本机 API 散落进组件。
4. **契约对齐度高**：SSE 事件映射表、错误码处理、Skills/MCP 写确认、cleanup preview-then-delete 都与 `runtime-api-for-ui-v1.md` 一一对应，说明作者读过后端契约。

但方案存在 **三个会直接导致"connected 却跑不通"的接入层硬伤**，都在"前端如何真正连上 daemon"这一层，而方案目前把它们当作已解决问题跳过了。这三点必须在动工前定稿，否则 Slice 1（连接）就会卡住。此外还有一个 **产品路线层面的分歧** 需要和早先的原型审查对齐后再决策。

按严重程度排序：P0 是接入阻断项，P1 是会返工的设计缺口，P2 是改进建议。

---

## 2. P0 阻断项（必须在实现前解决）

### 2.1 daemon 没有 CORS，Web 跨域直连会被浏览器拦死 🔴

**这是最严重的问题。** 我核对了 `apps/daemon/src/api/server.ts` 和 `apps/daemon/package.json`：

- daemon 用 Fastify 启动，**没有注册任何 CORS 插件**（无 `@fastify/cors`，全仓 grep `cors` / `access-control` 无结果）。
- 鉴权是全局 `preHandler` 钩子，除 `/healthz` 外强制校验 `Authorization: Bearer <token>`（`apps/daemon/src/api/auth.ts`）。

后果：Web App 从 Vite dev server（如 `http://localhost:5173`）向 daemon（如 `http://127.0.0.1:60855`）发请求属于跨域。带 `Authorization` header 和 `Content-Type: application/json` 的请求会触发浏览器 **CORS 预检 (preflight OPTIONS)**，而 daemon 既不响应 OPTIONS、也不返回 `Access-Control-Allow-Origin`，请求会在浏览器层直接失败——连 401 都拿不到。

这个方案通篇假设"connected 时走真实 API"，但**在纯浏览器环境里，第一个真实请求就发不出去**。方案第 2 节列了 13 个真实 API，却没有一条说明跨域怎么解决。

**必须在方案里明确二选一（建议同时写清各自的适用阶段）：**

1. **短期（Web dev 阶段推荐）**：Vite dev server 配 `server.proxy`，把 `/api/*` 或 daemon 路由代理到 daemon，前端只请求同源路径。这样零后端改动即可跑通 dev。但要注意：proxy 需要知道 daemon 的动态 address/token，而这俩是 daemon 启动时随机分配并打到 stdout 的——proxy target 无法在 `vite.config.ts` 里静态写死，需要一个中间层（例如启动脚本读 stdout 写入 `.env` / proxy 配置）。这个"如何把动态 address 喂给前端"的流程方案里完全没提，是 §11.1 启动流程的前置缺口。
2. **中长期（面向桌面/生产）**：daemon 增加 `@fastify/cors`，允许 localhost 来源。但这需要改后端，且要设计允许的 origin 白名单，避免任意网页都能打本机 daemon（本机 token 虽是屏障，但 CORS 该收紧）。

**建议**：方案第 5/6 节补一节"跨域与 dev 接入"，明确 dev 用 Vite proxy + 一个读取 daemon stdout 的引导脚本；桌面阶段 WebView 同源加载，不受此限。这也解释了为什么 `HostBridge.readConnectionConfig()` 在浏览器版必须存在——它就是喂 address/token 的入口，但方案没把它和 CORS/proxy 串起来。

### 2.2 浏览器 `EventSource` 不能带 Authorization header，SSE 鉴权走不通 🔴

方案 §7.1 写"提供 SSE 订阅和重连工具"，§11.3 写"每个 run 同时最多一个 EventSource"，默认用浏览器原生 `EventSource`。

但 `/runs/:id/events` 和其他路由一样挂在全局鉴权 `preHandler` 下，需要 `Authorization: Bearer`。而 **浏览器原生 `EventSource` API 无法设置自定义请求头**，没法带 token。这条和 2.1 是叠加的：就算解决了 CORS，原生 EventSource 依然过不了鉴权。

我核对了后端 `getReplayAfterSeq`（`routes.runs.ts:245`），重连参数支持 `fromSeq` / `afterSeq` query 和 `Last-Event-ID` header，但**没有支持把 token 放 query 参数**（例如 `?token=`）。所以三条出路：

1. **走 Vite proxy 同源**（配合 2.1）：proxy 层注入 Authorization，前端 EventSource 请求同源无 token——这是 dev 阶段最省事的路径，但生产/桌面需要另一套。
2. **改用 `fetch` + `ReadableStream` 手写 SSE 解析**（如 `@microsoft/fetch-event-source`）：`fetch` 可以带任意 header，能力也更强（可自定义重连、可读 header）。代价是要自己解析 SSE 分帧、heartbeat comment（`: heartbeat`）、`id:`/`event:`/`data:` 三行结构。
3. **后端放开 token query 参数**：改后端，安全性略降（token 进 URL 会被日志/history 记录）。

**建议**：方案 §7.1 明确"SSE 使用 `fetch`-based EventSource（非原生 `EventSource`），以支持 Authorization header 与断线重连控制"。这同时也让 §11.3 的"断线后用 `fromSeq` 重连一次"更好实现，因为原生 EventSource 的自动重连行为和"只重连一次"是冲突的（原生会无限自动重连，你反而要额外压制它）。这一条不写清，`runtime/sse.ts` 会先写成原生 EventSource，然后在联调时推翻重写。

### 2.3 同一 thread 串行 run 与 §11.3"每 run 一个 EventSource"、Composer 禁用逻辑的耦合没说清 🔴（设计一致性）

后端契约（`runtime-api-for-ui-v1.md` §4）明确：**同一 thread 的多个 run 串行，后续 run 先进 `queued`**。方案 §14.5 也据此在"同 thread 有 running/queued run 时禁用 composer"。方向对，但有两个没闭环的点：

1. **queued run 的 SSE 什么时候订阅？** 一个 run 处于 `queued` 时，它还没开始产生事件，但 §11.3 说"每个 run 最多一个 EventSource"。UI 是 queued 就订阅（然后一直等 heartbeat）还是等它 running 再订阅？如果 run-now（§11.8）或排队产生了一个当前 thread 之外的 run，UI 要不要为它开 SSE？方案没定义"哪些 run 需要活跃 SSE 连接"的规则，实现时容易出现要么漏订阅、要么开了一堆僵尸连接。
2. **判断"当前 thread 是否有活跃 run"的数据从哪来？** 要禁用 composer，就得知道当前 thread 有没有 running/queued run。这需要在进入 thread 时拉 `GET /threads/:id/runs` 并对每个非终态 run 维护状态。方案 §13 状态管理里 `runs` 是笼统一个，没有"按 thread 索引的活跃 run 状态"，也没说 queued→running→done 的状态迁移谁来驱动（是靠该 run 的 SSE `status` 事件，还是靠轮询 `/runs`？）。

**建议**：§11.3 增加一小节"SSE 连接生命周期"，明确：只为"当前查看的 thread 的最新非终态 run"维持一个 EventSource；queued 阶段也订阅（靠 heartbeat 保活 + `status` 事件推进）；切换 thread 时关闭旧连接。§13 的 `runs` 状态补一个 `activeRunByThreadId` 派生视图。

---

## 3. P1 设计缺口（会导致返工，建议定稿前补齐）

### 3.1 与早先原型审查的路线分歧没有显式和解 🟡（最需要决策的一条）

`docs/ui-prototype-runtime-review.md` 的核心结论是：**第一版把右侧"文件编辑器/文件树"降级为"Run 详情/诊断/能力上下文"**（该文 §4.3、§4.4、§9），理由是后端没有文件 API，做成编辑器会落到不存在的能力上。

这份新方案做了**完全相反**的选择：保留原型的文件编辑器 + 文件树形态，用 mock adapter + localStorage 补齐（§2.4、§9.2、§11.4）。

这不是谁对谁错的问题，是两个合理但不同的产品判断：

- 原型审查的路线：**第一版只承诺后端能兜住的东西**，UI 不出现"看起来能保存文件其实只是 localStorage"的错觉。保守、诚实、无返工，但第一版功能面窄。
- 新方案的路线：**先把产品最终形态搭出来**，缺口用 mock 顶住，后续换真实 API 不改组件结构。产品完整度高、避免形态返工，但引入了"mock 编辑器"这个需要小心措辞的中间态。

新方案已经用 `source` 标记 + "本地工作区草稿"文案（§11.4、§14.7）来缓解错觉风险，缓解措施是到位的。但**方案没有引用、也没有反驳早先那份审查的相反建议**，看起来像是没意识到存在这个分歧。两份文档都在 specs 目录里，后续实现者会困惑到底以哪份为准。

**建议**：在新方案 §1 或 §4 增加一段，明确"本方案有意偏离 `ui-prototype-runtime-review.md` 的降级建议，选择保留最终形态 + mock 兜底，理由是 X"，并说明该审查中仍然有效的部分（如"右侧应有 Run 详情/Diagnostics 视图"其实和文件编辑器**不冲突，应该并存**——见下条 3.2）。让两份文档形成明确的取舍关系，而不是并列的两个真相。

### 3.2 右侧只保留"文件编辑器"丢掉了原型审查里真实可用的"Run 详情/Diagnostics"视图 🟡

新方案右侧区域（§8.1、§8 右侧）只描述了文件编辑器（路径/保存/搜索/替换/文本编辑）。但 `runtime-api-for-ui-v1.md` §11 的 `GET /runs/:id/diagnostics` 是**真实可用**的能力，能返回 `meta.json`、`events.ndjson`、`stderr.redacted.log`、`diagnostics.json`。

原型审查建议右侧做成 tab：Output / Events / Diagnostics / Raw（该文 §4.3）。这是**真实后端支撑、且对调试 Codex run 极有价值**的功能。新方案把它挤到了设置页（§11.9"6. diagnostics 信息"），位置偏了——诊断应该贴着 run 看，而不是埋进全局设置。

**建议**：右侧区域改为可切换的两种模式（或 tab）：
- **Run 详情模式**（真实）：Output / Events / Diagnostics，接 `/runs/:id` + `/runs/:id/diagnostics`。
- **文件编辑模式**（mock）：现有编辑器。

这样右侧同时容纳"真实 run 产物"和"mock 文件编辑"，既不丢真实能力，又保留原型形态。这也是把两份文档和解的最优解。

### 3.3 `resumeMode` 失败处理在方案里缺失 🟡

`runtime-api-for-ui-v1.md` §13"继续对话"明确：`resumeMode: "auto"` 可能返回 `RESUME_CAPABILITY_UNVERIFIED` 或 `RESUME_TARGET_NOT_FOUND`，此时 UI 应提供"开启新上下文继续"，用 `resumeMode: "new_thread"` 重试。

方案 §11.2"新对话和发送消息"完全没提 resume 语义，§12 错误处理表里也没有这两个错误码的处理。这是继续对话（多轮）的核心路径，漏了会导致第二条消息就报错无解。

**建议**：§11.2 补"继续对话"分支，§12 错误处理补 `RESUME_*` 的降级重试 UI。protocol 里也确认了 `ResumeMode` 类型存在（`packages/protocol/src/api.ts:6`），类型层没问题，是流程层漏了。

### 3.4 mock 文件系统的 localStorage 容量与 QuotaExceeded 没有兜底策略 🟡

方案让 mock 文件内容（`opencreator.web.files.v1`）、editor 状态、mock timeline 全部进 localStorage（§10）。localStorage 单域通常只有 **5MB** 左右。原型里的文件是 markdown/srt/html，用户如果编辑较大文件或积累多个文件，很容易触及上限，`setItem` 抛 `QuotaExceededError`。

§12 只写了"localStorage 保存失败：保持 dirty，不显示保存成功"——这处理了"没存进去"，但没处理"存进去一半导致数据不一致"或"配额满了之后所有 mock 保存都失败"。而且 §10 说反序列化失败会"重置对应 mock domain"，如果因为写坏导致下次读失败→重置，用户的 mock 草稿会静默丢失，这和 §16 验收标准 6"mock 文件保存刷新不丢"直接冲突。

**建议**：§10 补：单文件大小上限（如 512KB）、总量上限提示、`QuotaExceededError` 的明确 UI（提示清理旧 mock 文件而非静默失败）。或者更稳妥——mock 文件内容改用 **IndexedDB**（容量大得多、异步、天然适合存文档），localStorage 只存索引和 UI 状态。这是个值得在选型阶段就定的事，晚了要迁移。

### 3.5 `POST /runs` 的 202 语义与 optimistic UI 的时序没说清 🟡

`runtime-api-for-ui-v1.md` §4 明确 `POST /runs` 返回 **202**（已接受，不等完成），响应体是 `RunResponse`（含初始 `status: queued|running`）。方案 §11.2 写"UI 立即追加 user timeline item"然后"POST /runs 再建立 SSE"，顺序对，但没说清：

- 拿到 `RunResponse` 后、SSE 第一个事件到达前的**空窗期**，UI 显示什么状态？（应显示 `queued`/`running`，用响应体的 status）
- SSE 从 `fromSeq=0` 订阅，能否保证不漏掉 202 之后、订阅建立之前产生的事件？后端是重放全部 `seq>0` 事件的（`listEvents(id, afterSeq)`），所以 `fromSeq=0` 是安全的——但方案应显式写明"依赖后端事件重放，故先创建 run 再订阅无丢失风险"，否则实现者可能担心竞态而加不必要的逻辑。

**建议**：§11.2 把"202 响应 → 用响应 status 占位 → fromSeq=0 订阅（依赖重放，无竞态）"这条时序写清。

---

## 4. P2 改进建议（可选，提升质量）

### 4.1 `@opencreator/protocol` 复用仅限编译期类型，注意运行时校验缺失

我核对了 `packages/protocol/src`：导出的全是 TypeScript `type` 别名（`api.ts`、`events.ts`、`errors.ts`），**没有运行时 schema（如 zod）**。方案 §5.2"复用 @opencreator/protocol 类型"是对的，但要意识到：这些类型在 `fetch` 拿到 JSON 后**不会自动校验**，`response.json() as CodexStatusResponse` 只是编译期断言。

如果 daemon 返回了非预期结构（版本漂移、错误），前端不会报错，而是在使用字段时才崩。方案 §15.2 测了 ApiError 解析，但没提正常响应的运行时校验。

**建议**：`RuntimeClient` 层对关键响应做轻量运行时校验（至少校验 SSE `AgentEventEnvelope.type` 是已知枚举，未知的走 `unknown_event` 通道——这个 §11.3 已有映射，很好，扩展到其他响应即可）。不必全量 zod，抓关键字段即可。

### 4.2 `RunRequest` 的 thread 字段覆盖约束应在 UI 层前置拦截

契约明确：thread run 若覆盖 `cwd/profile/model/reasoning/sandbox` 会返回 `THREAD_CONFIG_IMMUTABLE`（`runtime-api-for-ui-v1.md` §4）。方案 §12 没有这个错误码。虽然 UI 正常流程不会去覆盖，但既然 `RunRequest` 类型允许传这些字段，最好在 `RunService` 层就保证"带 threadId 时不发送这些字段"，而不是靠后端报错兜。属于防御性设计，低优先级。

### 4.3 Schedules 的 `cwd` 默认 `workspace-write` sandbox 需要 UI 显式提示风险

契约 §10：schedule 创建默认 `sandbox: "workspace-write"`（注意和 run/thread 的默认 `read-only` **不同**）。方案 §11.8 计划任务页没提这个差异。定时任务默认可写工作区是有实际影响的（无人值守时自动改文件），UI 创建 schedule 时应明确展示 sandbox 级别并让用户确认。建议 §11.8 补一句。

### 4.4 `index.html` 标题与文案问题原型审查已指出，方案应显式继承

原型审查 §6.2 指出标题"企业 Agent Dashboard"偏大、字符图标 `▸◷▣↑` 应换 lucide、"本地工作区已连接"不应静态显示。我确认 `index.html:6` 标题确实是"企业 Agent Dashboard"。新方案 §5.3 提了用 lucide、§14.3 提了不扩散字符图标，但没提标题收敛和"连接状态需绑定真实 health"。§14.8"disconnected 不能空白"提了，但顶部连接状态要绑 `/healthz` + `/codex/status` 这条建议没写进去。建议 §14 补一条：顶部连接状态必须反映真实 daemon health + codex status，不静态显示。

### 4.5 测试方案建议补两类真正容易错的用例

§15 测试方案比较完整，但缺两类最容易在这个架构里出 bug 的：

1. **SSE 断线重连的 seq 去重/续传测试**：mock 一个断在 seq=5、重连 `fromSeq=5` 的场景，验证不重复、不丢事件。这是 §11.3 的核心风险点。
2. **disconnected → connected 的状态切换测试**：验证切换时 mock Dashboard 不被清空（§11.1 第 7 点、§16 验收 4）、真实功能从 disabled 变 enabled。这是真实/mock 双状态并存架构最容易串味的地方。

---

## 5. 结论与行动建议

方案的**架构分层、真实/mock 边界、桌面兼容抽象**都是高质量的，可以作为实现基础。但在开工前，**必须先解决 P0 的三条接入层问题**，否则 Slice 1（连接）就跑不通：

| 优先级 | 问题 | 处理 |
|---|---|---|
| P0 | daemon 无 CORS，Web 跨域被拦 | §5/§6 补"Vite proxy + daemon stdout 引导脚本"接入方案；桌面阶段用 WebView 同源 |
| P0 | 原生 EventSource 不能带 token | §7.1 明确用 `fetch`-based SSE |
| P0 | queued/串行 run 的 SSE 生命周期与 composer 禁用逻辑未闭环 | §11.3 补"SSE 连接生命周期"，§13 补 `activeRunByThreadId` |
| P1 | 与原型审查的路线分歧未和解 | §1/§4 显式说明取舍，右侧改为 Run详情 + 文件编辑双模式 |
| P1 | 丢了真实可用的 Diagnostics 右侧视图 | 右侧并存 Run 详情/Diagnostics（真实）与编辑器（mock） |
| P1 | resumeMode 失败处理缺失 | §11.2 补继续对话分支，§12 补 `RESUME_*` 降级 |
| P1 | localStorage 配额兜底缺失 | §10 补配额策略，考虑 mock 文件改用 IndexedDB |
| P1 | 202 + optimistic + fromSeq=0 时序未写清 | §11.2 补时序说明 |
| P2 | protocol 仅编译期类型 / thread 字段覆盖 / schedule sandbox 默认 / 标题文案 / 测试补强 | 见 §4 各条 |

**最需要用户拍板的一件事**：第 3.1 条——右侧到底是"保留文件编辑器形态用 mock 兜底"（本方案）还是"降级为 Run 详情/诊断"（早先原型审查）。我的建议是**两者并存**（右侧双模式），既不丢真实 diagnostics 能力，又保留最终产品形态，同时用现有的 `source` 标记 + 草稿文案控制 mock 错觉风险。这条定了，方案就可以进入实现。
