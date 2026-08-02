# Agent 活动占位入口设计

## 目标

在 Clawee 左侧边栏的“新对话”正下方增加“Agent 活动”入口，为后续 Agent 运行活动功能提供稳定、可导航的产品位置。本次只实现入口、路由和占位页面，不接入活动数据。

## 产品行为

- 展开侧边栏时，入口显示活动语义的 Lucide 图标和“Agent 活动”文字。
- 收起侧边栏时，入口仅显示图标，并通过 `title` 提供“Agent 活动”提示。
- 点击入口后导航到 `/activity`，侧边栏入口通过 `aria-current="page"` 显示选中状态。
- 主内容区显示标题“Agent 活动”和“功能建设中”的简洁空状态。
- 刷新 `/activity` 时仍能恢复 Agent 活动视图。

## 前端结构

将 `activity` 加入共享的 `ActiveView` 和 `AppRoute` 联合类型，在路由解析、路由格式化、持久状态恢复和 `routeForActiveView` 中完整处理。`ClaweeSidebar` 的全局操作列表在“新对话”后插入 Agent 活动入口。主内容区使用独立的轻量占位页面组件，避免将未来活动功能耦合到通用占位分支。

所有实现位于 `apps/web`，Desktop 继续直接使用同一套 Web 前端产物，不增加 `hostBridge.kind` 分支或 Desktop 专属页面。

## 数据与错误处理

本次不请求 Runtime API，也不增加持久化数据。占位页面因此没有加载、空数据或请求失败状态；唯一状态由当前路由决定。

## 验证

- 侧边栏组件测试：入口位于“新对话”之后，点击调用 `onOpenView('activity')`，展开和收起状态均可访问，当前页面状态正确。
- 路由测试：`/activity` 可解析为 activity 视图，activity 视图可格式化回 `/activity`。
- App 测试：进入 activity 路由后显示“Agent 活动”和“功能建设中”。
- Web 类型检查和相关测试通过。
- 由于改动属于 Web/Desktop 共享 UI，使用 Browser Bridge 与 Desktop Bridge 的 App 测试确认相同文案和导航结果；实际打包 App 验证未执行时，不声明 Desktop 发布门禁完成。

## 非目标

- 不展示 Agent 运行记录、指标、图表或筛选器。
- 不新增 Daemon API、数据库表或偏好设置。
- 不设计未来活动数据的具体信息架构。
