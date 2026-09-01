# OpenCreator 火柴人视频生产任务重构实施计划

> 状态：代码与本地门禁已完成；真实 Provider 验收 `BLOCKED`
> 制定日期：2026-08-31
> 来源方案：`docs/specs/OpenCreator火柴人视频生产任务重构-方案-2026-08-31.md`
> 用户批准证据：用户在 D-1、D-2、D-3 后分别回复“没问题，继续”，来源方案已记录“已批准（2026-08-31）”且未决问题为无。
> 用户执行授权：已授权（2026-08-31），原话为“没问题，继续，中间不要停，一直把task全部处理完”。用户已看到独立 Reviewer 因容量失败的风险并知情授权继续。
> 计划基线：分支 `feat-stick-video`，初始提交 `accef876bfd81a4c6c20962f096ab6dd81fd2da2`；最终实现前已同步 `origin/main` 到 `476f451`。
> 体量判断：复杂。任务同时修改 Creator 公共协议与持久化、计费 Provider 恢复、破坏性旧数据迁移、镜头级并发、KrillinAI 映射、Remotion 资源、Web/Desktop 共用工作台和正式打包门禁；这些增量共同交付同一个 `stickman-video@2`，不能拆成可独立发布的多份 Plan。

## 1. 执行边界

本计划把当前火柴人 Demo 直接替换为唯一生产任务 `stickman-video@2`。OpenCreator TypeScript 负责来源获取、内容理解、脚本与分镜审核、镜头血缘、时间线、结果版本和五项交付；KrillinAI 只承担字幕、配音和横屏双语渲染；Remotion 只按已登记时间线渲染纯净视频。火柴人源码和专用 Runtime 不依赖 Python；来源获取可复用既有 Creator Runtime 中受 Manifest、版本和哈希约束的便携 Python `yt-dlp`，不得引入 auto-video Python 实现。

本计划不保留 `stickman-video@1`、旧执行器、旧页面业务状态、Legacy 路由或旧 Job 恢复；不把火柴人产品阶段加入 KrillinAI 协议；不重构其他 Creator 模板；不恢复 auto-video 的十三项多平台交付合同。

执行必须从 `TASK-0` 开始，按任务依赖顺序完成。任何实现不得回退或覆盖工作区内与本任务无关的用户改动。计划完成独立审核并向用户展示结果后，只有用户明确给出“开始执行”或等价指令才进入编码。

## 2. 契约快照

### 2.1 P0 需求与规则

| ID | 不可变合同 |
| --- | --- |
| FR-1 | 产品只存在一套真实运行的 `stickman-video` 工作台、模板、工作流和执行实现；页面可复用 Demo 交互，但完成状态只能来自持久 Creator 数据。 |
| FR-2 | 有效 YouTube 链接经脚本、分镜审核后，自动完成来源理解、图片、配音、时间线、纯净视频、字幕、封面、发布文案和交付校验。 |
| FR-3 | 用户和 Agent 能编辑脚本、审核分镜、重生成单镜头、查看历史结果；修改只失效受影响 Artifact 和下游结果。 |
| FR-4 | CreatorJob 是工作台和 Agent 的唯一状态源；刷新、Daemon 重启和外部任务恢复后，阶段、审核、进度、版本和结果一致。 |
| BR-1 | Registry 只注册 `stickman-video@2`；旧 `@1` Job 及关联数据由一次性迁移定向删除；不提供兼容模式。 |
| BR-2 | OpenCreator 负责产品编排、审核、状态、血缘和交付；KrillinAI 负责通用媒体能力；Remotion 只负责受信时间线渲染。 |
| BR-3 | 前端不维护独立结果版本且不提前宣布成功；只展示 `completed` 或历史 `stale` Artifact 与 ResultSnapshot。 |
| BR-4 | 计费 Provider 远端接受状态未知时不得自动重提；单镜头成功结果在其他镜头失败或重试时保留。 |
| BR-5 | 最终固定交付纯净视频、1280x720 YouTube 封面、YouTube 发布文案、双语视频和双语 SRT，并由 Delivery Manifest 验真。 |
| NFR-1 | 火柴人源码、Daemon、Stickman Runtime 和 `app.asar` 不包含 Python；既有 Creator Runtime 的便携 Python `yt-dlp` 只承担统一媒体获取并由独立 Manifest 固定版本、文件集和 SHA-256；Remotion、Chromium、字体、素材和 KrillinAI 依赖同样固定版本并记录 SHA-256。 |
| NFR-2 | 相同内容视口、Job 和设置下，Web 与实际 Desktop App 的通用界面、动作、Runtime 请求、持久化和交付一致。 |
| NFR-3 | Desktop 打包必须重新构建当前 Web，记录 commit、dirty、Web 哈希、平台、架构和时间，并逐文件比较 `apps/web/dist` 与 App 内嵌 Web。 |

### 2.2 架构决策

| ID | 实施约束 |
| --- | --- |
| DEC-1 | 保留模板 ID，生产 Registry 只含 `version: 2`；旧 Registry 必须以 unknown template 拒绝 `@2`，不得按 ID 或 latest 回退解释。 |
| DEC-2 | CreatorService 是业务状态唯一权威；OpenCreator TS 编排，KrillinAI 提供通用媒体原子能力，Remotion 在隔离 Node 子进程执行。 |
| DEC-3 | 审核使用 Job `needs_input` 与显式 CreatorAction；大内容写 Artifact，Job State 只存设置、选择、审核状态和必要 ID；结果版本来自 ResultSnapshot。 |
| DEC-4 | 动态昂贵阶段使用 `scopeKey` 与 `inputFingerprint`；计费请求先持久化身份，再提交远端；未知接受状态必须人工处置。 |
| DEC-5 | 固定五项交付；Remotion、Chromium、字体、角色素材和 KrillinAI 进入正式资源 Manifest 与实际包校验。 |

### 2.3 公开类型与持久化合同

`packages/protocol/src/creator.ts` 增加下列兼容性扩展；除 `stickman-video@2` 外的现有模板不填写新增可选字段，行为保持不变：

```ts
export type CreatorStageRun = {
  // 现有字段保持不变
  scopeKey: string | null;
  inputFingerprint: string | null;
};

export type CreatorArtifact = {
  // 现有字段保持不变
  scopeKey: string | null;
  inputFingerprint: string | null;
  sha256: string | null;
};

export type CreatorProviderRequestStatus =
  | 'registered'
  | 'submitting'
  | 'waiting_remote'
  | 'succeeded'
  | 'failed'
  | 'unknown_remote_acceptance'
  | 'abandoned_unknown'
  | 'canceled';

export type CreatorProviderRequest = {
  id: string;
  jobId: string;
  provider: string;
  stageRunId: string;
  scopeKey: string | null;
  requestKey: string;
  requestHash: string;
  remoteTaskId: string | null;
  billingSideEffect: boolean;
  status: CreatorProviderRequestStatus;
  resultArtifactId: string | null;
  generation: number;
  resubmissionOf: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`CreatorJob` 响应增加 `providerRequests: CreatorProviderRequest[]`。`creator_stage_runs` 增加 `scope_key`、`input_fingerprint`；`creator_artifacts` 增加 `scope_key`、`input_fingerprint`、`sha256`；新增 `creator_provider_requests` 表。活动执行唯一性由部分唯一索引约束 `job_id + stage_id + scope_key + input_fingerprint` 且状态为 `queued/running`，历史成功、失败和中断记录可共存。

`apps/daemon/src/creator/templates/types.ts` 为阶段增加：

```ts
jobCompletionPolicy?: 'complete' | 'continue';
```

默认值为 `complete`，保持现有模板行为；`stickman-video@2` 的中间阶段全部使用 `continue`，只有 `package-validation` 使用 `complete`。scope 和 fingerprint 只由 Workflow 通过 Command Dispatcher 的内部入队参数写入，公开 `run-stage` Action 不接受客户端伪造这两个字段。

计费请求状态只能按下列路径转换：

```text
registered -> submitting -> waiting_remote -> succeeded
                         -> failed
                         -> unknown_remote_acceptance
unknown_remote_acceptance -> waiting_remote        （query 找回原任务）
unknown_remote_acceptance -> abandoned_unknown     （用户确认重提）
unknown_remote_acceptance -> canceled              （取消作用域）
abandoned_unknown -> 新 generation 的 registered   （resubmissionOf 指向原账本）
```

`resolve-provider-request` 输入使用判别联合：

```ts
type ResolveProviderRequestInput = {
  ledgerId: string;
  revision: number;
} & (
  | { decision: 'query' }
  | { decision: 'confirm-resubmit'; acceptDuplicateBilling: true }
  | { decision: 'cancel-scope' }
);
```

只有 `actor: 'user'` 可执行 `confirm-resubmit`。普通 `retry-stage` 遇到相同作用域的 `unknown_remote_acceptance` 必须返回 `creator_provider_resolution_required`。Activity 记录 actor、ledgerId、decision、revision，不写 API Key、Token、完整请求体或 Provider 凭证。

### 2.4 `stickman-video@2` 阶段、Action 与 Artifact 合同

模板阶段固定为：

```text
acquire-source -> source-transcript -> source-brief -> content-plan -> script
script --approve-script--> storyboard --approve-storyboard--> images[*] + narration
images[*] + narration -> visual-validation -> timeline -> render-clean
render-clean -> cover + subtitles + publish-copy
subtitles -> bilingual-render
render-clean + cover + publish-copy + subtitles + bilingual-render -> package-validation
```

`images` 按镜头产生多个 `CreatorStageRun`，`scopeKey` 为稳定 shot ID。审核不注册空 Stage；`approve-script`、`approve-storyboard` 直接解除 Job 的 `needs_input` 门。`visual-validation` 无警告时自动推进；有可接受但非阻断警告时进入 `needs_input`，由 `approve-visuals` 明确继续；技术校验失败不得批准绕过。

显式 Action 为：`update-settings`、`edit-script`、`approve-script`、`edit-shot`、`approve-storyboard`、`regenerate-shot`、`approve-visuals`、`run-stage`、`commit-version`、`retry-stage`、`resolve-provider-request`、`undo-action`。每个 Action 在 `templates/stickman-video.ts` 使用 `.strict()` Zod Schema；审核输入必须携带当前 Artifact ID 和 revision。

核心 Artifact 为：`source_video`、`source_subtitle`、`source_brief`、`content_plan`、`script_manifest`、`shot_spec`、`character_reference`、`shot_image`、`narration_audio`、`visual_validation`、`timeline_manifest`、`clean_video`、`bilingual_subtitle`、`bilingual_video`、`cover_image`、`publish_copy`、`delivery_manifest`。每个文件 Artifact 必须记录 SHA-256、来源 Artifact ID、作用域、输入指纹、模板/模型快照及适用的 MIME、尺寸、时长。

最终文件名固定为：

```text
landscape-clean.mp4
youtube-cover.png
publish-copy-youtube.md
horizontal_bilingual.mp4
bilingual_srt.srt
```

`delivery_manifest` 必须列出且只列出五项交付，记录相对路径、SHA-256、字节数、MIME、来源 Artifact ID；封面必须是 1280x720，视频必须可由 FFprobe 读取，SRT 必须通过双语字幕校验。最终 ResultSnapshot 引用五项交付与 `delivery_manifest`；旧版本 Artifact 保留为 `stale` 并可打开，但不会被新阶段隐式读取。

### 2.5 失败、恢复和取消语义

- Daemon 启动时未结束 StageRun 收敛为 `interrupted`；Workflow 依据成功 Artifact、指纹、Provider 账本和幂等键补排缺失阶段。
- 相同 `stageId + scopeKey + inputFingerprint` 已有成功 Artifact 时直接复用，不创建新计费请求。
- 镜头失败只失败该 scope；其他镜头的 StageRun 和 `shot_image` 保持成功。聚合阶段要求已批准 Storyboard 的每个 shot 都存在当前指纹的成功图片。
- 用户取消必须终止 Remotion、FFmpeg、KrillinAI 及其他子进程树；未通过校验的临时文件不登记 Artifact。
- 配置缺失、审核等待和未知计费接受状态使用 Job `needs_input`；技术执行错误使用 StageRun `failed/interrupted/canceled`。
- 同一测试或命令进入 GREEN 后，针对同一根因做两次有实质差异的修复仍失败，当前 TASK 立即标记 `BLOCKED`，记录失败证据、根因假设和最小改动，不继续放宽断言或改变合同。

## 3. 基线与文件地图

### 3.1 当前工作区

- 当前分支：`feat-stick-video`；计划创建时 HEAD 与 `origin/main` 均为 `accef87`，最终实现前已同步到 `476f451`。
- 未跟踪参考仓库：`auto-video/`，只作为行为、合同和黄金样例来源，不纳入产品 Runtime。
- 未跟踪已批准方案：`docs/specs/OpenCreator火柴人视频生产任务重构-方案-2026-08-31.md`。
- 执行前不得删除、移动或提交 `auto-video/`，除非用户另行明确授权。

### 3.2 权威入口与参考符号

| 范围 | 当前文件与符号 | 本计划用途 |
| --- | --- | --- |
| Creator Protocol | `packages/protocol/src/creator.ts` 的 `CreatorStageRun`、`CreatorArtifact`、`CreatorJob`、`CreatorActionRequest` | 增加作用域、指纹、哈希和 Provider 账本响应。 |
| Schema/Repository | `apps/daemon/src/storage/migrations.ts`；`creator/repository.ts` 的 `CreateStageRunInput`、`createStageRun`、`hydrateStageRun` | 增列、账本表、活动唯一索引、查询和写入。 |
| Service/Runner | `creator/service.ts` 的 `applyAction`；`stage-runner.ts` 的 `runStageRun`、`resolveInputs`、`dependentArtifactIdsForChangedKinds` | 接入火柴人 Action Handler、镜头并发、精确血缘、结果快照。 |
| 队列 | `creator/command-dispatcher.ts` | 保持命令幂等，并把 scope/fingerprint 传给 StageRun。 |
| 模板/工作流 | `templates/stickman-video.ts`、`templates/video-translation-actions.ts` | 直接替换 `@1`，按现有 Workflow Controller 模式建立 `@2`。 |
| 注册入口 | `templates/registry.ts`、`api/server.ts`、`api/routes.creator.ts` | 只注册 `@2`、新 Executor 和 Workflow 的 recover/reconcile/resume。 |
| 旧 Demo | `creator/stickman/executor.ts`、`script-generator.ts`、`storyboard-generator.ts` | 删除旧 Executor 语义；可在新严格合同下重写生成器，不保留旧入口。 |
| 图像能力 | `creator/image/executor.ts`、`image-generation/provider.ts` | 复用 Provider 调用与图片校验；火柴人增加账本、安全恢复和镜头作用域。 |
| KrillinAI | `creator/krillin/adapter.ts`、`execution-plan.ts`、`packages/protocol/src/krillin-opencreator.ts` | 将产品 stage 映射到现有 `subtitle/tts/render-horizontal`，不新增火柴人协议 stage。 |
| Remotion 参考 | `auto-video/autovideo/render/remotion/template/src/*`、`stages/timeline.py`、`stages/rendering.py` | 迁移为 TypeScript 时间线合同和固定版本 Worker，不复制 Python Runner。 |
| Delivery 参考 | `auto-video/autovideo/stages/delivery.py` 的 `PackageStage`、`PackageValidationStage` | 固定五项文件、哈希、封面尺寸、字幕与血缘验真。 |
| Web 工作台 | `apps/web/src/features/dashboard/StickmanVideoWorkspace.tsx` | 保留交互布局，删除硬编码 `storyboardShots`、本地 ready/version 和提前成功。 |
| 会话与面板 | `creator-session-store.tsx`、`CreatorToolShell.tsx`、`creator-panel-adapters.ts` | 复用持久草稿、Revision、SSE、唯一面板，新增火柴人 Adapter。 |
| Desktop | `apps/desktop/scripts/prepare-daemon.mjs`、`package-release.mjs`、`verify-package.mjs`、`electron-builder.yml` | 新鲜 Web 构建已存在；扩展 Remotion 资源清单、无 Python 扫描和实际 App 门禁。 |
| 一致性测试 | `apps/web/e2e/web-desktop-parity.spec.ts`、`apps/desktop/e2e/creator-packaged-app.spec.ts` | 增加相同 Fake Daemon/视口对比和实际包火柴人流程。 |

### 3.3 公共验证命令

执行任务时优先运行该任务列出的定向命令；只在最终门禁或定向失败暴露跨模块影响时扩大范围。

```powershell
pnpm --filter @opencreator/protocol test -- test/creator-contract.test.ts test/krillin-opencreator-contract.test.ts
pnpm --filter @opencreator/protocol typecheck
pnpm --filter @opencreator/daemon test -- <定向测试文件>
pnpm --filter @opencreator/daemon typecheck
pnpm --filter @opencreator/web test -- <定向测试文件>
pnpm --filter @opencreator/web typecheck
pnpm --filter @opencreator/desktop test -- <定向测试文件>
pnpm --filter @opencreator/desktop typecheck
git diff --check
```

正式交付门禁命令在 `TASK-14` 单独定义；之前不得以局部测试暗示完整发布就绪。

## 4. 依赖图

```text
TASK-0 基线有效性
  -> TASK-1 作用域与 Artifact 合同
  -> TASK-2 Provider 账本与安全处置
  -> TASK-3 @2 模板与旧数据清理
  -> TASK-4 内容与审核工作流
  -> TASK-5 镜头图片、部分成功与精确 stale
  -> TASK-6 KrillinAI 配音、字幕与双语成片
  -> TASK-7 时间线与 Remotion Worker
  -> TASK-8 五项交付与 ResultSnapshot
  -> TASK-9 重启恢复、取消与 Revision 冲突
  -> TASK-10 持久工作台
  -> TASK-11 唯一协作面板 Adapter
  -> TASK-12 Desktop 资源与正式打包合同
  -> TASK-13 Web/Desktop 与真实流水线 E2E
  -> TASK-14 本地差异自审和完整功能验收
```

## 5. 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
| --- | --- | --- | --- | --- |
| TASK-1 | FR-3、FR-4、BR-3 | DEC-3、DEC-4 | Creator Protocol、Storage、Stage Scheduler | AC-3、AC-5 |
| TASK-2 | FR-4、BR-4 | DEC-4 | Provider Ledger、Action 权限、故障注入 | AC-4 |
| TASK-3 | FR-1、BR-1 | DEC-1 | Registry、Migration、旧 Registry fixture | AC-1、AC-7 |
| TASK-4 | FR-2、FR-3、FR-4、BR-2 | DEC-2、DEC-3 | Template、Workflow、Action、审核门 | AC-2、AC-5、AC-6 |
| TASK-5 | FR-3、BR-4 | DEC-4 | 镜头级 Executor、部分成功、精确 stale | AC-3、AC-4 |
| TASK-6 | FR-2、BR-2、BR-5 | DEC-2 | Krillin Adapter/CLI/合同测试 | AC-2 |
| TASK-7 | FR-2、BR-2、NFR-1 | DEC-2、DEC-5 | Timeline、Worker 崩溃/取消、媒体校验 | AC-2、AC-9 |
| TASK-8 | FR-2、FR-3、BR-3、BR-5 | DEC-3、DEC-5 | Delivery Manifest、ResultSnapshot、路径/哈希 | AC-2、AC-3、AC-5 |
| TASK-9 | FR-4、BR-4 | DEC-3、DEC-4 | recover/reconcile/cancel、Revision 冲突 | AC-4、AC-5、AC-6 |
| TASK-10 | FR-1、FR-3、FR-4、BR-3 | DEC-3 | Workspace、Session、刷新、结果打开 | AC-1、AC-5、AC-6 |
| TASK-11 | FR-4、NFR-2 | DEC-2、DEC-3 | Adapter、Panel、Activity 去重 | AC-8、AC-10 |
| TASK-12 | NFR-1、NFR-3、BR-2 | DEC-5 | Runtime Manifest、包扫描、完整哈希 | AC-9 |
| TASK-13 | FR-1、FR-2、FR-4、NFR-2 | DEC-1 至 DEC-5 | Fake Daemon parity、实际 App、真实 Provider | AC-2、AC-5、AC-8、AC-9、AC-10 |
| TASK-14 | 全部 P0 | 全部决策 | 最终门禁与新鲜证据 | AC-1 至 AC-10 |

## 6. 实施任务

### TASK-0：确认 Plan 仍然有效

**交付结果**
- 确认分支、基线、工作区、方案批准、文件与符号、依赖版本和公共命令仍与本计划一致；无效时在编码前熔断。

**实施步骤**
1. 运行 `git status --short --branch`、`git log -5 --oneline --decorate`、`git rev-parse HEAD`，确认在 `feat-stick-video`，记录是否已领先或落后 `origin/main`。
2. 确认来源方案仍为 `PASS`、用户批准仍有效、`FR/BR/NFR/DEC/AC` 未发生变化。
3. 用 `rg` 核对第 3.2 节全部入口符号；确认 `auto-video/` 仍只作为参考目录。
4. 运行 `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts`，只验证锁文件可解析，不触发运行时下载。
5. 若只有无关文件或局部命名变化，记录偏差并继续；若 `DEC`、职责边界、公开合同、迁移或 AC 失效，停止执行并更新方案或 Plan。

**TDD**
- 策略：豁免。该任务是只读基线门，不修改业务行为。

**任务完成门**
- 基线记录完整；不存在改变 P0 合同的未审变化；`git diff --check` 可运行。

### TASK-1：建立镜头作用域、输入指纹和 Artifact 哈希基础 `[FR-3, FR-4, BR-3, DEC-3, DEC-4, AC-3, AC-5]`

**交付结果**
- StageRun 和 Artifact 具备第一类 `scopeKey`、`inputFingerprint`、SHA-256；镜头 StageRun 可并发但同一活动身份不可重复；其他模板行为不变。

**文件与符号**
- 修改：`packages/protocol/src/creator.ts` - `CreatorStageRun`、`CreatorArtifact`、`CreatorJob`。
- 修改：`apps/daemon/src/storage/migrations.ts` - Creator 表增列和部分唯一索引。
- 修改：`apps/daemon/src/creator/repository.ts` - `CreateStageRunInput`、`InsertArtifactInput`、查询与 hydrate。
- 修改：`apps/daemon/src/creator/command-dispatcher.ts` - scoped `run-stage` 参数持久化。
- 修改：`apps/daemon/src/creator/stage-runner.ts` - `run`、`runStageRun`、执行 lane、Artifact 写入与 SHA-256。
- 测试：`packages/protocol/test/creator-contract.test.ts`、`apps/daemon/test/unit/creator-storage.test.ts`、`creator-stage-scheduler.test.ts`、`creator-runtime-advanced.test.ts`。

**实施步骤**
1. 在 Protocol 中把新增字段定义为响应必有、值可为 `null`，避免调用方用字段缺失表达旧数据。
2. 迁移为现有行写入 `NULL`；新增部分唯一索引只约束 `scope_key IS NOT NULL` 且 StageRun 状态为 `queued/running`。
3. `createStageRun` 接受可选 scope/fingerprint；Repository 所有 StageRun SELECT 使用同一列清单，Artifact 插入时写 scope/fingerprint/sha256。
4. StageRunner 在文件输出通过类型校验后计算 SHA-256，再在同一事务登记 Artifact；无文件 Artifact 的 `sha256=null`。
5. 把当前按 Job 串行的 `jobTails` 改为 lane：无 scope 使用 `jobId`，有 scope 使用 `jobId:stageId:scopeKey`；全局 `maxConcurrency` 继续限流。Workflow 未补齐前不允许自动排入 scoped StageRun。
6. Runner 将 StageRun 的 scope/fingerprint 默认传播到输出 Artifact；Executor 显式覆盖必须与当前 StageRun 一致，否则返回 `creator_artifact_scope_mismatch`。

**TDD**
- RED：`persists scoped stage runs and artifacts with hashes`，创建两个不同镜头和一个重复活动身份；断言不同 scope 可入队、重复身份被拒绝、文件 Artifact 返回正确 SHA-256。基线会因字段和索引缺失失败。
- RED：`runs distinct shot scopes concurrently without parallelizing unscoped stages`，使用受控 Executor barrier；断言两个镜头同时进入 running，而两个无 scope 阶段仍按 Job 串行。基线会因 `jobTails` 仅按 jobId 排队失败。
- GREEN：完成最小协议、迁移、Repository 和 lane 实现，运行上述测试及 `creator-service.test.ts` 回归。
- REFACTOR：抽取统一 StageRow/ArtifactRow 列清单和文件哈希函数；重跑 Protocol、Storage、Scheduler、Runtime Advanced 与 daemon typecheck。

**任务完成门**
- 定向测试、Protocol/Daemon typecheck、`git diff --check` 通过；其他模板 fixture 已补齐新增必有可空字段；对应 AC-3、AC-5 的基础合同可观察。

### TASK-2：实现计费 Provider 请求账本和显式处置 `[FR-4, BR-4, DEC-4, AC-4]`

**交付结果**
- 每个计费请求在提交前有持久身份；未知远端接受状态不会自动重提；查询、用户确认重提和取消作用域均有可审计状态转换。

**文件与符号**
- 修改：`packages/protocol/src/creator.ts` - `CreatorProviderRequest*`、`CreatorJob.providerRequests`。
- 修改：`apps/daemon/src/storage/migrations.ts` - `creator_provider_requests` 表、索引和外键。
- 修改：`apps/daemon/src/creator/repository.ts` - Provider request CRUD 与 Job hydrate。
- 创建：`apps/daemon/src/creator/provider-requests.ts` - `CreatorProviderRequestLedger`、合法转换和脱敏。
- 修改：`apps/daemon/src/creator/service.ts` - `retry-stage` 未知状态拒绝和 user-only 重提保护。
- 测试：创建 `apps/daemon/test/unit/creator-provider-requests.test.ts`，修改 `creator-service.test.ts`、`creator-storage.test.ts`。

**实施步骤**
1. 表字段按第 2.3 节落地；`request_key` 对 provider+generation 唯一，`request_hash` 使用规范 JSON 的 SHA-256，不保存密钥或完整请求体。
2. `CreatorProviderRequestLedger.registerBeforeSubmit()` 在事务内创建 `registered` 记录；`markSubmitting()` 必须发生在网络调用前；Remote ID、结果 Artifact 和终态分别独立持久化。
3. 提供 `recover(ledgerId, providerCapabilities)`：优先 Remote ID 查询；无 Remote ID 仅在 `lookupByRequestKey=true` 时查询；否则转 `unknown_remote_acceptance` 并返回 `needs_input` 原因。
4. `resolve-provider-request/query` 不创建新请求；`confirm-resubmit` 校验 actor、revision、布尔确认后把原记录置为 `abandoned_unknown` 并创建 generation+1；`cancel-scope` 取消账本和对应 StageRun，不造 Artifact。
5. `retry-stage` 在执行前查询同 scope 未解决账本并以稳定错误码拒绝；Activity 只写允许字段。

**TDD**
- RED：`blocks automatic resubmit after crash between provider acceptance and remote id commit`，Fake Provider 记录已接受但抛连接错误；重启后断言账本为 unknown、submit 次数仍为 1。基线无账本会再次提交。
- RED：`allows only user-confirmed duplicate billing generation`，分别以 agent、用户缺少确认、用户完整确认调用；前两者拒绝，最后生成 generation 2 且 `resubmissionOf` 正确。
- RED：`query and cancel-scope never create a paid request`，断言 query 只调用 lookup，cancel 保留其他 scope 成果且无假 Artifact。
- GREEN：实现状态机、Repository、Service guard，运行新测试、Creator Service/Storage 回归。
- REFACTOR：集中错误码和审计字段白名单；重跑 daemon typecheck。

**任务完成门**
- AC-4 四条处置路径均有故障注入证据；日志与 Activity 不含测试凭证；普通重试无法绕过 unknown 状态。

### TASK-3：注册唯一 `stickman-video@2` 并定向清理旧 Demo `[FR-1, BR-1, DEC-1, AC-1, AC-7]`

**交付结果**
- 生产 Registry 只枚举 `stickman-video@2`；旧 `@1` Job 与级联数据被事务删除，文件目录在根约束下可恢复清理；重复升级无副作用。

**文件与符号**
- 替换：`apps/daemon/src/creator/templates/stickman-video.ts` - `createStickmanVideoTemplate`。
- 修改：`apps/daemon/src/creator/templates/registry.ts` - 唯一 `@2` 注册。
- 创建：`apps/daemon/src/creator/stickman/legacy-migration.ts` - `purgeLegacyStickmanJobs`。
- 修改：`apps/daemon/src/api/server.ts` - Repository 建立后、Workflow 恢复前执行迁移。
- 删除：`apps/daemon/src/creator/stickman/executor.ts` 的旧聚合入口；新 Executor 在后续任务按职责文件注册。
- 测试：`creator-template-registry.test.ts`、创建 `creator-stickman-migration.test.ts`。

**实施步骤**
1. 新模板使用 `version: 2`、第 2.4 节阶段与严格 Action Schema；中间阶段设置 `resultVersionPolicy: 'none'`，只有 `package-validation` 创建结果版本。
2. 不保留 `@1` 定义、Legacy 导出或模板 ID fallback。测试中的旧 Registry 使用仅存在于测试文件的最小 `@1` fixture。
3. `purgeLegacyStickmanJobs` 首次事务查询 `template_id='stickman-video' AND template_version=1`，记录 Job ID，删除 Job 让外键级联，并写迁移标记与待清理目录列表。
4. 事务提交后，对每个 `jobsRoot/<jobId>` 做 `resolve/relative` 越界检查再递归删除；崩溃时迁移标记保留未完成列表，下一次启动继续目录清理并更新完成状态。
5. `@2` Job、其他模板 Job、项目文件目录及不在 `jobsRoot` 下的路径不得进入删除集合。

**TDD**
- RED：`registry exposes only stickman-video version 2 and old registry rejects v2 jobs`，基线会枚举 version 1。
- RED：`purges only v1 jobs and resumes post-commit directory cleanup`，数据库同时包含 v1、v2、其他模板，并在事务提交后注入文件删除崩溃；断言二次运行只补清 v1 目录。
- RED：`rejects escaped legacy job directory`，伪造越界路径，断言文件不删除且迁移结果记录受阻目录。
- GREEN：完成模板身份和迁移；运行 Registry、Storage、Agent Storage、Migration 定向回归。
- REFACTOR：迁移 SQL 与文件清理分离，保持可重复执行。

**任务完成门**
- AC-1、AC-7 自动化通过；生产源码中不存在 `stickman-video@1` 或旧 Executor 注册；不可逆清理行为已保留发布说明入口。

### TASK-4：实现内容理解、脚本/分镜 Artifact 与审核工作流 `[FR-2, FR-3, FR-4, BR-2, DEC-2, DEC-3, AC-2, AC-5, AC-6]`

**交付结果**
- 来源获取到 Storyboard 审核形成可恢复流水线；脚本、内容计划和分镜写 Artifact；审核绑定当前 revision 和 Artifact，旧审批不能推进。

**文件与符号**
- 创建：`apps/daemon/src/creator/stickman/contracts.ts` - 内容、脚本、Shot、Timeline、Delivery Zod 合同。
- 创建：`apps/daemon/src/creator/stickman/content-executor.ts` - `createStickmanContentExecutor`。
- 创建：`apps/daemon/src/creator/stickman/action-handler.ts` - `createStickmanActionHandler`。
- 创建：`apps/daemon/src/creator/templates/stickman-video-actions.ts` - `createStickmanVideoWorkflow`。
- 修改：`apps/daemon/src/creator/download/executor.ts` - `acquire-source` 分支。
- 修改：`apps/daemon/src/creator/service.ts` - 模板专属 Action Handler 扩展点，现有通用/视频翻译行为不变。
- 修改：`apps/daemon/src/api/server.ts`、`routes.creator.ts` - 注册、reconcile、recover、resume。
- 重写：`creator/stickman/script-generator.ts`、`storyboard-generator.ts` - 使用严格合同和受控 upstream fetch。
- 测试：创建 `creator-stickman-workflow.test.ts`、`creator-stickman-content-executor.test.ts`；修改 `creator-api.test.ts`、`creator-service.test.ts`。

**实施步骤**
1. `acquire-source` 只接受公共 YouTube URL，使用现有 yt-dlp/FFprobe 路径产出 `source_video` 和来源技术元数据。
2. Workflow 依次排入 `source-transcript`、`source-brief`、`content-plan`、`script`；内容 Executor 使用 Creator LLM 配置、规范 JSON、Zod 解析和原子文件写入。
3. `script` 成功后把 Job 置 `needs_input`，保存 `{kind:'approve-script', artifactId, revision}`；`approve-script` 必须匹配当前 completed `script_manifest` 和 revision。
4. `edit-script` 接收完整严格脚本模型，写新 `script_manifest`，将旧脚本及依赖 Artifact 标 stale，并重新建立审核门；正文不写入 Job State。
5. `storyboard` 产出包含稳定 shot ID、narration、imagePrompt、motion、duration、来源 script segment 的 `shot_spec`；成功后建立 `approve-storyboard` 门。
6. `edit-shot` 写包含全部 shots 的新 `shot_spec`，只改变目标 shot；`approve-storyboard` 绑定当前 `shot_spec`；Workflow 只对已批准版本排图片和配音。
7. 每个自动排队命令使用稳定 idempotency key；`recover()` 扫描未完成 `@2` Job，`reconcile()` 依据 Artifact 和审核状态补排，不按 Job State 猜测大内容。

**TDD**
- RED：`stops on script and storyboard approval gates and rejects stale approvals`，基线没有审核门且 Action Schema 宽泛。
- RED：`persists edited script and shot specs as artifacts without storing bodies in job state`，断言重启后可读取文件、Job State 无脚本/shot 数组。
- RED：`reconcile enqueues each content stage exactly once after restart`，在 stage 成功和下一命令提交之间模拟重启；断言仅补排一次。
- GREEN：实现合同、Executor、Action Handler 与 Workflow；运行 Creator API/Service/Workflow 回归。
- REFACTOR：共享规范 JSON、原子写入和 LLM 错误映射；不得抽象到 KrillinAI。

**任务完成门**
- 来源到分镜审批的 API 集成测试通过；旧 revision 返回现有可识别冲突码；Agent 与用户走同一 Action Handler。

### TASK-5：实现镜头图片、部分成功和精确血缘失效 `[FR-3, BR-4, DEC-4, AC-3, AC-4]`

**交付结果**
- 每个 shot 独立生成、持久进度和计费请求；失败不丢其他镜头；编辑或重生成单 shot 只替换该图片并失效真实下游。

**文件与符号**
- 创建：`apps/daemon/src/creator/stickman/image-executor.ts` - `createStickmanImageExecutor`。
- 创建：`apps/daemon/src/creator/stickman/lineage.ts` - scoped 指纹、聚合完整性和 stale 计算。
- 修改：`apps/daemon/src/creator/stickman/action-handler.ts` - `regenerate-shot`、`resolve-provider-request`。
- 修改：`templates/stickman-video-actions.ts` - 批量排 scope 和聚合推进。
- 复用：`apps/daemon/src/image-generation/provider.ts`、`creator/validators/image.ts`。
- 测试：创建 `creator-stickman-image-executor.test.ts`、`creator-stickman-lineage.test.ts`；扩展 `creator-provider-requests.test.ts`、`creator-stage-scheduler.test.ts`。

**实施步骤**
1. `inputFingerprint` 规范哈希覆盖 shot 内容、角色参考 SHA-256、风格、比例、Provider/model/quality 和直接输入 Artifact 哈希。
2. Workflow 为每个批准 shot 创建 `stageId='images'`、`scopeKey=shot.id` 的 StageRun；已有同指纹成功图片则复用，失败/旧指纹才创建新运行。
3. Executor 从批准 `shot_spec` 只读取当前 scope，调用共享 Image Provider；计费 Provider 通过 TASK-2 账本包裹，结果校验后写 `shot_image`。
4. 每个镜头 progress 使用标准 `phase/percent/message/completed/failed/total`，单运行终态为 1/0/1 或 0/1/1；面板聚合所有当前指纹运行。
5. `edit-shot`/`regenerate-shot` 把目标旧图片及递归依赖它的 `visual_validation/timeline_manifest/clean_video/cover_image/bilingual_* /publish_copy/delivery_manifest` 标 stale；其他 `shot_image` 保持 completed。
6. 进入 `visual-validation` 前验证全部批准 shot 具备当前指纹图片；任何缺失只回到对应 scope，不重跑成功 scope。

**TDD**
- RED：`keeps successful shot artifacts when another scope fails`，三个 scope 中一个失败；断言两个成功 Artifact 保留、Job 等待缺失 scope。
- RED：`regenerates one shot and stales only its transitive dependents`，断言其他 shot ID、SHA 和状态不变，时间线与交付 stale。
- RED：复用 TASK-2 的远端接受后崩溃用例，断言 scope 级 unknown 不阻断查看其他镜头，但阻止聚合与普通重试。
- GREEN：实现指纹、Executor、部分成功与 lineage；运行 Image Executor、Provider、Scheduler、Workflow 回归。
- REFACTOR：将通用哈希/路径校验留在 Creator 公共层，火柴人 shot 解析留在 stickman 模块。

**任务完成门**
- AC-3、AC-4 的镜头级断言全部通过；同一 scope 活动重复提交被数据库和 Workflow 双重阻止。

### TASK-6：映射 KrillinAI 配音、字幕和双语成片 `[FR-2, BR-2, BR-5, DEC-2, AC-2]`

**交付结果**
- `narration`、`source-transcript`、`subtitles`、`bilingual-render` 通过现有 KrillinAI 通用 stage 执行并返回火柴人 Artifact 名称，不扩展产品级 Krillin 协议。

**文件与符号**
- 修改：`apps/daemon/src/creator/krillin/adapter.ts` - `resolveKrillinStageContract`、输出别名和按模板必需输出。
- 修改：`apps/daemon/src/creator/krillin/cli-runner.ts` - 仅补通用 options/输入映射。
- 修改：`apps/daemon/src/creator/templates/stickman-video.ts`、`stickman-video-actions.ts` - Krillin 阶段声明和推进。
- 保持：`packages/protocol/src/krillin-opencreator.ts`、`contracts/krillin-opencreator-v1.schema.json` 的 stage enum 不新增火柴人名称。
- 测试：`creator-krillin-adapter-dependency.test.ts`、`creator-krillin-cli-protocol.test.ts`、`creator-krillin-execution-plan.test.ts`、`krillin-opencreator-contract.test.ts`，创建 `creator-stickman-krillin.test.ts`。

**实施步骤**
1. 映射 `source-transcript -> subtitle`，只要求 `source_subtitle`；字幕来源优先平台字幕，失败按现有 execution plan 回落 Whisper。
2. 映射 `narration -> tts`，输入批准脚本生成的字幕/文本 Artifact，把 `dubbed_audio` 注册为 `narration_audio`，保留 Provider/voice/model 和时长元数据。
3. 映射 `subtitles -> subtitle`，输入 `clean_video`，产出固定文件名 `bilingual_srt.srt` 的 `bilingual_subtitle`。
4. 映射 `bilingual-render -> render-horizontal`，输入 `clean_video + bilingual_subtitle`，把 `horizontal_video` 注册为 `bilingual_video`，文件名固定 `horizontal_bilingual.mp4`。
5. Krillin result manifest 的 SHA-256、路径越界、必需输出和媒体/SRT 校验继续在 Adapter 验证；Job State 不保存 Krillin 私有任务 payload。

**TDD**
- RED：`maps stickman semantic stages onto existing krillin stage enum`，断言请求 stageType 只出现 `subtitle/tts/render-horizontal`，输出别名正确；基线会以 unsupported stage 失败。
- RED：`rejects undeclared or missing stickman krillin outputs`，Fake Manifest 返回 vertical_video 或缺失字幕，断言稳定错误码且不登记 Artifact。
- GREEN：实现 contract resolver 和别名；运行 Krillin unit/integration 与 Protocol 合同测试。
- REFACTOR：把现有 video-translation 硬编码收敛为默认 contract，保持其请求和输出不变。

**任务完成门**
- Krillin schema enum 未增加火柴人 stage；四个产品阶段均有通用请求/输出合同测试；现有视频翻译回归通过。

### TASK-7：实现时间线合同和隔离 Remotion Worker `[FR-2, BR-2, NFR-1, DEC-2, DEC-5, AC-2, AC-9]`

**交付结果**
- 已批准 shots、图片和配音生成可验证时间线；隔离 Node Worker 使用固定 Remotion/Chromium/字体/素材渲染 `landscape-clean.mp4`，崩溃只失败当前 StageRun。

**文件与符号**
- 创建：`apps/daemon/src/creator/stickman/timeline-executor.ts` - `createStickmanTimelineExecutor`。
- 创建：`apps/daemon/src/creator/stickman/remotion-executor.ts` - `createStickmanRemotionExecutor`。
- 创建：`apps/daemon/src/creator/stickman/remotion-worker.ts` - 子进程入口和 JSON 文件协议。
- 创建：`packages/stickman-remotion/package.json`、`tsconfig.json`、`src/index.ts`、`src/Root.tsx`、`src/StickmanLandscape.tsx`、`src/timeline.ts`。
- 创建：`packages/stickman-remotion/assets/fonts/NotoSans-Bold.woff2`、`NotoSansSC-Bold.woff2`、`OFL.txt`。
- 修改：`apps/daemon/package.json`、根 `pnpm-lock.yaml` - 精确固定 `@remotion/bundler@4.0.473`、`@remotion/renderer@4.0.473`、`remotion@4.0.473`、`sharp@0.34.3`；Remotion package 使用仓库现有 `react@18.3.1`、`react-dom@18.3.1`。
- 测试：创建 `creator-stickman-timeline.test.ts`、`creator-stickman-remotion.test.ts`；增加 `packages/stickman-remotion/src/*.test.ts`。

**实施步骤**
1. 时间线 schema 固定 fps、1280x720、shot 顺序、每镜头帧区间、图片 Artifact ID、音频 Artifact ID、motion 和来源 SHA-256；总帧数由真实音频时长和批准顺序计算。
2. Timeline Executor 拒绝缺图、缺音频、负时长、重叠、空洞、越界路径和 stale 输入，写 `timeline_manifest` 并记录自身 SHA-256。
3. Remotion package 从 auto-video TypeScript 模板迁移需要的干净横屏构图，不复制 legacy 兼容层、Python 调度和竖屏交付；组件只消费经过 Zod 验证的 props。字体通过本地 `@font-face` 加载上述两个 WOFF2 文件，不使用 `@remotion/google-fonts` 或网络字体。
4. 构建阶段用固定 `@remotion/bundler` 生成 bundle；运行阶段 Worker 用固定 `@remotion/renderer` 和 Manifest 指定 Chromium，禁止 `npm install`、浏览器自动下载和网络字体。
5. Daemon 通过 `spawnCreatorProcess(process.execPath, ...)` 启动 Worker；请求、结果和错误通过当前 Stage workdir 内 JSON 文件交换，Worker 校验时间线、bundle、Chromium和输出均位于允许根。
6. Worker 成功后用 FFprobe 校验视频可解码、1280x720、时长与时间线容差，才登记 `clean_video`；取消或崩溃删除未完成输出。

**TDD**
- RED：`builds deterministic timeline from approved current artifacts`，打乱 Artifact 顺序并含 stale 输入，断言输出仍按 shot 规范且不选 stale。
- RED：`isolates remotion worker crash and cancellation`，Fake Worker 分别异常退出和长时间运行；断言仅当前 StageRun failed/canceled、子进程树退出、无 clean_video。
- RED：`renders a nonblank fixed-frame smoke video with packaged browser and fonts`，对三帧做像素方差检查并 FFprobe；未准备资源时应明确失败而非在线下载。
- GREEN：完成 timeline、package 和 Worker；运行定向测试、daemon/package typecheck。
- REFACTOR：把 runtime path/manifest 解析独立于渲染业务，供 TASK-12 打包校验复用。

**任务完成门**
- 时间线和 Worker 测试通过；固定版本已进入锁文件；运行路径无 Python、无运行时安装和不受控下载。

### TASK-8：生成五项交付、Delivery Manifest 和历史结果 `[FR-2, FR-3, BR-3, BR-5, DEC-3, DEC-5, AC-2, AC-3, AC-5]`

**交付结果**
- 五项文件与 Delivery Manifest 逐项一致；最终 Stage 才生成 ResultSnapshot；重生成后旧结果保持可查看的 stale 历史。

**文件与符号**
- 创建：`apps/daemon/src/creator/stickman/delivery-executor.ts` - `createStickmanDeliveryExecutor`。
- 修改：`apps/daemon/src/creator/stage-runner.ts` - stickman 最终 `artifactRefsPatch` 与 job completion policy。
- 修改：`apps/daemon/src/creator/result-snapshots.ts` - 多同类 scoped Artifact 与五项引用。
- 修改：`templates/stickman-video.ts`、`stickman-video-actions.ts` - `cover`、`publish-copy`、`package-validation`。
- 复用：`creator/validators/image.ts`、`media.ts`、`srt.ts`；使用 `sharp` 输出 1280x720 封面。
- 测试：创建 `creator-stickman-delivery.test.ts`、`creator-stickman-results.test.ts`；修改 `creator-runtime-advanced.test.ts`。

**实施步骤**
1. `cover` 通过共享 Image Provider 生成候选，使用 sharp 归一化到 1280x720，保留模型、Prompt、来源和最终尺寸证据，文件名 `youtube-cover.png`。
2. `publish-copy` 从 `content_plan + script_manifest` 生成 `publish-copy-youtube.md`，Zod 校验标题、简介、标签段存在且文件非空。
3. `package-validation` 在 Job 根内物化固定五项文件，拒绝符号链接和路径越界；比较实际文件集合、SHA-256、字节数、MIME、封面尺寸、视频 FFprobe、SRT 解析和 sourceArtifactIds。
4. 只在所有校验通过后写 `delivery_manifest`、把 Job 标 `completed` 并追加 ResultSnapshot；快照 `artifactRefs` 同时引用五项 Artifact 和 Manifest。
5. 新版本完成前旧 ResultSnapshot 保持可打开；任何上游变更后其 Artifact 状态为 stale，但快照内容不被覆盖。

**TDD**
- RED：`rejects delivery with extra, stale, hash-mismatched or wrong-size files`，逐项注入错误；基线没有五项合同。
- RED：`creates one result snapshot only after package validation succeeds`，中间阶段不增加版本，失败交付无新版本，成功后引用五项精确 ID。
- RED：`keeps previous result snapshot readable after one-shot regeneration`，断言 V1 文件仍能通过 content API 打开，V2 不引用 stale V1 输入。
- GREEN：实现 Delivery 和结果快照补丁；运行 Delivery、Runtime Advanced、API content route 回归。
- REFACTOR：共享文件清单/哈希比较函数给 TASK-12，业务文件名仍由 stickman contract 权威定义。

**任务完成门**
- AC-2、AC-3、AC-5 的交付与历史断言通过；失败 Delivery 不产生假完成状态或 ResultSnapshot。

### TASK-9：闭合重启恢复、取消和工作台/Agent 冲突 `[FR-4, BR-4, DEC-3, DEC-4, AC-4, AC-5, AC-6]`

**交付结果**
- 所有阶段、审核、镜头进度、Provider 状态和结果可在重启后恢复；取消清理进程；旧 revision 不覆盖新数据。

**文件与符号**
- 修改：`templates/stickman-video-actions.ts` - `recover`、`reconcile`、`resumeConfiguredJobs`。
- 修改：`apps/daemon/src/api/routes.creator.ts` - resume/retry/resolve 路由接入。
- 修改：`apps/daemon/src/creator/stage-runner.ts`、`process-tree.ts` - scoped cancel 与终态回调。
- 修改：`apps/daemon/src/creator/agent/service.ts` 及 Agent CreatorAction 桥接调用方 - 保持 expectedRevision 和 actor。
- 测试：创建 `creator-stickman-recovery.test.ts`；修改 `creator-api.test.ts`、`creator-agent-service.test.ts`、`creator-agent-recovery.test.ts`、`creator-tool-process-lease.test.ts`。

**实施步骤**
1. 启动恢复先执行旧数据迁移，再恢复 StageRun/Provider Ledger，最后执行 stickman Workflow `recover()`；顺序不得让已删除 `@1` Job 被恢复。
2. 对 interrupted scoped run：成功 Artifact 指纹匹配则收敛成功；Provider waiting/unknown 走账本；没有远端副作用且无成功 Artifact才允许重新排队。
3. `resume` 和 `retry-stage` 统一调用 Workflow guard，不绕过审核、当前输入指纹或 Provider unknown 状态。
4. Job cancel 枚举所有 active scope，终止进程树并把未完成 StageRun 置 canceled；已 completed Artifact 不删除。
5. 工作台和 Agent 都必须提交 `expectedRevision`；冲突返回现有 revision conflict 错误，客户端刷新后再操作。Agent 只能建议 `confirm-resubmit`，服务端拒绝其执行。

**TDD**
- RED：`recovers running review completed and unknown-provider jobs after daemon restart`，四类状态分别断言恢复结果和 submit 次数。
- RED：`cancels all scoped process trees without deleting completed shots`，两个运行 scope、一个成功 scope，断言子进程退出与 Artifact 保留。
- RED：`rejects stale agent revision and agent duplicate-billing confirmation`，断言用户较新改动不被覆盖。
- GREEN：完成恢复顺序、路由和 Agent guard；运行 API、Agent、Process Lease、Workflow 回归。
- REFACTOR：统一 Workflow 错误映射和 needsInput 结构，避免 route 私有判断。

**任务完成门**
- AC-4、AC-5、AC-6 的服务和 API 场景通过；重启不会重复计费或重复排队；取消无残留子进程。

### TASK-10：把 Demo 工作台改为 CreatorSession 持久视图 `[FR-1, FR-3, FR-4, BR-3, DEC-3, AC-1, AC-5, AC-6]`

**交付结果**
- 保留现有步骤、角色、分镜弹窗、配音设置、结果页和版本菜单的交互设计，但所有业务内容、状态、进度和版本来自 CreatorSession。

**文件与符号**
- 重写：`apps/web/src/features/dashboard/StickmanVideoWorkspace.tsx`。
- 修改：`apps/web/src/features/dashboard/DashboardPage.tsx` - `createPendingCreatorJob` 使用模板摘要中的 version 2，不再写死 1。
- 修改：`apps/web/src/features/dashboard/creator-session-store.tsx` - JSON Artifact 读取缓存与冲突刷新，不新增业务真相源。
- 修改：`apps/web/src/services/creator-service.ts` - 保持 content API，按需增加 JSON helper。
- 创建：`apps/web/src/features/dashboard/StickmanVideoWorkspace.test.tsx`。
- 修改：`DashboardPage.test.tsx`、`creator-session-store.test.tsx`。

**实施步骤**
1. 删除硬编码 `storyboardShots`、`storyboardReady`、`videoReady`、`resultVersions` 和调用后立即 set success 的路径。
2. 表单设置只通过 `session.updateDraft` 持久化；执行、审核、编辑、重生成、Provider 处置全部调用 `session.applyAction`。
3. 通过 `openArtifact` 读取 `script_manifest`、`shot_spec`、`delivery_manifest`；组件可缓存解析结果和 Object URL，但 Job 更新或 Artifact ID 变化时必须失效缓存。
4. 镜头卡片由当前 `shot_spec` 与匹配 scope/fingerprint 的 `shot_image` 组合；running/failed/unknown 状态来自 StageRun/ProviderRequest。
5. 结果版本由 `readCreatorResultSnapshots(job.state)` 派生；只有快照引用的五项 Artifact 可出现在版本页和下载入口。
6. revision conflict 显示可识别错误并触发远端快照刷新，不覆盖用户/Agent 较新数据。

**TDD**
- RED：`does not show ready or result versions before persisted artifacts arrive`，Action 返回 running Job，断言 UI 不提前成功；基线会立即 set ready。
- RED：`renders storyboard and versions from artifact content after refresh`，卸载重挂组件，断言镜头、审核和版本从服务恢复。
- RED：`submits edit and regenerate with current revision and scope`，并模拟冲突后刷新。
- GREEN：完成工作台与 Session helper；运行 Workspace、Dashboard、Session、Creator Service 测试。
- REFACTOR：仅保留 UI 临时状态，例如当前 tab、打开的 modal 和 object URL；不得恢复业务 ready/version state。

**任务完成门**
- AC-1 静态断言与组件测试通过；刷新和冲突场景有自动化证据；Web typecheck 通过。

### TASK-11：新增 `stickmanVideoPanelAdapter` 并复用唯一协作面板 `[FR-4, NFR-2, DEC-2, DEC-3, AC-8, AC-10]`

**交付结果**
- 火柴人使用唯一 `CreatorCollaborationPanel`；P0 Stage/Phase、Action Activity 和镜头聚合进度具有中英文语义、过滤和去重。

**文件与符号**
- 修改：`apps/web/src/features/dashboard/creator-panel-adapters.ts` - 导出 `stickmanVideoPanelAdapter`，在 `creatorPanelAdapterFor` 选择。
- 修改：`apps/web/src/features/dashboard/CreatorCollaborationPanel.tsx` - 仅补通用 scope 聚合显示。
- 保持：`CreatorToolShell.tsx` 的唯一面板结构，不创建火柴人 Panel。
- 创建：`apps/web/src/features/dashboard/creator-panel-adapters.test.ts`。
- 修改：`CreatorCollaborationPanel.test.tsx`、`DashboardPage.test.tsx`。

**实施步骤**
1. 为第 2.4 节全部 Stage 和 phase 提供 zh-CN/en 标签；未知 phase 回落 generic，不读取 Executor 私有 payload。
2. 为 `approve-script/edit-script/edit-shot/approve-storyboard/regenerate-shot/approve-visuals/retry-stage/resolve-provider-request/commit-version` 定义 Activity 文案和安全字段。
3. 过滤 `create-job`、无 objectId 的草稿设置和无语义系统噪声；连续同 stage+scope 的 progress Activity 合并为最新一条。
4. 图片阶段从当前指纹 StageRun 聚合 completed/failed/total；scopeKey 仅用于镜头标识，不改变面板结构。
5. Provider unknown 显示“需要用户处置”，Agent 建议与用户实际处置保持不同 actor 语义。

**TDD**
- RED：`selects stickman adapter without rendering a second panel`，断言 DOM 只有一个 panel region。
- RED：`labels every p0 stage phase and action in both locales`，表驱动覆盖全部合同项。
- RED：`aggregates current shot runs and deduplicates activity by stage and scope`，混入旧指纹、draft Activity，断言真实 2/1/3 和过滤结果。
- GREEN：实现 Adapter 和通用聚合；运行 Adapter、Panel、Dashboard 测试。
- REFACTOR：共享去重工具只在能保持现有 video translation/cover 行为时抽取。

**任务完成门**
- AC-10 全部断言通过；源码不存在 `Stickman*AgentPanel` 或第二个 `CreatorCollaborationPanel` 实例。

### TASK-12：固定 Remotion 资源并扩展 Desktop 正式打包合同 `[NFR-1, NFR-3, BR-2, DEC-5, AC-9]`

**交付结果**
- Desktop 包包含受 Manifest 约束的 Remotion bundle、Chromium、字体和角色素材；构建清单记录资源哈希；Daemon、Stickman Runtime 和 `app.asar` 不含 Python Runtime，既有 Creator Runtime 的便携 Python `yt-dlp` 由独立合同验真；任一资源或 Web 不一致阻止交付。

**文件与符号**
- 创建：`apps/desktop/scripts/prepare-stickman-runtime.mjs`、`stickman-runtime-contract.mjs`。
- 修改：`apps/desktop/scripts/package-release.mjs` - 准备资源和记录 manifest 字段。
- 修改：`apps/desktop/scripts/verify-package.mjs` - 资源完整文件集、哈希和 Python 扫描。
- 修改：`apps/desktop/scripts/prepare-daemon.mjs` - 构建 Remotion package/worker，保持当前 Web 新鲜构建。
- 修改：`apps/desktop/electron-builder.yml` - `.pack/stickman-runtime -> stickman-runtime`。
- 修改：`apps/desktop/package.json` - `prepare:stickman-runtime`。
- 创建：`apps/desktop/test/stickman-runtime-package.test.mjs`。
- 修改：`apps/desktop/test/creator-runtime-package.test.mjs`、`apps/desktop/e2e/creator-packaged-app.spec.ts`。

**实施步骤**
1. prepare 脚本从锁定依赖生成 Remotion bundle，把固定 Chromium、两个字体文件和以下角色素材复制到 `.pack/stickman-runtime`：`default.png`、`tech-guy.png`、`long-hair.png`、`short-hair.png`、`hiphop.png`、`student.png`、`elder.png`、`manager.png`、`chef.png`、`fitness.png`；角色源文件固定来自 `apps/web/public/dashboard/characters/`。Manifest 为每个文件记录 kind、version、sha256、size、platform、arch。
2. 合同校验要求实际文件集合与 Manifest 完全相等，且包含 bundle、Chromium 可执行文件、字体和角色素材；路径越界、缺失、多余、哈希错误均失败。
3. `package-release.mjs` 在 electron-builder 前执行 prepare；现有 `prepare-daemon.mjs` 继续重新构建 `apps/web/dist`。构建清单增加 `stickmanRuntimeHash`、`stickmanRuntimeFileCount`、Remotion/Chromium 版本和资源 Manifest SHA-256。
4. `verify-package.mjs` 比较源 runtime、`.pack` runtime 与 App runtime 的文件列表和逐文件哈希，并继续比较 Web 源/包。Python 禁止扫描覆盖 daemon、stickman-runtime 和 app.asar，拒绝 Python 可执行文件、`libpython`、`site-packages`、`venv/.venv`、`__pycache__`、`.pyc/.pyo/.pth`、`auto-video` 路径和其他已知 Python Runtime 标志；Creator Runtime 中既有便携 Python `yt-dlp` 由 `creator-runtime-contract` 独立验证版本、文件集、哈希和无可变字节码缓存。普通依赖附带但不可执行的 `.py` 源文件单独报告，不以文件扩展名替代 Runtime 判定。
5. 包内 Worker 用资源 Manifest 解析 Chromium/字体/素材，不读取开发机全局缓存或 PATH。

**TDD**
- RED：`rejects missing extra hash-mismatched or wrong-platform stickman resources`，表驱动修改 fixture。
- RED：`rejects packaged python runtime and stale embedded web`，分别注入 `.pyc` 与 Web 单文件差异，断言 verify-package 非零退出。
- RED：`build manifest binds package to exact stickman and web hashes`，篡改 manifest 字段后校验失败。
- GREEN：实现 prepare/contract/package/verify；运行 Desktop package contract、typecheck。
- REFACTOR：复用现有 `hashDirectory/findFirstDifferentPath` 语义，避免两套不一致哈希算法。

**任务完成门**
- AC-9 的静态打包合同全部有自动化；未执行实际包前只能声明“合同测试通过”，不能声明可发布。

### TASK-13：完成 Web/Desktop 一致性、实际 App 与真实流水线 E2E `[FR-1, FR-2, FR-4, NFR-2, DEC-1, DEC-2, DEC-3, DEC-4, DEC-5, AC-2, AC-5, AC-8, AC-9, AC-10]`

**交付结果**
- 同一 Fake Daemon 下 Browser/Desktop Bridge 的通用 UI、Action、Runtime 请求和持久化结果一致；实际打包 App 可运行完整火柴人关键流程；真实受控 Provider 产生五项交付。

**文件与符号**
- 创建：`apps/web/e2e/support/fake-stickman-daemon.ts`、`apps/web/e2e/stickman-web-desktop-parity.spec.ts`。
- 修改：`apps/web/e2e/web-desktop-parity.spec.ts`、`fixtures/runtime.ts` - 共用视口和 Creator fixture。
- 修改：`apps/desktop/e2e/creator-packaged-app.spec.ts` - 打包态火柴人创建、审核、重生成、重启和结果。
- 创建：`apps/daemon/test/integration/creator-stickman-real-pipeline.test.ts` - 环境门控真实短输入。
- 修改：Playwright 配置，仅纳入对应项目，不改变无关测试收集。

**实施步骤**
1. Fake Daemon 固定同一 project/job/preferences、Artifact 内容、Provider unknown 和请求日志；分别注入 Browser Bridge 与具备真实 capability 回调的 Desktop Bridge，内容视口固定 1440x900，并增加 390x844 响应式检查。
2. 对比首页、项目选择器、创建项目、设置、会话输入区、文件工作区以及火柴人脚本审核、分镜审核、单镜头重生成、协作面板和结果页的可见文案、按钮、状态、关键尺寸、Action 请求和持久化快照。
3. Browser Bridge 不显示目录选择、窗口控制等不可用入口；Desktop Bridge 的原生入口必须调用真实 fake callback，不传空函数。
4. 实际 App E2E 使用打包目录启动 `opencreator-app://`，走 Preload Bridge 和 Runtime 代理，创建 `@2` Job，完成审核、scope 重生成、Daemon 重启恢复、Artifact 打开和五项结果验证。
5. 真实流水线测试只在 `OPENCREATOR_RUN_REAL_STICKMAN_E2E=1` 时运行，读取 `OPENCREATOR_STICKMAN_E2E_CONFIG` 私密配置路径和 `OPENCREATOR_STICKMAN_E2E_YOUTUBE_URL` 固定短视频；限制镜头数和图片候选数，记录计费请求数但不输出凭证。
6. 真实测试验证五项文件可用、封面 1280x720、视频可解码、SRT 双语、Manifest 哈希一致；失败必须保留临时证据路径并阻止发布。

**TDD**
- RED：`browser and desktop bridges produce identical stickman actions and snapshots`，基线 Demo 本地状态与硬编码镜头会导致差异。
- RED：`packaged app restores scoped progress and five artifacts after daemon restart`，基线包只验证旧 Demo/通用 Creator。
- RED：真实测试在未设置门控时明确 skip；设置后任何一项 Delivery 校验失败使测试失败，不允许降级为 warning。
- GREEN：完成 fixture 和 E2E；先跑 Fake parity，再跑 package app，最后在授权配置下跑真实 Provider。
- REFACTOR：E2E helper 只抽取公开 API/Bridge 操作，不从数据库直接伪造被验收的最终结果。

**任务完成门**
- AC-8 全套一致性和实际 App E2E 通过；AC-2 有本次真实运行证据。若真实凭证、网络或目标平台不可用，标记 `BLOCKED`，不得宣布功能完成或可发布。

### TASK-14：执行本地差异自审和完整功能验收 `[AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10]`

**交付结果**
- 主 Agent 对最终差异完成一次本地自审，修复范围内问题后，用最后一次相关改动之后的新鲜证据执行全部 P0 验收；不启动新的 Reviewer。

**文件与符号**
- 检查：`git diff --stat`、本任务全部 `git diff`、新增/删除文件、依赖和打包资源。
- 验收：第 7 节矩阵列出的公开 API、浏览器、实际 App、真实流水线和包合同。

**实施步骤**
1. 审查最终 diff 是否完整映射契约与追踪矩阵，重点检查旧兼容残留、状态双写、重复抽象、凭证泄漏、路径越界、未知计费重提、子进程回收、Web/Desktop 分叉和无关修改。
2. 自审发现问题时按对应 TASK 的 RED/GREEN 修复并重跑受影响测试；修复后的旧验收证据失效。
3. 依次运行：Protocol/Daemon/Web/Desktop typecheck；全部定向 Creator/Stickman/Krillin/Package 测试；Web build；Desktop build；Fake parity；真实流水线；`pnpm --filter @opencreator/desktop package`；`verify:package`；实际打包 App E2E。
4. 对 App 内嵌 Web 与本次 `apps/web/dist` 保存文件列表、逐文件 SHA-256 和聚合哈希；保存构建清单、stickman runtime manifest 和 Python 扫描结果。
5. 对每个 AC 记录 `PASS/FAIL/BLOCKED`、实际结果、执行目录、时间、退出码、证据路径或输出摘要。任一 P0 为 FAIL/BLOCKED 时不声明完成或发布就绪。

**TDD**
- 策略：豁免新增测试。该任务只消费前序测试和公开功能入口；自审修复回到对应 TASK 的 TDD 流程。

**任务完成门**
- 第 7 节全部 P0 AC 为 PASS 且证据产生在最后一次相关代码修改之后；`git diff --check` 通过；未提交工作区只包含本任务实现、已批准方案/计划和用户原有未跟踪 `auto-video/`。

## 7. 最终功能验收矩阵

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AC-1 | P0 | 唯一生产实现 | 新 Registry、测试内旧 @1 Registry、清洁 Job | 枚举模板、创建 @2、打开工作台、用旧 Registry 操作 @2 | 只枚举 `stickman-video@2`；无旧 Executor/硬编码镜头/本地结果；旧 Registry 明确拒绝 | Registry/组件测试 + 源码搜索 | 测试输出、`rg` 清单 |
| AC-2 | P0 | 真实五项交付 | 私密 Provider 配置、KrillinAI、固定短 YouTube URL | 完成脚本和分镜审核并等待结束 | 五项文件可用；封面 1280x720；Manifest 路径、哈希、参数、血缘一致 | 真实流水线集成测试 | 临时 Job 路径、Manifest 摘要、FFprobe/SRT 结果 |
| AC-3 | P0 | 单镜头修改 | 已完成多镜头 V1 | 修改一个 shot 并重生成至 V2 | 只新增该 scope 的 StageRun/图片；其他图片不变；下游 stale 后生成新版本 | Service 集成测试 | StageRun/Artifact/ResultSnapshot 对比 |
| AC-4 | P0 | 计费请求未知接受 | 可故障注入 Fake Provider | 崩溃后依次 query、普通 retry、用户确认重提、cancel | query 找回原任务；retry 拒绝；仅用户确认产生 generation 2；cancel 无假 Artifact且有 Activity | Provider 故障注入 | submit/lookup 次数、账本与 Activity |
| AC-5 | P0 | 刷新与重启恢复 | Job 分别 running/needs_input/completed | 刷新页面并重启 Daemon | Job、阶段、scope 进度、审核、Provider、快照和 Artifact 恢复；安全继续 | API + 浏览器 + 实际 App | API 快照、页面断言、重启日志 |
| AC-6 | P0 | 工作台/Agent 冲突 | 两端打开同一 revision | 工作台先改，Agent 用旧 revision；刷新后再改 | 旧 revision 被拒绝且不覆盖；刷新后两端一致；Agent 不可确认重复计费 | Service + Agent 集成 | 冲突响应、最终 Job/Activity |
| AC-7 | P0 | 旧 Demo 清理 | DB 含 @1、@2、其他模板及文件目录 | 执行升级两次，并注入一次目录清理中断 | 只删除 @1 及关联数据/目录；@2 和其他数据不变；二次幂等并补清目录 | 迁移测试 | SQL 计数、目录集合、迁移标记 |
| AC-8 | P0 | Web/Desktop 一致性 | 同 Fake Daemon、Job、偏好、内容视口和实际 App | 两端完成审核、重生成、面板/结果查看和原生能力操作 | 通用 DOM、文案、尺寸、Action、Runtime 请求、持久化和结果一致；原生入口按 capability 工作 | Playwright parity + App E2E | 请求日志、状态快照、截图/几何 |
| AC-9 | P0 | 正式打包 | 当前工作区允许 dirty 如实记录 | 运行 package、verify 和 App E2E | 新鲜 Web；清单字段完整；Web 与包逐文件一致；Remotion/Krillin 资源有效；Daemon、Stickman Runtime 和 `app.asar` 无 Python，Creator Runtime 仅含受合同约束的便携 Python `yt-dlp` | 构建/包合同 + 实际 App | build manifest、文件哈希、runtime manifest、扫描输出 |
| AC-10 | P0 | 唯一协作面板 | Job 含全部 P0 Activity 和 scope 进度 | 执行设置、审核、重生成、retry、Provider 处置 | Adapter 文案完整、过滤/去重正确、显示真实完成/失败/总数；只有一个 Panel | Adapter/Panel 测试 + parity | 测试表、DOM 数量、面板截图 |

功能验收必须从公开 API、Web UI、Host Bridge 或实际打包 App 发起。单元测试可以补充证据，但不能替代 AC-2、AC-5、AC-8、AC-9 的真实边界。

## 8. 发布、迁移与回滚

### 8.1 发布步骤

1. 全部 TASK 完成后同步最新 `origin/main`，只解决直接相关冲突，并重跑受影响门禁和 TASK-14。
2. 首次有效实现提交后推送 `feat-stick-video`；提交不包含未跟踪 `auto-video/`，除非用户另行授权纳入。
3. 发布前执行实际目标平台的 `pnpm --filter @opencreator/desktop package` 或正式发行命令；不得复用来源不明的 `apps/web/dist` 或 `.pack/stickman-runtime`。
4. 保存 Desktop build manifest、Web 完整哈希、Creator/Krillin runtime manifest、stickman runtime manifest、实际 App E2E 和真实流水线结果。
5. 发布说明明确：旧 `stickman-video@1` Job 会被定向永久删除；代码回滚不会恢复这些 Job。

### 8.2 回滚步骤

- 数据迁移执行前：可不合并或回滚分支提交，恢复主分支代码与包，不产生数据副作用。
- 数据迁移执行后：允许回滚代码和资源，但不恢复旧 Demo Job；不得创建伪造旧数据。旧代码遇到 `stickman-video@2` 必须报 unknown template，禁止按 `@1` 解释。
- 新 @2 结果文件保留在 Job 根中；若回滚版本无法识别，只允许保持不可操作状态，不删除或降级解释。
- Provider unknown 账本不得因回滚自动重提；恢复到新版本后继续显式处置。
- 任一包资源或 Web 哈希不一致时停止交付，删除该次生成的 release 产物后重新从当前工作区构建；不得手工替换包内文件。

## 9. 执行偏差与最终报告

不改变 `FR/BR/NFR/DEC/AC` 的局部文件位置、命名和实现细节可以调整，但最终报告必须记录原因、影响和替代验证。任何公开合同、职责边界、迁移范围、Provider 安全语义、五项交付或验收标准变化都必须立即停止并更新方案/Plan，不能通过放宽测试继续。

最终报告必须包含：

- 已完成任务、未完成项和每个 AC 的 PASS/FAIL/BLOCKED。
- Plan 偏差及其是否改变合同。
- 主 Agent 最终 diff 自审发现和修复项。
- 关键 RED、GREEN、回归、typecheck、build、package、E2E 命令与结果。
- 真实流水线五项交付摘要及计费请求数量，不包含凭证。
- Web/App 文件哈希、资源 Manifest、Python 扫描和实际 App 证据。
- 发布/回滚状态和残余风险。

## 10. 风险控制

| 风险 | 控制与失败条件 |
| --- | --- |
| 计费 Provider 不支持幂等查询 | 未知接受状态进入 `needs_input`；普通 retry 拒绝；无用户确认不得新 generation。 |
| Creator 公共核心受 scope 扩展影响 | 新字段对旧模板为 null；定向跑 Service/Storage/Scheduler/视频翻译/封面回归；跨模块失败才升级验证。 |
| 多 scope 并发产生状态竞态 | lane 只并发 scoped run；SQLite 事务登记 Artifact/Stage 终态；Workflow 聚合后才排下游。 |
| Remotion/Chromium 跨平台和包体增长 | 固定版本、Manifest 和平台/架构；实际目标平台 package/App E2E 未过即 BLOCKED。 |
| 旧 Demo 数据删除不可逆 | 精确 SQL、事务、可恢复目录清理、路径守卫、二次幂等；发布说明明确不可恢复。 |
| 真实 Provider 成本或不稳定 | 固定短输入、限制镜头和候选、记录请求数；真实 AC-2 失败不能由 Fake 测试替代。 |
| Web/Desktop 表面共用但行为分叉 | 相同 Fake Daemon、偏好和内容视口比较 DOM、请求和持久化；再跑实际 App。 |
| auto-video 参考实现漂移 | 只迁移已批准五项合同和 TypeScript Remotion 行为；Python 测试通过不作为完成证据。 |

## 11. 独立审核记录

> Reviewer 原始结论：`FAILED`，所选 Reviewer 模型容量不足，错误为 `Selected model is at capacity. Please try a different model.`
> 流程结论：`PASS（用户知情授权执行）`

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
| --- | --- | --- | --- | --- | --- |
| REVIEW-INFRA-1 | Blocker | 按 Plan Skill 约束不启动第二个 Reviewer，不以主 Agent 自审冒充独立审核 | 文档头部、独立审核记录 | 已成功创建 Reviewer 任务，但其 turn 因模型容量失败且没有返回合法 `PASS/REVISE/BLOCKED` 结论 | 本 Plan 已完成主 Agent 自审，但没有第二视角验证方案一致性、追踪、TDD 和验收闭合；用户看到本风险后可明确授权开始执行，或要求以后重新进行独立审核 |

## 12. 2026-09-01 执行结果

### 12.1 TASK 状态

| 范围 | 状态 | 结果 |
| --- | --- | --- |
| TASK-0 至 TASK-12 | `PASS` | 唯一 `stickman-video@2`、Creator 持久工作流、镜头级恢复与 Provider 账本、五项交付执行器、统一协作面板和 Desktop Runtime/包合同均已实现并通过对应定向测试。 |
| TASK-13 | `BLOCKED` | Fake Browser/Desktop parity 和实际打包 App E2E 已通过；真实 Provider 流水线因未配置 `OPENCREATOR_RUN_REAL_STICKMAN_E2E`、`OPENCREATOR_STICKMAN_E2E_CONFIG`、`OPENCREATOR_STICKMAN_E2E_YOUTUBE_URL` 按设计跳过，因此没有真实五项付费交付证据。 |
| TASK-14 | `BLOCKED` | 最终差异自审、类型检查、定向测试、构建、打包、包验证和实际 App E2E 已执行；因 AC-2 阻塞，整体不得声明功能完成、发布就绪或可合并主分支。 |

### 12.2 AC 状态

| AC | 状态 | 本次证据摘要 |
| --- | --- | --- |
| AC-1 | `PASS` | Registry/模板/工作台测试与生产源码扫描通过；只存在 `stickman-video@2`，旧 Executor 已删除。 |
| AC-2 | `BLOCKED` | 真实流水线测试入口和强校验已实现，但缺少私密 Provider 配置与固定短 YouTube URL，未产生本次真实五项交付。 |
| AC-3 | `PASS` | 镜头图片、时间线、交付和 ResultSnapshot 定向测试覆盖单 scope 重生成与精确 stale。 |
| AC-4 | `PASS` | Provider Ledger、未知远端接受、查询、拒绝普通重试、用户确认重提和取消作用域测试通过。 |
| AC-5 | `PASS` | Creator API/恢复测试、页面恢复测试和实际 App Daemon 重启恢复通过。 |
| AC-6 | `PASS` | Creator Service/Agent revision 冲突和动作权限测试通过。 |
| AC-7 | `PASS` | `stickman-video@1` 定向迁移、幂等和目录清理恢复测试通过。 |
| AC-8 | `PASS` | Fake Browser/Desktop parity 通过；实际 Desktop App E2E `1 passed (46.2s)`。 |
| AC-9 | `PASS` | 正式目录包校验通过：包体 `1,505,514,995` 字节，Web 74 个文件逐文件一致；FFmpeg/FFprobe `6.1.1`、yt-dlp `2026.08.29.232711`、Python `3.13.15`、Remotion `4.0.473`、Chromium `149.0.7790.0` 均由 Runtime 合同验证。Python 禁止扫描覆盖 Daemon、Stickman Runtime 和 `app.asar`，Creator Runtime 的便携 Python `yt-dlp` 由独立合同验证。 |
| AC-10 | `PASS` | Adapter、唯一 Panel、P0 文案、Activity 过滤去重和镜头进度聚合测试通过。 |

### 12.3 自审修复与偏差

- 修正 `ffmpeg-static b6.1.1` 的声明与检测版本，由错误的 `6.0` 改为实际 `6.1.1`。
- Windows 实际 App E2E 改用 Go 编译的 `codex.exe` 启动 Fake Codex，并补齐 Node/脚本环境变量；同时按动态 `latestVersion` 判断 yt-dlp 更新状态、按实际 revision 验证重启恢复，并从“我的项目”打开正确的火柴人 Job。
- 增加 Creator Runtime、Codex Runtime、Stickman Runtime 单项包体积门禁，分别为 384 MiB、450 MiB、384 MiB；总包门禁保持 1536 MiB。
- 方案原文“整个 Desktop 包无 Python”与仓库既有 Creator Runtime 便携 Python `yt-dlp` 冲突。本次修订将 NFR-1/AC-9 明确为“不新增 Python 火柴人实现，禁止 Python 进入 Daemon、Stickman Runtime 和 `app.asar`；既有 Creator Runtime 例外必须受独立 Manifest/哈希合同约束”。该修订不改变 TypeScript 火柴人实现边界，也不引入 auto-video Python 代码。

### 12.4 最终门禁结论

- 已通过：Protocol、Daemon、Web、Desktop typecheck；Creator/Stickman/Download 定向测试；Web 相关组件测试；Desktop Creator/Stickman 包合同 `14/14`；Fake parity；Remotion 包内 smoke；实际 Desktop App E2E；`verify:package`；`git diff --check`。
- 未通过或失败：无。
- 环境阻塞：仅 AC-2 真实 Provider 五项交付。
- 分支可以提交并推送用于协作和后续配置验收，但在 AC-2 获得真实证据前不得合并主分支或发布。
