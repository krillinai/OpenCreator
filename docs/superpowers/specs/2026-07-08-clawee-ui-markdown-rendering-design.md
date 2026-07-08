# Clawee UI Markdown 对话渲染设计

## 1. 背景

Clawee 当前前端对话区已经接入 Runtime、SSE、thread 历史和 `assistant_message` 思考过程展示，但消息正文仍然以纯文本 `<p>{text}</p>` 渲染。模型输出中的 Markdown 语法，例如 `**29°C**`、列表、代码块、表格和链接，会原样暴露在界面上，导致最终回复和思考过程都不够接近成熟 Agent 桌面应用的阅读体验。

用户已经确认两个产品策略：

1. Markdown 覆盖范围采用全面覆盖：对话、思考过程、工具结果、诊断、文件预览等文本展示都要纳入统一渲染策略。
2. HTML 策略采用禁止 HTML：不渲染原始 HTML，不通过 `dangerouslySetInnerHTML` 展示模型文本。

本设计补充 `2026-07-07-clawee-desktop-app-web-ui-design.md`，只处理 Clawee Web UI 的文本与 Markdown 渲染体系，不重做桌面壳、Runtime API、项目模型、会话模型或整体布局。

## 2. 参考结论

本次参考当前目录下 `open-design-main` 的前端实现，重点不是搬迁它的大型业务组件，而是吸收其聊天渲染经验。

### 2.1 可借鉴的模式

1. `open-design-main/apps/web/src/runtime/markdown.tsx`
   - 自研轻量 Markdown renderer。
   - 输出 typed React elements。
   - 普通文本路径不使用 `dangerouslySetInnerHTML`。
   - 支持常见聊天 Markdown：标题、段落、列表、任务列表、引用、分隔线、代码块、表格、链接、行内代码、粗体、斜体。
2. `open-design-main/apps/web/src/components/AssistantMessage.tsx`
   - `ProseBlock` 作为主要 assistant 文本入口。
   - `ThinkingBlock` 作为可折叠思考过程入口。
   - 最终回复与思考过程使用同一 Markdown renderer，但视觉密度不同。
3. `open-design-main/apps/web/src/styles/viewer/code.css`
   - `.prose-block`、`.md-p`、`.md-code-block`、`.md-table-wrap`、`.thinking-block` 等样式可以作为视觉参考。
   - 代码块、表格、链接、引用都有清晰的桌面应用质感。

这些内容只能作为实现思路参考，不能照搬。Clawee 必须改写以下差异：

1. Open Design 显式 Markdown 链接没有做完整协议白名单校验；Clawee 必须补 `isSafeHref`。
2. Open Design 图片分支允许 `http/https/data:image/blob` 并产出 `<img>`；Clawee 第一版不能在聊天区主动加载远程图片。
3. Open Design 代码高亮使用 shiki 并通过 `dangerouslySetInnerHTML` 注入高亮 HTML；Clawee 第一版禁止采用这条路径。

### 2.2 不应直接搬迁的部分

1. `AssistantMessage.tsx` 绑定了 Open Design 的 artifacts、question form、analytics、brand browser、plugin、project file 等业务逻辑，不能直接进入 Clawee。
2. `ToolCard.tsx` 的工具族和 Open Design 业务耦合较多，只能参考“工具输出卡片化”的方法。
3. artifacts 里的 `renderMarkdownToSafeHtml` 是 HTML 链路，不符合 Clawee 本阶段禁止 HTML 的策略。
4. shiki 高亮 + `dangerouslySetInnerHTML` 链路不能复用。
5. Markdown 图片直接输出 `<img>` 的链路不能复用。
6. `ColorSwatch`、`PROSE_HEX_COLOR_RE` 色值色块和 `::code-comment{}` 指令块属于 Open Design 业务增强，不进入 Clawee 第一版。
7. Open Design 的品牌、文案、插件机制、文件打开协议都不能直接复用。

## 3. 目标

本阶段完成 Clawee UI 的统一 Markdown 渲染基础能力，让对话体验接近用户认可的 Open Design 效果，同时保持 Clawee 的产品边界和安全边界。

具体目标：

1. 最终 Clawee 回复支持 Markdown 渲染。
2. 用户消息纳入统一渲染体系，但只启用极简子集，保持用户输入的字面语义。
3. 思考过程继续使用现有的 `assistant_message` / `agent_message` 分流方案：同一 run 中成功完成前的中间 `assistant_message` 进入思考过程，最后一个成功完成的 `assistant_message` 作为最终回复。
4. 思考过程中的中间文本支持 Markdown 渲染。
5. 成功完成但没有中间文本时，仍然保留“思考过程”入口，不伪造任何思考内容。
6. 运行中没有中间文本时，展示“思考中”状态，不能让用户误以为页面卡死。
7. 工具结果、诊断、错误、JSON、日志类内容有统一的可读展示策略，不能把 raw JSON 直接当普通 prose 混进聊天气泡。
8. Markdown 文件预览使用同一渲染体系的 document variant。
9. 所有模型文本都不通过 `dangerouslySetInnerHTML` 渲染。
10. 原始 HTML 标签按文本显示或转义显示，不作为 DOM 节点执行。

## 4. 非目标

本阶段不做：

1. 完整复制 Open Design 的 `AssistantMessage`。
2. 完整复制 Open Design 的 `ToolCard`。
3. 引入 artifacts、question form、brand browser、analytics 等 Open Design 业务功能。
4. 支持原始 HTML 渲染。
5. 让模型输出的 `<script>`、`<iframe>`、`style`、事件属性等任何 HTML 生效。
6. 重新设计 Runtime 事件协议。
7. 重新设计会话列表、项目树、设置页或桌面壳。
8. 伪造 Codex 或 Clawee 没有实际返回的思考内容。
9. 把 `reasoning_item` 作为思考过程唯一来源。Clawee 当前思考过程来源仍是 `assistant_message`。
10. 第一版语法高亮、数学公式、脚注、远程图片内联预览、Open Design 色值色块和 code-comment 指令块。

## 5. 当前问题

当前关键文件：

1. `apps/web/src/components/timeline/Timeline.tsx`
   - `renderMessageContent` 只返回 `<p>{item.text}</p>`。
   - `renderProcessStep` 对 `reasoning_summary` 和 `assistant_message` 使用 `splitSummaryParagraphs` 后渲染普通 `<p>`。
   - `diagnostic` 和失败 `done` 使用 raw `<pre>`，没有统一样式。
   - 过程空态不区分运行中和完成，当前统一显示 `等待 Clawee 返回结果...`。
2. `apps/web/src/components/timeline/timeline-model.ts`
   - 已经保留 `text` 和 `content` 字段，可以区分用户可读文本与 raw payload。
   - `tool_result` 事件当前把 `payload.toolCallId` 放入 `name`，直接展示会出现不可读的调用 id。
3. `apps/web/src/styles/app.css`
   - 已经有 Timeline、process、bubble 样式，但没有 Markdown prose、代码块、表格、链接、任务列表的完整样式。
4. `apps/web/package.json`
   - 当前未引入 Markdown 渲染依赖。
5. 文件预览当前没有 `FilePreview` 组件，真实入口是 `apps/web/src/features/details/DetailPanel.tsx` 的 `mode="file"`；`apps/web/src/components/editor/FileEditor.tsx` 是草稿编辑器，当前始终展示原始可编辑文本。

这些问题导致：

1. Markdown 语法原样显示。
2. 多段回答、代码块、表格缺少阅读结构。
3. 思考过程空白时缺少明确状态。
4. 工具和诊断输出在视觉上仍偏 raw。
5. 工具完成态标题如果直接使用当前 `item.name`，可能显示 `toolCallId` 而不是工具名。

## 6. 设计原则

1. 参考 Open Design 的效果，但实现 Clawee 自己的轻量渲染层。
2. 安全优先：模型文本永远不能直接生成未受控 HTML。
3. 组件边界清晰：Markdown renderer 只负责文本到 React 节点，不知道 Runtime、thread、run、project。
4. Timeline 只负责消息分组、最终回复与思考过程分流、以及不同 item 选择合适的展示组件。
5. 工具、诊断、日志不强行 prose 化，优先卡片化或代码块化。
6. 样式统一走 Clawee 当前 tokens，不引入新的大型 UI 框架。
7. 先保证聊天主路径正确，再把同一 renderer 扩展到文件预览和诊断详情。

## 7. 方案选择

### 7.1 方案 A：借鉴 Open Design，自研 typed React Markdown renderer

新增 Clawee 自己的 Markdown 渲染模块，参考 Open Design 的轻量 parser 和 React element 输出方式。它只支持 Agent 对话里高频 Markdown，不追求完整 CommonMark 兼容。

优点：

1. 最接近用户认可的 Open Design 对话效果。
2. 不使用 HTML 字符串链路，安全边界清晰。
3. 与当前 React/Vite 结构匹配，不引入重依赖。
4. 样式和交互可控，代码块复制、长代码折叠、表格滚动都容易做成 Clawee 风格。

缺点：

1. Markdown 兼容性需要我们自己维护。
2. 边界 case 需要单测覆盖。

### 7.2 方案 B：引入 `react-markdown` 和 `remark-gfm`

使用成熟 Markdown AST 链路，禁用 raw HTML，配置 GFM 插件。

优点：

1. Markdown 兼容性更完整。
2. 维护成本低。

缺点：

1. 增加依赖。
2. 视觉和交互仍需大量自定义 component。
3. 和 Open Design 当前聊天效果不是同一路实现。
4. 需要额外确认 raw HTML、链接协议、图片加载等安全策略。

### 7.3 方案 C：使用 micromark 输出 HTML 后 sanitize

使用 Markdown 转 HTML，再通过 sanitize 后插入页面。

优点：

1. Markdown 标准支持较好。
2. 文件预览场景常见。

缺点：

1. 与用户已确认的“禁止 HTML”方向冲突。
2. 即使 sanitize，也需要 `dangerouslySetInnerHTML` 或等价 HTML 注入链路。
3. 对模型输出不够保守。

### 7.4 推荐

推荐方案 A。

原因是 Clawee 当前需要的是 Open Design 那种聊天阅读体验，而不是完整 Markdown 文档系统。方案 A 能在不引入 HTML 字符串链路的前提下，快速补齐对话区最重要的阅读能力，并且可以和现有 Timeline 的 `assistant_message` 思考过程分流直接融合。

## 8. 架构设计

新增渲染层：

```text
apps/web/src/components/markdown/
  MarkdownRenderer.tsx
  markdown-parser.ts
  markdown-inline.tsx
  MarkdownCodeBlock.tsx
  clipboard.ts
  MarkdownRenderer.test.tsx
```

建议职责：

1. `markdown-parser.ts`
   - 输入纯文本。
   - 输出 block AST。
   - 不依赖 React。
2. `markdown-inline.tsx`
   - 渲染行内元素：粗体、斜体、行内代码、链接、裸 URL。
   - 负责链接协议校验。
   - 必须实现 `isSafeHref` 白名单，这是 Open Design 参考实现缺失、Clawee 必须补齐的部分。
   - 不允许协议时统一降级为纯文本，不渲染 disabled 链接。
   - 相对项目路径只有在调用方提供 `onLinkClick` 并接管跳转时才可点击；否则按纯文本展示。
3. `MarkdownCodeBlock.tsx`
   - 渲染 fenced code。
   - 支持语言标签、复制按钮、长代码折叠。
   - 第一版不做语法高亮。
   - 禁止复制 Open Design 的 shiki + `dangerouslySetInnerHTML` 高亮路径。
   - 后续如果要做语法高亮，必须使用 token 化 React 节点输出，不能注入 HTML 字符串。
4. `clipboard.ts`
   - 封装 `navigator.clipboard.writeText`。
   - 复制失败时返回 `false`，由 `MarkdownCodeBlock` 显示失败状态。
5. `MarkdownRenderer.tsx`
   - 组合 block 和 inline 渲染。
   - 暴露 variant。
   - 不知道 Timeline item 类型。
   - 使用 `useMemo` 按 `text` 和 `variant` 缓存解析结果，避免长会话频繁重渲染时重复解析历史消息。

对外 API：

```ts
export type MarkdownVariant = "assistant" | "user" | "process" | "tool" | "diagnostic" | "document";

export type MarkdownRendererProps = {
  text: string;
  variant?: MarkdownVariant;
  className?: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
};
```

Timeline 使用：

```text
Timeline
  -> renderMessageContent
    -> assistant_message -> MarkdownRenderer variant="assistant"
    -> user_message -> MarkdownRenderer variant="user"
  -> renderProcessStep
    -> MarkdownRenderer variant="process"
  -> renderToolStep
    -> ToolProcessCard / CodePayloadBlock
  -> renderDiagnostic
    -> DiagnosticProcessCard / MarkdownRenderer variant="diagnostic"
```

文件预览使用：

```text
DetailPanel mode="file"
  -> 根据 title/subtitle 后缀推断 markdown/json/html/text
  -> .md/.markdown
    -> MarkdownRenderer variant="document"
  -> .json/.html/.txt/.srt
    -> CodePayloadBlock 或预格式文本

FileEditor
  -> 继续展示原始可编辑文本
  -> 不在 textarea 内渲染 Markdown
```

## 9. Markdown 支持范围

第一版必须支持：

1. 段落。
2. ATX 标题：`#` 到 `####`。
3. 无序列表：`-`、`*`、`+`。
4. 有序列表：`1.`。
5. GFM 任务列表：`- [ ]`、`- [x]`。
6. 引用块：`>`。
7. 分隔线：`---`、`***`、`___`。
8. fenced code block：三个反引号，支持语言 label。
9. 行内代码。
10. 粗体：`**text**`。
11. 斜体：`*text*` 和 `_text_`。
12. Markdown 链接：`[text](https://example.com)`。
13. 裸 URL 自动链接。
14. GFM pipe table。
15. 原始 HTML 按文本显示。

不同 variant 的支持范围不同：

1. `assistant`、`process`、`tool`、`diagnostic`、`document` 支持上述完整第一版范围。
2. `user` 只启用段落换行、行内代码、fenced code、裸 URL 和安全 Markdown 链接，不启用标题、列表、表格、引用、分隔线、粗体、斜体和任务列表。
3. 用户消息这样处理是为了保持输入字面语义，避免 `1 * 2 * 3`、`# 标题`、`_变量_` 等普通文本被误解析。

第一版暂不支持或降级：

1. 原始 HTML 渲染：始终不支持。
2. Markdown 内嵌 HTML：按文本。
3. 脚注：按普通文本。
4. 数学公式：按普通文本。
5. 深层嵌套列表：允许基础展示，不保证完整 CommonMark 行为。
6. Markdown 图片：聊天区默认不主动加载远程图片，渲染为链接或附件提示；文件预览可以在后续基于可信本地资源白名单支持。
7. 嵌套强调：例如 `**a *b* c**` 按可识别的最外层或普通文本降级，不保证嵌套结构。
8. 跨行强调：例如 `**第一行\n第二行**` 按普通文本降级。
9. 粗体或斜体内部包含同类分隔符时按普通文本或局部文本降级，不能抛错。
10. 图片语法 `![alt](url)` 第一版不输出 `<img>`；聊天 variant 渲染为 `alt` 文本加安全链接提示，document variant 也默认不加载图片。

## 10. 安全策略

1. 不使用 `dangerouslySetInnerHTML` 渲染模型文本。
2. Markdown parser 输出自定义 AST 或直接输出 React elements。
3. HTML 标签不被解析成 DOM。方案 A 输出 React 文本节点时，React 会自动把 `<script>`、`<div>` 等标签作为字面文本转义显示。
4. 链接只允许：
   - `http:`
   - `https:`
   - `mailto:`
   - 相对项目路径，且必须由调用方 `onLinkClick` 拦截处理。
5. 禁止：
   - `javascript:`
   - `data:` 链接。
   - `file:` 链接直接打开。
   - `vbscript:`
6. 不允许的链接统一渲染为纯文本，不渲染 disabled 链接，也不保留可点击行为。
7. 外链默认 `target="_blank"`，并设置 `rel="noreferrer noopener"`。
8. Markdown 图片第一版不自动加载远程资源，避免模型输出触发隐私泄漏或不受控网络请求。
9. `assistant`、`user`、`process`、`tool`、`diagnostic` variant 下 `![]()` 不能产出 `<img>`。
10. `document` variant 第一版也默认不产出 `<img>`；后续如需支持，只允许可信本地资源白名单，且不能加载任意远程 URL。
11. 代码块第一版不做语法高亮，避免引入 shiki + HTML 注入链路。
12. 复制代码块只复制纯文本 code body，不复制额外 DOM 文案。

## 11. 思考过程设计

Clawee 的思考过程继续沿用当前已确定方案：

1. Runtime 中同一 run 的多个 `assistant_message` 会进入 Timeline。
2. 当 run 成功完成时，该 run 最后一个 `assistant_message` 是最终回复。
3. 同一 run 内最终回复之前的 `assistant_message` 是过程文本，展示在“思考过程”折叠区域。
4. `reasoning_summary` 如存在，也展示在同一折叠区域。
5. `run_status` 不作为主要思考内容展示，只用于判断运行状态和“正在思考”。
6. 成功完成但没有中间文本时，仍显示“思考过程”入口，展开后显示“本次没有可展示的中间过程”或保持空态说明；不能伪造内容。
7. 运行中没有中间文本时，显示“思考中”，展开后显示“等待 Clawee 返回过程...”。
8. 完成后默认折叠，避免过程文本压住最终结论。
9. 失败或取消时默认展开，便于查看诊断。

展示文案：

1. 运行中：`正在思考`
2. 完成且有过程：`思考过程`
3. 完成且无过程：`思考过程`
4. 运行中空态：`等待 Clawee 返回过程...`
5. 完成空态：`本次没有可展示的中间过程。`

## 12. 工具、诊断和日志展示

工具与诊断不能简单作为普通 Markdown prose 渲染。

### 12.1 工具调用

`tool_step` 使用紧凑卡片：

1. 标题：`使用工具 <name>` 或 `工具完成 <name>`。
2. 状态：运行中、完成、失败。
3. 摘要：从 payload 中提取可读字段。
4. 详情：默认折叠。
5. 详情内容：
   - JSON payload 使用格式化代码块。
   - 文本 output 可使用 `MarkdownRenderer variant="tool"`，但如果内容看起来是 JSON 或日志，优先代码块。

工具名处理必须避免把 `toolCallId` 当成可读名称展示：

1. `tool_use` 使用 payload 中的 `name`。
2. `tool_result` 使用 `toolCallId` 关联同一 run 或同一 process block 中已经出现的 `tool_use`，拿到可读工具名。
3. 如果找不到对应 `tool_use`，标题使用 `工具完成`，详情中再显示 `toolCallId`，不在主标题里显示 `call_...` 这类不透明 id。
4. 该映射只发生在 UI 派生层，不修改 Runtime 原始事件。

### 12.2 诊断

`diagnostic` 使用诊断卡：

1. 显示 severity。
2. 显示 message。
3. content 默认折叠。
4. content 为 JSON 时格式化为代码块。
5. content 为普通文本时使用 `MarkdownRenderer variant="diagnostic"`。

### 12.3 done 失败

失败或取消的 `done` 使用错误卡：

1. 显示状态。
2. 显示 terminationReason。
3. 展开后显示 raw content 代码块。

成功 `done` 不作为可见过程记录展示，除非本次没有任何过程文本且需要保留“思考过程”入口。

## 13. 文件预览

文件预览纳入统一策略，但不改变当前 mock/adapter 边界。

1. 只读预览挂载在 `apps/web/src/features/details/DetailPanel.tsx` 的 `mode="file"` 分支。
2. `DetailPanel` 根据 `title` 或 `subtitle` 后缀判断展示方式。
3. `.md`、`.markdown` 文件使用 `MarkdownRenderer variant="document"`。
4. `.json` 文件使用格式化代码块。
5. `.txt`、`.srt` 使用纯文本代码块或预格式文本。
6. `.html` 第一版不渲染为真实 HTML，显示源码或只读文本，避免和“禁止 HTML”策略冲突。
7. mock 文件预览仍需标记来源，不得暗示已经真实写盘。
8. `apps/web/src/components/editor/FileEditor.tsx` 是草稿编辑入口，继续使用 textarea 展示和编辑原始内容，不在编辑器内部渲染 Markdown。

## 14. 样式设计

新增样式应集中在 `apps/web/src/styles/app.css` 或拆分后的 markdown 样式文件中，并使用现有 Clawee tokens。

核心 class：

```text
.markdown-prose
.markdown-prose[data-variant="assistant"]
.markdown-prose[data-variant="user"]
.markdown-prose[data-variant="process"]
.markdown-prose[data-variant="tool"]
.markdown-prose[data-variant="diagnostic"]
.markdown-prose[data-variant="document"]
.md-p
.md-h
.md-ul
.md-ol
.md-task-list
.md-task-item
.md-quote
.md-inline-code
.md-code-block
.md-code-header
.md-code-body
.md-table-wrap
.md-table
.md-link
.md-hr
```

视觉要求：

1. 聊天回复字号和行高适合长文本阅读。
2. 思考过程更紧凑，字号略小，颜色更弱。
3. 代码块不使用大面积深色背景，保持 Clawee 浅色桌面应用质感。
4. 表格必须横向滚动，不能撑破对话列。
5. 链接要有可识别样式，但不能过于抢眼。
6. 行内代码不应导致行高跳动。
7. 长代码块默认展示前若干行，并提供展开按钮。
8. 复制按钮使用 lucide 图标，hover 时显示清晰状态。
9. 原始 HTML 作为文本时必须可读，不和真实 HTML 混淆。
10. 用户消息 variant 的标题、列表、表格等样式不应触发，因为用户消息不启用这些块级 Markdown。

## 15. 数据流

### 15.1 新消息

```text
Runtime SSE event
  -> eventToTimelineItem
  -> TimelineItem[]
  -> buildTimelineRenderItems
  -> finalAssistantMessageIds
  -> final message bubble 或 process block
  -> MarkdownRenderer / ToolProcessCard / DiagnosticCard
```

### 15.2 历史会话

历史会话仍然从 Runtime thread/run/event 数据恢复 Timeline。Markdown 渲染必须是纯前端展示行为，不改变历史数据结构。

要求：

1. 不迁移历史事件。
2. 不修改 Runtime payload。
3. 同一条历史消息和实时消息渲染结果一致。

### 15.3 Streaming 和等待状态

当前 Runtime 不是 token 级 Markdown streaming renderer，本阶段不强制实现逐 token 渲染。

要求：

1. run 开始后立即展示用户消息。
2. run 未完成且无过程文本时展示“正在思考”。
3. 中间 `assistant_message` 到达后追加到思考过程。
4. 最终 `assistant_message` 到达后展示最终回复。
5. 如果多个 assistant message 最后一起到达，仍按当前分流规则渲染，不能丢失中间过程。

## 16. 错误处理

1. Markdown parser 遇到无法识别的结构时，降级为普通文本段落。
2. 未闭合代码块按代码块渲染到文本末尾。
3. 未闭合粗体、斜体、链接按原文本展示。
4. 表格列数不一致时，缺失单元格为空，多余单元格保留。
5. 复制代码失败时，按钮显示失败状态，不影响消息阅读。
6. 链接协议不允许时，统一渲染为普通文本，不触发导航。
7. 渲染器异常不能导致整个 Timeline 崩溃。必要时上层可降级为 `<pre>` 文本。

## 17. 测试策略

### 17.1 Markdown renderer 单测

覆盖：

1. 粗体、斜体、行内代码。
2. 标题、段落、多段文本。
3. 无序列表、有序列表、任务列表。
4. fenced code，包含语言 label。
5. 表格，包含对齐行。
6. 引用和分隔线。
7. Markdown 链接与裸 URL。
8. `javascript:` 链接不生成可点击链接。
9. HTML 标签显示为文本，不生成 DOM 节点。
10. 未闭合 Markdown 降级合理。
11. `data:`、`file:`、`vbscript:` 链接降级为纯文本。
12. 图片语法不生成 `<img>`。
13. `user` variant 不把 `# 标题`、`1. 条目`、`*斜体*` 解析成标题、列表或斜体。
14. 嵌套强调和跨行强调降级，不抛错。
15. 代码块复制成功和失败状态。

### 17.2 Timeline 单测

覆盖：

1. `assistant_message` 最终回复中的 `**29°C**` 渲染为 `<strong>`。
2. 用户消息 Markdown 渲染但不破坏用户气泡。
3. 同一 run 多个 `assistant_message` 时，最后一个成功消息作为最终回复，前面的进入思考过程。
4. 思考过程中的 Markdown 生效。
5. 成功完成但无过程消息时，保留“思考过程”按钮。
6. run 运行中无过程消息时，显示“正在思考”和 `等待 Clawee 返回过程...`。
7. run 完成但无过程消息时，显示 `本次没有可展示的中间过程。`。
8. `diagnostic` JSON 展示为代码块，不当普通 prose。
9. 失败 `done` 默认展开并显示错误详情。
10. `tool_result` 能通过 `toolCallId` 关联 `tool_use` 显示可读工具名；找不到关联时主标题不显示不透明 id。

### 17.3 文件预览测试

覆盖：

1. Markdown 文件使用 document variant 渲染。
2. HTML 文件显示源码，不执行 HTML。
3. JSON 文件格式化显示。
4. `DetailPanel mode="file"` 是只读预览挂载点。
5. `FileEditor` 继续显示原始可编辑文本。

### 17.4 集成和视觉检查

覆盖：

1. 真实或模拟天气回复：`**29°C**`、列表、建议段落都正常渲染。
2. 代码块带复制按钮。
3. 长表格不撑破布局。
4. 思考过程完成后折叠，展开后能看到中间过程。
5. 无中间过程时不伪造内容。
6. 移动宽度或窄窗口下文本不溢出按钮和气泡。

## 18. 验收标准

本阶段完成后可以认为 Markdown 对话渲染达标，当且仅当：

1. 对话主路径中 Markdown 不再原样暴露。
2. 最终回复和思考过程使用完整第一版 Markdown 渲染；用户消息使用极简子集，保持输入字面语义。
3. 工具、诊断、错误不再以难读 raw JSON 直接污染聊天气泡。
4. HTML 不被执行。
5. `javascript:` 等危险链接不可点击。
6. 思考过程仍基于 `assistant_message` 分流，未被错误改成依赖 `reasoning_item`。
7. run 运行中有明确“正在思考”状态。
8. 完成后思考过程默认折叠。
9. 运行中和完成后的过程空态文案不同。
10. 文件预览中的 Markdown 文件使用同一 renderer，挂载在 `DetailPanel mode="file"`。
11. `FileEditor` 不把 textarea 内容渲染成 Markdown。
12. 自动化测试覆盖 renderer、Timeline、文件预览、工具名关联和安全策略。

## 19. 实施边界

实施时应优先保持变更集中：

1. 新增 Markdown renderer 组件和测试。
2. 修改 `Timeline.tsx` 的渲染入口。
3. 补充 Timeline 测试。
4. 修改 `DetailPanel mode="file"` 的只读文件预览分支。
5. 保持 `FileEditor` 为原始文本编辑器。
6. 新增 clipboard 工具函数和复制失败状态。
7. 添加样式。
8. 改写过程空态文案，区分运行中和完成。
9. 为 `tool_result` 增加 UI 层工具名关联展示。

不要在同一阶段：

1. 重写 App 总布局。
2. 重写 Runtime service。
3. 重构 thread/history 数据层。
4. 引入桌面壳。
5. 大规模搬迁 Open Design 组件。

## 20. 自审结论

1. 本设计无 `TBD` 或待定范围。
2. 本设计与用户已确认的“禁止 HTML”策略一致。
3. 本设计明确保留 `assistant_message` 作为思考过程来源，没有回到错误的 `reasoning_item` 唯一路径。
4. 本设计范围集中在文本渲染和 Timeline 展示，不扩大到完整 UI 重做。
5. 推荐方案 A 与用户认可的 Open Design 聊天效果最接近，同时避免搬入 Open Design 的业务耦合。
6. 已明确 Open Design 参考实现中不能照搬的安全差异：链接协议、图片加载、shiki/innerHTML 高亮。
7. 已把不存在的 `FilePreview` 映射修正为当前真实的 `DetailPanel` 和 `FileEditor`。
