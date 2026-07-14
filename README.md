# Clawee Agent

Clawee Agent 是一个本地优先的 Codex Agent 工作台。Web 前端负责会话、任务、文件、插件和设置体验；本地 Fastify daemon 负责 Codex CLI 调用、持久化、审批、附件、计划任务、搜索、通知状态和显式长期记忆。

## 环境要求

- Node.js 22 或更高版本。
- pnpm 9.15。
- 已安装并可执行 `codex`。
- 如需真实模型任务，Codex CLI 必须处于有效登录状态。

## 安装与启动

```bash
corepack enable
pnpm install
pnpm web:dev
```

浏览器打开 `http://127.0.0.1:9000/`。

开发 Web 服务会自动启动本地 daemon，并通过同源代理连接，无需手工复制 Runtime token。若只调试 daemon：

```bash
pnpm daemon:dev
```

daemon 会监听随机本机端口，并在 stdout 输出一次连接地址和临时 token。

长期计划任务默认在同一个底层 Codex thread 完成 50 次终态 Run 后，使用最新
ConversationSummary 建立新 Codex thread；resume 目标失效时也会自动尝试一次相同恢复。
Clawee Thread、Schedule 绑定和页面路由保持不变。可通过环境变量调整阈值，设为 `0`
可关闭按次数主动轮换：

```bash
CLAWEE_CODEX_THREAD_ROTATION_RUN_THRESHOLD=100 pnpm daemon:dev
```

该自动恢复只用于 `resumeMode: "auto"` 的计划任务；普通会话或显式
`resumeMode: "resume_thread"` 仍按原错误语义失败，不会静默新建上下文。

## 主要能力

- 会话分页、长列表虚拟化、正文搜索和目标消息定位。
- Run 后台执行、刷新恢复、跨会话切换、排队发送、立即打断并继续。
- 图片附件、多模态 Run、工作区文件浏览和安全 HTML 预览。
- Codex Skills 市场、MCP、Profiles、Schedules、Cleanup 和 Diagnostics。
- Codex app-server 审批闭环、全局任务中心和显式系统通知授权。
- 用户显式管理的全局、项目和线程记忆，以及版本化会话摘要。

## 数据目录

默认 Runtime 数据位于仓库根目录的 `.runtime/`：

- `.runtime/app.sqlite`：线程、Run、事件、任务、附件元数据、审批、记忆和摘要。
- `.runtime/runs/`：每次 Run 的脱敏日志、诊断和元数据。
- `.runtime/attachments/`：受控附件文件。
- `.runtime/workspaces/`：Runtime 托管工作区。

Codex 会话、配置、Skills 和 MCP 默认仍使用当前 `$CODEX_HOME`；未设置时使用 `~/.codex`。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:ci
pnpm perf:check
pnpm audit --audit-level high
```

真实 Codex 发布 smoke：

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## 安全边界

- daemon 仅监听 `127.0.0.1`，除健康检查外所有 API 都要求 Bearer token。
- HTML 预览默认禁用脚本、导航和弹窗，只允许受控的同工作区相对资源。
- 敏感记忆必须二次确认；Clawee 不会自动永久保存未确认内容，也不会写入外部知识库。
- Diagnostics 和 Run 日志在返回或导出前进行脱敏。

## 文档

- [用户指南与故障排查](docs/clawee-user-guide-and-troubleshooting.md)
- [Runtime API v1](docs/runtime-api-for-ui-v1.md)
- [完整优化实施计划](docs/superpowers/plans/2026-07-12-clawee-agent-complete-optimization.md)
- [最终验收报告](docs/superpowers/test-reports/2026-07-12-clawee-agent-final-acceptance.md)
