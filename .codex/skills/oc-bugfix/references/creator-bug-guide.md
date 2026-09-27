# Creator Bug 排查指南

只在问题涉及 Creator 模板、Workspace、协作面板、执行进度、审批或生成工作流时读取。

## 先定位责任层

沿真实数据流找首个错误状态，不要只修最终展示：

1. 用户输入与模板 Workspace 上下文。
2. `CreatorPanelAdapter` 的模板语义映射。
3. `CreatorCollaborationPanel` 的通用消息、Stage、Activity、审批和 Composer。
4. Web service / Runtime 请求和标准事件。
5. Daemon、执行器及外部 Provider。
6. 持久化结果、项目列表和恢复路径。

用网络请求、Runtime 事件、持久化数据和组件状态交叉验证边界。日志中的错误字符串不是根因；确认它由哪一层产生，以及失败后状态是否仍继续推进。

## Creator 架构检查

- 所有模板共用唯一 `CreatorCollaborationPanel`。模板差异放在 Adapter、配置、回调或局部 slot，不能创建第二套消息、审批、SSE 或 Stage 框架。
- 通用 Panel 只消费 `phase`、`percent`、`message`、`completed`、`failed`、`total` 等标准进度；执行器私有字段只在 Runtime normalizer 或对应 Adapter 兼容。
- Activity 只记录用户可理解的业务变化。过滤 UI-only 状态，合并连续同类更新，未知模板使用 fallback 文案，不能暴露内部 Stage ID 或原始事件字段。
- 区分“后端仍在执行”“前端连接中断”“事件被错误标记失败”和“展示状态过期”。取消、重试、刷新恢复和重复事件要保持幂等。
- 项目产物必须能从项目列表和会话恢复路径找到；确认 project/session/task/artifact 标识在创建、执行和持久化各阶段一致。
- 外部 Provider 的 403、429、5xx 要保留可诊断信息，并区分鉴权、限流、输入不支持和临时故障。不要把所有异常改写成通用失败。

## 修复策略

- 优先修正状态或协议的真实来源，再调整 UI；避免用延时、强制刷新或隐藏错误绕过竞态。
- 共享行为在通用层修一次，模板语义在 Adapter 修；不要按模板复制通用逻辑。
- 对异步竞态，明确事件顺序、任务身份、终止条件和过期结果丢弃规则。
- 对历史任务或草稿，说明兼容策略；公共字段变化时检查旧数据和所有消费者。
- 涉及 Web/Desktop 时按 capability 隔离原生能力，不按 `hostBridge.kind` 分叉通用业务。

## 功能测试选择

至少覆盖报告问题的可观察结果，并优先补一条能在修复前失败、修复后通过的回归测试：

- Adapter：Stage/Phase/字段文案和 fallback。
- Activity：UI-only 过滤、连续更新合并、重复事件去重。
- Stage：成功、失败、取消、重试和刷新恢复。
- 进度：标准字段、乱序/重复事件、完成态不回退。
- Workspace/Panel：关键用户操作与共享 Panel 的交互结果。
- Runtime/Daemon：请求参数、错误映射、持久化和恢复。

UI 布局或拖拽问题应验证真实交互和关键尺寸；视觉问题保留相同内容视口。涉及共享 Web UI 时判断 Web/Desktop 一致性，但只有触及相关范围才执行对应门禁，不为局部问题默认打包 Desktop。
