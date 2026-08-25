# OpenCreator 模板化创作架构实施计划

> 状态：TASK-0 至 TASK-19 实现已执行完成；真实媒体/生产 Provider、Browser parity 与真实 Codex Skill 冒烟按第 6 节标记 BLOCKED，未冒充发布验收通过
> 生成日期：2026-08-20
> 代码基线：`main` / `a1cca23e65648e53d972a0f3792eb120c1cf593e`
> KrillinAI 基线：`master` / `a9f4ec207925d9ae702b2064d11607d1ba3bfef6`
> 来源方案：`docs/specs/OpenCreator模板化创作架构方案-2026-08-20.md`
> 用户批准证据：2026-08-20，用户在 D-4 后回复 `没问题，继续`；本次 `继续` 授权生成实施 Plan，不构成编码授权。
> 体量判断：复杂。P0/P1/P2 共享 CreatorJob、Artifact、StageRunner、Agent Action 和打包边界，无法独立完成契约与验收；保持一份按垂直行为切片组织的内聚 Plan，不按前后端或阶段机械拆分。

## 1. 契约快照

### 1.1 目标与非目标

目标是把现有五类 Demo 工作区升级为可持久化、可恢复、可由工作台和 Agent 平等操作的模板化内容创作系统；OpenCreator 负责编排、状态、预览和导出，KrillinAI 与其他执行器负责媒体阶段。产品不包含发布、发布审批、平台账号上传、多人实时协作、通用节点工作流、用户模板编辑器或完整非线性编辑器。

### 1.2 需求与业务规则

| ID | 不可降低的执行约束 |
| --- | --- |
| FR-1 | 从素材或意图完成模板化创作、预览和导出，产品流程不得加入发布。 |
| FR-2 | 每次模板运行创建持久化 CreatorJob，并保留模板版本、阶段、产物版本、Activity 和失败记录。 |
| FR-3 | 工作台与 Agent 面板展示同一 CreatorSession，任一侧有效操作在另一侧状态或 Activity 中体现。 |
| FR-4 | Agent 面板固定展示状态、动态、对话，并通过运行时无关 Creator Action 修改任务。 |
| FR-5 | P0 视频翻译覆盖 YouTube、Bilibili、本地媒体、字幕编辑、可选 TTS、横竖屏、版本、预览和导出。 |
| FR-6 | 复用统一 AI 服务配置映射 KrillinAI；Agent Runtime 认证与生产模型凭证分离。 |
| FR-7 | P1 提供可复用的 probe/download，并支持独立或嵌入式、多候选、多比例封面创作。 |
| FR-8 | P2 自动剪辑和火柴人视频复用统一领域契约，只新增专用执行器。 |
| BR-1 | TemplateDefinition 是阶段、依赖、失效和 UI 行为的唯一业务权威；Skill 不保存这些规则。 |
| BR-2 | 工作台本地操作只更新共享状态和 Activity，不创建 Codex Run、不消耗模型 Token。 |
| BR-3 | 高频输入即时更新草稿，仅在失焦、保存或聚合阈值到达时形成语义 Activity。 |
| BR-4 | 所有持久修改必须携带 `expectedRevision`，旧 revision 返回冲突且不得覆盖新状态。 |
| BR-5 | 上游变化保留旧版本，并沿模板依赖图把受影响下游产物标记为 `stale`。 |
| BR-6 | P0 每个 StageRun 启动一个 KrillinAI CLI 进程，不预先引入常驻 Worker。 |
| BR-7 | 成功必须同时通过退出状态、JSON/Manifest 解析和文件/媒体校验。 |
| BR-8 | Daemon 自动把 `opencreator-runtime` 同步到应用隔离 Runtime Home，用户不参与安装。 |
| NFR-1 | Web/Desktop 复用同一 React、Protocol、Daemon、模板和 Agent Action 实现。 |
| NFR-2 | 刷新和 Daemon 重启恢复状态；未结束外部进程转为 `interrupted` 并可重试。 |
| NFR-3 | API Key 不得进入 React 持久状态、Creator 数据、Agent 上下文、普通日志、诊断包或导出包。 |
| NFR-4 | 同页工作台变化通过共享 Store 即时反映到 Agent 状态，不依赖轮询或模型。 |
| NFR-5 | OpenCreator 领域契约不引用 Codex 类型，运行时差异仅存在于 AgentRuntimeAdapter。 |
| NFR-6 | 安装包固定 KrillinAI 和媒体依赖版本；正式运行时不克隆仓库或下载不受控可执行文件。 |

### 1.3 关键决策

| ID | 实施决定 |
| --- | --- |
| DEC-1 | `CreatorSessionStore` 是单前端实例即时展示状态，Daemon `CreatorService` 是持久业务权威。 |
| DEC-2 | Agent 面板固定三层：状态摘要、创作动态、模型对话。 |
| DEC-3 | Creator Core 作为现有 Daemon 内模块和 SQLite 表实现，不引入微服务、队列、CRDT、事件溯源。 |
| DEC-4 | 模板是静态 TypeScript `TemplateDefinition` 加 Schema 校验，P0 不做 DSL 或模板编辑器。 |
| DEC-5 | Agent 核心契约运行时无关；MCP/Native Tools 只是 Adapter 传输。 |
| DEC-6 | 稳定规则放入隔离 Runtime Home 的 `opencreator-runtime` Skill，模板不写入 Skill。 |
| DEC-7 | 每轮只传 Job、模板、revision、阶段、selection、recentChanges、allowedActions；大产物按需读取。 |
| DEC-8 | KrillinAI 是固定版本 CLI Sidecar，每 StageRun 独立进程和目录。 |
| DEC-9 | Codex 负责交互理解和文本修改，ASR/翻译/TTS/生图/视频使用 CreatorServicesConfig 生产服务。 |
| DEC-10 | P0 先交付视频翻译，P1/P2 必须复用同一领域契约。 |
| DEC-11 | P1 下载由 Daemon `DownloadExecutor` 直接封装固定 yt-dlp。 |
| DEC-12 | P1 封面由 `ImageExecutor` 使用 OpenAI-compatible 图片 Provider；KrillinAI cover 仅兼容回退。 |

### 1.4 公共契约

- 新增 `packages/protocol/src/creator.ts`，定义 Job/StageRun/Artifact/Activity、模板摘要、Action、Receipt、AgentContext、AgentTurn、SSE 事件及 API 请求响应；`packages/protocol/src/index.ts` 统一导出。
- Job 状态固定为 `draft | running | needs_input | completed | failed | canceled`；StageRun 增加 `queued | running | succeeded | failed | canceled | interrupted`；Artifact 固定为 `draft | technical_preview | completed | stale`。
- Creator API 固定为 `GET /creator/templates`、`POST /creator/jobs`、`GET /creator/jobs?projectId={projectId}`、`GET /creator/jobs/:id`、`POST /creator/jobs/:id/actions`、`POST /creator/jobs/:id/agent-turns`、`GET /creator/jobs/:id/agent-history`、`GET /creator/jobs/:id/events`。
- Creator SSE 只发送 Job 失效提示和新 revision；断线后客户端先重新 `GET Job` 快照再订阅，不新增事件溯源表，不复用 Codex Run SSE。
- Creator 工具固定为 `creator_get_context`、`creator_get_artifact`、`creator_apply_action`，授权范围固定为 `creator:context`、`creator:artifact:read`、`creator:action`。
- 所有持久 Action 在单事务内校验 `expectedRevision`、更新 Job/Artifact/Activity、递增 revision，并返回 `CreatorActionReceipt`。冲突错误携带最新 revision；输入、阶段、来源、依赖、能力、配置和执行失败使用稳定错误码。
- Agent Action 首次返回 `creator_revision_conflict` 后，稳定指导要求同一 turn 重新调用 `creator_get_context`，基于最新 revision 最多重试一次；第二次冲突返回 `creator_conflict_requires_user` 并停止写入。调用顺序和 revision 记录进入 Agent turn audit，工作台未提交草稿继续覆盖在 confirmed snapshot 之上，不被 SSE 快照替换。
- Creator 数据表固定为 `creator_jobs`、`creator_stage_runs`、`creator_artifacts`、`creator_activities`；媒体只存项目产物目录，SQLite 只保存路径、版本、血缘和元数据。`creator_jobs.agent_thread_id` 作为运行时 Thread 的不透明关联列，不进入模板 state。
- 模板阶段必须声明 `allowedJobStatuses`、`inputArtifacts`、`outputArtifacts`；Action 必须声明 `allowedStages` 和 `invalidates`。失效仅从 Action 声明的源 Artifact 沿阶段图传播。
- KrillinAI 进程固定 `cwd=<app-data>/runtime/krillin-launch/<stage-run-id>`，`--workdir=<项目内无密钥 StageRun 绝对目录>`；配置只短暂写入私有启动目录，结束路径均清理。
- OpenCreator 使用基于 KrillinAI `a9f4ec2` 的固定集成补丁：新增 `KRILLINAI_RESOURCE_ROOT=<安装包只读 creator-runtime/krillinai>` 与 `KRILLINAI_OFFLINE_DEPENDENCIES=1`。补丁把 `internal/deps/checker.go`、`pkg/fasterwhisper/transcription.go`、`pkg/whispercpp/transcription.go` 的 `./bin`、`./models` 解析统一改为绝对资源根，并在缺失时直接返回 `dependency_not_packaged`，禁止进入下载/更新分支；未设置环境变量时保留上游 CLI 行为。
- 包内固定布局为 `creator-runtime/krillinai/bin/krillinai-cli[.exe]`、`bin/ffmpeg[.exe]`、`bin/ffprobe[.exe]`、`bin/yt-dlp[.exe]`、可选本地 ASR 可执行目录、`models/<provider-model>/` 和 `manifest.json`。Manifest 逐文件记录路径、版本、平台、架构、SHA-256、provider/model；Daemon 只允许启动 manifest 声明的 provider。
- P0 声明的本地 ASR 支持矩阵固定为：Windows/Linux 安装包可选择打包 `fasterwhisper` 可执行文件及配置指定模型；macOS 默认不声明本地 ASR，使用 OpenAI/Aliyun 等远程 Provider。未打包项不得在 UI 中显示为可用能力。PATH 测试使用干净值，资源必须通过 `KRILLINAI_RESOURCE_ROOT` 命中，不依赖系统 ffmpeg/yt-dlp。
- 新模板版本只影响新 Job；旧 Job 固定原版本。当前 Demo 状态不迁移成正式 Job，切换正式实现时只保留受控开发回退入口。

### 1.5 视频翻译真实边界

| 用例 | 输入 | 字幕编辑 | TTS | 输出 | 独立预期 |
| --- | --- | --- | --- | --- | --- |
| VT-1 | YouTube 公开短视频 | 修改并保存至少一条目标字幕 | 关闭 | 字幕文件 | 平台字幕可用时优先使用，不可用时按配置回退 ASR；保存后版本递增。 |
| VT-2 | Bilibili 公开短视频 | 修改并保存字幕 | 开启 | 横屏视频 | 生成有效配音和横屏视频；字幕修改后的旧音频/视频为 stale。 |
| VT-3 | 本地 MP4 | 修改并保存字幕 | 开启 | 竖屏视频 | 生成有效配音和竖屏视频；分辨率与音视频流校验通过。 |
| VT-4 | 本地 MP4 | 不修改 | 关闭 | 横屏视频 | 生成无目标语言配音的横屏字幕视频。 |
| VT-5 | 不支持的平台 URL | 不适用 | 不适用 | 不适用 | 执行下载前返回 `unsupported_source`，不创建假成功 StageRun。 |
| VT-6 | 支持输入但缺所选 TTS 配置 | 不适用 | 开启 | 任一视频 | StageRun 不启动，Job 进入 `needs_input` 并定位到 TTS 设置。 |

### 1.6 KrillinAI 配置唯一映射

| CreatorServicesConfig | KrillinAI TOML |
| --- | --- |
| `proxy` | `app.proxy` |
| `llm.baseUrl/apiKey/model/jsonMode` | `llm.base_url/api_key/model/json` |
| `transcription.provider/enableGpuAcceleration` | `transcribe.provider/enable_gpu_acceleration` |
| `transcription.openai.*` | `transcribe.openai.*` |
| `transcription.fasterWhisper.model` | `transcribe.fasterwhisper.model` |
| `transcription.whisperKit.model` | `transcribe.whisperkit.model` |
| `transcription.whisperCpp.model` | `transcribe.whispercpp.model` |
| `transcription.aliyun.oss.*` | `transcribe.aliyun.oss.*` |
| `transcription.aliyun.speech.*` | `transcribe.aliyun.speech.*` |
| `tts.provider` | `tts.provider` |
| `tts.openai.*` | `tts.openai.*` |
| `tts.minimax.*` | `tts.minimax.*` |
| `tts.aliyun.oss.*` | `tts.aliyun.oss.*` |
| `tts.aliyun.speech.*` | `tts.aliyun.speech.*` |
| `image.provider/image.openai.*` | `image.provider/image.openai.*` |

## 2. 基线与文件地图

### 2.1 当前基线

- Git 工作区存在用户未跟踪内容：`.tmp/KrillinAI-incomplete-*`、`KrillinAI/`、来源方案文档。实施不得删除、移动或擅自加入 Git。
- 根目录当前缺少 `node_modules`。Protocol、Daemon、Web、Desktop 定向测试因 `tsc`/`vitest` 不可用而未启动；这不是测试失败。
- KrillinAI 正式可依赖命令为 `subtitle`、`tts`、`render-horizontal`、`render-vertical`、`cover`、`voices`；不得依赖未完成的 `pipeline/status`。
- KrillinAI 结果证据为单行 JSON、`krillinai_manifest.json` 和输出文件；配置固定从启动目录 `config/config.toml`、字幕样式从 `config/subtitle-style-default.json` 读取。

### 2.2 公共命令

| 命令 ID | 命令 | 用途 |
| --- | --- | --- |
| CMD-0 | `pnpm install --frozen-lockfile` | 恢复锁文件确定的依赖。 |
| CMD-1 | `pnpm --filter @opencreator/protocol typecheck && pnpm --filter @opencreator/protocol test` | Protocol 契约。PowerShell 执行时拆成两条命令。 |
| CMD-2 | `pnpm --filter @opencreator/daemon test -- <test-paths>` | Daemon 定向 RED/GREEN/回归。 |
| CMD-3 | `pnpm --filter @opencreator/web test -- <test-paths>` | Web 定向 RED/GREEN/回归。 |
| CMD-4 | `pnpm --filter @opencreator/desktop test -- <test-paths>` | Desktop 定向 RED/GREEN/回归。 |
| CMD-5 | `pnpm typecheck && pnpm test && pnpm build` | 全仓静态、单元和构建回归；PowerShell 拆分执行。 |
| CMD-6 | `pnpm desktop:package && pnpm --filter @opencreator/desktop verify:package` | 实际桌面安装包结构验证；PowerShell 拆分执行。 |
| CMD-7 | `pnpm e2e` | Web 产品级浏览器验收。 |
| CMD-8 | `pnpm --filter @opencreator/desktop e2e:package` | 实际 Desktop App 验收。 |

### 2.3 关键现有入口

| 责任 | 现有文件/符号 | 计划扩展 |
| --- | --- | --- |
| Protocol | `packages/protocol/src/api.ts`、`events.ts`、`errors.ts`、`index.ts` | 新增 Creator 契约并保持运行时无关。 |
| SQLite | `apps/daemon/src/storage/migrations.ts#migrate`、`repositories.ts`、`database.ts#openRuntimeDatabase` | 新表、Repository、重启恢复。 |
| API/SSE | `apps/daemon/src/api/server.ts`、`sse.ts`、`routes.runs.ts` | 注册 Creator 路由和独立 SSE。 |
| Core | 当前无正式 Creator Core | 新增 `apps/daemon/src/creator/` 下 Registry、Service、StageRunner、Adapter、校验器。 |
| 能力工具 | `agent-tools/capability-token.ts`、`internal-routes.ts`、`mcp-routes.ts`、`stdio-server.ts`、`run-injection.ts` | 增加 Creator scopes、工具和 Creator Run 注入。 |
| Thread/Run | `threads/types.ts`、`threads/manager.ts`、`runs/manager.ts#createRunManager` | 新增隐藏 `creator_agent` purpose，并支持隔离 Runtime Home。 |
| Codex Skill | `codex/probe-home.ts#createCodexIsolatedHome`、`codex/skills/*`、`codex/app-server-runner.ts#startCodexAppServer` | 自动同步稳定 Skill、首轮激活、后续恢复。 |
| 配置 | `packages/protocol/src/creator-services.ts`、`daemon/src/creator-services/config-store.ts` | 复用 Keyring 配置并桥接 KrillinAI。 |
| Web Runtime | `web/src/runtime/client.ts#RuntimeClient`、`runtime/sse.ts`、`services/run-service.ts` | 新增 Creator Service 和 Creator SSE。 |
| 工作台 | `WorkbenchPage.tsx`、`VideoTranslationWorkspace.tsx`、`VideoTranslationAgentPanel.tsx`、`CreatorToolShell.tsx` | 共享 SessionStore、三层 Agent 面板、真实视频翻译状态。 |
| App 装配 | `apps/web/src/app/AppController.tsx#AppController` | 注入 projectId、CreatorService，不复制 Desktop 前端。 |
| Desktop | `electron-builder.yml`、`prepare-daemon.mjs`、`package-release.mjs`、`verify-package.mjs`、`daemon-manager.ts` | 打包 Creator Runtime 与固定 Sidecar 清单。 |

## 3. 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
| --- | --- | --- | --- | --- |
| TASK-1 | FR-2、BR-1、BR-5、NFR-5 | DEC-4、DEC-10 | Protocol shape、Template Registry/graph | AC-2、AC-6、AC-12、AC-14 |
| TASK-2 | FR-2、NFR-2 | DEC-3 | storage/repository/restart | AC-2 |
| TASK-3 | FR-2、BR-3、BR-4、BR-5 | DEC-1、DEC-3、DEC-4 | CreatorService transaction/revision/stale | AC-2、AC-5、AC-6 |
| TASK-4 | FR-2、FR-3、NFR-2、NFR-4 | DEC-1、DEC-3 | Creator API/SSE/client reconnect | AC-2、AC-3 |
| TASK-5 | FR-3、FR-4、BR-2、BR-3、NFR-1、NFR-4 | DEC-1、DEC-2 | Store/Agent panel integration | AC-3、AC-13 |
| TASK-6 | FR-3、FR-4、FR-5、BR-2 | DEC-1、DEC-2、DEC-10 | Workbench migration tests | AC-3、AC-4、AC-7 |
| TASK-7 | FR-4、BR-4、NFR-3、NFR-5 | DEC-5、DEC-7 | capability/internal MCP authorization | AC-4、AC-5、AC-14 |
| TASK-8 | FR-4、NFR-5 | DEC-5、DEC-7 | context/adapter/thread contract | AC-4、AC-14 |
| TASK-9 | BR-8、NFR-3、NFR-5 | DEC-5、DEC-6、DEC-7 | bootstrap/real Codex smoke | AC-9、AC-14 |
| TASK-10 | FR-2、BR-6、BR-7、NFR-2 | DEC-3、DEC-8 | StageRunner lifecycle/recovery | AC-2、AC-10 |
| TASK-11 | FR-6、NFR-3 | DEC-8、DEC-9 | config bridge/ACL/cleanup/redaction | AC-8 |
| TASK-12 | FR-5、BR-6、BR-7 | DEC-8、DEC-9 | Krillin JSON/Manifest/media validation | AC-7、AC-10 |
| TASK-13 | FR-1、FR-5、BR-5、BR-7 | DEC-8、DEC-9、DEC-10 | video translation service/UI/E2E | AC-1、AC-4、AC-6、AC-7 |
| TASK-14 | FR-6、BR-8、NFR-1、NFR-3、NFR-6 | DEC-6、DEC-8、DEC-9 | package manifest/App E2E | AC-8、AC-9、AC-10、AC-13、AC-14 |
| TASK-15 | FR-7、BR-7、NFR-6 | DEC-10、DEC-11 | probe/download executor/E2E | AC-11 |
| TASK-16 | FR-7、BR-5、BR-7 | DEC-10、DEC-12 | image provider/partial success/E2E | AC-11 |
| TASK-17 | FR-8、BR-1、BR-5、BR-7 | DEC-4、DEC-9、DEC-10 | clip template/executor/E2E | AC-12 |
| TASK-18 | FR-8、BR-1、BR-5、BR-7 | DEC-4、DEC-9、DEC-10 | stickman template/executor/E2E | AC-12 |
| TASK-19 | 全部 | 全部 | 全仓回归、差异自审 | AC-1 至 AC-14、VT-1 至 VT-6 |

## 4. 实施任务

### TASK-0：确认 Plan 仍然有效

**交付结果**
- 实施前确认分支、commit、未跟踪文件、来源方案、关键路径、公共符号、KrillinAI commit 和依赖命令仍与本 Plan 一致；完成依赖安装并获得真实测试基线。

**实施步骤**
1. 运行 `git status --short --branch`、`git rev-parse HEAD`、`git -C KrillinAI rev-parse HEAD`，保留用户未跟踪内容不变。
2. 核对本 Plan 的公共契约、路径和符号。无关改动或不改变契约的局部重命名记录为执行偏差后继续；任一 FR/BR/NFR/DEC/AC、公共 API、数据所有权或安全边界失效时停止并更新方案/Plan。
3. 执行 CMD-0，然后依次运行 CMD-1、Daemon 的 `storage.test.ts`/`agent-capability-token.test.ts`/`agent-tool-run-injection.test.ts`/`codex-probe-home.test.ts`、Web 的 `WorkbenchPage.test.tsx`/`runtime/client.test.ts`/`runtime/sse.test.ts`、Desktop 的 `protocol-path.test.ts`/`runtime-proxy.test.ts`/`codex-resolver.test.ts`。

**TDD**
- 策略：豁免。该任务不改变行为；以依赖安装、基线命令退出码和当前 Git 证据代替。

**任务完成门**
- 基线已真实运行并区分既有失败与环境失败；确认 Plan 契约仍有效后方可进入 TASK-1。

### TASK-1：建立 Creator Protocol 与静态模板契约 `[FR-2, BR-1, BR-5, NFR-5, DEC-4, DEC-10, AC-2, AC-6, AC-12, AC-14]`

**交付结果**
- 对外 Creator 数据/API/错误契约与运行时无关的模板、Action、AgentContext 类型可被 Daemon/Web/Desktop 共同引用；视频翻译模板依赖图可解析并精确传播 stale。

**文件与符号**
- 创建：`packages/protocol/src/creator.ts`；`apps/daemon/src/creator/templates/types.ts`、`registry.ts`、`video-translation.ts`。
- 修改：`packages/protocol/src/index.ts`、`packages/protocol/src/errors.ts`。
- 测试：`packages/protocol/test/creator-contract.test.ts`；`apps/daemon/test/unit/creator-template-registry.test.ts`。
- 不可拆说明：Protocol 类型、运行时 Registry、首个模板实例和契约测试共同定义同一公共模板契约，拆开会产生无法编译或无法验证的中间状态。

**实施步骤**
1. 定义 1.4 中的公共类型、Action/Receipt、Agent Context、稳定错误码和 SSE envelope；字段使用 JSON 可序列化值，不引用 Codex/MCP 类型。
2. 实现 `TemplateDefinition<State>` 的 Schema、Registry 唯一键 `(id, version)`、阶段拓扑与循环/未知 Artifact 校验。
3. 注册 `video-translation@1`，明确 source_video → subtitle → target_subtitle → tts/render 的输入输出、可选 dubbed_audio 和 `edit-subtitle` 失效源。

**TDD**
- RED：`creator contract does not expose codex-specific fields` 动态加载 Protocol，断言 Creator 导出存在且序列化对象不需要 Codex 字段；预期因导出不存在失败。
- RED：`edit-subtitle invalidates only dependent audio and renders` 注册视频翻译模板，执行图遍历并断言只返回 `dubbed_audio/horizontal_video/vertical_video`；预期因 Registry/图不存在失败。
- GREEN：只实现公共类型、Schema、Registry、图校验和视频翻译 v1；不实现通用 DSL、用户模板或执行器。
- REFACTOR：运行 CMD-1 和 Creator Template 定向测试；保持 TemplateDefinition 为业务规则唯一来源。

**任务完成门**
- 定向测试和 CMD-1 通过；满足 AC-6、AC-12、AC-14 的契约前置。

### TASK-2：持久化 CreatorJob、StageRun、Artifact 与 Activity `[FR-2, NFR-2, DEC-3, AC-2]`

**交付结果**
- Creator 数据在 SQLite 与项目产物目录中可事务读写，Daemon 重启后未结束 StageRun 转为 `interrupted`，旧产物和 Activity 可恢复。

**文件与符号**
- 修改：`apps/daemon/src/storage/migrations.ts#migrate`、`repositories.ts`、`database.ts#openRuntimeDatabase`。
- 创建：`apps/daemon/src/creator/repository.ts`、`apps/daemon/test/unit/creator-storage.test.ts`。

**实施步骤**
1. 新增四张表、索引、外键和 check 约束；`creator_jobs` 增加 nullable `agent_thread_id`，Artifact 对 `(job_id, kind, version)` 唯一。
2. 实现 `CreatorRepository` 的 create/get/list/update transaction、StageRun 状态、Artifact 版本、Activity 分页和 thread 绑定方法；所有 JSON 在边界解析验证。
3. 数据库打开后把 `queued/running` StageRun 原子改为 `interrupted`，并按可重试语义更新 Job，不删除工作目录。

**TDD**
- RED：`reopens creator job with artifacts and activities` 在临时数据库写入完整 Job 后关闭重开，断言版本、血缘和 Activity 一致；预期因表/Repository 不存在失败。
- RED：`marks nonterminal stage runs interrupted on reopen` 写入 running StageRun 后重开，断言 StageRun=`interrupted` 且 Job 可重试；预期因恢复逻辑缺失失败。
- GREEN：只实现批准的四表模型、Repository 和启动恢复；不引入事件表或后台队列。
- REFACTOR：运行 Creator storage、现有 `storage.test.ts` 与 `thread-manager.test.ts`。

**任务完成门**
- 持久化与重启定向测试通过；AC-2 的数据恢复前置成立。

### TASK-3：实现 CreatorService revision、事务、Activity 聚合与 stale 传播 `[FR-2, BR-3, BR-4, BR-5, DEC-1, DEC-3, DEC-4, AC-2, AC-5, AC-6]`

**交付结果**
- 工作台和 Agent 的所有持久修改走同一 Service；冲突不覆盖、语义 Activity 聚合、撤销创建新 revision、上游变化精确标记下游 stale。

**文件与符号**
- 创建：`apps/daemon/src/creator/service.ts`、`activity-aggregator.ts`、`stale-propagation.ts`、`apps/daemon/test/unit/creator-service.test.ts`。
- 修改：`apps/daemon/src/creator/repository.ts`。

**实施步骤**
1. 实现 `CreatorService.createJob/getJob/listJobs/applyAction/undoAction`；事务开始后重新读取 revision，按模板 Schema/allowedStages 校验。
2. Action 成功时统一写 state、Artifact 变化、Activity、revision 和 Receipt；`expectedRevision` 不匹配返回 `creator_revision_conflict` 及最新快照标识。
3. 高频草稿按 `(jobId, actor, action, objectId, window)` 合并 Activity；保存、执行、版本、撤销始终单独记录。
4. 从 Action invalidates 源版本沿模板阶段图查找实际血缘，只把依赖旧版本的下游 Artifact 置 stale，保留文件和版本。

**TDD**
- RED：`rejects stale expectedRevision without overwriting state` 用 revision 1、2 连续修改后再次提交 revision 1，断言冲突且 state 保持 revision 2；预期因 Service 缺失失败。
- RED：`coalesces draft edits and preserves semantic actions` 在窗口内输入多次再保存，断言一个聚合草稿 Activity 加一个保存 Activity；预期因聚合缺失失败。
- RED：`stales only artifacts linked to edited subtitle version` 构造两版字幕与下游产物，编辑 v2 后断言只影响 v2 血缘；预期因传播缺失失败。
- GREEN：实现同步事务 Service 与确定性聚合/传播，不引入事件溯源或 CRDT。
- REFACTOR：运行 CreatorService、Template Registry、storage 回归。

**任务完成门**
- AC-5、AC-6 对应 Service 测试通过，事务中无部分更新。

### TASK-4：提供 Creator HTTP API、Job SSE 与 Web CreatorService `[FR-2, FR-3, NFR-2, NFR-4, DEC-1, DEC-3, AC-2, AC-3]`

**交付结果**
- Web 可创建/恢复/操作 CreatorJob，并在 SSE 断线后以最新快照收敛；Creator SSE 不承担历史重放。

**文件与符号**
- 创建：`apps/daemon/src/api/routes.creator.ts`、`apps/daemon/src/creator/events.ts`、`apps/web/src/services/creator-service.ts`、`apps/web/src/runtime/creator-sse.ts`。
- 修改：`apps/daemon/src/api/server.ts`、`apps/web/src/runtime/client.ts`。
- 测试：`apps/daemon/test/integration/creator-api.test.ts`、`apps/web/src/services/creator-service.test.ts`、`apps/web/src/runtime/creator-sse.test.ts`。
- 不可拆说明：公开路由、事件广播、客户端快照和重连策略共同构成一次可验证的断线收敛行为，任一部分单独交付都不能证明 AC-2/AC-3。

**实施步骤**
1. 注册 1.4 的公开路由，统一 auth、错误转换、项目/Job 边界和请求 Schema。
2. EventHub 在成功事务后广播 `{jobId, revision, kind}`；SSE 连接只订阅单 Job，释放时移除 listener。
3. Web `createCreatorService` 封装快照、Action、Agent turn/history；Creator SSE reconnect 顺序固定为 GET snapshot → replace local confirmed state → subscribe。

**TDD**
- RED：`returns latest snapshot after creator SSE reconnect` 断开期间提交两个 revision，再重连，断言客户端直接收敛到最新 revision 且不要求事件重放；预期因路由/SSE 不存在失败。
- RED：`rejects creator action outside owning project` 用其他项目访问 Job，断言 404/权限错误且无 Activity；预期因项目边界缺失失败。
- GREEN：实现薄路由、内存 EventHub 和快照重连；不新增消息队列或 Creator 事件表。
- REFACTOR：运行 Creator API/SSE、现有 API auth 与 runtime client/sse 回归。

**任务完成门**
- Creator 公共 API 和重连测试通过；满足 AC-2、AC-3 的传输前置。

### TASK-5：建立 CreatorSessionStore 与 Agent 三层同源展示 `[FR-3, FR-4, BR-2, BR-3, NFR-1, NFR-4, DEC-1, DEC-2, AC-3, AC-13]`

**交付结果**
- 工作台输入即时更新 Agent 状态区；语义提交后动态区更新；对话区独立显示 Agent turns；普通操作不会生成 Agent 消息或 Run。

**文件与符号**
- 创建：`apps/web/src/features/workbench/creator-session-store.tsx`、`CreatorAgentPanel.tsx`、对应测试。
- 修改：`apps/web/src/features/workbench/WorkbenchPage.tsx`、`CreatorToolShell.tsx`、`workbench.css`、`apps/web/src/app/AppController.tsx#AppController`。
- 不可拆说明：Store、两侧消费组件和 App 注入共同决定“工作台操作即时出现在 Agent 区且不创建 Run”的单一前端行为。

**实施步骤**
1. Store 分离 `confirmedSnapshot`、`draftState`、`selection`、`recentHighlights` 和连接状态；草稿立即派生状态摘要，debounce/flush 通过 CreatorService 持久化。
2. 收到 SSE 后只替换 confirmed snapshot，并按字段级 dirty map 重放当前草稿；服务端同字段变化标记冲突提示，但不得静默丢弃用户输入。
3. Agent Panel 固定渲染状态、Activity、对话；Activity 不伪装为 assistant 消息，工作台 action 不调用 run/agent-turn endpoint。
4. `AppController` 创建 CreatorService，并把当前 `projectId`、Service 传给 Workbench；Desktop 继续加载同一 Web 构建。

**TDD**
- RED：`updates agent status immediately without creating agent turn` 在工作台改变目标语言，断言 Agent 状态同步、Fake CreatorService 最终收到 action、Agent turn 调用为 0；预期因共享 Store 不存在失败。
- RED：`preserves dirty workbench draft when a newer confirmed snapshot arrives` 本地编辑字幕但未 flush，注入更高 revision SSE 快照，断言 dirty 字段仍显示本地值、其他字段采用新快照并出现冲突提示；预期因 draft/confirmed 未分层失败。
- RED：`renders status activity and conversation as separate regions` 注入三类数据，断言各自语义区域且 Activity 不出现在 chat log；预期因三层面板不存在失败。
- GREEN：实现单页面 Context Store 与受控 debounce，不引入 Redux、跨窗口同步或网络轮询。
- REFACTOR：运行新 Store/Panel、`WorkbenchPage.test.tsx`、`App.test.tsx`。

**任务完成门**
- AC-3 的即时展示和零 Codex Run 断言通过；Web/Desktop 共享装配满足 AC-13 前置。

### TASK-6：把视频翻译 Demo 迁移到正式 CreatorSession `[FR-3, FR-4, FR-5, BR-2, DEC-1, DEC-2, DEC-10, AC-3, AC-4, AC-7]`

**交付结果**
- 视频翻译的来源、语言、字幕、TTS、画幅、版本、选中项和高亮均由 CreatorSession 驱动；旧组件本地业务状态与关键词 Demo 回调退出正式路径。

**文件与符号**
- 修改：`VideoTranslationWorkspace.tsx`、`VideoTranslationAgentPanel.tsx`、`VideoTranslationResultWorkspace.tsx`、`creator-workspace.ts`、`WorkbenchPage.tsx`。
- 测试：`apps/web/src/features/workbench/VideoTranslationWorkspace.test.tsx`、`WorkbenchPage.test.tsx`。
- 不可拆说明：这些组件当前共同持有同一 Demo 业务状态，必须在一个切片中切换到 CreatorSession，避免新旧状态源同时写入。

**实施步骤**
1. 将现有 `useState` 业务字段映射到 `video-translation@1` state/action；组件只保留瞬时 UI 状态。
2. 工作台编辑通过 Store action 更新，Agent Receipt 通过同一快照呈现并短时高亮；撤销提交 `undo-action` 而不是回滚组件数组。
3. 在正式入口创建/恢复当前项目的视频翻译 Job；开发回退入口不读取或转换旧 Demo state。

**TDD**
- RED：`restores video translation workspace from creator snapshot` 卸载再以同一 Job 快照挂载，断言字幕、TTS、画幅、版本恢复；预期因本地 state 初始化失败。
- RED：`highlights agent-edited subtitle and can undo through action` 注入 agent Receipt，断言行高亮，点击撤销产生 expectedRevision action；预期因正式 Receipt 链路缺失。
- GREEN：替换视频翻译业务状态来源，不同时改造其余四个模板 UI。
- REFACTOR：运行视频翻译、Workbench、CreatorSessionStore 回归。

**任务完成门**
- AC-3、AC-4 的 UI 行为通过；AC-7 的真实执行按钮已有 Action 接口，不再调用 Demo 文本回调。

### TASK-7：扩展 Creator 能力令牌、内部 API 与 MCP 工具 `[FR-4, BR-4, NFR-3, NFR-5, DEC-5, DEC-7, AC-4, AC-5, AC-14]`

**交付结果**
- Agent 只能在绑定 Job 和授权 scope 内读取上下文/Artifact、提交 Action；用户输入不能伪造 actor、jobId 或 expectedRevision。

**文件与符号**
- 修改：`agent-tools/capability-token.ts#AGENT_CAPABILITY_SCOPES`、`internal-routes.ts`、`mcp-routes.ts`、`stdio-server.ts`、`run-injection.ts`。
- 创建：`apps/daemon/src/agent-tools/creator-tools.ts`。
- 测试：扩展 `agent-capability-token.test.ts`、`agent-tool-api.test.ts`、`agent-tool-run-injection.test.ts`；新增 `creator-mcp-api.test.ts`。
- 不可拆说明：令牌、内部路由、MCP/stdio 暴露和 Run 注入是一条完整授权链；拆分会留下有工具无授权或有授权无可调用工具的危险中间态。

**实施步骤**
1. 增加三个 Creator scope，grant 绑定 `jobId/threadId/projectId`，服务端从 grant 派生 actor/job，拒绝请求体覆盖。
2. 内部 HTTP 与 MCP/stdio 暴露三个固定工具，Artifact range 读取限制在登记路径和允许大小；Action 强制 expectedRevision。
3. Run Injector 仅对 Creator Agent Thread 注入 Creator MCP 和最小环境变量；能力令牌按进程租约撤销。

**TDD**
- RED：`rejects creator action for a different job even with valid token` 使用 Job A token 请求 Job B，断言拒绝且两边 revision 不变；预期因 Creator scopes 不存在失败。
- RED：`does not allow actor override in creator_apply_action` 输入 actor=user，断言 Activity actor 仍由 token 绑定为 agent；预期因工具未实现失败。
- GREEN：复用现有 capability token、内部 HTTP、MCP 和 Injector；不创建第二个 MCP 服务进程。
- REFACTOR：运行所有 agent-tool/capability 定向回归。

**任务完成门**
- 越权、伪造、过期 token 和正常工具调用测试通过；满足 AC-4、AC-5、AC-14 工具安全前置。

### TASK-8：实现最小 AgentContext、Runtime Adapter 与隐藏 Creator Thread `[FR-4, NFR-5, DEC-5, DEC-7, AC-4, AC-14]`

**交付结果**
- 用户发送消息前先 flush 草稿；每轮只携带最小动态上下文；大产物按需读取；Creator Thread 可恢复但不出现在普通会话列表。

**文件与符号**
- 创建：`apps/daemon/src/creator/agent/context-builder.ts`、`runtime-adapter.ts`、`agent-service.ts`、对应单元测试。
- 修改：`packages/protocol/src/api.ts#ThreadPurpose`、`threads/types.ts`、`threads/manager.ts`、`storage/repositories.ts`、`api/routes.threads.ts`。
- 不可拆说明：最小上下文、Adapter 合同、隐藏 Thread 创建和列表过滤共同形成可恢复且不污染普通会话的 Agent turn 行为。

**实施步骤**
1. 新增内部 `creator_agent` purpose 和创建路径，普通 thread list 默认过滤；Job 保存不透明 `agent_thread_id`。
2. 实现批准的 `StableAgentGuide`/`AgentRuntimeAdapter`；`AgentContextBuilder` 只输出 DEC-7 字段，recentChanges 设数量/字节上限。
3. Agent turn endpoint 在 Web flush 成功后构造上下文；每个 turn 创建 audit，记录 context/action 工具顺序和 revision。首次冲突要求 Adapter 重新读取 context 并最多重试一次；第二次冲突或 Adapter 未重读即重试时终止写入并返回 `creator_conflict_requires_user`。
4. Agent 冲突期间到达的新 confirmed snapshot 按 TASK-5 dirty map 合并；turn 结果向 UI 暴露 `completed | needs_user_resolution`，后者在对话区和状态区显示明确冲突，不伪装成功 Activity。

**TDD**
- RED：`builds agent context without subtitle body or credentials` 构造含长字幕和配置的 Job，断言 envelope 仅含允许字段；预期因 Builder 不存在失败。
- RED：`creator agent thread is resumable and hidden from conversation list` 创建/恢复 Thread 并列普通会话，断言可通过 Job 使用但列表不可见；预期因 purpose 不存在失败。
- RED：`rereads context once after revision conflict and preserves workbench changes` Fake Adapter 先读 revision N，工作台提交 N+1，Agent 用 N 写入并收到冲突；断言调用顺序为 get(N) → action(N, conflict) → get(N+1) → action(N+1, success)，revision 到 N+2 且工作台 N+1 修改保留。再制造第二次并发冲突，断言无第三次 action、结果为 `needs_user_resolution`；预期因冲突恢复/audit 不存在失败。
- GREEN：实现最小 Context、Fake Adapter 合同和隐藏 Thread；不实现 Claude Code 正式 Adapter。
- REFACTOR：运行 Creator agent、thread-manager、API thread 和 conversation list 回归。

**任务完成门**
- 最小上下文和 Thread 隔离测试通过；Fake Adapter 能完成读取后修改的 AC-14 契约路径。

### TASK-9：自动安装 `opencreator-runtime` Skill 并激活 CodexAdapter `[BR-8, NFR-3, NFR-5, DEC-5, DEC-6, DEC-7, AC-9, AC-14]`

**交付结果**
- Daemon 启动自动安装/升级/修复稳定 Skill 到应用隔离 Codex Home；首轮显式激活，后续只传 guide id/version；失败时仅禁用 Agent。

**文件与符号**
- 创建：`apps/daemon/src/creator/agent/bootstrap.ts`、`codex-adapter.ts`、`runtime/opencreator-runtime/SKILL.md`、`runtime/opencreator-runtime/manifest.json`。
- 修改：`codex/probe-home.ts#createCodexIsolatedHome`、`codex/app-server-runner.ts#startCodexAppServer`、`runs/manager.ts`、Daemon 启动装配。
- 测试：`creator-agent-bootstrap.test.ts`、`creator-codex-adapter.test.ts`、扩展 `codex-probe-home.test.ts`；真实 smoke 扩展 `real-codex-smoke.test.ts`。
- 不可拆说明：Skill 文件、原子同步、隔离 Home、Run 注入和首轮激活共同决定“受约束 Codex 可用或 Agent 明确禁用”的单一安全门。

**实施步骤**
1. 固定 `<dataDir>/creator-runtime/codex-home`，复制 auth、生成最小 config；用临时目录、SHA-256 和原子替换同步 Skill，失败保留上一有效版本。
2. Codex 首轮 Prompt 前缀固定 `$opencreator-runtime` 并要求先调用 `creator_get_context`；恢复轮只重复 guide id/version 和最小 context。
3. RunManager/AppServer 对 Creator Thread 使用固定隔离 Home 和 Creator Injector；bootstrap/tool 不 ready 时 `AgentRuntimeAdapter` 返回 failed，工作台仍可操作。

**TDD**
- RED：`repairs corrupted runtime skill without touching global codex home` 准备损坏隔离 Skill 和哨兵全局 Home，启动 bootstrap 后断言哈希恢复且哨兵不变；预期因 bootstrap 不存在失败。
- RED：`disables agent when stable guide or tools are unavailable` 模拟原子写入失败/Injector 缺失，断言 Agent unavailable、无无约束 Codex Run；预期因失败门缺失。
- GREEN：实现单一稳定 Skill 和 CodexAdapter；Skill 只写工具使用、先读后写、revision/冲突规则，不复制模板阶段。
- REFACTOR：运行 bootstrap、Codex home/runner、RunManager 定向回归；条件具备时运行真实 Codex smoke。

**任务完成门**
- AC-9 四种 bootstrap 条件通过；AC-14 的真实 Codex 激活证据可采集，Fake 非 Skill Adapter 仍走等价 instructions。

### TASK-10：实现 StageRunner 生命周期、取消、重试与中断恢复 `[FR-2, BR-6, BR-7, NFR-2, DEC-3, DEC-8, AC-2, AC-10]`

**交付结果**
- 长 Action 创建 StageRun；执行前锁定具体输入 Artifact 版本；取消终止进程树；重试创建新 StageRun 且不覆盖旧证据。

**文件与符号**
- 创建：`apps/daemon/src/creator/stage-runner.ts`、`executor.ts`、`process-tree.ts`、对应单元测试。
- 修改：`creator/service.ts`、`creator/repository.ts`、Daemon shutdown/startup 装配。

**实施步骤**
1. 定义 `CreatorExecutor.run({stageRun,inputArtifacts,workdir,signal,reportProgress})` 和归一化 Result/Error；StageRunner 单机内按 Job 串行，跨 Job 使用有界并发。
2. 启动前解析并固化必需 Artifact 版本，缺失/stale 输入直接 `needs_input`；成功后仅登记已校验输出。
3. 取消使用 AbortSignal 加平台进程树终止；Daemon 关闭等待短宽限后强制结束；retry 复制原输入版本并创建新 run id。

**TDD**
- RED：`does not start executor with missing or stale required input` 构造缺失/stale 输入，断言 executor 调用 0、Job needs_input；预期因 Runner 不存在失败。
- RED：`cancels process tree and retries without overwriting artifacts` Fake 子进程带孙进程，取消后断言全终止；重试产生新 run/artifact version；预期因生命周期缺失失败。
- GREEN：实现阶段级真实状态和进程控制，不制造虚拟百分比，不引入持久任务队列。
- REFACTOR：运行 StageRunner、CreatorService、shutdown/startup 回归。

**任务完成门**
- AC-2、AC-10 的状态、取消、重试和无覆盖行为在 Fake 进程层通过。

### TASK-11：桥接 KrillinAI 配置、私有启动目录、权限与清理 `[FR-6, NFR-3, DEC-8, DEC-9, AC-8]`

**交付结果**
- Keyring 配置按唯一映射生成 KrillinAI TOML；密钥只短暂存在私有启动目录；缺配置、启动失败、崩溃和 Daemon 重启均无泄露。

**文件与符号**
- 创建：`apps/daemon/src/creator/krillin/config-bridge.ts`、`launch-directory.ts`、`dependency-preflight.ts`、对应测试。
- 修改：`creator-services/config-store.ts` 的只读消费接口、诊断/Workspace 文件排除规则、Daemon startup cleanup。
- 修改（KrillinAI 集成补丁）：`KrillinAI/internal/deps/checker.go`、`KrillinAI/pkg/fasterwhisper/transcription.go`、`KrillinAI/pkg/whispercpp/transcription.go`；创建 `KrillinAI/internal/resourcepath/resourcepath.go` 及测试。
- 不可拆说明：字段映射、ACL、扫描排除和结束清理必须一起验证，任何分拆都会留下密钥进入持久面或可被文件 API 读取的窗口。

**实施步骤**
1. 实现第 1.6 节唯一字段映射，未配置字段不写；日志只记录 provider/model/字段存在性，不记录值。
2. POSIX 创建 `0700` 目录/`0600` 文件；Windows 在 LocalAppData 应用目录创建并设置仅当前用户与 SYSTEM ACL。任何 ACL 失败都不启动进程。
3. 实现 KrillinAI `resourcepath`：有 `KRILLINAI_RESOURCE_ROOT` 时所有 bin/models 返回清理后的绝对路径并校验仍在根内；`KRILLINAI_OFFLINE_DEPENDENCIES=1` 时 checker 优先查 manifest 资源，缺失立即返回 `dependency_not_packaged`，不调用 `exec.LookPath`、下载器、更新器或写资源目录。
4. Adapter env 只增加资源根、离线标志和必要系统变量；PATH 在验证场景中清空或使用隔离值。ffmpeg、ffprobe、yt-dlp、fasterwhisper 可执行文件和模型均从 manifest 绝对路径命中；配置/样式仍从私有 cwd 读取。
5. `finally` 删除启动目录；启动时只清理 `krillin-launch` 下无活动子进程的合法 UUID 目录。Workspace、Artifact、诊断扫描显式排除该根目录。
6. Provider 预检读取 manifest 的 platform/arch/provider/model；未声明的本地 Provider 返回 `dependency_not_packaged`，UI capability 同步不可用。

**TDD**
- RED：`never persists secrets outside restricted launch directory` 写入带哨兵 key 的全配置，覆盖正常/缺字段/启动失败/崩溃，扫描 DB、日志、context、diagnostics、exports，断言哨兵只短暂存在启动目录且最终删除；预期因桥接不存在失败。
- RED：`blocks provider whose local dependency is not packaged` 选择未打包本地 ASR，断言进程未启动并返回 `dependency_not_packaged`；预期因预检缺失失败。
- RED：`uses only manifest resources with empty launch directory and clean PATH` 创建只含 config 的空启动目录、干净 PATH、带 ffmpeg/ffprobe/yt-dlp/fasterwhisper 与模型的资源根，运行 patched CLI dependency check，断言所有实际路径位于资源根、网络下载/更新替身调用为 0、资源目录无写入；逐一移除资源后断言 `dependency_not_packaged`；预期因上游相对路径和下载回退失败。
- GREEN：复用 CreatorServicesConfig/Keyring，只实现固定 TOML、ACL、清理和预检，不新增配置中心。
- REFACTOR：运行 config bridge、安全、creator-services、diagnostics/workspace-files 回归。

**任务完成门**
- AC-8 四条结束路径及秘密扫描全部通过；任何权限/清理失败均为阻断错误。

### TASK-12：实现 KrillinAIAdapter 与结果校验 `[FR-5, BR-6, BR-7, DEC-8, DEC-9, AC-7, AC-10]`

**交付结果**
- `subtitle/tts/render-horizontal/render-vertical` 每阶段独立调用固定 CLI；仅当 JSON、Manifest 和实际媒体一致时登记成功 Artifact。

**文件与符号**
- 创建：`apps/daemon/src/creator/krillin/adapter.ts`、`manifest.ts`、`validators/srt.ts`、`validators/media.ts`、`validators/image.ts`、对应测试。
- 修改：`creator/stage-runner.ts` executor 注册。
- 不可拆说明：进程返回、Manifest 映射和各类文件校验共同定义 BR-7 的成功条件，拆开会允许 exit 0 被误登记为成功。

**实施步骤**
1. 构造参数数组而非 shell 字符串，CLI 绝对路径来自资源 manifest，固定 cwd/workdir/timeout，并设置 `KRILLINAI_RESOURCE_ROOT`/`KRILLINAI_OFFLINE_DEPENDENCIES`；解析单行 JSON、exit code、stderr，并把 Manifest 字段映射为 Artifact kind。
2. SRT 解析序号/时间轴/非空内容；ffprobe 校验流、时长、分辨率和非空；路径必须位于 StageRun workdir 且不允许符号链接逃逸。
3. JSON/Manifest/文件任一不一致时 StageRun failed、保留脱敏诊断引用、不登记假 Artifact；取消后拒绝迟到输出。

**TDD**
- RED：`rejects exit-zero response with invalid manifest or media` Fake CLI exit 0 但缺文件/坏 SRT/零时长，断言 failed 且 Artifact 0；预期因校验 Adapter 不存在失败。
- RED：`maps valid krillin manifest outputs to versioned artifacts` 提供有效 JSON/Manifest/ffprobe fixture，断言 kind、path、source ids、metadata 正确；预期因映射缺失失败。
- GREEN：只支持已确认四个 P0 命令及 cover 兼容验证器，不依赖 pipeline/status。
- REFACTOR：运行 Krillin adapter/validator、StageRunner、process cancellation 回归。

**任务完成门**
- AC-10 的假成功防护通过；真实媒体边界已具备 AC-7 执行条件。

### TASK-13：交付 P0 视频翻译真实闭环 `[FR-1, FR-5, BR-5, BR-7, DEC-8, DEC-9, DEC-10, AC-1, AC-4, AC-6, AC-7]`

**交付结果**
- 三类输入可完成字幕、编辑、可选 TTS、横/竖屏、版本预览和导出；工作台与 Agent 使用同一 Action；失败路径不产生假结果。

**文件与符号**
- 创建：`apps/daemon/src/creator/templates/video-translation-actions.ts`、`video-translation-export.ts`、`apps/web/e2e/creator-video-translation.spec.ts`、`apps/daemon/test/e2e/creator-video-translation-real.test.ts`。
- 修改：视频翻译模板、Service/Runner 注册、`VideoTranslationWorkspace.tsx`、`VideoTranslationResultWorkspace.tsx`、`CreatorAgentPanel.tsx`。
- 不可拆说明：Action 编排、执行器注册、预览导出和真实 E2E 是 P0 视频翻译从公开入口到成品的一个垂直闭环。

**实施步骤**
1. 实现来源接入、subtitle/edit-subtitle、tts、render-horizontal、render-vertical、select-version、export actions；不支持 URL 在创建下载 StageRun 前返回 `unsupported_source`。
2. 编辑字幕创建新 `target_subtitle` 版本并 stale 旧血缘下游；TTS 关闭时 render 不要求 dubbed_audio，开启但缺配置时 Job needs_input 并返回设置 deep link。
3. 预览只读取登记 Artifact；导出复制到用户选择目录并生成不含密钥的内容清单，不包含发布字段。
4. 用参数化 VT-1 至 VT-6 逐项运行；外部平台样例固定为测试资产清单并记录可用性，单一样例不得替代矩阵。

**TDD**
- RED：`video translation action matrix enforces tts and render dependencies` 以 Fake executors 覆盖 TTS 开关、横/竖屏和编辑后 stale，断言阶段输入/输出版本；预期因完整 action 编排缺失失败。
- RED：`unsupported source and missing tts config do not create successful stage runs` 覆盖 VT-5/VT-6，断言错误、needs_input、零假成功 Artifact；预期因错误路径缺失失败。
- GREEN：先让 Fake executor 产品流程全通，再接真实 KrillinAI 执行 VT 矩阵；不顺带实现下载独立模板或封面。
- REFACTOR：运行 Creator 全部定向回归、Web E2E 和真实视频翻译 E2E。

**任务完成门**
- AC-1、AC-4、AC-6、AC-7 与 VT-1 至 VT-6 全部通过；任一真实矩阵项 FAIL/BLOCKED 时 P0 不得宣称完成。

### TASK-14：固定 Creator Runtime Sidecar 并验证 Desktop 打包 `[FR-6, BR-8, NFR-1, NFR-3, NFR-6, DEC-6, DEC-8, DEC-9, AC-8, AC-9, AC-10, AC-13, AC-14]`

**交付结果**
- 安装包携带固定 KrillinAI、ffmpeg、ffprobe、yt-dlp、字幕样式、Runtime Skill 和版本/哈希清单；实际 Desktop 使用与 Web 同一 Creator 链路。

**文件与符号**
- 创建：`apps/desktop/scripts/prepare-creator-runtime.mjs`、`apps/desktop/test/creator-runtime-package.test.ts`、`apps/desktop/test/web-asset-integrity.test.ts`、`apps/web/e2e/web-desktop-parity.spec.ts`、`apps/desktop/e2e/creator-packaged-app.spec.ts`、Creator Runtime manifest 模板。
- 修改：`electron-builder.yml`、`prepare-daemon.mjs`、`package-release.mjs`、`verify-package.mjs`、`src/main/daemon-manager.ts`、Desktop Playwright 配置/现有 App E2E fixture。
- 不可拆说明：资源准备、builder 声明、运行时解析、包校验和实际 App 测试共同证明安装包自包含，分拆无法满足 NFR-6。

**实施步骤**
1. 从 KrillinAI 基线 commit 加 TASK-11 集成补丁构建 CLI；构建记录保存 upstream commit、补丁 content hash、Go 版本和产物 hash。打包前从受控构建输入复制平台二进制/资源，生成逐文件 manifest 并校验 SHA-256、版本和可执行权限；正式运行时禁止 git clone 或下载。
2. DaemonManager 通过资源根解析 Sidecar，传入 Creator runtime/data 路径；校验失败时 Agent/媒体阶段明确不可用，工作台只读恢复仍可用。
3. 包内目录严格使用 1.4 的只读布局；实际运行以空启动目录、干净 PATH 和离线标志验证 ffmpeg/ffprobe/yt-dlp/fasterwhisper/模型只命中资源根，网络下载调用为 0。
4. `web-desktop-parity.spec.ts` 使用同一 Fake Daemon、项目、会话、本地偏好、deviceScaleFactor=1 和 `1280x800` 前端内容视口，分别挂载 Browser/Desktop Bridge，逐项比较：首页、项目选择器、创建项目、设置页、会话输入区、文件工作区的通用文案、按钮、状态、主要 DOM 和关键 bounding box；比较相同操作的 Runtime 请求序列与持久结果。
5. 同一 parity 用例验证 Web 首启获得默认项目且输入框可用；Browser 不显示目录选择/更换/窗口关闭；Desktop 原生入口真实调用 Bridge capability，不接受空函数或假成功。
6. `creator-packaged-app.spec.ts` 在实际安装包覆盖 preload、`clawee-app://`、Runtime 代理、默认项目、核心输入、Creator 创建/恢复/取消/导出和原生 capability。`web-asset-integrity.test.ts` 比较本次 `apps/web/dist` 与 App 内嵌目录的相对文件列表和逐文件 SHA-256 完全一致。

**TDD**
- RED：`packaged creator runtime contains only manifest-pinned executables` 对缺文件、错哈希、额外下载入口运行 verify，断言失败；预期因准备/验证逻辑不存在失败。
- RED：`browser and desktop bridges pass all shared product parity gates` 用固定 fixture/视口运行六个通用页面与默认项目、API、平台 capability 比较，任一 DOM/文案/尺寸/请求/结果差异即失败；预期因完整一致性门禁尚不存在失败。
- RED：`packaged app embeds the current web build byte for byte` 先构建 Web，再篡改/删除一项包内资源，断言 verify 失败；恢复后断言文件列表与逐文件 hash 全等；预期因现有校验未覆盖完整 Web 资源失败。
- RED：`desktop and web observe the same creator job revision and export` 对同一 Daemon Job 分别操作，断言 revision、Artifact 和导出清单一致；预期因 Desktop 装配未接 Creator runtime 失败。
- GREEN：扩展现有打包管线，不复制前端或创建 Desktop 专用 Creator 状态。
- REFACTOR：运行 CMD-4、CMD-6、CMD-8，并复跑 Web Creator E2E。

**任务完成门**
- AC-8、AC-9、AC-10、AC-13、AC-14 的打包层证据通过；安装包外部不需要 KrillinAI 仓库。

### TASK-15：交付 P1 DownloadExecutor 与视频下载模板 `[FR-7, BR-7, NFR-6, DEC-10, DEC-11, AC-11]`

**交付结果**
- 用户可独立 probe/download，也可把已下载 Artifact 直接交给视频翻译和自动剪辑，避免重复下载。

**文件与符号**
- 创建：`apps/daemon/src/creator/download/executor.ts`、`probe-parser.ts`、`templates/video-download.ts`、对应测试；`apps/web/src/features/workbench/VideoDownloadWorkspace.tsx` 正式测试。
- 修改：Executor/Template Registry、视频翻译来源选择、Desktop Runtime manifest。
- 不可拆说明：probe、下载、Artifact 登记、跨模板复用和打包版本必须在同一行为切片中验证“只下载一次”。

**实施步骤**
1. `probe(url)` 标准化平台、标题、时长、格式；`download(url, formatId)` 只接受 probe 返回格式并持续上报 yt-dlp 真实进度。
2. 输出 `source_video/source_audio` Artifact；失败码区分 unsupported、login_required、region_or_copyright_restricted、format_unavailable、disk_full。
3. 视频翻译接受显式 Artifact id 后跳过内部下载；KrillinAI 兼容下载只在无预下载 Artifact 时使用。

**TDD**
- RED：`downloaded artifact is reused by video translation without second network download` Fake yt-dlp 下载一次后启动翻译，断言下载调用仍为 1 且 source id 相同；预期因 DownloadExecutor/复用路径不存在失败。
- RED：`fails when probed format disappears without registering artifact` probe 后模拟格式消失，断言 `format_unavailable`、Artifact 0；预期因独立错误语义缺失失败。
- GREEN：直接封装固定 yt-dlp，不等待 KrillinAI 命令，不引入通用下载服务。
- REFACTOR：运行 Download、视频翻译复用、实际 P1 浏览器/打包 App E2E。

**任务完成门**
- AC-11 下载部分通过，且 P0 视频翻译回归不重复下载。

### TASK-16：交付 P1 ImageExecutor 与封面模板 `[FR-7, BR-5, BR-7, DEC-10, DEC-12, AC-11]`

**交付结果**
- 视频/图片/文字可形成创意简报、多候选、参考图编辑和比例适配；每张候选独立版本化，部分失败可见且不覆盖成功项。

**文件与符号**
- 创建：`apps/daemon/src/creator/image/provider.ts`、`openai-compatible-provider.ts`、`executor.ts`、`templates/cover.ts`、对应测试。
- 修改：`CoverGeneratorWorkspace.tsx`、Creator Registry/Service、CreatorServices 图片配置消费。
- 不可拆说明：Provider 能力声明、多候选执行、Artifact 版本和工作台结果必须共同验证 partial_success 与参考图失败语义。

**实施步骤**
1. ImageExecutor 输入固定为 prompt、ratio、candidateCount、optional reference Artifact；生成/编辑能力由 Provider 明确声明。
2. 每候选独立 StageRun 或子结果并登记 `cover_image` Artifact；部分失败返回 `partial_success` 和失败项，成功图仍可比较/调整/导出。
3. Provider 不支持参考图时返回 `unsupported_capability`；不得忽略参考图。Krillin cover 仅注册无参考图兼容 Adapter。

**TDD**
- RED：`keeps successful cover candidates when one request fails` 三候选中一项失败，断言两 Artifact、partial_success 和失败详情；预期因 ImageExecutor 不存在失败。
- RED：`rejects reference image when provider cannot edit` 提交 reference，断言明确错误且生成调用 0；预期因 capability gate 缺失失败。
- GREEN：实现一个 OpenAI-compatible ProviderAdapter 和兼容 Krillin Adapter，不新增 Provider 配置类型。
- REFACTOR：运行 Image/cover、Artifact 版本/stale、P1 产品 E2E。

**任务完成门**
- AC-11 封面部分全部通过，封面可独立使用也可作为其他模板可选阶段。

### TASK-17：交付 P2 ClipExecutor 与自动剪辑模板 `[FR-8, BR-1, BR-5, BR-7, DEC-4, DEC-9, DEC-10, AC-12]`

**交付结果**
- 自动剪辑复用字幕 Artifact，用统一 LLM 配置生成结构化候选和四维评分，工作台选择后由 ffmpeg 裁切/重构/拼接并可复用字幕/TTS。

**文件与符号**
- 创建：`apps/daemon/src/creator/clip/analyzer.ts`、`executor.ts`、`templates/auto-clip.ts`、对应测试。
- 修改：`AutoClipWorkspace.tsx`、Registry/Executor 注册、CreatorServices LLM 消费。
- 不可拆说明：结构化分析、候选持久化、ffmpeg 执行和工作台选择共同构成自动剪辑的最小可用闭环。

**实施步骤**
1. Analyzer 要求 LLM 输出带起止时间、理由和四维评分的严格 JSON；时间范围必须落在媒体时长内且不重叠非法区间。
2. 候选、用户选择、时间线和渲染均保存为 Artifact/version；ClipExecutor 用参数数组调用 ffmpeg 完成裁切、画幅和拼接。
3. 字幕/TTS 复用 P0 阶段；时间线变化沿模板图 stale 最终 clip，不创建组件本地业务链。

**TDD**
- RED：`rejects invalid highlight ranges before ffmpeg and persists valid candidates` 混合合法/越界 LLM JSON，断言越界被拒、合法候选可保存且 ffmpeg 未提前启动；预期因 analyzer 缺失失败。
- RED：`auto clip uses creator job artifact activity and action contracts` 跑 Fake 全流程，断言无独立本地状态数据源；预期因模板未接统一 Core 失败。
- GREEN：复用现有 LLM、Krillin 和 ffmpeg，不增加新 Provider 或通用时间线引擎。
- REFACTOR：运行 Clip、统一契约、P2 产品 E2E。

**任务完成门**
- AC-12 自动剪辑路径通过，所有状态可重启恢复并可由 Agent Action 修改。

### TASK-18：交付 P2 火柴人执行器与模板 `[FR-8, BR-1, BR-5, BR-7, DEC-4, DEC-9, DEC-10, AC-12]`

**交付结果**
- 主题/脚本形成版本化脚本、分镜、逐镜头图片、TTS 和 ffmpeg 时间线成片；每段可由工作台或 Agent 修改并触发精确 stale。

**文件与符号**
- 创建：`apps/daemon/src/creator/stickman/script-generator.ts`、`storyboard-generator.ts`、`executor.ts`、`templates/stickman-video.ts`、对应测试。
- 修改：`StickmanVideoWorkspace.tsx`、Registry/Executor 注册、Image/TTS 复用接口。
- 不可拆说明：脚本、分镜、逐镜头资产、TTS、合成和工作台状态必须共享同一血缘链，拆分会使 stale 验收失去完整路径。

**实施步骤**
1. LLM 输出严格脚本/分镜 JSON；每段脚本、镜头、图片和音频登记独立 Artifact，并记录来源版本。
2. ImageExecutor 逐镜头生成；Krillin TTS 生成音频；StickmanExecutor 用 ffmpeg 按音频时长组合镜头、简单平移缩放、字幕和时间线。
3. 修改脚本段只 stale 受影响镜头及最终视频；修改风格 stale 对应图片链；旧版本继续可预览。

**TDD**
- RED：`editing one script segment stales only its storyboard assets and final render` 构造三段血缘，修改中段，断言其他段图片/音频保持 completed；预期因细粒度血缘缺失失败。
- RED：`stickman workflow is recoverable through creator session after restart` 在分镜完成后重启，断言继续生成而非重建本地 state；预期因统一模板尚未实现失败。
- GREEN：复用 LLM/Image/Krillin/ffmpeg 执行器，不创建第二套项目、任务或 Agent 协议。
- REFACTOR：运行 Stickman、stale 血缘、P2 产品 E2E。

**任务完成门**
- AC-12 火柴人路径通过，与自动剪辑共同证明 P2 复用统一领域契约。

### TASK-19：执行完整差异自审与功能验收 `[FR-1..FR-8, BR-1..BR-8, NFR-1..NFR-6, DEC-1..DEC-12, AC-1..AC-14]`

**交付结果**
- 主 Agent 完成最终 Git 差异自审、修复范围内问题、运行全仓回归和公开接口功能验收，并生成当次会话中的可追溯交付报告。

**实施步骤**
1. 在不启动 Reviewer 的前提下检查 `git diff --stat` 与相关 `git diff`，逐项对照契约、追踪矩阵和 TASK；检查漏项、范围外改动、重复抽象、安全/权限、兼容、错误语义和测试质量。
2. 自审问题按同一 TDD 规则修复并重跑受影响测试；最后一次相关修改之后重新执行 CMD-1、CMD-5、CMD-7、CMD-6、CMD-8 及真实 VT/P1/P2 矩阵。
3. 按第 6 节验收矩阵逐项记录 `PASS | FAIL | BLOCKED`、实际结果、命令/操作、时间、退出码和证据摘要；任一 P0 AC 非 PASS 时不得宣称 P0 完成。

**TDD**
- 策略：豁免新增 RED。该任务验证已实现公开行为；自审发现的行为缺陷必须先补真实 RED 再修复。

**任务完成门**
- AC-1 至 AC-10、AC-13、AC-14 和 VT-1 至 VT-6 全部 PASS 才能交付 P0；AC-11 PASS 才能交付 P1；AC-12 PASS 才能交付 P2。

## 5. 失败熔断与执行偏差

### 5.1 失败熔断

- RED 预期失败不计入修复失败次数；必须确认失败来自目标能力缺失，而非语法、环境或 fixture。
- 进入 GREEN 后，每次修复前记录失败证据、根因假设和最小改动。同一测试或命令因同一根因经过两次有实质差异的修复仍失败，立即停止当前 TASK，标记 `BLOCKED`。
- 熔断后说明属于实现、测试/fixture、环境还是 Plan/契约问题；不得继续盲试、放宽断言、删除失败用例、静默改设计或启动子 Agent。
- 外部网络样例临时不可用时，真实平台 AC 标记 BLOCKED 并保留本次证据；受控 fixture 只能验证执行器逻辑，不能冒充 VT/P1 的真实平台验收。

### 5.2 偏差规则

- 不改变契约的文件移动、局部命名、测试归档或实现细节可调整，但最终报告必须记录原因、影响和替代路径。
- 任何 FR/BR/NFR/DEC/AC、公共 API、表语义、错误码、安全边界、执行器所有权、Template/Skill 关系或发布边界变化，立即停止并回到方案/Plan 修订。
- 不得为了通过测试降低断言、伪造进度/成功、跳过真实媒体校验、把密钥写入可持久位置，或让 P1/P2 建立独立本地状态链。

## 6. 最终功能验收矩阵

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 新鲜证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AC-1 | P0 | 创作到导出 | 任一视频翻译 Job | 完成模板并导出 | 得到内容成品；UI/API/清单无发布审批、账号上传或发布状态 | Web 与 Desktop 产品 E2E | 录屏/截图、导出清单、命令时间和退出码 |
| AC-2 | P0 | 刷新与重启恢复 | Job 含阶段、产物、Activity，另有 running StageRun | 刷新 Web 并重启 Daemon | 全量恢复；running 变 interrupted 且可重试 | 真实 API + 浏览器 | 重启前后快照、DB 查询摘要、E2E trace |
| AC-3 | P0 | 工作台即时同步 | 工作台和 Agent 面板同页 | 改语言/TTS/字幕并等待语义提交 | Agent 状态立即变，Activity 聚合，Codex Run 数不增加 | 前端集成 + 浏览器 | DOM 断言、API 调用记录、Run 列表 |
| AC-4 | P0 | Agent 修改与撤销 | Agent 绑定同一 Job | Agent 改字幕/输出，随后用户撤销 | 工作台更新并高亮；actor=agent；撤销创建新 revision | Fake/真实 Agent E2E | Receipt、Activity、revision 序列、截图 |
| AC-5 | P0 | revision 冲突 | Agent 持旧 revision，工作台已更新且可有未 flush 草稿 | 旧 revision 提交；Agent 按规则重读并重试 | 首次返回冲突；调用顺序为 get → action(conflict) → get → action；工作台持久修改和 dirty 草稿不丢失；第二次冲突停止并提示用户 | Service + Runtime 集成 | context/action audit、revision 序列、冲突前后 confirmed/draft 快照 |
| AC-6 | P0 | stale 血缘 | 已有字幕、配音、横竖屏 | 编辑目标字幕并保存/重生成 | 旧版本保留；相关音频/视频 stale；新版本并存 | Service + 产品 E2E | Artifact 血缘表、版本列表、预览截图 |
| AC-7 | P0 | VT-1 至 VT-6 | 固定真实样例和对应生产配置 | 逐项运行矩阵 | 每项满足来源方案独立预期，三输入/TTS 开关/横竖屏/失败均覆盖 | 参数化真实边界 E2E | 每项命令、日志摘要、媒体探测、产物路径、状态 |
| AC-8 | P0 | 配置与秘密安全 | 完整/缺字段/启动失败/崩溃四条件 | 启动 Krillin 阶段并扫描所有持久面 | 映射正确；密钥仅在受限目录；结束/重启清理；其他位置无明文 | 安全集成 + 实际 App | ACL、目录生命周期、秘密哨兵扫描报告 |
| AC-9 | P0 | Skill 生命周期 | 新装/升级/损坏/写失败 | 启动 Daemon | 隔离 Home 自动安装/修复；全局 Home 不变；失败仅禁用 Agent | Bootstrap 集成 | 哈希、路径、全局哨兵、UI 状态 |
| AC-10 | P0 | Sidecar 生命周期 | 实际安装包 | 启动、取消、失败、重试真实阶段 | 无残留进程；状态准确；无假 Artifact；旧结果不覆盖 | 打包 App E2E | 进程树、StageRun/Artifact 快照、trace |
| AC-11 | P1 | 下载与封面 | 固定 yt-dlp；图片 Provider 支持生成/编辑 | probe/download 后复用；生成多候选多比例参考图封面 | 下载不重复；封面逐张版本化、可调整/部分失败/导出；不支持参考图明确报错 | P1 产品 E2E | 网络调用计数、Artifact/失败项、导出与截图 |
| AC-12 | P2 | 自动剪辑和火柴人 | P2 执行器可用 | 分别完成两个模板 | 均使用统一 Job/Run/Artifact/Activity/Action，无独立本地业务链 | 架构断言 + 产品 E2E | API/DB 快照、状态恢复、最终视频探测 |
| AC-13 | P0 | Web/Desktop 一致 | 同一 Fake Daemon、项目、会话、偏好、`1280x800` 内容视口及本次 Web build | 两端走首页、项目选择/创建、设置、输入、文件工作区和 Creator 操作；再运行实际包 | 通用 DOM/文案/状态/尺寸/API/持久结果一致；Web 默认项目可输入；平台入口按真实 capability 显隐/调用；preload、`clawee-app://`、Runtime 代理正常；包内 Web 文件列表/hash 与 `apps/web/dist` 全等 | parity E2E + 实际 Desktop E2E + 资源校验 | 双端截图/DOM/bounding box、请求序列、Bridge spy、持久快照、逐文件 hash |
| AC-14 | P0 | Runtime 可替换契约与冲突恢复 | 稳定指导、真实 Codex、无 Skill Fake Adapter | 创建 Thread，先正常读取后修改，再制造一次 revision 冲突 | Codex 激活 Skill 并先读后写；Fake 注入等价规则；冲突后重读且最多重试一次；再次冲突停止；激活失败禁用 Agent | Runtime contract + real smoke | Prompt/工具 audit 顺序、revision 序列、Receipt、冲突 UI、无秘密日志 |

VT-1 至 VT-6 的具体输入和独立预期以第 1.5 节为唯一执行契约；执行记录必须在本矩阵 AC-7 下逐项展开，不能汇总为单一 PASS。

## 7. 发布、迁移与回滚

- P0-A（Core/UI Fake executor）、P0-B（Agent/Krillin）、P0-C（真实视频翻译）可使用内部功能开关逐段合入，但 P0 对外完成必须同时满足 TASK-13/14/19。
- 当前 Demo 数据不迁移；正式入口切换失败可回退旧 Demo 路由，但不得把正式 Job 降级为组件 state。回退期间数据库和产物保持只读可恢复。
- 新模板版本只用于新 Job；旧 Job 不原地升级。若模板 v1 有阻断缺陷，创建显式升级副本并保留来源 Job/Artifact。
- Creator Runtime/Skill 更新使用哈希清单和原子替换；失败保留上一有效版本。Sidecar 版本回滚不改变 CreatorService、StageRun 或 Artifact 协议。
- 常驻 Worker 不在本 Plan 实施；只有真实基准证明预热为常见显著瓶颈后另行设计，失败可无协议变化地继续 CLI 模式。

## 8. 风险

| 风险 | 计划内控制 |
| --- | --- |
| Activity 过量 | 仅语义变化持久化，高频草稿按对象和窗口聚合。 |
| 工作台/Agent 并发覆盖 | expectedRevision、冲突回读、禁止自动覆盖。 |
| Template 与 Skill 漂移 | 模板保存业务规则，Skill 只保存稳定工具纪律；契约测试检查 Skill 不复制阶段定义。 |
| Krillin 细粒度进度缺失 | P0 只展示真实阶段状态；不解析人类日志制造百分比。 |
| 本地模型下载/预热 | 打包 manifest 预检；未打包直接 `dependency_not_packaged`；常驻 Worker 延后。 |
| Windows 进程树/文件句柄 | 取消、崩溃、重试和实际打包 App 作为 P0 阻断验收。 |
| 跨平台二进制差异 | 平台清单、哈希、权限、实际安装包 E2E。 |
| 真实平台网络波动 | 固定短样例和执行时间证据；不可用标 BLOCKED，不用 fixture 冒充。 |

## 9. 最终报告格式

实施完成后的会话报告必须包含：已完成/未完成任务；执行偏差及是否改变契约；本地 `git diff` 自审结论和修复项；每个 TASK 的 RED/GREEN/回归命令与结果；AC/VT 验收状态、时间和新鲜证据；打包/回滚状态；遗留风险。除项目已有测试产物外，不额外创建实施报告或证据 Markdown。

## 10. Plan 独立审核记录

### Reviewer 原始结论

`REVISE`

### 流程结论

`PASS`

### 问题处理

首版 Plan 已完成唯一一次 `zhiyu-reviewer` 审核。主 Agent 按三个 Major 的可验证关闭条件修订；全部关闭后流程结论更新为 `PASS`，不启动第二次 Reviewer。

| 问题 ID | 严重程度 | Reviewer 关闭条件 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | Major | 固定 KrillinAI 资源根、cwd/env/参数、包内布局和禁止下载门；增加干净 PATH、空启动目录、固定依赖/本地 ASR、零下载 RED | 采纳并关闭 | 1.4、TASK-11、TASK-12、TASK-14、AC-8/10 | 固定 `KRILLINAI_RESOURCE_ROOT` 与离线标志；列出 KrillinAI 补丁文件、manifest 布局、Windows/Linux fasterwhisper 支持和逐项 RED；缺资源直接 `dependency_not_packaged` | KrillinAI 集成补丁需在独立 KrillinAI fork/构建产物中维护，升级上游时必须重验 content hash |
| R-02 | Major | 给出固定 fixture/内容视口/测试路径，覆盖项目规则八项 Web/Desktop 门禁和 Web 资源逐文件 hash | 采纳并关闭 | TASK-14、AC-13 | 新增 parity、实际包、资源完整性测试路径；明确六类页面、默认项目、API、capability、preload、协议、代理和逐文件 hash 的操作/断言 | 实际 Electron 内容区在不同 OS 的边框差异需由测试 fixture 固定 content bounds |
| R-03 | Major | 明确冲突后工具顺序、最大重试/停止语义、UI 结果、dirty draft 保护，并映射 AC-5/14 | 采纳并关闭 | 1.4、TASK-5、TASK-8、AC-5、AC-14 | 固定首次冲突重读、最多一次重试、二次冲突 `needs_user_resolution`；新增 audit 顺序和 dirty draft RED/验收证据 | 真实 Codex 是否严格遵循冲突指导仍需 AC-14 冒烟阻断验证 |

## 11. 执行授权

> 状态：已授权。授权日期：2026-08-20。用户原话：`开始执行，把这20个Task全部完成，中途不要停下来问我，除非有绕不开的阻断，开始吧`。从 TASK-0 开始连续执行，不再重复请求批准。
