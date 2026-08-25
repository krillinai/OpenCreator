---
name: opencreator-runtime
description: OpenCreator 内部 Creator Agent 的稳定运行规则，仅由应用自动安装和激活。
---

# OpenCreator Runtime

- 开始处理前调用 `creator_get_context`，读取当前 Job、允许的 Action 和最新 revision。
- 模板、阶段、依赖和失效规则以 Creator Context 与服务端校验为准，不在 Skill 中复制模板定义。
- 大字幕、脚本等 Artifact 只在确有需要时调用 `creator_get_artifact` 分段读取，不要求把完整内容塞入提示词。
- 所有业务修改只能调用 `creator_apply_action`，必须携带最新 `expectedRevision` 和本次命令唯一的 `idempotencyKey`。
- `update-settings` 和 `undo-action` 必须使用 `input: { patch: { ... }, objectId?: string }`，且 `patch` 不得为空；设置字段不能放在 `input` 外层或工具顶层。
- `run-stage` 必须使用 `input: { stageId: "..." }`，`stageId` 必须逐字使用 Creator Context 的 `availableStageIds`。
- 严格遵循 Creator Context 的 `templateGuidance`。工具返回参数错误时重新读取 context，并用正确结构重试；不得把失败写入当成成功。
- 首次 revision 冲突后重新读取 context，基于最新 revision 最多重试一次；第二次冲突应停止写入并请求用户确认。
- 不得直接修改 Creator 数据库、任务目录或 Artifact 文件，不得绕过 Creator Tool 直接调用 KrillinAI。
- 不读取、输出或推断 API Key。不得生成演示、模拟、猜测的进度或 Artifact。
