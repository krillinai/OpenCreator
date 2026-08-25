# OpenCreator Codex App Server 兼容与真实 Agent 实施计划

> 版本：V2
> 状态：已批准执行
> 生成日期：2026-08-21
> OpenCreator 代码基线：`main` / `a1cca23e65648e53d972a0f3792eb120c1cf593e`
> Codex 稳定基线：`rust-v0.149.0` / `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`
> Codex 当前源码参考：`d8ec270183ffb341fb0211c5ee8335419ea67cc7`
> KrillinAI 基线：`master` / `a9f4ec207925d9ae702b2064d11607d1ba3bfef6`
> 来源方案：`docs/specs/OpenCreator-Codex-AppServer兼容与真实Agent方案-2026-08-21.md`
> 方案批准证据：2026-08-21，用户回复 `没问题，继续`
> 本次授权边界：生成实施 Plan，不构成开始修改业务代码的授权
> V1 Plan Reviewer 原始结论：`REVISE`，提出 5 个 Major，无产品未决问题
> 流程结论：`PASS`，5 个 Major 已在 V2 按关闭条件修订
> 用户批准执行：2026-08-21，批准原话：`没问题，继续`

## 1. 执行目标

本 Plan 在保留现有 Creator Core、模板、StageRunner 和工作台基础的前提下，完成以下改造：

1. 将 Codex `0.149.0` 作为固定、可校验、与本机环境隔离的 OpenCreator 内置 Runtime。
2. 所有交互式 Agent 统一使用常驻 `codex app-server`；`codex exec` 只保留给定时任务和明确的一次性非交互任务。
3. Creator Agent 使用真实 Codex Thread、Turn、Item、审批和工具事件，不再使用每 Turn 临时进程、内存历史或 Demo 规则回答。
4. 工作台与 Agent 继续共享唯一 Creator Job，通过 Snapshot、Activity 和真实对话呈现同步状态。
5. Creator Tool Server 与 REST 共用 Command Dispatcher，并具备 Turn 级权限、revision、幂等和可恢复调度语义。
6. 将 KrillinAI 正式接入方式升级为 OpenCreator 托管的认证常驻服务，并完成真实视频翻译闭环。

## 2. 不可降低的合同

### 2.1 Runtime 合同

| ID | 合同 |
| --- | --- |
| RC-1 | 正式安装包固定 Codex `0.149.0`、稳定标签 commit、平台二进制 SHA-256 和协议 Schema。 |
| RC-2 | 内置 Codex 使用安装包绝对路径和 `<userData>/runtime/codex/home`，不修改 PATH，不读取用户全局 Codex。 |
| RC-3 | 默认内置 Runtime 失败时不得搜索 PATH 兜底；外部 Codex 只能由用户显式启用。 |
| RC-4 | app-server 连接必须依次完成 `initialize`、`initialized`、`model/list`、`skills/list`、`account/read`。 |
| RC-5 | `developerInstructions` 只在 `thread/start|resume` 设置；动态 Creator Context 进入 `turn/start.input`。 |
| RC-6 | app-server 协议类型从 `rust-v0.149.0` 生成，不以当前 main 或手写 `any` 为正式依据。 |

### 2.2 Agent 与共享状态合同

| ID | 合同 |
| --- | --- |
| AG-1 | Creator Core 是 Job、revision、StageRun、Artifact、Activity 的唯一业务状态源。 |
| AG-2 | Agent 区域由 Creator Snapshot、Activity 和 Codex Conversation 三类数据组成。 |
| AG-3 | 工作台操作更新 Creator 状态和 Activity，但不自动启动 Codex Turn。 |
| AG-4 | Agent Tool 与工作台 Action 都进入同一个 Creator Command Dispatcher。 |
| AG-5 | Agent Session、Turn、Item、Event、Approval 和 Command Receipt 持久化到 SQLite。 |
| AG-6 | 页面刷新可以继续同一存活审批；进程死亡后旧审批 expired，未知 Turn interrupted。 |
| AG-7 | 生产构建不存在规则回答、固定回复、Demo Artifact 或 mock 结果兜底。 |

### 2.3 Tool 与安全合同

| ID | 合同 |
| --- | --- |
| TS-1 | P0 工具固定为 `creator_get_context`、`creator_get_artifact`、`creator_apply_action`。 |
| TS-2 | Host 使用固定 Process Capability Lease；Turn 前 activate，终态 deactivate，Host 关闭 revoke。 |
| TS-3 | 同一 Host 同时只运行一个 Turn，确保进程 Lease 只有一个活动绑定。 |
| TS-4 | 写命令携带 `expectedRevision`、`idempotencyKey`；同键同载荷重放，同键不同载荷拒绝。 |
| TS-5 | revision、Activity、StageRun 调度意图和 committed receipt 在同一事务中提交。 |
| TS-6 | MCP URL、命令、环境或工具集合变化时重启 Host，不依赖 reload 刷新启动参数。 |

### 2.4 KrillinAI 合同

| ID | 合同 |
| --- | --- |
| KR-1 | 正式链路为 Creator StageRunner → Krillin Runtime Host → KrillinAI OpenCreator Service。 |
| KR-2 | 服务随机绑定 `127.0.0.1` 端口，并使用每进程高熵 Bearer Token。 |
| KR-3 | 服务只接收 job/stage/artifact 标识，不接受任意绝对工作目录。 |
| KR-4 | 所有路径在 Creator Jobs 授权根内 canonicalize，并拒绝 `..`、符号链接和跨 Job 逃逸。 |
| KR-5 | OpenCreator service mode 不暴露旧 `/api/config`、`/api/file` 和静态 UI。 |
| KR-6 | Provider 凭据只在 Keyring 和任务进程内存中存在，不进入 Job、Manifest、日志或诊断包。 |
| KR-7 | 未配置云端 ASR 时，如果安装包声明本地 Whisper 可用则走本地；两者均不可用才失败。 |

### 2.5 Krillin OpenCreator Protocol V1 快照

唯一协议源为 `packages/protocol/contracts/krillin-opencreator-v1.schema.json`。TASK-16 将其生成副本写入 `KrillinAI/api/opencreator/v1/schema.json`，两个文件的 SHA-256 必须相同；Go 和 TypeScript 通过相同黄金 JSON fixture 做合同测试。

```ts
type KrillinTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'interrupted';

type CreateKrillinTaskRequest = {
  protocolVersion: 1;
  jobId: string;
  stageRunId: string;
  stageType:
    | 'download'
    | 'subtitle'
    | 'tts'
    | 'render-horizontal'
    | 'render-vertical';
  idempotencyKey: string;
  requestHash: string;
  inputArtifactIds: string[];
  options: Record<string, unknown>;
  providerConfig?: Record<string, unknown>;
};

type KrillinTask = {
  id: string;
  jobId: string;
  stageRunId: string;
  status: KrillinTaskStatus;
  lastEventSeq: number;
  resultManifestId?: string;
  error?: { code: string; message: string; retryable: boolean };
  createdAt: string;
  updatedAt: string;
};

type KrillinTaskEvent = {
  taskId: string;
  seq: number;
  type: 'status' | 'progress' | 'artifact' | 'result' | 'error';
  payload: Record<string, unknown>;
  createdAt: string;
};
```

固定语义：

1. `POST /v1/tasks` 使用 `(jobId,idempotencyKey)` 唯一约束；同键同 `requestHash` 返回原 Task，同键不同 hash 返回 `idempotency_key_reused`。
2. 状态转换只允许 `queued → running → succeeded|failed|canceled|interrupted`，以及 `queued → canceled`；终态不可回退。
3. `GET /v1/tasks/:id/events?afterSeq=N` 返回 `seq > N` 的升序事件和 `nextSeq`；seq 在单 Task 内单调且持久化。
4. 取消 queued/running Task 后进入 canceled；对终态重复取消返回原终态，不制造新事件。
5. Result Manifest 先写临时文件、fsync、原子 rename，再在同一持久事务中写 result event 和 succeeded；读取 succeeded 时 Manifest 必须已经可见且通过 Schema。
6. 服务启动时将遗留 running Task 转为 interrupted 并追加持久事件；queued Task 保留并可重新领取；completed/canceled 终态原样恢复。
7. providerConfig 只用于创建 Task 的进程内执行上下文，不写入 task metadata、event 或 Manifest。
8. 黄金 fixtures 至少包含 create、same-key replay、different-hash rejection、event cursor、cancel、success manifest、restart interrupted。

固定打包布局与环境合同：

```text
creator-runtime/krillinai/
  manifest.json
  bin/krillinai-opencreator-server[.exe]
  bin/ffmpeg[.exe]
  bin/ffprobe[.exe]
  bin/yt-dlp[.exe]
  bin/<local-asr>/...
  models/<provider-model>/...
```

```text
KRILLINAI_RESOURCE_ROOT=<包内 creator-runtime/krillinai 绝对路径>
KRILLINAI_OFFLINE_DEPENDENCIES=1
OPENCREATOR_KRILLIN_LISTEN=127.0.0.1:0
OPENCREATOR_KRILLIN_JOBS_ROOT=<userData>/creator/jobs
OPENCREATOR_KRILLIN_TOKEN=<256-bit 随机值>
```

`manifest.json` 固定 service version、KrillinAI upstream commit、OpenCreator patch hash、protocol v1 hash、平台/架构和每个资源 SHA-256。干净 PATH 且断网时必须只命中 manifest 资源，缺失资源直接返回 `dependency_not_packaged`。

## 3. 合同追踪矩阵

| 合同 | TASK | RED / 自动化测试 | 最终验收 |
| --- | --- | --- | --- |
| RC-1 | 1、2、3、18 | `codex-runtime-contract.test.ts`、`codex-app-server-protocol-0_149_0.test.ts`、`codex-runtime-package.test.mjs` | AC-1、AC-3、AC-18 |
| RC-2 | 3、4 | `codex-resolver.test.ts`、package test | AC-1、AC-2 |
| RC-3 | 4、7 | resolver、run-manager transport test | AC-2、AC-3 |
| RC-4 | 5、15 | `codex-runtime-readiness.test.ts`、routes.codex integration、Settings UI test | AC-4、AC-5 |
| RC-5 | 11 | `creator-codex-adapter.test.ts` | AC-13 |
| RC-6 | 2 | generated Schema snapshot/hash test | AC-18 |
| AG-1 | 8、9 | Creator repository/dispatcher tests | AC-9、AC-10、AC-11 |
| AG-2 | 13、14 | Creator SSE、Agent panel tests | AC-7、AC-10、AC-11 |
| AG-3 | 14 | Workbench no-turn test | AC-10 |
| AG-4 | 9、10 | Dispatcher/API/Tool equivalence test | AC-9、AC-11 |
| AG-5 | 1、8、12 | `creator-agent-storage.test.ts`、`creator-agent-recovery.test.ts` | AC-7、AC-8 |
| AG-6 | 12、13、15 | approval generation、SSE replay、Settings approval UI tests | AC-7、AC-8 |
| AG-7 | 14、19 | production-source mock scan、Runtime failure UI test | AC-12 |
| TS-1 | 10 | creator tool schema/API integration | AC-6、AC-11 |
| TS-2 | 6、10 | process lease activate/deactivate test | AC-6 |
| TS-3 | 6 | same-scope concurrent Turn queue test | AC-5、AC-6 |
| TS-4 | 1、8、9 | receipt protocol、concurrency/restart tests | AC-9 |
| TS-5 | 9 | transaction/crash-before-dispatch recovery test | AC-9 |
| TS-6 | 6、10 | MCP config invalidation/restart test | AC-6 |
| KR-1 | 1、16、17 | Go/TS golden contract、Host integration | AC-14、AC-16 |
| KR-2 | 16 | auth/listen tests | AC-14 |
| KR-3 | 16 | request Schema rejects path fields | AC-14 |
| KR-4 | 16 | path/symlink/cross-job tests | AC-14 |
| KR-5 | 16 | old route 404 tests | AC-14 |
| KR-6 | 16、17 | log/metadata/diagnostics secret scan | AC-14 |
| KR-7 | 17 | ASR capability selection tests | AC-15、VT-5、VT-6 |

反向检查：TASK-1 至 TASK-19 均至少服务于上述一项合同；TASK-0 只负责基线门禁，不产生产品行为。

## 4. 当前差距

| 范围 | 当前实现 | 目标差距 |
| --- | --- | --- |
| Codex 发现 | `apps/desktop/src/main/codex-resolver.ts` 搜索本机候选 | 默认只解析包内 manifest 和绝对二进制；外部模式显式化 |
| Codex 打包 | `electron-builder.yml` 未携带 Codex Runtime | 增加 Codex staging、manifest、哈希、包校验和回滚信息 |
| 普通 Agent | 已有 persistent app-server executor，但仍有 `exec` 传输分支 | 交互式请求强制 app-server，一次性任务显式分类 |
| Creator Agent | `codex-adapter.ts` 每 Turn 启动 app-server | 接入共享 Runtime Manager 和 scope Host |
| Agent 历史 | `agent-service.ts` 使用内存 `Map` | SQLite Session/Turn/Item/Event/Approval |
| Creator Tool | 直接调用 `CreatorService.applyAction` | 统一 Dispatcher、Process Lease、receipt 和调度事务 |
| 工作台 Agent | 仍有本地消息和 Demo 意图逻辑 | 使用服务端真实历史和事件，删除生产 Demo |
| KrillinAI | 当前以 CLI Stage Adapter 为主，旧 Server 无认证且状态在内存 | 新增 OpenCreator service mode、认证任务协议和持久任务状态 |

## 5. 公共命令

PowerShell 中带 `&&` 的组合命令拆开运行，并分别记录退出码。

| 命令 ID | 命令 | 用途 |
| --- | --- | --- |
| CMD-0 | `git status --short --branch`、`git rev-parse HEAD`、`git -C codex rev-parse "rust-v0.149.0^{commit}"`、`git -C KrillinAI rev-parse HEAD` | 执行前基线 |
| CMD-1 | `pnpm --filter @opencreator/protocol typecheck`；`pnpm --filter @opencreator/protocol test` | 公共协议 |
| CMD-2 | `pnpm --filter @opencreator/daemon typecheck`；`pnpm --filter @opencreator/daemon test -- <paths>` | Daemon 定向测试 |
| CMD-3 | `pnpm --filter @opencreator/web typecheck`；`pnpm --filter @opencreator/web test -- <paths>` | Web 定向测试 |
| CMD-4 | `pnpm --filter @opencreator/desktop typecheck`；`pnpm --filter @opencreator/desktop test -- <paths>` | Desktop 定向测试 |
| CMD-5 | `go test ./...`，工作目录 `KrillinAI` | KrillinAI 单元与集成测试 |
| CMD-6 | `pnpm typecheck`；`pnpm test`；`pnpm build` | 全仓回归 |
| CMD-7 | `pnpm desktop:package`；`pnpm --filter @opencreator/desktop verify:package` | 实际包结构与哈希 |
| CMD-8 | `pnpm e2e`；`pnpm --filter @opencreator/desktop e2e:package` | Web/Desktop 功能验收 |
| CMD-9 | `pnpm --filter @opencreator/desktop e2e:real-codex` | 登录环境下真实 Codex 冒烟 |

## 6. 任务依赖

```text
TASK-0
  └─ TASK-1
       ├─ TASK-2 ─ TASK-3 ─ TASK-4 ─ TASK-5 ─ TASK-6 ─ TASK-7
       ├─ TASK-8 ─ TASK-9
       │             └─ TASK-10（同时依赖 TASK-6）
       │                    └─ TASK-11
       │                          └─ TASK-12
       │                                └─ TASK-13
       │                                      └─ TASK-14
       │                                            └─ TASK-15（同时依赖 TASK-5）
       └─ TASK-16 ─ TASK-17（同时依赖 TASK-9）

TASK-18 依赖 TASK-3、7、12、15、17 全部完成
TASK-19 依赖 TASK-1 至 TASK-18 全部完成
```

任务可以在依赖满足后并行开发，但同一文件不得由两个任务同时修改；实施记录必须按任务保留 RED、GREEN 和回归证据。

Host 所有权固定为：只有 `apps/daemon/src/codex/app-server-runtime-manager.ts` 可以直接创建、缓存、重启或关闭 `createCodexAppServerHost`。`persistent-app-server-executor-2026-07-28.ts` 和 Creator Codex Adapter 都只能调用 Runtime Manager 接口，不得持有第二套 Host 生命周期。

## 7. 实施任务

### TASK-0：确认 Plan 和工作区基线

**交付结果**

- 确认源码、方案、二进制来源、dirty worktree 和测试环境仍符合本 Plan。

**步骤**

1. 执行 CMD-0，记录当前 106 项 dirty/untracked 状态，不删除、不回退用户已有改动。
2. 核对来源方案状态为“已批准”，目标稳定 commit 为 `758ef40...`。
3. 运行现有 Creator、app-server、capability、Desktop package 定向测试，建立实施前基线。
4. 若公共合同、Codex 稳定标签、KrillinAI commit 或关键文件已变化，先更新 Plan，不直接猜测兼容性。

**完成门**

- 基线命令有真实输出；既有失败、环境失败和本次回归可以区分。

### TASK-1：扩展公共 Protocol 与错误合同

**文件**

- 修改：`packages/protocol/src/api.ts`、`creator.ts`、`errors.ts`、`index.ts`
- 测试：`packages/protocol/test/creator-contract.test.ts`、新增 `codex-runtime-contract.test.ts`

**实施**

1. 增加 `BundledCodexManifest`、Runtime Readiness、Account、Host Scope、Agent Session/Turn/Item/Event/Approval、Command Receipt 类型。
2. 扩展 Creator Agent 状态：`queued | running | waiting_approval | completed | failed | canceled | interrupted | needs_user_resolution`。
3. 固定错误码：runtime 缺失/哈希/版本/协议、Host busy/crashed、approval expired、idempotency reused、Krillin auth/path/config/capability。
4. 所有公共类型保持 Runtime 无关，不暴露 app-server 原始 JSON-RPC 类型。

**TDD**

- RED：新增协议 shape、非法状态和错误码测试。
- GREEN：最小类型与 validator 实现。
- 回归：CMD-1。

**完成门**

- Daemon/Web/Desktop 可以只依赖 `@opencreator/protocol` 表达新状态；不存在 Codex 专属类型泄露到 Creator Contract。

### TASK-2：固定 Codex 0.149.0 Schema 生成与兼容门禁

**文件**

- 创建：`apps/daemon/scripts/generate-codex-app-server-protocol.mjs`
- 创建：`apps/daemon/src/codex/generated/v0_149_0/`
- 创建：`apps/daemon/test/unit/codex-app-server-protocol-0_149_0.test.ts`
- 修改：`apps/daemon/package.json`

**实施**

1. 只从 `git show rust-v0.149.0:codex-rs/app-server-protocol/schema/...` 读取已生成 TypeScript/JSON Schema。
2. 将 OpenCreator 实际使用的方法和事件生成到版本目录，保存来源 commit 和内容哈希。
3. 对 `ThreadStartParams`、`ThreadResumeParams`、`TurnStartParams`、关键 Request/Notification 做编译与 fixture 测试。
4. 明确 `developerInstructions` 不在 `TurnStartParams`；关键字段缺失时生成脚本失败。

**TDD**

- RED：先用缺字段/错误 commit fixture 证明门禁失败。
- GREEN：生成版本化协议并通过 snapshot。
- 回归：CMD-2 对协议测试。

**完成门**

- 删除 `codex/` 工作副本后，Daemon 仍可用已提交生成物构建；重新生成无差异。

### TASK-3：建立 Codex Runtime 打包合同

**文件**

- 创建：`apps/desktop/scripts/codex-runtime-contract.mjs`
- 创建：`apps/desktop/scripts/prepare-codex-runtime.mjs`
- 创建：`apps/desktop/test/codex-runtime-package.test.mjs`
- 修改：`apps/desktop/scripts/package-release.mjs`、`verify-package.mjs`、`electron-builder.yml`、`package.json`
- 创建或修改：`resources/codex-runtime/manifest.json`

**实施**

1. Manifest 固定 version、commit、官方 asset、platform、arch、sha256、schema hash 和构建时间。
2. 构建阶段只接受 manifest 对应的官方预构建二进制或 `OPENCREATOR_CODEX_BINARY` 显式输入，校验哈希后 staging 到 `.pack/codex-runtime`。
3. 安装包包含当前平台二进制、manifest 和 Schema；运行时不下载 Codex。
4. Desktop build manifest 记录 Codex 版本与哈希；包校验逐文件比较 staging 和 packaged resources。
5. 保留上一版 active manifest 的运行时目录结构，为升级回滚提供位置，但安装包只携带当前版本。

**TDD**

- RED：错误版本、错误哈希、错误平台、缺二进制、包内文件被替换均失败。
- GREEN：正确 fixture 能 staging 并通过 verify。
- 回归：CMD-4 的 package tests。

**完成门**

- 正式包不能从 PATH 或网络补齐 Codex；包内版本证据可追踪到稳定标签。

### TASK-4：改造 Desktop Codex 解析和隔离 Home

**文件**

- 修改：`apps/desktop/src/main/codex-resolver.ts`、`bootstrap-controller.ts`、`daemon-manager.ts`、`main.ts`
- 修改测试：`apps/desktop/test/codex-resolver.test.ts`、`workspace-ready.test.ts`、`daemon-output.test.ts`

**实施**

1. 默认模式从 `<resources>/codex-runtime/manifest.json` 解析绝对二进制并校验平台、版本和哈希。
2. 固定 `CODEX_HOME=<userData>/runtime/codex/home`，通过 Daemon env 显式传入。
3. 删除默认 PATH 搜索和静默 fallback；内置 Runtime 错误进入 Bootstrap 可诊断状态。
4. 高级设置增加 `bundled | external` 模式；external 需要显式路径、版本/协议检查和风险提示。
5. 外部模式也不得复用 bundled Home；两者 Home 分离。

**TDD**

- RED：机器 PATH 有其他 Codex 时默认仍必须选择 bundled；bundled 损坏不得切到 PATH。
- GREEN：绝对路径、Home 和诊断正确。
- 回归：CMD-4 定向测试。

**完成门**

- 有/无本机 Codex 的默认行为一致；OpenCreator 不修改用户 PATH 或全局 Home。

### TASK-5：升级 app-server Client、Host 和 Readiness

**文件**

- 修改：`apps/daemon/src/codex/app-server-client.ts`、`app-server-host-2026-07-28.ts`、`app-server-runner.ts`、`status.ts`
- 创建：`apps/daemon/src/codex/runtime-readiness.ts`
- 修改：`apps/daemon/src/api/routes.codex.ts`、`server.ts`
- 测试：现有 app-server client/runner/host 测试，新增 `codex-runtime-readiness.test.ts`

**实施**

1. 使用 TASK-2 生成类型替换关键路径的宽泛 JSON 解析。
2. 强制 initialize/initialized 顺序，并完成 model、skill、account 检查。
3. Readiness 分离 binary、protocol、account、models、skills、toolServer 和整体状态。
4. 增加 account read/login start/login cancel/logout API，转发 app-server account 方法；登录流程只作用于隔离 Home。
5. 保留 recoverable `configWarning`，关键协议不兼容直接阻断 Agent。

**TDD**

- RED：未 initialize 调用、重复 initialize、缺关键方法、未登录和 Schema 不兼容分别得到稳定状态。
- GREEN：Readiness 与 account API 可用。
- 回归：CMD-2 app-server、routes.codex、model tests。

**完成门**

- “未登录”不再显示为“Codex 损坏”；Web 能获得结构化登录和模型状态。

### TASK-6：实现 Scope Runtime Manager 和 Process Lease

**文件**

- 创建：`apps/daemon/src/codex/app-server-runtime-manager.ts`
- 修改：`apps/daemon/src/agent-tools/capability-token.ts`、`run-injection.ts`
- 修改：`apps/daemon/src/api/server.ts`、`shutdown.ts`
- 测试：新增 `app-server-runtime-manager.test.ts`，扩展 `agent-capability-token.test.ts`

**实施**

1. 支持 `project:<id>` 与 `creator-job:<id>` scope，按 scope 复用 Host。
2. 将 `createCodexAppServerHost` 的直接调用收口到 Runtime Manager；其他生产模块通过 `acquireScope/startTurn/closeScope` 使用 Host。
3. 每个 Host 创建 Process Capability Lease；同 Host Turn 串行排队。
4. Turn 前 activate run/thread/job/scopes，所有终态和异常 finally 中 deactivate。
5. Host close/invalidate/restart 时 revoke；Daemon restart 生成新 process generation 和 Token。
6. 活动 Turn 不参与 LRU；空闲 Host 按 TTL 和上限回收。
7. MCP 启动配置变化使 Host invalidated/restart，不把 reload 当作 env 刷新。

**TDD**

- RED：同 Host 两个并发 Turn、旧 Token、非活动请求、跨 Job 请求、LRU 杀活动 Host。
- GREEN：排队、租约和回收符合合同。
- 回归：CMD-2 capability、persistent executor、runtime manager。

**完成门**

- 同一 Host 连续两个 Turn 只能访问各自绑定的 Job；旧绑定请求稳定拒绝。

### TASK-7：统一普通交互 Agent 到 app-server

**文件**

- 修改：`apps/daemon/src/runs/manager.ts`、`persistent-app-server-executor-2026-07-28.ts`、`api/server.ts`
- 修改测试：`run-manager.test.ts`、`persistent-app-server-executor-2026-07-28.test.ts`、`persistent-app-server-server-2026-07-28.test.ts`

**实施**

1. 交互式 project/thread Run 强制通过 Runtime Manager/app-server。
2. `exec` 只允许 `createdBy=schedule` 或显式 `executionMode=one_shot_noninteractive`。
3. 删除内置 app-server 失败后切 exec 的静默分支。
4. 将 `persistent-app-server-executor-2026-07-28.ts` 改为 Runtime Manager 的调用适配层，删除其中直接创建/持有 Host 的逻辑。
5. 保持现有队列、取消、审批和事件协议兼容；普通 Agent 与 Creator Agent 按各自 scope 使用同一个 Manager 实例。

**TDD**

- RED：交互请求配置为 exec、app-server 不可用、schedule one-shot 三类路径。
- GREEN：交互路径只命中 app-server，schedule 保持可用。
- 回归：CMD-2 runs 全套定向测试。

**完成门**

- 日志和测试可以证明所有交互式 Run 的 transport 为 app-server。

### TASK-8：增加 Agent 与幂等持久化表

**文件**

- 修改：`apps/daemon/src/storage/migrations.ts`
- 创建：`apps/daemon/src/creator/agent/repository.ts`
- 扩展：`apps/daemon/src/creator/repository.ts`
- 测试：`creator-storage.test.ts`、新增 `creator-agent-storage.test.ts`

**实施**

1. 创建 `creator_agent_sessions/turns/items/events/approvals` 和 `creator_command_receipts`。
2. 增加唯一约束：Job session、runtime IDs、Item IDs、事件稳定键、`(job_id,idempotency_key)`。
3. Approval 保存 runtime request ID、process generation 和 payload；Receipt 保存 request hash、终态、结果/错误和 stage_run_id。
4. migration 对现有数据库增量执行；旧 Demo history 不迁移成真实 Turn。
5. 启动恢复将遗留 running Stage/Turn 标记为待对账，不直接成功或失败。

**TDD**

- RED：重复 Item、重复 receipt、旧库升级、重启读取、同键不同 hash。
- GREEN：Repository 原子、可恢复且无重复记录。
- 回归：CMD-2 storage/creator storage。

**完成门**

- 关闭 Daemon 后重新打开数据库，Agent 和命令历史完整，内存 Map 不再是权威。

### TASK-9：实现 Creator Command Dispatcher 和持久幂等

**文件**

- 创建：`apps/daemon/src/creator/command-dispatcher.ts`
- 修改：`apps/daemon/src/creator/service.ts`、`repository.ts`、`stage-runner.ts`、`apps/daemon/src/storage/migrations.ts`
- 创建：`apps/daemon/src/creator/stage-scheduler.ts`
- 修改：`apps/daemon/src/api/server.ts`、`shutdown.ts`
- 修改：`apps/daemon/src/api/routes.creator.ts`、`agent-tools/creator-tools.ts`、`internal-routes.ts`
- 测试：新增 `creator-command-dispatcher.test.ts`，扩展 Creator API/Service 测试

**实施**

1. 将当前 `applyAction` 的事务逻辑移动到 Dispatcher，Service 只作为领域 API。
2. 请求规范化后计算稳定 request hash；同键同 hash 重放 receipt，同键不同 hash 返回稳定冲突。
3. revision、Job/Artifact、Activity、StageRun 调度意图和 receipt 同事务提交。
4. `creator_stage_runs` 增加 `dispatch_status=queued|claimed|finished`、`claim_owner`、`claim_expires_at`、`attempt` 和 `idempotency_key`；Dispatcher 只提交 queued 意图。
5. StageScheduler 启动时扫描 queued 和过期 claimed 记录，以单条条件 UPDATE 原子领取，运行期间续租，完成后标记 finished。
6. Daemon 在“事务提交后、内存唤醒前”崩溃时，重启扫描仍会领取同一个 StageRun；外部执行使用 `stageRunId` 作为幂等键。
7. `run-stage` 必须真实创建可领取 StageRun；取消“只改 currentStage”的分叉。
8. REST actor 由认证入口决定，Tool actor 固定 agent，禁止请求体伪造。

**TDD**

- RED：并发重复、响应丢失重试、重启重试、同键不同 payload、revision conflict 后新键重试，以及事务已提交但 scheduler 尚未唤醒时崩溃。
- GREEN：只产生一次 revision、Activity 和 StageRun；重启后同一 StageRun 最终被领取并执行一次。
- 回归：CMD-2 Creator service/API/tools。

**完成门**

- UI 和 Agent 的相同 Action 产生完全相同的领域结果与 receipt；queued StageRun 不会因进程崩溃永久遗留。

### TASK-10：完成 Creator Tool Server 的 Turn 级授权

**文件**

- 修改：`apps/daemon/src/agent-tools/creator-tools.ts`、`internal-routes.ts`、`mcp-routes.ts`、`capability-token.ts`
- 修改：`apps/daemon/src/codex/argv.ts`、Runtime Manager
- 测试：`agent-tool-api.test.ts`、`agent-capability-token.test.ts`、新增 `creator-tool-process-lease.test.ts`

**实施**

1. MCP Host 环境只注入固定 Process Token。
2. Tool route 每次 inspect active grant，并匹配 job/thread/run/scopes。
3. `creator_get_artifact` 只允许当前 Job Artifact 和授权范围，不接受任意路径。
4. `creator_apply_action` 调用 Dispatcher，并强制 expectedRevision/idempotencyKey。
5. Tool 输入输出统一做大小限制、Schema 校验和日志脱敏。

**TDD**

- RED：未激活、停用后、旧 generation、跨 Job、越权 scope、路径逃逸。
- GREEN：合法当前 Turn 调用成功。
- 回归：CMD-2 agent tools 集成测试。

**完成门**

- Host 复用不扩大授权，Creator Tool 不能绕过 Dispatcher 或 StageRunner。

### TASK-11：重写 Creator Codex Adapter、Context 与 Skill 加载

**文件**

- 修改：`apps/daemon/src/creator/agent/runtime-adapter.ts`、`codex-adapter.ts`、`context-builder.ts`
- 修改：`apps/daemon/runtime/opencreator-runtime/SKILL.md` 或当前打包 Skill 源目录
- 修改：Runtime Manager Host bootstrap
- 测试：新增 `creator-codex-adapter.test.ts`、扩展 `creator-runtime-advanced.test.ts`

**实施**

1. Adapter 实现方案中的 start/resume/startTurn/steer/interrupt/subscribe/readHistory/closeScope。
2. 删除 `codex-adapter.ts` 中每 Turn `startCodexAppServer`。
3. Host 启动后调用 `skills/extraRoots/set`；`skills/list(forceReload)` 验证内置 Skill 可见。
4. `developerInstructions` 在 thread start/resume 注入强制规则；Turn input 仅包含用户消息和最小 Context Projection。
5. Context 只含 Job/revision/stage/selection/recentChanges/allowedActions；大 Artifact 按工具读取。
6. 用 Fake 非 Codex Adapter 验证 Creator Contract 不依赖 Skill 或 MCP 类型。

**TDD**

- RED：developerInstructions 错放 Turn、Skill 不可见、完整字幕误入 Prompt、Adapter 直接调用 KrillinAI。
- GREEN：协议调用顺序和上下文体积符合合同。
- 回归：CMD-2 Creator runtime tests。

**完成门**

- 模板不写入 Skill，Skill 不保存 Job 状态，替换 Adapter 不修改 Creator Core。

### TASK-12：持久 Agent Service、事件归一化和重启对账

**文件**

- 修改：`apps/daemon/src/creator/agent/agent-service.ts`
- 创建：`apps/daemon/src/creator/agent/event-normalizer.ts`、`reconciler.ts`
- 修改：`apps/daemon/src/api/routes.creator.ts`、`server.ts`
- 测试：新增 `creator-agent-service.test.ts`、`creator-agent-recovery.test.ts`

**实施**

1. 删除 history Map，Session/Turn/Item/Event 全部写 Repository。
2. app-server 通知归一化为稳定 OpenCreator AgentEvent，并按 runtime IDs 幂等保存。
3. 页面刷新从 DB replay；同一存活 Host pending approval 可以继续。
4. 新 process generation 启动时先 `thread/read(includeTurns:true)` 对账，再 resume Thread。
5. 旧 generation approvals → expired；无法证明仍活动的 running/waiting Turn → interrupted。
6. 未确认 Turn 不自动重放，用户显式继续时创建新 client message ID。

**TDD**

- RED：重复事件、页面刷新审批、Daemon 重启、app-server 审批中崩溃、completed 事件晚到。
- GREEN：历史一致且无永久 running/waiting。
- 回归：CMD-2 Creator Agent/API。

**完成门**

- 刷新与重启后用户看到的对话和真实 runtime 历史一致，旧审批不能被误响应。

### TASK-13：扩展 Creator API、SSE 与 Web Service

**文件**

- 修改：`apps/daemon/src/api/routes.creator.ts`
- 修改：`apps/web/src/services/creator-service.ts`、`runtime/creator-sse.ts`
- 修改：`packages/protocol/src/creator.ts`
- 测试：Creator API、Web creator-service、creator-sse 测试

**实施**

1. Agent history API 返回 Session/Turn/Item 和 pending approval 摘要，不再返回 Demo Turn 数组。
2. Creator SSE 统一传输 snapshot invalidation、Activity、Stage 和 Agent normalized events，并使用稳定 event ID。
3. 断线使用 Last-Event-ID 或 cursor replay；超出保留范围时回到快照 + DB history。
4. Web Service 为 start/steer/interrupt/respondApproval 提供显式方法。

**TDD**

- RED：断线重连、重复 Activity、Agent delta 顺序、终态后迟到事件。
- GREEN：客户端幂等消费，刷新不重复提示。
- 回归：CMD-2 API 与 CMD-3 service/SSE。

**完成门**

- “左侧工作台设置已同步”同一 actionId 只展示一次。

### TASK-14：移除工作台 Demo Agent 并接入真实对话

**文件**

- 修改：`VideoTranslationWorkspace.tsx`、`VideoTranslationAgentPanel.tsx`、`CreatorAgentPanel.tsx`、`creator-session-store.tsx`、`WorkbenchPage.tsx`
- 修改测试：对应组件测试与 `WorkbenchPage.test.tsx`

**实施**

1. 删除本地 messages、关键词意图判断、固定回复、假工具结果和 Demo fallback。
2. Agent 面板固定展示状态摘要、Activity、真实对话/工具/审批三层内容。
3. 工作台草稿先本地更新；发送 Agent 消息前 flush 并等待 revision 确认。
4. 工作台 Action 只产生 Activity，不启动 Turn；Agent Tool 结果通过同一 Store 更新工作台。
5. 快捷按钮明确区分直接 Action 和真实 Agent Turn。
6. Runtime 不可用时显示 Readiness 具体原因和设置入口，不显示演示结果。

**TDD**

- RED：工作台操作触发模型、重复 Activity、刷新丢对话、Runtime 失败出现 mock。
- GREEN：真实 Service 驱动全部状态。
- 回归：CMD-3 workbench/agent tests。

**完成门**

- 搜索生产源码不存在 Demo Agent 文案、规则回答函数或 mock Artifact 入口。

### TASK-15：完成 Codex 登录、审批和诊断 UI

**文件**

- 修改：`apps/web/src/features/settings/ClaweeSettingsView.tsx`、`DiagnosticsSettingsView.tsx`
- 创建或修改：Codex Runtime 设置子视图、`connection-service.ts`、`model-service-2026-08-05.ts`
- 测试：设置页、connection/model service、Agent approval UI 测试

**实施**

1. 展示 bundled 版本、commit、哈希、Home、account、model、skills、tool server readiness。
2. 提供 app-server account login start/cancel/logout 流程，不要求用户打开终端。
3. 审批 UI 绑定 approval ID 和 process generation；expired 后禁用提交并提示重新执行。
4. 外部 Codex 高级模式只接受显式路径，展示兼容检查结果。
5. Creator Services 设置继续独立展示 ASR/TTS/图片/视频 Provider，不与 Codex 登录合并。

**TDD**

- RED：已配置 Creator Provider 却提示 Codex API Key、expired approval 仍可提交、bundled 错误静默 fallback。
- GREEN：状态和入口分域正确。
- 回归：CMD-3 settings tests。

**完成门**

- 用户能在 OpenCreator 内完成 Codex 登录；“AI 服务设置”和“Codex Agent 登录”不会混淆。

### TASK-16：在 KrillinAI 增加 OpenCreator Service Mode

**文件**

- 创建：`packages/protocol/contracts/krillin-opencreator-v1.schema.json`
- 创建：`packages/protocol/test/fixtures/krillin-opencreator-v1/*.json`
- 创建：`KrillinAI/cmd/opencreator-server/main.go`
- 创建：`KrillinAI/api/opencreator/v1/schema.json`
- 创建：`KrillinAI/internal/opencreatorapi/` 下 server、auth、task store、path guard、DTO
- 复用/修改：`KrillinAI/internal/service/stage_exports.go`、`internal/pipeline/manifest.go`
- 测试：`packages/protocol/test/krillin-opencreator-contract.test.ts`、`KrillinAI/internal/opencreatorapi/*_test.go`

**实施**

1. 实现 2.5 的唯一 JSON Schema、黄金 fixtures、状态机、幂等和事件 cursor；Go Schema 副本必须与 Protocol 源文件哈希一致。
2. 实现 `/v1/health`、`capabilities`、`tasks`、`task read/cancel/events?afterSeq=`，所有 DTO 严格匹配 Schema。
3. 只绑定 Host 传入的 `127.0.0.1:0`，启动后通过 stdout 单行 JSON 报告端口和 generation，不输出 Token。
4. Bearer Token 从环境读取；所有路由包括 health 都认证。
5. 数据根从受控环境读取；请求只接收 job/stage/artifact ID，PathGuard 拒绝逃逸和跨 Job。
6. `(jobId,idempotencyKey)` 同键同 hash 重放原 Task、不同 hash 拒绝；事件 seq 持久单调。
7. Manifest 临时写入并原子 rename 后才能提交 succeeded/result event。
8. task metadata 和 events 写入 Job 任务目录；服务重启把 running 转 interrupted，保留 queued/terminal 状态。
9. service mode 不注册旧 router、config/file/static 路由。
10. Provider config 只保存在 task context 内存，日志统一 redact。

**TDD**

- RED：Go/TS fixture 漂移、同键不同 hash、事件断线续读、无/错/旧 Token、`..`、绝对路径、symlink、跨 Job、旧路由、日志密钥、running 重启和 Manifest 半写入。
- GREEN：最小服务合同可用。
- 回归：CMD-5。

**完成门**

- 本机其他进程即使发现端口，也不能访问任务或配置；服务不接受任意文件路径。

### TASK-17：实现 Krillin Runtime Host、Stage 接入与配置桥

**文件**

- 创建：`apps/daemon/src/creator/krillin/service-client.ts`、`runtime-host.ts`
- 修改：`apps/daemon/src/creator/krillin/adapter.ts`、`config-bridge.ts`、`dependency-preflight.ts`
- 修改：`apps/daemon/src/creator/stage-runner.ts`、`api/server.ts`
- 测试：新增 Krillin host/client/security/recovery 测试，扩展 creator runtime tests

**实施**

1. Daemon 生成服务 Token、随机端口启动参数和 Jobs 授权根，等待认证 health。
2. Client 使用 Protocol Schema/黄金 fixtures 生成或校验 DTO，按 `afterSeq` 断线续读并持久化 cursor。
3. StageRunner 以 `stageRunId` 作为 Krillin idempotencyKey 创建/查询 task，不再解析长期 CLI stdout 文案。
4. 服务崩溃时重启一次；对 task metadata 对账，running → interrupted，不自动重复计费 Stage；queued 由 StageScheduler 重新领取。
5. Config Bridge 从 Keyring 构造单任务配置，经认证请求传入，不落盘；所有错误脱敏。
6. Preflight 按能力选择云端 ASR、本地 Whisper 或缺失错误；沿用打包 dependency manifest。
7. Runtime Host 固定传入 2.5 的五个环境变量，使用干净 PATH，并验证 service binary、resource root 和 protocol hash。
8. CLI Adapter 仅保留显式迁移开关和真实结果，在 P2 验收后删除正式入口。

**TDD**

- RED：错误 Token、事件 cursor 重连、服务崩溃、重复 task key/不同 hash、配置泄漏、资源缺失时意外下载、云端缺失但本地可用、两者均缺失。
- GREEN：真实 Stage 任务可恢复且选择正确。
- 回归：CMD-2 Krillin/StageRunner 和 CMD-5。

**完成门**

- 视频任务的状态、取消、错误和 Artifact 均来自真实 Krillin task，不来自 Demo 或推测。

### TASK-18：更新完整安装包和 Web/Desktop 一致性门禁

**文件**

- 修改：`apps/desktop/electron-builder.yml`、package/prepare/verify scripts、build manifest
- 修改：`apps/desktop/e2e/creator-packaged-app.spec.ts`、`real-codex.smoke.ts`
- 修改：`apps/web/e2e/web-desktop-parity.spec.ts`、必要的 parity fixture

**实施**

1. 安装包同时包含 Codex Runtime、KrillinAI service、yt-dlp nightly、FFmpeg、可声明的本地 ASR 和 Web 新鲜构建。
2. Krillin manifest 固定 service version、upstream commit、OpenCreator patch hash、protocol hash 和逐资源 SHA-256；干净 PATH/离线包测试证明不触发下载。
3. verify 检查所有 runtime manifest、版本、哈希、平台、架构、禁止开发文件和 Web hash 一致性。
4. 使用同一 Fake Daemon、项目、会话、偏好和内容视口比较 Browser/Desktop 首页、项目、设置、输入区、文件工作区和 Creator 工作台。
5. 实际 App E2E 覆盖 preload、`clawee-app://`、Runtime proxy、默认项目、Agent 登录状态、Creator Job 和原生 capability。
6. 真实 Codex 冒烟只在具备测试账号的受控环境运行；缺账号标记 BLOCKED，不用 fake 冒充。

**TDD**

- RED：旧 Web、缺 Codex、Codex 哈希错、Krillin service 缺失、两端请求序列不同。
- GREEN：打包和 parity 门禁全部通过。
- 回归：CMD-4、CMD-7、CMD-8、条件满足时 CMD-9。

**完成门**

- 包内 Web 与本次 `apps/web/dist` 文件列表和哈希完全一致；Runtime 均来自包内固定资源。

### TASK-19：真实验收、迁移清理与发布门禁

**文件**

- 修改：相关测试、诊断、迁移文档和 release runbook
- 删除：生产 Demo Agent/规则兜底、已完成迁移的 CLI 正式入口
- 创建：`docs/test-reports/OpenCreator真实Agent与Codex-AppServer最终验收-2026-08-21.md`

**实施**

1. 执行 CMD-1 至 CMD-8；条件满足时执行 CMD-9。
2. 执行 AC-1 至 AC-18 和真实视频矩阵，保存命令、退出码、版本、Artifact、截图与日志摘要。
3. 全仓搜索 `mock/demo/fallback`，逐项证明仅存在测试夹具或明确非生产示例。
4. 验证数据库从当前版本升级、旧 Demo history 隔离、Codex runtime manifest 回滚和 Krillin task 恢复。
5. 执行 Web/Desktop 强制八项一致性门禁。
6. 对未执行的真实外部 Provider 或平台测试标记 BLOCKED，禁止写成 PASS。

**完成门**

- 所有强制 AC 有新鲜证据；任一生产 mock、重复 Stage、永久 running/waiting、包内旧 Web 或 Runtime 哈希不匹配都阻止完成声明。

## 8. 最终验收矩阵

TASK-19 先创建并冻结 `apps/web/e2e/fixtures/creator-acceptance/manifest.json`，记录本地媒体路径/SHA-256、外部 URL/平台 ID、许可来源、源语言、目标语言、预期时长范围和最后验证时间。验收期间不得临时换样例；外部样例失效则该项为 BLOCKED，更新 manifest 后必须重新执行全部关联 VT。

| AC | 前置环境 / 固定数据 | 公开操作 | 独立业务预期 | 最高验证层 / 命令 | 新鲜证据 |
| --- | --- | --- | --- | --- | --- |
| AC-1 | 无系统 Codex；实际 unpacked App | 启动 App，打开 Runtime 诊断 | 显示 bundled `0.149.0`、稳定 commit、隔离 Home，Agent 可进入登录态 | Packaged E2E / CMD-7、8 | 诊断 JSON、进程 argv/env 脱敏摘要、截图 |
| AC-2 | PATH 放入不同版本 fake/真实 Codex；全局 Home 写入标记文件 | bundled 模式启动并完成一个 Turn | 只启动包内绝对路径；全局 Home 标记不变 | Packaged E2E / CMD-8 | 子进程路径、两个 Home 文件哈希 |
| AC-3 | 复制实际包并篡改 Codex 一个字节 | 启动 Agent | Readiness 为 hash_error；无 PATH、exec、mock fallback | Package + App E2E / CMD-7、8 | verify 失败输出、UI 错误、无替代进程证明 |
| AC-4 | 受控真实 Codex 测试账号 | UI 执行 login、account/read、logout，并模拟 token 过期 | account 状态准确；Creator 历史仍可读 | Real Codex / CMD-9 | account 事件、UI 截图、脱敏日志 |
| AC-5 | 一个 project scope、两个固定用户消息 | 连续发送 Turn A/B | 同一 Host PID、同一 Thread；两次完整 Item 流且顺序正确 | Daemon integration + real smoke / CMD-2、9 | Host/Thread/Turn IDs、事件序列 |
| AC-6 | 两个 Creator Job；同一 Host 先后运行两个 Turn | Turn A/B 分别调用三种 Creator Tool，并在空闲期调用一次 | 仅当前 Job/Run/scopes 成功；旧绑定、空闲和跨 Job 均拒绝 | Integration / CMD-2 | activate/deactivate 审计与 HTTP 结果 |
| AC-7 | 已有消息、Activity、Stage 和 pending approval；Host 保持存活 | 刷新页面并重连 SSE | 数据只出现一次，原 approval 可继续处理 | Web + Desktop E2E / CMD-3、8 | 刷新前后 DOM、event IDs、approval result |
| AC-8 | Turn 停在 approval；分别终止 Daemon 和 app-server | 重启 App，打开原 Job，再显式发送继续消息 | 旧 approval expired；旧 Turn interrupted；新 Turn 可继续，无旧 request 回写 | Integration + Packaged E2E / CMD-2、8 | generation、状态迁移、Thread 对账日志 |
| AC-9 | 固定 Action 请求；注入并发、响应丢失、事务提交后崩溃 | 用同 idempotencyKey 重试并重启 Daemon | 一个 revision、Activity、StageRun；重启 scheduler 最终执行一次 | Integration / CMD-2 | DB 快照、receipt、claim/attempt、执行计数 |
| AC-10 | 一个视频翻译 Job | 工作台修改语言、音色和字幕，不发送 Agent 消息 | Agent 状态/Activity 实时更新且每 action 一条；无新 Turn | Web E2E / CMD-3、8 | Runtime 请求序列、Activity IDs、Turn 数量 |
| AC-11 | 同一 Job/revision | Agent 指令修改字幕并触发 Stage | 工作台显示新 revision、Artifact/stale 和 Stage；REST/Tool receipt 同形 | Real/Fake controlled Agent E2E / CMD-2、8、9 | Tool Item、receipt、UI/DB 快照 |
| AC-12 | 分别注入 Runtime、Tool、Provider、Krillin service 失败 | 从公开 UI 启动对应操作 | 显示真实稳定错误；无 Demo 消息、假进度或假 Artifact | Integration + E2E / CMD-2、3、8 | 错误码、Artifact 列表、源码 mock scan |
| AC-13 | bundled Skill 根；超大字幕 Artifact fixture | 启动/恢复 Thread 并询问字幕问题 | `skills/list` 可见 Skill；developerInstructions 在 Thread；Turn input 小于上限并按需读 Artifact | Integration / CMD-2 | JSON-RPC fixture、输入字节数、Tool 调用 |
| AC-14 | Krillin service fixture 和两个 Job 根 | 测试无/错/旧 Token、`..`、绝对路径、symlink、跨 Job、旧路由 | 全部拒绝；正常任务可用；日志/metadata/diagnostics 无密钥 | Go + Daemon integration / CMD-5、2 | HTTP 结果矩阵、secret scan、路径记录 |
| AC-15 | 三套固定 capability fixture：云端、仅本地、均无 | 从 UI 创建 subtitle Stage | 分别选择 cloud、本地 Whisper、needs_input；选择原因可诊断 | Daemon + packaged integration / CMD-2、8 | preflight JSON、实际子任务 provider |
| AC-16 | 第 9 节 VT-1..6 固定 manifest | 仅通过 Web/Desktop 公开视频翻译流程执行 | 每个 VT 获得唯一 PASS/FAIL/BLOCKED，媒体/Artifact 符合指标 | Real media E2E / CMD-8 + VT 命令 | URL/文件 SHA、ffprobe、SRT、Task/Artifact IDs |
| AC-17 | 同一 Fake Daemon、项目、会话、偏好、内容视口 `1366x768` | 分别以 Browser/Desktop Bridge 执行项目和 Creator 全流程 | 下述八项门禁全部 PASS，通用 DOM/文案/请求/持久结果一致 | Parity + packaged E2E / CMD-8 | DOM/截图 diff、请求日志、Web hash |
| AC-18 | 新鲜实际安装包和 build manifest | 运行 verify-package 并启动 Runtime readiness | Codex、Krillin、yt-dlp nightly、FFmpeg、ASR、Schema、Web 均逐资源版本/hash 匹配 | Package / CMD-7 | manifest、逐文件 hash、版本输出、离线启动证明 |

AC-17 必须展开执行项目规则八项门禁：同 fixture/视口；首页/项目/设置/输入/文件工作区对比；相同 Runtime API；Web 默认项目；Browser 隐藏原生入口；Desktop 原生入口真实调用；实际 App preload/协议/代理；Web 文件列表和哈希一致。任一子项失败则 AC-17 失败。

## 9. 真实视频验收组合

共同设置：源语言 `en`，目标语言 `zh-CN`；字幕输出为 UTF-8 SRT，至少一条非空目标字幕且时间轴递增；横屏输出 H.264/AAC `1280x720`，竖屏输出 H.264/AAC `720x1280`，音视频流均存在，输出时长与源视频差值不超过 1 秒。外部 Provider 名称、模型和凭据引用只写入本机验收配置，不写入报告；报告记录 provider/model 非敏感标识。

| ID | manifest 固定输入 | Provider / 操作 | 独立预期 | 命令与证据 |
| --- | --- | --- | --- | --- |
| VT-1 | `youtube-captioned`：固定 URL、video ID、duration range | 平台字幕开启；ASR 凭据为空；TTS 关 | 下载真实媒体并使用平台字幕；保存一次字幕编辑后 revision +1 | Packaged E2E；yt-dlp metadata、SRT、Activity/Artifact IDs |
| VT-2 | `youtube-no-caption`：固定 URL、video ID、source media SHA | 云端 ASR fixture；TTS 关 | 明确记录“平台无字幕→云端 ASR”；输出翻译 SRT | Packaged E2E；Krillin events、provider 标识、SRT |
| VT-3 | `local-short-en.mp4`：提交/LFS 文件，8-15 秒、1280x720、SHA-256 | 禁用云端 ASR；本地 faster-whisper 固定模型；TTS 固定测试 voice | 本地转录、翻译、配音并输出 1280x720；旧字幕编辑后音频/视频 stale | Packaged E2E；resource hit log、ffprobe JSON、Artifact 图 |
| VT-4 | `bilibili-public`：固定 URL、BV ID、duration range | manifest 指定字幕/ASR路径；TTS 同 VT-3 | 输出 720x1280 配音视频，字幕在安全区内且媒体指标通过 | Packaged E2E；下载 metadata、截图、ffprobe、Task IDs |
| VT-5 | 同 `local-short-en.mp4` | text Provider 可用；云端 ASR 全空；本地模型已打包；TTS 关 | preflight 选择本地 Whisper并成功生成字幕，不提示 OpenAI 转录 Key | Packaged E2E；preflight、进程资源路径、SRT |
| VT-6 | 同 `local-short-en.mp4` | 云端 ASR 全空；使用缺本地模型的受控 package fixture | StageRun 不启动；Job `needs_input`，deep link 指向 ASR 设置；无假 Artifact | Package fixture E2E；DB/Task 数量、UI 错误、manifest 差异 |

每个 VT 报告必须记录：fixture manifest commit/hash、输入 URL 或文件 SHA、Creator Job/StageRun/Krillin Task/Artifact IDs、Provider 非敏感标识、最终状态、SRT 校验和 `ffprobe -show_streams -show_format -of json` 输出。外部网络、账号或 URL 不可用时只能标记 BLOCKED。

## 10. 切换和回滚

1. 数据库 migration 在启动时一次性执行，执行前创建备份；失败时停止启动 Creator 写能力。
2. 新 Creator Agent 上线后，旧 Demo history 标记 `legacy_demo` 并从正式对话入口隐藏。
3. Codex active manifest 原子切换；新版本 Readiness 失败时可回到上一已验证目录，但不得切到系统 PATH。
4. Krillin service 初期保留显式开发迁移开关；正式 P2 验收通过后移除生产 CLI 分支。
5. 任何回滚都保留 Creator Job、Artifact 和 Activity；不得以删除用户数据恢复服务。

## 11. 完成声明规则

1. 未执行类型检查、相关单元/集成测试、Web/Desktop parity 和实际打包 App，不得声称完成。
2. 真实 Codex 或生产 Provider 因凭据/网络不可运行时，必须标记 BLOCKED 和残余风险，不得以 fake 测试替代真实验收。
3. 发现生产 Demo fallback、Runtime PATH fallback、重复 Stage、永久等待状态、密钥泄漏或路径逃逸时立即阻止发布。
4. 每个 TASK 完成时记录修改文件、RED/GREEN 命令、回归命令、未验证项和偏差；不得到 TASK-19 才集中补证据。

## 12. Plan Reviewer 修订记录

V1 Plan Reviewer 原始结论为 `REVISE`，无未决产品问题。V2 关闭情况如下：

| Reviewer 问题 | V2 修订 | 关闭证据 |
| --- | --- | --- |
| R-01 不可降低合同没有追踪 | 增加 RC/AG/TS/KR 全量合同追踪矩阵，映射 TASK、具体 RED 和 AC/VT | 第 3 节 |
| R-02 DAG 悬空且 Host 所有权不唯一 | 重绘依赖图；TASK-18 汇合 3/7/12/15/17，TASK-19 依赖全部；Runtime Manager 是唯一 Host owner | 第 6 节、TASK-6/7 |
| R-03 receipt 后存在调度崩溃窗口 | 增加 StageRun 持久 dispatch 状态、原子 claim、租约、启动扫描和过期回收 | TASK-9、AC-9 |
| R-04 Krillin 协议不足以并行实施 | 固定 Protocol V1 Schema、DTO、状态机、幂等、cursor、Manifest 原子提交、资源布局和环境合同 | 2.5、TASK-16/17/18 |
| R-05 AC/VT 不可直接执行 | 增加固定 fixture manifest、环境、公开操作、验证层、命令、证据和媒体指标 | 第 8、9 节 |

流程结论为 `PASS`：五项 Major 均已转化为唯一实施合同，不需要执行者在编码阶段重新选择架构。Reviewer 未运行测试、构建或服务；该结论仅表示 Plan 可执行，不代表代码或最终 AC 已通过。
