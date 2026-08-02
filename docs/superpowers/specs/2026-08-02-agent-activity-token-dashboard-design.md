# Agent 活动与 Token 看板设计

## 目标

在 Clawee 左侧边栏的“新对话”正下方增加“Agent 活动”入口，展示 `claw-mcp` 采集的组织级 Agent 活动和 Token 用量。

首版支持两种角色视图：

- 企业管理员查看全企业汇总、员工分布，并下钻到任意员工、Agent、会话和回合。
- 普通员工只查看自己的汇总、Agent、会话和回合。

首版覆盖 Collector 能发现的全部 Codex/Agent 活动，不限于 Clawee 客户端发起的任务。不提供费用估算，不接入 SSE 实时更新。

## 产品入口与路由

- 展开侧边栏时，入口显示活动语义的 Lucide 图标和“Agent 活动”。
- 收起侧边栏时只显示图标，并通过 `title` 提供“Agent 活动”提示。
- 点击后导航到 `/activity`，入口通过 `aria-current="page"` 表示选中状态。
- Agent、员工、会话和回合详情使用可恢复的应用路由；刷新或前进后退不能丢失当前下钻位置。
- 所有页面位于 `apps/web` 共享实现，Desktop 不增加独立页面或平台分支。

## 角色与数据边界

### 企业管理员

管理员复用 `claw-mcp` 现有企业管理员权限，可查看：

- 全企业 Token、趋势和使用分布。
- 所有员工、Agent、会话、回合、活动和工具调用元数据。
- 回合标题、用户提示词、Agent 回复摘要和最后一条回复。

### 普通员工

普通员工只能查看当前登录账号拥有或绑定的 Agent 数据。服务端必须按认证会话中的 `tenant_id` 和 `user_id` 限定查询，不能接收前端传入的任意用户 ID 作为权限依据。

### 共同隐私限制

工具调用只返回名称、类型、状态、发生时间和耗时。首版不向任一角色返回工具输入、完整响应或响应正文，避免暴露文件内容、密钥和业务载荷。

## 数据流

```text
Codex / Agent runtime
        -> 累计 usage 事件
clawee-collector
        -> 标准化活动与 Token 上报
claw-mcp
        -> 组织级存储、角色授权、时间范围聚合
Clawee Daemon
        -> 使用现有企业会话代理只读 Activity API
apps/web
        -> 共享的管理员或员工 Agent 活动页面
```

`claw-mcp` 是组织级活动和用量的唯一事实源。Clawee 本地数据库不复制企业汇总数据。Web 不直接请求 `claw-mcp`，避免 Browser 与 Desktop 的 Cookie、CORS 和协议来源差异。

## Token 采集与存储

### 原始字段

每条回合用量至少包含：

- 身份：`tenant_id`、`user_id`、`collector_id`、`agent_id`。
- 关联：`session_id`、`turn_id`。
- 模型：`provider`、`model`；未知时为空，不伪造默认模型。
- Token：`input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`。
- 状态：`source`、`is_final`、`usage_available`。
- 时间：`first_observed_at`、`last_observed_at`、`completed_at`。

所有 Token 字段使用非负 64 位整数。未知值和真实的 `0` 必须可区分；对于无法提供 Token 的 Agent，记录 `usage_available=false`，页面显示“暂无用量数据”。

### 计算口径

- `total_tokens = input_tokens + output_tokens`。
- `cached_input_tokens` 是输入 Token 的子集，不重复加入总量。
- `reasoning_output_tokens` 是输出 Token 的子集，不重复加入总量。
- 可展示 `non_cached_input_tokens = max(input_tokens - cached_input_tokens, 0)`，但不另行持久化。
- Codex 的 usage 更新是同一回合的累计值。以 `(tenant_id, collector_id, agent_id, session_id, turn_id)` 为幂等键覆盖最新累计值，禁止把每次更新直接相加。
- 回合完成后保存最终累计值；迟到事件只允许以更完整或更大的有效累计值修正，不能降低已确认用量。

### 保留期

回合级 Token 和活动明细保留 90 天。清理任务按企业时区边界删除过期明细；首版不保留超出 90 天的长期聚合。删除必须覆盖用量、活动和对应查询索引，且不能影响账户、Agent 和权限记录。

## 查询与 API

`claw-mcp` 在现有 Activity API 体系中增加 Token 汇总，管理员和员工使用不同的服务端权限入口：

- 管理员：企业总览、趋势、员工列表、员工详情、Agent 详情。
- 员工：我的总览、趋势、Agent 列表、Agent 详情。

所有查询只接受 `today`、`7d`、`30d` 三种时间范围，默认 `7d`。服务端返回明确的范围起止时间和时区，避免浏览器与服务器按不同日期边界聚合。

Clawee Daemon 通过现有企业认证 Service 代理这些只读接口，并在 Protocol 层定义裁剪后的 DTO。响应中不得出现工具输入和响应正文。认证失效沿用现有企业账户错误语义，不建立第二套登录态。

## 页面设计

### 管理员总览

页面从上到下包括：

1. 标题与今天、近 7 天、近 30 天分段选择器。
2. 总 Token、活跃员工、活跃 Agent、完成回合四个核心指标。
3. Token 趋势，以及输入、缓存输入、输出、推理输出的构成。
4. 员工用量表，包含员工、总 Token、活跃 Agent、会话、回合、工具调用和运行时长。
5. 点击员工后进入员工详情，再下钻至 Agent、会话和回合。

员工表支持按名称搜索，默认按总 Token 降序。Token 缺失的员工不与真实零用量混在一起。

### 员工总览

页面从上到下包括：

1. 标题与相同的时间范围选择器。
2. 我的总 Token、活跃 Agent、完成回合三个核心指标。
3. 我的 Token 趋势。
4. 模型分布和 Agent 分布。
5. 最近回合列表，包含标题、Agent、Token、状态和耗时。

### Agent 与回合详情

详情展示 Agent 状态、当前工作区、会话与回合、Token 拆分、活动时间线、子 Agent、工具名称/类型/状态/时间/耗时。管理员可以看到员工的提示词和回复摘要，普通员工只能看到自己的内容。

页面采用安静、紧凑的工作台布局，不使用营销式大标题或装饰性卡片。指标卡仅用于少量核心统计，列表和详情使用表格、分栏与无外框信息区。

## 页面状态与错误处理

- 未登录企业账号：显示登录要求和进入企业账户页的明确操作。
- 无管理员权限：服务端返回禁止访问；客户端不降级为带残留企业数据的管理员页面。
- 加载中：保持页面骨架尺寸稳定，不改变侧边栏布局。
- 无 Agent：显示尚未采集到 Agent 活动，并提供 Collector 状态提示。
- 有活动但无 Token：活动正常展示，用量位置显示“暂无用量数据”。
- 部分记录缺少 Token：汇总标记“部分数据缺失”，并显示缺失记录数；不能把缺失值当作零参与平均值。
- 网络或服务错误：保留时间范围选择，显示可重试错误，不回退到过期的其他账号数据。
- 角色变化或退出登录：清除 Activity 查询缓存并重新按当前身份获取。

## Web / Desktop 一致性

该功能属于通用产品能力：

- Browser Bridge 与 Desktop Bridge 调用相同 Runtime API。
- 两端使用相同路由、DOM、文案、布局和状态处理。
- 不使用 `hostBridge.kind` 分叉页面或数据逻辑。
- 相同企业会话、Fake Daemon 数据和内容视口下，两端页面和请求结果必须一致。

## 验证

### `claw-mcp`

- Collector usage 标准化测试，覆盖累计更新、最终值、迟到事件和未知字段。
- 存储集成测试，覆盖幂等覆盖、Token 子集口径、企业隔离、用户隔离和 90 天清理。
- 管理员/员工 API 权限测试，证明员工无法请求其他用户数据，管理员可在本企业范围下钻。
- API 响应隐私测试，证明工具输入、响应和响应正文不会返回。

### Clawee Daemon 与协议

- 企业代理 Service 单元测试，覆盖认证、时间范围、上游错误和 DTO 裁剪。
- Runtime API 集成测试，覆盖管理员与员工响应，并验证不接受任意用户身份覆盖。
- 类型检查和 Protocol shape 测试。

### 共享 Web UI

- 侧边栏测试：入口位置、折叠提示、选中状态和导航结果。
- 路由测试：列表与详情路由可解析、格式化和刷新恢复。
- 页面测试：管理员、员工、未登录、无数据、缺失 Token、禁止访问和加载失败状态。
- Browser Bridge / Desktop Bridge 一致性测试：相同数据下可见文案、关键尺寸、Runtime 请求和下钻结果一致。
- 实际打包 App E2E：验证 `clawee-app://`、Preload Bridge、Runtime 代理、管理员/员工页面和详情下钻。

未完成类型检查、相关测试、Web/Desktop 一致性测试和实际打包 App 验证前，不声明该功能可发布。

## 非目标

- 不估算或展示模型费用。
- 不提供自定义日期范围。
- 不在首版接入 SSE 实时推送。
- 不展示工具输入、完整响应或响应正文。
- 不提供部门主管或部门级权限；首版只有企业管理员与普通员工。
- 不支持超过 90 天的趋势或长期汇总。
