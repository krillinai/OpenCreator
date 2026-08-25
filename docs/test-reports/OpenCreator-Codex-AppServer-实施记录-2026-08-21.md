# OpenCreator Codex App Server 实施记录

> 日期：2026-08-21
> 实施计划：`docs/plans/OpenCreator-Codex-AppServer兼容与真实Agent-实施计划-2026-08-21.md`
> OpenCreator 基线：`a1cca23e65648e53d972a0f3792eb120c1cf593e`
> Codex 稳定基线：`rust-v0.149.0` / `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`
> KrillinAI 基线：`a9f4ec207925d9ae702b2064d11607d1ba3bfef6`

## TASK-0：确认 Plan 和工作区基线

状态：完成

### 工作区

- 分支：`main`
- 工作区在实施前已有约 106 项 modified/untracked。
- `codex/`、`KrillinAI/` 以及 Creator 相关实现包含未跟踪文件，实施过程保留这些内容，不回退无关改动。
- 方案文档状态为 V3、用户已批准、Reviewer 流程结论为 `PASS`。
- 实施 Plan 状态为 V2、已批准执行、Reviewer 提出的 5 个 Major 已关闭。

### 通过的基线测试

- `pnpm --filter @opencreator/protocol typecheck`
- `pnpm --filter @opencreator/protocol test`
- Creator Service、Storage、Capability、Creator API 定向测试的大部分用例。
- Web Creator Agent 定向测试：5 个文件、8 个测试通过。
- Desktop Creator Runtime package 测试。

### 实施前已存在的失败

1. Daemon `persistent-app-server-executor-2026-07-28.test.ts`
   - 13 个测试中 1 个失败。
   - 用例：`crosses the no-replay boundary only after turn/start is written`。
   - 预期 EPIPE/reject，实际 Turn 正常完成；归类为既有时序失败，后续由唯一 Runtime Manager 改造覆盖。
2. Desktop `codex-resolver.test.ts`
   - 21 个测试中 12 个失败。
   - 失败主要来自旧的本机 Codex 搜索、macOS bundle、NVM、wrapper 行为，以及 Windows symlink `EPERM`。
   - 新合同默认只使用 bundled Runtime，测试将在 TASK-4 按新策略重写。
3. KrillinAI `go test ./...`
   - `cmd/desktop`、`internal/desktop` 因 Windows 缺少 OpenGL/Fyne 构建条件失败。
   - `internal/cli` 存在 Windows TempDir 文件占用清理失败。
   - CLI、config、deps、pipeline、resourcepath 等主要包通过；后续优先运行不依赖 Fyne 的定向测试，并在最终报告保留环境限制。

### 基线结论

现有失败可以与后续回归区分，稳定 Codex 标签、KrillinAI commit 和批准文档均未发生阻断性变化，可以进入 TASK-1。

## TASK-1：扩展公共 Protocol 与错误合同

状态：完成

- 增加 Codex Runtime、Creator Agent、Command Receipt、Krillin OpenCreator V1 等公共类型和稳定错误码。
- Creator 合同不暴露 app-server 原始 JSON-RPC 类型；TypeScript 与 Go 使用同一协议快照和黄金 fixture。
- 验证：Protocol 4 个测试文件、8 个测试通过；全仓类型检查通过。

## TASK-2：固定 Codex 0.149.0 Schema 生成与兼容门禁

状态：完成

- 固定来源为 `rust-v0.149.0` / `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`。
- 生成并提交 `apps/daemon/src/codex/generated/v0_149_0/`，协议 Schema SHA-256 为 `6670c9dc6595e01472c7b7ec35e604bc132b9fb7fab4894ea78ebee50f36e1ac`。
- 增加生成脚本和关键方法/字段门禁测试，确认 `developerInstructions` 只属于 Thread 初始化合同。

## TASK-3：建立 Codex Runtime 打包合同

状态：完成

- 打包 Codex `0.149.0`、`rg.exe`、Windows sandbox/command runner 资源和版本化协议快照。
- Manifest 固定版本、commit、平台、架构和逐资源 SHA-256；`codex.exe` SHA-256 为 `14b7e6b2356e82d1d9275579eaa588757b4e0a501b65dcc19fccdf77bd83dc00`。
- `verify:package` 对实际 `win-unpacked` 包校验通过。

## TASK-4：改造 Desktop Codex 解析和隔离 Home

状态：完成

- bundled 模式只解析安装包内绝对路径，不搜索 PATH、NVM 或 ChatGPT 应用内 Codex。
- OpenCreator 使用独立 Runtime Home，不修改或复用用户全局 `CODEX_HOME`。
- Desktop Resolver 单测和打包 E2E 已覆盖最小 PATH、NVM/ChatGPT 干扰及数据迁移。

## TASK-5：升级 app-server Client、Host 和 Readiness

状态：完成

- App Server Client 支持初始化、请求、通知、审批、超时、进程重启和协议诊断。
- Readiness 聚合版本、哈希、协议、模型、Skills、Account 和初始化状态。
- 补齐 `process_initialized` 生命周期证据，并在 Run 诊断中持久化。

## TASK-6：实现 Scope Runtime Manager 和 Process Lease

状态：完成

- `app-server-runtime-manager.ts` 成为 Host 生命周期唯一所有者。
- Process Capability Lease 在 Turn 前激活、终态后失活、Host 关闭时撤销；跨 Job、伪造和空闲调用均拒绝。
- 常驻 Host 串行执行 Turn，MCP 配置变化会失效并重启 Host。

## TASK-7：统一普通交互 Agent 到 app-server

状态：完成

- 生产默认 `runtimeTransport` 为 `app-server`，普通交互 Run 使用常驻 app-server。
- 定时任务和明确的一次性任务仍可使用既有一次性执行路径。
- 旧 JSONL CLI 集成测试显式注入 `runtimeTransport: 'exec'`；该注入不改变生产默认。

## TASK-8：增加 Agent 与幂等持久化表

状态：完成

- SQLite 增加 Creator Agent Session、Turn、Item、Event、Approval、Command Receipt 和调度状态。
- Repository 创建时会把遗留 `queued/running` Stage Run 标记为 `interrupted`，清理 claim，并把运行中的 Job 转为 `needs_input`。
- 持久化、重启恢复和迁移测试通过。

## TASK-9：实现 Creator Command Dispatcher 和持久幂等

状态：完成

- 工作台 Action 与 Agent Tool 统一进入 Creator Command Dispatcher。
- 写请求校验 `expectedRevision` 和 `idempotencyKey`；同键同载荷重放，同键不同载荷拒绝。
- Revision、Activity、StageRun 调度意图和 Receipt 在事务边界内提交，并支持重启后的 claim/lease 恢复。

## TASK-10：完成 Creator Tool Server 的 Turn 级授权

状态：完成

- 实现 `creator_get_context`、`creator_get_artifact`、`creator_apply_action`。
- Tool Server 与 REST 共用 Dispatcher，不接受任意 Job、路径或执行配置覆盖。
- Process Lease、Capability Token、MCP 路由、工具注入和跨 Job 拒绝测试通过。

## TASK-11：重写 Creator Codex Adapter、Context 与 Skill 加载

状态：完成

- Creator Agent 通过共享 Runtime Manager 启动/恢复真实 Codex Thread 和 Turn。
- 稳定 Skill 在 Runtime 准备阶段自动安装和校验，用户无需理解或手工操作 Skill。
- 模板仍属于 Creator 上层；Agent Context 只注入当前 Job、Stage、Artifact 摘要和按需读取引用，不把整套模板全文重复塞入每个 Turn。

## TASK-12：持久 Agent Service、事件归一化和重启对账

状态：完成

- Agent Session、Turn、Item、Event、Approval 全部持久化，服务端生成稳定序号。
- 刷新可重放历史和继续存活审批；进程死亡后旧 Turn/Approval 转为 `interrupted/expired`。
- Creator Agent Recovery、Storage、Service 和 app-server Approval 集成测试通过。

## TASK-13：扩展 Creator API、SSE 与 Web Service

状态：完成

- 增加 Creator Job、Action、Agent Timeline、Approval、SSE Replay 和 Runtime Readiness API。
- Web Creator Service 和 SSE 客户端使用游标恢复，避免重复 Activity 和消息。
- Creator API、SSE、Web Service 单元及集成测试通过。

## TASK-14：移除工作台 Demo Agent 并接入真实对话

状态：完成

- 工作台与右侧 Agent 面板共享唯一 Creator Job、Revision、Activity、Stage 和 Artifact 状态。
- 工作台操作只更新共享状态并形成一条 Activity，不会自动启动普通 Codex Turn；Agent 指令通过 Tool 修改同一状态源。
- 删除生产 mock service/change service；生产 Timeline/File 类型只允许 `source: 'runtime'`。
- Web/Desktop Parity E2E 已验证刷新恢复、两侧同步且不误启动普通 Codex Run。

## TASK-15：完成 Codex 登录、审批和诊断 UI

状态：完成（真实账号验收受环境阻断）

- 设置页增加 bundled Runtime 状态、版本、来源、Account 和诊断信息。
- UI 支持真实 Approval 的展示与原位处理，不生成本地假审批。
- 受控 app-server 测试全部通过；真实账号 E2E 因未设置 `CLAWEE_RUN_REAL_CODEX_SMOKE=1` 被条件跳过，详见最终验收报告。

## TASK-16：在 KrillinAI 增加 OpenCreator Service Mode

状态：完成

- 新增认证的 `opencreator-server`，随机监听 `127.0.0.1` 端口并使用高熵 Bearer Token。
- 实现 Task 幂等、事件游标、取消、重启中断恢复、Manifest 原子可见和授权根路径校验。
- 旧配置/文件/UI 路由不在 OpenCreator Service Mode 暴露。
- Krillin 后端定向 Go 测试全部通过。

## TASK-17：实现 Krillin Runtime Host、Stage 接入与配置桥

状态：完成

- OpenCreator 托管 KrillinAI 常驻服务生命周期，并把 Provider 配置仅注入任务进程内存。
- StageRunner 使用结构化 Task/Events/Result Manifest，不从普通日志猜测成功状态。
- Runtime 包含 `ffmpeg`、`ffprobe`、nightly `yt-dlp`、`whispercpp` 和 tiny 模型；无云端 ASR 时可选择本地 Whisper。
- Krillin Runtime Host、错误映射、服务客户端、视频翻译工作流和 capability 选择测试通过。

## TASK-18：更新完整安装包和 Web/Desktop 一致性门禁

状态：完成

- Desktop 打包前重建当前 Web，并校验 App 内嵌 Web 与 `apps/web/dist` 内容哈希一致。
- 实际包同时携带 Codex Runtime 和 Creator/Krillin Runtime，逐资源版本和哈希校验通过。
- 打包 E2E：`14 passed / 1 skipped`；Web/Desktop E2E：`29 passed / 13 skipped`。

## TASK-19：真实验收、迁移清理与发布门禁

状态：实现与自动化门禁完成；真实账号/真实媒体矩阵阻断

### 本轮修复

- Windows Skill 安装路径校验改为 `relative + sep + isAbsolute`，消除盘符和分隔符误判。
- MCP 启动统一使用 Windows 兼容的 Codex Process Runner。
- Codex 强制终止等待 `taskkill` 完成，避免结果返回后子进程仍占用目录。
- 首次超时原因变为不可覆盖，防止总超时被后续 spawn/inactivity timeout 改写。
- Skill Market 正式目录保持为空；事务单测注入候选目录，生产 API 明确拒绝未发布候选技能。

### 最终自动化结果

- `pnpm test`：Protocol 8、Desktop 81、Skill Market 6、Harness 3、Web 839、Daemon 948 个测试通过；Web 4、Daemon 26 个测试跳过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；仅有 Vite 大 chunk 警告。
- `pnpm e2e`：29 通过，13 跳过。
- `pnpm --filter @opencreator/desktop e2e:package`：14 通过，1 跳过。
- `pnpm --filter @opencreator/desktop verify:package`：通过，实际包约 1.47 GB。
- KrillinAI 后端矩阵：通过；`go test ./...` 仅因 Windows Fyne/OpenGL/CGO 无法构建 `cmd/desktop` 和 `internal/desktop`。
- `git diff --check`：无空白错误；仅提示 Windows 工作区 LF/CRLF 转换。

### 未冒充通过的项目

- 真实 Codex 登录/会话 E2E：2 条因未启用真实 Smoke 条件而跳过。
- `VT-1` 至 `VT-6`：缺少冻结的授权媒体 manifest 和受控 Provider 凭据，全部记为 `BLOCKED`，未用 fake E2E 替代。
- 详细状态见 `docs/test-reports/OpenCreator真实Agent与Codex-AppServer最终验收-2026-08-21.md`。
