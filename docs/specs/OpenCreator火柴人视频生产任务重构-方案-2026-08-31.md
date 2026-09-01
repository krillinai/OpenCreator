# OpenCreator 火柴人视频生产任务重构方案

> 状态：草案
> 体量判断：复杂。该交付同时涉及 Creator 模板与状态、持久化数据清理、镜头级并发与幂等、外部付费 Provider、KrillinAI、Remotion、Web/Desktop 共用界面和正式打包门禁；各部分共同约束同一个可发布任务，无法独立批准或验收，因此保持一份内聚方案。
> 设计确认：已完成（D-1 至 D-3）
> Reviewer 原始结论：REVISE
> 流程结论：PASS
> 用户批准：已批准（2026-08-31）

## 背景、目标与非目标

### 目标

在 `feat-stick-video` 分支中删除现有火柴人 Demo 的业务实现，以 auto-video 当前真实生产链路为基线，重新实现唯一的 `stickman-video` Creator 任务。新任务必须使用 OpenCreator 已落地于视频翻译、图像生成等功能的 CreatorJob、StageRun、Artifact、CreatorAction、Revision、ResultSnapshot 和 Agent 协作架构，并由 OpenCreator、KrillinAI 与 Remotion 按明确边界共同完成五项交付物。

### 非目标

- 不保留旧火柴人模板、执行器、页面状态或兼容入口。
- 不迁移或恢复旧火柴人 Demo Job。
- P0 不恢复 auto-video 旧设计文档中的十三项多平台交付合同。
- 不把脚本审核、分镜审核、交付包等火柴人产品语义放入 KrillinAI。
- 不把 auto-video 的 Python 实现、解释器或依赖放入 OpenCreator 源码运行链路或火柴人 Runtime；既有 Creator Runtime 中受 Manifest、版本和哈希约束的便携 Python `yt-dlp` 保持原有媒体获取职责，不扩展为火柴人业务实现。
- 不借本任务重构视频翻译、图像生成及其他 Creator 模板。

## 用户需求原文

1. `auto-video是自动生成视频的项目，我现在希望把当前这个功能合并到opencreator里面，就像Krillinai提供视频下载、字幕生成等能力一样，需要给出技术方案分析，因为auto-video是Python实现的，opencreator不太适合引入更多语言，有两种选择：1. 用OpenCreator的ts重构 2. 放到Krillinai里面重构，或者你有没有更好的方案，评估一下`
2. `你推荐的方案整体没问题，需要修正下，auto-video是对应 火柴人生成，目前OpenCreator的 火柴人生成，还是之前的demo，并没有按照 视频翻译、图像生成等这些按照新的架构设计出来的任务，所以需要你重新评估下`
3. `$zhiyu-brainstorm 1. 从OpenCreator拉取一个新的分支 feat-stick-video开发。2. 不要留兼容模式，stickman-video就只有一个版本，可以使用现有demo的功能交互设计，但底层只有一套`
4. D-1 确认：`没问题，继续`
5. D-2 确认：`没问题，继续`
6. D-3 确认：`没问题，继续`

## 事实基线与假设

| 证据 | 已确认事实 | 对设计的影响 |
| --- | --- | --- |
| `apps/web/src/features/dashboard/StickmanVideoWorkspace.tsx` 的 `storyboardShots`、`resultVersions`、`generateStoryboard`、`generateVideo` | 现有火柴人页面以硬编码分镜和 React 本地结果为主，调用后端后会立即标记结果就绪 | 现有业务状态和结果逻辑必须删除，只允许复用交互与视觉设计 |
| `apps/daemon/src/creator/templates/stickman-video.ts`、`creator/stickman/executor.ts` | 现有模板只有简化的 script、storyboard、narration、render 四阶段，未形成真实审核、版本和完整交付闭环 | 直接替换模板和执行器，不以现有实现为增量基座 |
| `creator-session-store.tsx`、`creator/service.ts`、`creator/stage-runner.ts`、`creator/result-snapshots.ts` | OpenCreator 已具备持久 CreatorJob、Revision、StageRun、Artifact、stale 血缘、事件同步和结果快照 | 新任务复用 Creator 通用领域模型，不迁移 auto-video 的 SQLite 与 Runner |
| `video-translation.ts`、`video-translation-actions.ts` | 视频翻译已经形成模板、工作流推进、配置门、reconcile/recover 和 KrillinAI 执行边界 | 火柴人任务按同一新架构建立专属 Workflow Controller |
| `packages/protocol/src/krillin-opencreator.ts`、KrillinAI `internal/opencreatorapi` | KrillinAI 暴露下载、字幕、TTS、横竖屏渲染等媒体能力，并具有任务、事件、Manifest 和幂等字段 | 只复用通用媒体原子能力，不向 KrillinAI 下沉火柴人产品状态 |
| auto-video `application/factory.py`、`stages/*`、Remotion 模板 | auto-video 的 Python 主要承担编排、合同和工件处理，字幕已调用 KrillinAI，Remotion 模板本身是 TypeScript | Python 作为行为参考和黄金基线，不作为最终 Runtime |
| 当前 Git 状态 | 已从最新 `origin/main` 创建本地 `feat-stick-video`，未跟踪的 `auto-video/` 目录保持不变 | 后续方案、Plan 和实现均以该分支为工作分支；首次有效提交后再推送远端 |

假设：P0 输入为有效的 YouTube 公共链接；当前 auto-video 实际五项交付合同是本轮功能基线；旧火柴人 Demo 数据不具有需要保留的生产价值。不存在未决问题。

## 设计确认记录

| 设计部分 | 核心决定 | 用户确认原话 |
| --- | --- | --- |
| D-1 产品范围与替换策略 | 直接重做唯一 `stickman-video`；清理旧 Demo Job；P0 交付纯净视频、封面、发布文案、双语视频和双语 SRT；不新增 Python 火柴人实现或 Runtime | `没问题，继续` |
| D-2 技术架构与任务数据流 | OpenCreator TS 编排，KrillinAI 承担媒体原子能力，Remotion 使用 Node Worker；页面、Agent、版本和进度全部由 CreatorJob、StageRun 和 Artifact 驱动 | `没问题，继续` |
| D-3 失败恢复、测试与交付门禁 | 定义中断恢复、付费请求安全、镜头级幂等、旧数据清理、Web/Desktop 一致性和实际打包 App 门禁 | `没问题，继续` |

## 需求与业务规则

| ID | 类型 | 优先级 | 描述 |
| --- | --- | --- | --- |
| FR-1 | 功能需求 | P0 | 产品中只存在一套可真实运行的 `stickman-video` 工作台、模板、工作流和执行实现；页面可以沿用 Demo 的交互设计，但所有完成状态来自持久任务数据。 |
| FR-2 | 功能需求 | P0 | 用户输入有效 YouTube 链接并完成脚本、分镜审核后，任务自动完成内容理解、图片、配音、时间线、纯净成片、字幕、封面、发布文案和交付校验。 |
| FR-3 | 功能需求 | P0 | 用户和 Agent 可以编辑脚本、审核分镜、重生成单镜头并查看历史结果；修改只使受影响 Artifact 及其下游结果失效。 |
| FR-4 | 功能需求 | P0 | CreatorJob 是工作台与 Agent 的共享权威状态；刷新页面、重启 Daemon 或恢复外部任务后，阶段、审核、进度、版本和结果保持一致。 |
| BR-1 | 业务规则 | P0 | 不保留兼容模式；TemplateRegistry 只注册当前生产定义 `stickman-video@2`，不注册旧 `@1`；旧 Demo Job 及其关联数据通过一次性迁移定向删除。 |
| BR-2 | 业务规则 | P0 | OpenCreator 负责产品编排、审核、状态、血缘和交付；KrillinAI 只负责通用媒体能力；Remotion 只负责按照已登记时间线渲染。 |
| BR-3 | 业务规则 | P0 | 前端不得维护独立结果版本或自行宣布成功；所有可展示结果来自 `completed` 或历史 `stale` Artifact 及 ResultSnapshot。 |
| BR-4 | 业务规则 | P0 | 具有计费副作用的 Provider 在远端接受状态未知时不得自动再次提交；单镜头成功结果必须在其他镜头失败或重试时保留。 |
| BR-5 | 业务规则 | P0 | P0 最终交付固定为纯净视频、YouTube 封面、YouTube 发布文案、双语视频和双语 SRT 五项文件，并由 Delivery Manifest 逐项验真。 |
| NFR-1 | 非功能需求 | P0 | 火柴人源码、Daemon、Stickman Runtime 和 `app.asar` 不包含 Python 实现或 Runtime；既有 Creator Runtime 的便携 Python `yt-dlp` 只能用于统一媒体获取，必须由独立 Manifest 固定版本、文件集和哈希。Remotion、Chromium、字体、素材和 KrillinAI 依赖同样必须固定版本并记录哈希。 |
| NFR-2 | 非功能需求 | P0 | Web 与实际 Desktop App 在相同内容视口、Job 和设置下具有相同通用界面、动作、Runtime 请求、持久化结果和交付结果。 |
| NFR-3 | 非功能需求 | P0 | Desktop 正式打包必须从当前工作区重新构建 Web，记录 commit、dirty 状态、Web 构建标识或哈希、平台、架构和构建时间，并逐文件比较 `apps/web/dist` 与 App 内嵌 Web 目录的文件列表和内容哈希。 |

需求追踪：FR-1 由 AC-1、AC-7 验证；FR-2 由 AC-2 验证；FR-3 由 AC-3、AC-6 验证；FR-4 由 AC-5、AC-6、AC-10 验证；BR-1 由 AC-1、AC-7 验证；BR-2 由 AC-2、AC-9 验证；BR-3 由 AC-1、AC-5 验证；BR-4 由 AC-3、AC-4 验证；BR-5 由 AC-2 验证；NFR-1 由 AC-9 验证；NFR-2 由 AC-8 验证；NFR-3 由 AC-9 验证。

## 方案比较与推荐

| 方案 | 状态与调用方影响 | 失败与维护成本 | 结论 |
| --- | --- | --- | --- |
| OpenCreator 全量 TS 重写 | 产品状态自然落入 Creator 架构，但会在 TS 中重复下载、ASR、TTS、字幕和媒体渲染能力 | 媒体实现和跨平台依赖维护面过大 | 不采用 |
| 整条火柴人流水线放入 KrillinAI | OpenCreator 只能把高层流程视作黑盒，或被迫与 KrillinAI 双写阶段、审核和版本 | Go Runtime 被产品语义污染，Agent 与 UI 的逐镜修改、stale 血缘和恢复复杂 | 不采用 |
| Python Sidecar | 最快复用 auto-video，但新增解释器、依赖、跨平台环境和另一套状态账本 | 与“不引入更多语言”和正式打包约束冲突 | 只作为测试基线，不进入产品 |
| OpenCreator Creator 编排 + 专用 TS Executor + KrillinAI + Remotion Worker | CreatorJob 保持唯一状态源，媒体能力通过现有 Runtime 边界复用，Remotion 使用原生 Node 生态 | 需要补充镜头级 StageRun 和 Provider 请求安全，但边界可测试、可恢复 | 推荐 |

## 关键设计决策

| DEC ID | 决策 | 理由 | 约束范围 |
| --- | --- | --- | --- |
| DEC-1 | 保留模板 ID `stickman-video`，当前 Registry 只注册单一 `version: 2` 生产定义并删除旧 `@1` 定义；旧数据定向删除，不保留 Legacy 模块或并行注册版本 | 仍满足“只有一个版本”，同时让旧代码的 Registry 无法识别或运行新 `@2` Job，避免代码回滚后用 Demo 语义打开生产数据 | TemplateRegistry、数据库迁移、Web 路由、结果打开逻辑、回滚 |
| DEC-2 | CreatorService 是业务状态唯一权威；OpenCreator TS 承担内容、审核、时间线和交付，KrillinAI 承担通用媒体能力，Remotion 在隔离 Node Worker 中渲染 | 复用新 Creator 架构和既有媒体 Runtime，同时保持产品语义在 OpenCreator | Daemon、Krillin 协议、渲染、UI、Agent |
| DEC-3 | 审核使用 `needs_input` 和显式 CreatorAction；大内容存为 Artifact，Job State 只保存设置、选择和审核状态；结果版本由 ResultSnapshot 派生 | 避免假 Stage、前端双状态和大对象状态漂移，支持重启恢复与 Agent 协作 | Template、Workflow Controller、CreatorSession、Artifact |
| DEC-4 | 为昂贵的动态项目执行引入 `scopeKey` 与 `inputFingerprint`；Provider 请求在提交前持久化请求身份，在远端状态未知时阻止自动重试 | 支持单镜头重生成、部分成功、精确 stale 和计费安全 | StageRun、ImageExecutor、Provider Ledger、恢复逻辑 |
| DEC-5 | P0 固定五项交付合同；Remotion、Chromium、字体、角色素材和 KrillinAI 进入正式资源 Manifest 与实际打包 App 校验 | 防止目标漂移、运行时安装和不可复现资源；满足 Desktop 发布门禁 | Delivery、资源打包、Desktop E2E、发布 |

## 详细设计

### 模块边界

直接替换现有 `templates/stickman-video.ts`、`creator/stickman/*` 和 `StickmanVideoWorkspace.tsx` 的业务实现，不创建 Legacy 目录。新增 `stickman-video-actions.ts` 作为模板专属 Workflow Controller；它与视频翻译工作流保持同一调用模式，负责自动推进、配置门、审核门、幂等排队、`reconcile` 和 `recover`。

执行所有权固定如下：

| 能力 | 执行者 | 主要输入 | 主要输出 |
| --- | --- | --- | --- |
| 来源获取 | OpenCreator DownloadExecutor | YouTube URL | `source_video` |
| 来源转录 | KrillinAI subtitle | `source_video` | `source_subtitle` |
| 摘要、计划、脚本、分镜规格 | TS LLM Executor | 上游文本 Artifact、用户创作设置 | `source_brief`、`content_plan`、`script_manifest`、`shot_spec` |
| 分镜图片、封面候选 | OpenCreator ImageExecutor | `shot_spec`、`character_reference`、Prompt、Provider 设置 | `shot_image`、`cover_image` |
| 配音 | KrillinAI tts | 已批准脚本或字幕 | `narration_audio` |
| 图片和媒体技术校验 | TS + `sharp`、按需 Tesseract、FFprobe | 图片、音视频 Artifact | 校验元数据或失败 |
| 时间线 | TS Timeline Executor | 已批准镜头、图片、音频 | `timeline_manifest` |
| 纯净视频 | Remotion Node Worker | `timeline_manifest` 和受信 Artifact | `clean_video` |
| 双语字幕与视频 | KrillinAI subtitle/render-horizontal | `clean_video`、语言和字幕设置 | `bilingual_subtitle`、`bilingual_video` |
| 发布和交付 | TS Delivery Executor | 结果 Artifact、脚本、内容计划 | `publish_copy`、`delivery_manifest` 和五项交付文件 |

KrillinAI 协议不得增加火柴人产品级 Stage。若现有媒体能力缺失，只允许增加可被其他模板复用的通用媒体能力，并同步 TS 类型、JSON Schema、Go DTO 和合同测试。

### 阶段与审核数据流

执行 DAG 为：

```text
acquire-source
→ source-transcript
→ source-brief
→ content-plan
→ script
→ [approve-script]
→ storyboard
→ [approve-storyboard]
→ images ─────┐
→ narration ──┤
              ▼
       visual-validation
              ↓
           timeline
              ↓
        render-clean
       ↙      ↓       ↘
   cover   subtitles   publish-copy
              ↓
      bilingual-render
       ↘      ↓       ↙
      package-validation
```

`approve-script` 和 `approve-storyboard` 是 Action，不注册无执行内容的假 Stage。对应上游 Stage 成功后，Workflow Controller 将 Job 切换为 `needs_input` 并持久化审核对象、来源 Artifact 和 revision；只有针对当前 revision 与当前 Artifact 的批准才能继续。

CreatorAction 至少包括：`update-settings`、`approve-script`、`edit-shot`、`approve-storyboard`、`regenerate-shot`、`approve-visuals`、`run-stage`、`commit-version`、`retry-stage`、`resolve-provider-request` 和 `undo-action`。每个 Action 使用显式 Zod Schema，不使用无边界通用 Record 代替业务合同。

### Job State、Artifact 与结果版本

Job State 只保存来源 URL、角色/参考图选择、创作偏好、语言与配音设置、BGM 设置、当前 UI 步骤、审核状态、当前结果选择和必要的 Artifact ID。脚本、分镜、时间线、字幕、媒体和发布文本都存为 Artifact。

核心 Artifact 包括：`source_video`、`source_subtitle`、`source_brief`、`content_plan`、`script_manifest`、`shot_spec`、`character_reference`、`shot_image`、`narration_audio`、`timeline_manifest`、`clean_video`、`bilingual_subtitle`、`bilingual_video`、`cover_image`、`publish_copy` 和 `delivery_manifest`。

每个 Artifact 必须保存版本、SHA-256、来源 Artifact ID、作用域、模板与模型配置快照，以及媒体适用的 MIME、尺寸、时长等技术证据。ResultSnapshot 只从已登记 Artifact 生成，允许历史结果继续查看；上游变化后旧结果保留为 `stale`，不得作为新运行输入静默复用。

### 镜头级执行与失效

CreatorStageRun 增加可选 `scopeKey` 和 `inputFingerprint`。图片阶段按镜头创建独立 StageRun，例如 `stageId=images`、`scopeKey=shot-07`，指纹覆盖镜头 Prompt、角色参考、风格、模型和所有直接输入 Artifact 哈希。同一 `stageId + scopeKey + inputFingerprint` 只能存在一个活动执行。

修改 `shot-07` 只使该镜头图片以及依赖它的视觉校验、时间线、视频和交付结果失效；其他镜头图片保持 `completed`。Workflow Controller 在进入聚合阶段前校验已批准 Storyboard 中每个 shot 都有匹配当前指纹的成功 Artifact。

### Provider 请求安全

对计费 Provider 持久化请求账本，最少包含 provider、stageRunId、scopeKey、requestKey、requestHash、remoteTaskId、billingSideEffect、status 和 resultArtifactId。流程必须先登记稳定请求身份，再提交远端，再登记 Remote ID，最后登记结果 Artifact。

恢复时优先按 Remote ID 查询；没有 Remote ID 时只有 Provider 明确支持 requestKey 查询才可自动恢复。无法判断远端是否已接受的请求进入 `needs_input`，不得默认再次提交。已经成功的其他镜头 Artifact 不因单项失败而删除或覆盖。

未知计费请求只能通过 `resolve-provider-request` 处置，其 Zod 合同固定为请求账本 ID、当前 revision 和以下一种决策：

| 决策 | 行为 |
| --- | --- |
| `query` | 仅当 Provider 声明支持 Remote ID 或 requestKey 查询时继续查询原请求；不创建新计费请求 |
| `confirm-resubmit` | 只允许用户角色提交，并要求 `acceptDuplicateBilling: true`；原账本标记为 `abandoned_unknown`，新请求使用新的 generation、requestKey 并记录 `resubmissionOf` |
| `cancel-scope` | 将未知请求和对应镜头执行标记为已取消，不生成假 Artifact；必需镜头仍阻止聚合，用户需编辑或移除该镜头后继续 |

普通 `retry-stage` 必须拒绝存在 `unknown_remote_acceptance` 的计费请求。每次处置写入 Creator Activity，记录 actor、账本 ID、决策和 revision，但不得记录凭证；Agent 可以建议处置，不能代替用户执行 `confirm-resubmit`。

### 前端和 Agent

现有 Demo 的步骤布局、角色选择视觉、分镜弹窗、配音设置、结果页和版本菜单可以继续使用，但所有数据改由 CreatorSession 提供。表单通过 `updateDraft` 持久化，执行通过 CreatorAction 发起，进度由 StageRun 事件驱动，分镜由 `shot_spec` 与 `shot_image` 渲染，结果菜单由 ResultSnapshot 派生。

删除前端的硬编码 `storyboardShots`、本地 `resultVersions`、`storyboardReady`、`videoReady` 和调用后立即成功的逻辑。工作台和 Agent 对同一 Job 使用 `expectedRevision`；冲突时拒绝旧 revision，重新加载后再提交，不覆盖另一入口的较新修改。

火柴人必须复用唯一 `CreatorCollaborationPanel`，不得创建独立 Agent Panel。`creator-panel-adapters.ts` 新增 `stickmanVideoPanelAdapter` 并由 `creatorPanelAdapterFor('stickman-video')` 选择；Adapter 负责全部 P0 Stage 和 Phase 的中英文文案、`approve-script`、`edit-shot`、`approve-storyboard`、`regenerate-shot`、`approve-visuals`、`resolve-provider-request` 等 Activity 语义、无意义草稿 Activity 过滤，以及连续同阶段/同镜头更新的合并去重。

镜头级进度只读取 CreatorStageRun 的标准字段 `phase/percent/message/completed/failed/total/scopeKey`，不得读取执行器私有 Payload。协作面板必须展示真实镜头完成数、失败数和总数，并把脚本审核、分镜审核、渲染、字幕和交付映射为可识别阶段。

### Remotion Worker

Remotion 使用固定版本 `@remotion/bundler` 与 `@remotion/renderer`，由 Daemon 启动隔离 Node 子进程。Worker 只接收受信时间线、Artifact 路径和当前 Stage 工作目录；崩溃只使当前 StageRun 失败。运行时不得执行 `npm install` 或下载不受控 Chromium。

模板、Chromium、字体、角色和固定素材进入 Desktop 资源 Manifest，逐文件记录版本和 SHA-256。输出必须位于当前 Stage 工作目录，完成技术校验后才能登记 `clean_video` Artifact。

## 异常、兼容、迁移与回滚

### 状态和恢复

StageRun 使用 `queued/running/succeeded/failed/interrupted`；配置、审核或远端未知状态通过 Job `needs_input` 表达。Daemon 重启时未结束 StageRun 转为 `interrupted`，Workflow Controller 依据已完成 Artifact、输入指纹、请求账本和父 StageRun 幂等键恢复。成功且指纹未变化的阶段不重跑；Stage 成功但后续排队中断时由 `reconcile` 补排。

用户取消时终止 Remotion、FFmpeg、KrillinAI 和其他子进程树；未通过最终校验的临时文件不登记 Artifact。日志和进度不得输出 API Key、Token、完整 Provider 请求或其他凭证。

### Demo 数据迁移

一次性数据库迁移在事务内定向识别 `template_id='stickman-video' AND template_version=1` 的旧 Job，删除其 StageRun、Artifact、Activity、Agent 关联记录和 Job，并写入迁移标记。事务提交后，只允许在经过根目录约束和路径越界检查后删除这些 Job 的 Creator 文件目录。其他模板数据、`stickman-video@2` Job 和项目文件不得修改。

不提供旧 Demo 数据恢复、Legacy 页面或旧执行器。旧 Demo 主要结果原本是前端内存状态，设计不建立无事实依据的兼容层。

### 发布和回滚

开发只在 `feat-stick-video` 进行，首次有效提交后推送远端。合并前同步最新 `origin/main`，解决 Creator 架构相关冲突并重新执行直接受影响门禁。所有门禁通过前不合并主分支。

发布前可以通过不合并或回滚分支提交撤回功能；数据库清理一旦在用户环境执行，代码回滚不会恢复旧 Demo Job。该不可逆性是用户已确认“不保留兼容模式”的直接结果，发布说明必须明确。新生产任务固定为 `stickman-video@2`，旧代码只注册 `@1`，因此必须以 `Unknown creator template: stickman-video@2` 拒绝打开、修改或运行新任务，不能回退到 latest 或按模板 ID 猜测解释。

## 验收标准

| AC ID | 关联需求 | 前置条件 | 操作 | 可观察结果 | 验证层级 |
| --- | --- | --- | --- | --- | --- |
| AC-1 | FR-1、BR-1、BR-3 | 使用新代码、旧代码 Registry 和清洁测试库 | 枚举模板、创建新任务、打开火柴人页面，并尝试用旧 Registry 加载新 Job | 新 Registry 只枚举 `stickman-video@2`；无硬编码分镜、本地结果版本或旧执行器；旧 Registry 明确拒绝加载、修改和运行 `@2` Job | 静态检查 + 单元测试 |
| AC-2 | FR-2、BR-2、BR-5 | 配置真实生产 Provider、KrillinAI 和固定短 YouTube 输入 | 完成脚本与分镜审核并等待流水线结束 | 产生可播放纯净视频、1280x720 封面、发布文案、可播放双语视频和合法双语 SRT；Delivery Manifest 的路径、哈希和技术参数全部匹配 | 真实流水线 E2E |
| AC-3 | FR-3、BR-4 | 已完成含多个镜头的结果版本 | 修改一个镜头并重生成 | 只产生该镜头的新 StageRun/Artifact，其他镜头保持有效；时间线、视频和交付被精确标记 stale 后生成新版本 | Service 集成测试 |
| AC-4 | BR-4 | Fake Provider 支持故障注入和可配置查询能力 | 在远端接受请求后、Remote ID 持久化前模拟崩溃；分别执行查询、普通重试、用户确认重提交和取消作用域 | 可查询时恢复原任务；不可查询时普通 `retry-stage` 被拒绝；只有用户提交 `acceptDuplicateBilling: true` 才创建新 generation；取消不产生假 Artifact 且保留审计 Activity | Provider 故障注入测试 |
| AC-5 | FR-4、BR-3 | 流水线分别处于运行、审核和完成状态 | 刷新页面并重启 Daemon | Job、阶段、进度、审核对象、ResultSnapshot 和可打开 Artifact 完整恢复；中断阶段可安全继续 | API + 浏览器 E2E |
| AC-6 | FR-3、FR-4 | 工作台和 Agent 同时打开同一 Job | 工作台先修改，Agent 再使用旧 revision 提交；随后 Agent 刷新并修改镜头 | 旧 revision 返回可识别冲突且不覆盖新数据；刷新后双方看到相同 Job 和 Artifact | Service + Agent 集成测试 |
| AC-7 | FR-1、BR-1 | 数据库含旧 `stickman-video@1` Demo Job、新 `@2` Job 和其他模板 Job | 执行升级迁移 | 仅旧 `@1` Job 及关联数据被定向删除，新 `@2` 和其他 Creator Job、Artifact、文件保持不变；重复迁移无副作用 | 数据迁移测试 |
| AC-8 | NFR-2 | 同一 Fake Daemon、Job、偏好和内容视口，以及实际 Desktop App | 执行项目规定的完整 Web/Desktop 一致性套件，并在两端完成审核、单镜头重生成、协作面板查看和结果查看 | 首页、项目选择、设置、输入区、文件工作区及火柴人通用文案、按钮、状态、关键尺寸、CreatorAction、Runtime API、持久化和交付结果一致；Desktop 原生入口仍按 capability 工作 | Web/Desktop 一致性 E2E + 实际 App E2E |
| AC-9 | BR-2、NFR-1、NFR-3 | 当前工作区准备正式 Desktop 打包，允许工作区 dirty 状态被如实记录 | 运行正式打包链路、资源合同校验和实际 App 火柴人 E2E | 打包前重新构建当前 `apps/web/dist`；构建清单记录 commit、dirty、Web 构建标识或哈希、平台、架构和时间；App 内嵌 Web 与本次 dist 的完整文件列表和逐文件哈希完全一致；Remotion、Chromium、字体、素材和 KrillinAI Manifest 有效；Daemon、Stickman Runtime 和 `app.asar` 无 Python Runtime，Creator Runtime 仅允许受独立 Manifest/哈希合同约束的便携 Python `yt-dlp`；任一不一致均阻止交付 | 构建清单 + 完整哈希比较报告 + 打包合同 + 实际 App E2E |
| AC-10 | FR-4 | Job 含工作台、Agent、镜头进度和各类火柴人 Activity | 在唯一 CreatorCollaborationPanel 中执行设置修改、审核、镜头重生成、失败重试和 Provider 处置 | `stickmanVideoPanelAdapter` 提供全部 P0 Stage/Phase 文案，过滤无意义 Activity，合并连续同阶段/同镜头更新，展示标准字段产生的真实 completed/failed/total；未创建独立 Panel，也未读取执行器私有字段 | Adapter 单元测试 + Panel 组件测试 |

## 测试策略

- 单元层验证 Zod Action/Artifact 合同、时间线、指纹、作用域、血缘失效、Delivery Manifest 和路径约束。
- Service 集成层使用临时 SQLite 和文件目录验证 revision、审核门、镜头级 StageRun、部分成功、恢复、取消、迁移和 ResultSnapshot。
- Provider 层使用 Fake LLM、Fake Image Provider、Fake KrillinAI 验证幂等、未知提交状态、超时、Remote ID 恢复、配置缺失和错误映射；真实 Provider 测试只使用受控短输入并避免无界计费。
- 前端层验证页面只消费 CreatorSession、StageRun 和 Artifact，运行中不提前显示成功，刷新和冲突后能够恢复；不以硬编码媒体或本地版本冒充结果。
- 协作层验证 `stickmanVideoPanelAdapter` 的 Stage/Phase 文案、Action Activity、过滤去重、镜头级真实进度和唯一 `CreatorCollaborationPanel` 选择逻辑。
- 真实边界使用一条固定短视频验证 KrillinAI、Remotion、字幕、双语烧录和五项交付合同。
- 发布层执行项目完整 Web/Desktop 一致性套件、当前工作区 Web 新鲜构建、构建清单字段校验、`apps/web/dist` 与 App 内嵌资源的完整文件列表和逐文件哈希比较、实际打包 App E2E、Creator Runtime 与 Remotion 资源校验，以及安装包 Python Runtime 扫描。

## 风险与未决问题

| 风险 | 处理 |
| --- | --- |
| Remotion Chromium 和字体增大安装包并存在跨平台差异 | 固定版本和资源哈希，逐平台运行实际打包 App；未通过平台不得发布 |
| 图片 Provider 缺少服务端幂等查询 | 正式流水线阻止未知状态自动重试，通过 `needs_input` 显式处理 |
| 镜头级 StageRun 扩展影响共享 Creator 核心 | 字段设计为可选，只改变火柴人及明确使用 scope 的执行路径；共享回归由 Creator Service 定向测试覆盖 |
| 旧 Demo 数据清理不可逆 | 定向事务、路径守卫和迁移测试；发布说明明确不兼容决定 |
| auto-video 当前测试没有完整真实整链覆盖 | 使用黄金输入输出和新 Fake/真实 E2E 建立新的可执行证据，不把旧单元测试通过视为迁移完成 |

未决问题：无。

## 独立审核记录

Reviewer 原始结论：`REVISE`。

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
| --- | --- | --- | --- | --- | --- |
| R-01 | Major | 采纳。当前唯一注册模板改为 `stickman-video@2`，删除 `@1` 注册；旧数据只清理 `@1`；旧代码必须拒绝 `@2` | BR-1、DEC-1、Demo 数据迁移、发布和回滚、AC-1、AC-7 | 关闭条件要求统一身份隔离并证明旧 Registry 无法操作新 Job；AC-1 明确用旧 Registry 验证拒绝，AC-7 验证版本定向迁移 | 数值版本由 1 改为 2，但 Registry 中仍只有一个当前版本，符合用户“只有一个版本”要求 |
| R-02 | Major | 采纳。增加 `resolve-provider-request` 及 query、confirm-resubmit、cancel-scope 三种决策；普通重试拒绝未知计费状态 | CreatorAction、Provider 请求安全、AC-4 | 关闭条件要求状态转换、Action、审计和三类恢复路径；对应合同与 AC-4 已逐项补齐 | 用户确认重提交仍可能产生重复计费，但必须明确勾选并有 Activity 审计 |
| R-03 | Major | 采纳。复用唯一协作面板并新增火柴人语义 Adapter，覆盖 Stage/Phase、Activity、去重和标准镜头进度 | 前端和 Agent、AC-10、测试策略 | 关闭条件要求 Adapter 责任和测试；AC-10 同时验证 Adapter、Activity、进度和无独立 Panel | 多阶段文案需要在实现时保持中英文同步，由 Adapter 测试约束 |
| R-04 | Major | 采纳。补充新鲜 Web 构建、完整构建清单、dist 与 App 内嵌目录的文件列表和逐文件哈希门禁 | NFR-3、AC-8、AC-9、测试策略 | 关闭条件要求完整一致性套件和可判定打包证据；AC-8/AC-9 已列出全部项目门禁和失败语义 | 实际打包成本较高，但属于发布前强制门禁，不能降级 |

全部 Major 均已按 Reviewer 的可验证关闭条件修订，流程结论记录为 `PASS`；Reviewer 原始结论保持 `REVISE`，本版本不启动第二次 Reviewer。
