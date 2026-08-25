# OpenCreator 真实 Agent 与 Codex App Server 最终验收

> 日期：2026-08-21
> OpenCreator：`a1cca23e65648e53d972a0f3792eb120c1cf593e`（dirty worktree，保留用户已有改动）
> Codex：`0.149.0` / `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`
> KrillinAI：`a9f4ec207925d9ae702b2064d11607d1ba3bfef6`

## 1. 验收结论

实现结论：`PASS`。

自动化发布门禁结论：`PASS`。

真实外部依赖验收结论：`BLOCKED`。

OpenCreator 已完成真实 Creator Agent、Codex app-server、Creator Tool Server、工作台/Agent 共享状态、KrillinAI 常驻服务和完整打包。生产代码不再使用 Demo Agent、固定回答、假进度或假 Artifact 兜底。

当前不能声明“真实视频矩阵全部通过”，原因是工作区没有冻结的授权媒体 manifest，也没有本次验收专用的真实 Codex 账号和受控 Provider 凭据。该阻断不影响已完成的实现和自动化门禁，但阻止把外部真实链路标为已验收。

## 2. 核心架构验收

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 内置 Codex 隔离 | PASS | bundled `0.149.0`；绝对路径；独立 Runtime Home；PATH/NVM/ChatGPT 干扰 E2E 通过 |
| app-server 统一运行时 | PASS | 生产默认 `app-server`；常驻 Host、Thread/Turn、审批和生命周期测试通过 |
| Creator Tool Server | PASS | 三个 P0 Tool、Process Lease、跨 Job/伪造/空闲拒绝、Dispatcher 同源测试通过 |
| 工作台与 Agent 同步 | PASS | 唯一 Creator Job；Snapshot/Activity/Conversation 三类信息；Parity E2E 通过 |
| 无 Demo 兜底 | PASS | mock/change service 删除；生产 Timeline/File 只允许 runtime；源码扫描无 fake/mock 分支 |
| KrillinAI 常驻服务 | PASS | 认证、随机端口、Task/Events/Manifest、路径隔离、重启恢复测试通过 |
| 完整安装包 | PASS | Codex、Krillin、nightly yt-dlp、FFmpeg、WhisperCPP/模型及 Schema 哈希校验通过 |

## 3. 自动化结果

| 命令 | 结果 |
| --- | --- |
| `pnpm test` | PASS：Web 839、Daemon 948、Desktop 81、Protocol 8、Skill Market 6、Harness 3 |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS；Vite 报告大 chunk 警告，不影响构建 |
| `pnpm e2e` | PASS：29 passed，13 skipped |
| `pnpm --filter @opencreator/desktop e2e:package` | PASS：14 passed，1 skipped |
| `pnpm --filter @opencreator/desktop verify:package` | PASS：包约 1.47 GB，Daemon 约 89.9 MB，Fuses/Privacy 校验通过 |
| KrillinAI 后端定向 `go test` | PASS |
| KrillinAI `go test ./...` | BLOCKED：仅 Fyne Desktop GUI 受 Windows OpenGL/CGO 构建约束 |
| `pnpm --filter @opencreator/desktop e2e:real-codex` | BLOCKED：2 skipped，未设置 `CLAWEE_RUN_REAL_CODEX_SMOKE=1` |
| `git diff --check` | PASS：无空白错误；仅 LF/CRLF 提示 |

## 4. AC-1 至 AC-18

| AC | 状态 | 说明 |
| --- | --- | --- |
| AC-1 | PASS | 实际包内 Codex 版本、commit、隔离 Home 和 Runtime 诊断合同已验证 |
| AC-2 | PASS | bundled 模式忽略 PATH、NVM 和 ChatGPT 内 Codex |
| AC-3 | PASS | Manifest/hash 校验和失败不回退合同已由 package/resolver 测试覆盖 |
| AC-4 | BLOCKED | 登录、真实 account/read/logout 需要受控真实账号 |
| AC-5 | PARTIAL | 同 Host/Thread 顺序和事件在受控 app-server 测试通过；真实账号 Smoke 未执行 |
| AC-6 | PASS | Process Lease 和三个 Creator Tool 的授权边界通过 |
| AC-7 | PASS | 刷新、SSE 重连、事件去重和审批继续处理通过 |
| AC-8 | PASS | Daemon/app-server 重启后的 interrupted/expired 对账通过 |
| AC-9 | PASS | Revision、幂等、Receipt、Stage claim/lease 和恢复通过 |
| AC-10 | PASS | 工作台操作同步到 Agent Activity，且不自动启动 Codex Turn |
| AC-11 | PARTIAL | Tool/REST 同形和 UI 状态同步通过；真实 Codex Tool Item 未执行 |
| AC-12 | PASS | Runtime/Tool/Provider/Krillin 错误显示真实错误，无 Demo Artifact 兜底 |
| AC-13 | PASS | Skill 自动准备、Thread 指令和按需 Artifact Context 测试通过 |
| AC-14 | PASS | Krillin 认证、路径、旧路由、持久化和 secret 边界测试通过 |
| AC-15 | PASS | 云端、本地 Whisper、均不可用三类 capability 选择测试通过 |
| AC-16 | BLOCKED | 依赖 `VT-1` 至 `VT-6` 的冻结真实媒体矩阵 |
| AC-17 | PASS | Browser/Desktop 同代码、同 API、同状态和实际打包 App 门禁通过 |
| AC-18 | PASS | Codex/Krillin/yt-dlp/FFmpeg/ASR/Schema/Web 逐资源打包校验通过 |

## 5. 真实视频矩阵

| VT | 状态 | 阻断证据 |
| --- | --- | --- |
| VT-1 YouTube 平台字幕 | BLOCKED | 缺少冻结 URL、video ID、许可来源和预期时长 manifest |
| VT-2 YouTube 无字幕云端 ASR | BLOCKED | 缺少冻结样例和受控云端 ASR 凭据 |
| VT-3 本地短视频转录/翻译/配音 | BLOCKED | 缺少提交或 LFS 固定媒体及 SHA-256、测试 voice |
| VT-4 Bilibili 竖屏配音 | BLOCKED | 缺少冻结 BV ID、许可和真实输出检查基线 |
| VT-5 无云 ASR 时本地 Whisper | BLOCKED | 打包能力和自动化 fixture 已通过，但缺少 VT-3 固定真实媒体 |
| VT-6 本地模型缺失 | BLOCKED | 受控 package fixture 合同已测试，但缺少冻结真实媒体验收输入 |

必须先创建 `apps/web/e2e/fixtures/creator-acceptance/manifest.json`，记录媒体 SHA-256、外部平台 ID、许可、语言、时长和 Provider 配置，再执行整个 VT 矩阵。外部样例变化后需要重跑所有关联 VT。

## 6. 打包事实

- Codex Runtime Manifest：版本 `0.149.0`，协议 hash `6670c9dc6595e01472c7b7ec35e604bc132b9fb7fab4894ea78ebee50f36e1ac`。
- Krillin Runtime Manifest：协议 hash `30f633ded90956f0e00d9b95af4c1c136b0e57d1c2c51ddd5ad202924a2bb1c7`。
- Krillin 包含 `krillinai-opencreator-server.exe`、`ffmpeg.exe`、`ffprobe.exe`、nightly `yt-dlp.exe`、`whispercpp.exe`、依赖 DLL 和 `ggml-tiny.bin`。
- `verify:package` 返回 `ok: true`，Fuses 与 Privacy 均为 `verified`。

## 7. 残余风险

1. 未执行真实 Codex 登录态 E2E，账号过期和网络侧行为仍需在受控账号环境验证。
2. 未执行冻结真实媒体矩阵，平台限流、字幕变化、Provider 配额和最终媒体质量仍属于外部风险。
3. Windows 环境无法构建 KrillinAI 自带 Fyne Desktop GUI；OpenCreator 打包使用的是通过测试的无 GUI OpenCreator Service，不受该项影响。
4. Web 构建存在大 chunk 警告，属于性能优化项，不是本次功能阻断。
