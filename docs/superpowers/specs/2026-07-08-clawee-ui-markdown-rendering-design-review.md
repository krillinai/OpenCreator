# Clawee UI Markdown 对话渲染设计 — 评审意见

评审对象：`docs/superpowers/specs/2026-07-08-clawee-ui-markdown-rendering-design.md`

评审方式：逐条核对设计对现状的描述，并交叉阅读设计所引用的参考实现 `open-design-main/apps/web/src/runtime/markdown.tsx` 与 clawee 当前 `Timeline.tsx`、`timeline-model.ts`、`app.css`、`package.json`。

## 0. 总体结论

方案方向正确：选方案 A(自研 typed React renderer)、禁止 HTML、思考过程继续走 `assistant_message` 分流，这几条都与现有代码结构契合，落地成本可控，推荐通过。

但设计把参考实现 `markdown.tsx` 定性为"可直接借鉴"存在**误导性风险**。经核对，该参考实现在链接协议校验、图片远程加载、代码高亮三处的实际行为与本设计第 9/10 章的安全约束**直接冲突**。如果实施者按第 2.1 章的措辞"直接借鉴"甚至照搬，会引入设计明令禁止的行为。这几处必须在设计里显式标注为"参考中不安全、必须改写"的部分,否则验收标准第 4/5 条会形同虚设。

下面按严重程度排列。

---

## 1. 阻断级问题(必须在实施前修正设计)

### 1.1 【安全】参考实现的链接渲染没有做协议校验,设计却列为可直接借鉴

- 设计第 10 章要求：链接只允许 `http/https/mailto/相对路径`，禁止 `javascript:`/`data:`/`file:`/`vbscript:`；验收标准第 5 条"`javascript:` 等危险链接不可点击"。
- 实际核对参考实现 `markdown.tsx` 的 `renderInline`(577-655 行)：
  - 显式链接分支 `[text](url)`(609-622 行)直接 `href={href}`，**无任何 scheme 校验**。
  - 裸 URL 分支只匹配 `https?://`，这个安全；但显式链接分支不限协议。
  - 全文只有 `isSafeMarkdownImageSrc`(501 行)对**图片 src** 做校验，对 `<a>` 链接**没有**对应的 `isSafeHref`。
- 结论：`[点我](javascript:alert(1))` 在参考实现里会渲染成可点击的 `javascript:` 链接。设计第 2.1 章把 `markdown.tsx` 整体标为"可直接借鉴 ... 不使用 dangerouslySetInnerHTML"，容易让人误以为链接安全也已具备。
- 建议：
  1. 设计第 8 章 `markdown-inline.tsx` 职责里明确列出"必须新增 `isSafeHref` 白名单校验",并注明**这是参考实现缺失、Clawee 必须补齐的部分**。
  2. 不允许协议时的降级行为要写清：渲染为纯文本(推荐)还是 `disabled` 链接。设计第 16 章第 6 点两种都提了,需二选一定死。

### 1.2 【安全/自相矛盾】参考代码块用 shiki + `dangerouslySetInnerHTML` 高亮,与"禁止 dangerouslySetInnerHTML"冲突

- 设计目标第 9 条、安全策略第 1 条、验收第 4 条都强调"不使用 `dangerouslySetInnerHTML` 渲染模型文本"。
- 参考实现 `MarkdownCodeBlock`(412-492 行)对有语言标注的代码块会异步加载 shiki 并通过 `dangerouslySetInnerHTML={{ __html: highlightedHtml }}`(480-483 行)注入高亮 HTML。
- 设计第 8 章描述 `MarkdownCodeBlock` 职责时只写了"语言标签、复制按钮、长代码折叠",**既没提语法高亮，也没警告不要搬 shiki 路径**。实施者若为了"更接近 Open Design 效果"把高亮一起搬进来,就会违反自己的安全约束。
- 建议：设计第 8 章或第 10 章显式加一条："代码块第一版不做语法高亮;若后续要做,必须输出 React 节点(token 化),禁止走 shiki/innerHTML 路径。" 顺带在第 2.2 章"不应搬迁"列表补上 shiki 高亮链路。

### 1.3 【安全】参考实现默认加载远程图片,与"聊天区不主动加载远程图片"冲突

- 设计第 9.6、10.7 条：聊天区默认不主动加载远程图片,渲染为链接或附件提示,避免隐私泄漏/不受控网络请求。
- 参考实现 `isSafeMarkdownImageSrc`(501-510 行)允许 `http://`、`https://`、`data:image/`、`blob:`、相对路径,匹配到就直接渲染 `<img src>`(593-603 行),会立即发起远程请求。
- 结论：直接借鉴 `renderInline` 的图片分支会违反第 10.7 条。
- 建议：设计第 8 章明确"聊天 variant(message/process/tool/diagnostic)下 `![]()` 渲染为链接或占位提示,不产出 `<img>`;仅 `document` variant 且命中可信本地白名单时才允许 `<img>`"。这一点设计文字层面已隐含,但要落到 renderer 的 variant 行为上,否则实施容易漏。

---

## 2. 重要问题(影响落地准确性)

### 2.1 【落地】设计引用的 `FilePreview` 组件在 clawee 中不存在

- 设计第 8 章架构图和第 13 章都以 `FilePreview` 为文件预览入口,第 19 章第 4 点写"修改文件预览 Markdown 分支"。
- 实际核对：clawee web 里**没有**名为 `FilePreview` 的组件。文件内容当前由：
  - `src/features/details/DetailPanel.tsx`(mode=`file`,用 `<pre>{props.content}</pre>` 展示),
  - `src/components/editor/FileEditor.tsx`(见 `FileEditor.test.tsx`)
  承载。
- 结论：第 13 章的 `.md/.json/.txt/.html` 分支目前没有对应实体,"文件预览 Markdown 分支"这个改动点无处落。
- 建议：把第 8/13/19 章的 `FilePreview` 替换为真实组件名,明确 Markdown document variant 挂在 `DetailPanel(mode=file)` 还是 `FileEditor` 上,并说明二者分工(只读预览 vs 可编辑)。这是实施前必须澄清的映射。

### 2.2 【数据】`tool_result` 的 `name` 是 toolCallId,工具卡标题会显示不可读 id

- 设计第 12.1 条工具卡标题用"使用工具 `<name>`/工具完成 `<name>`",依赖 `item.name` 是可读工具名。
- 实际核对 `timeline-model.ts`：`tool_use` 的 name 取 `payload.name`(可读),但 `tool_result` 的 name 取 `event.payload.toolCallId`(78-85 行,是不透明调用 id)。
- 结论："工具完成 `<name>`" 实际会渲染成 "工具完成 `call_abc123`"。
- 建议：设计第 12.1 条补充说明——工具完成态需要用 `toolCallId` 关联回对应的 `tool_use` 拿到可读名,或明确接受显示 id。这是设计需要拍板的行为,不能留给实施临时决定。

### 2.3 【一致性】空态文案与现状不符,且未区分运行中/完成

- 设计第 11.4/11.5 要求两种空态文案:运行中"等待 Clawee 返回过程..."、完成"本次没有可展示的中间过程。"
- 现状 `Timeline.tsx` 320 行:两种情况共用同一句 `等待 Clawee 返回结果...`(是"结果"不是"过程",且不区分状态)。
- 这属于设计要改的目标(方向 OK),但第 5 章"当前问题"和第 19 章实施项没有把"空态文案需区分并改写"列为明确改动点,容易漏改。
- 建议:在第 5 章现状描述里补一句"当前空态文案不区分运行状态且用词为'结果'",并在实施边界里点名要改。

---

## 3. 中等问题(建议在设计里补充说明)

### 3.1 【产品】用户消息渲染 Markdown 的副作用未评估

设计目标第 2 条要求用户消息也走 Markdown。但用户输入里的 `*`、`_`、`#`、`1.` 等会被当语法解析,例如用户打 `1 * 2 * 3` 会被渲染成斜体、`# 标题` 会变大标题。设计只说"保持克制样式",没说明是否接受这种语义转换。建议明确:用户气泡是否只启用**极简子集**(如仅代码块/行内代码)或完全按纯文本 + 换行处理,避免误解析用户字面文本。

### 3.2 【依赖缺口】clawee 无 clipboard 工具与 `Icon` 组件

- 参考 `MarkdownCodeBlock` 依赖 `copyToClipboard`(lib)、`useT`(i18n)、自研 `Icon`。核对 clawee:无 `copyToClipboard` 工具、无 `useT`、图标用的是 `lucide-react`(已装,`^0.468.0`)。
- 设计第 14 章第 8 点说"复制按钮使用 lucide 图标"是对的(与 clawee 技术栈一致),但第 8/10 章没提"需新增一个 clipboard 复制工具函数"这一实现依赖。建议在实施边界补一条,并注明复制失败态(第 16 章第 5 点)由谁承接。

### 3.3 【兼容性边界】自研 inline 正则的已知限制未写入支持范围

参考实现的 bold 用 `\*\*[^*]+\*\*`、italic 用 `\*[^*\n]+\*`,因此**不支持**:粗体内含 `*`、粗斜体嵌套(`**a *b* c**`)、跨行强调。设计第 9 章列了"支持粗体/斜体",但没列这些边界。方案 A 的缺点(第 7.1 章)只笼统写"边界 case 需单测覆盖"。建议在第 9 章"暂不支持或降级"里显式写清嵌套/跨行强调的降级行为,让第 17.1 单测有明确断言目标。

### 3.4 【性能】未提渲染缓存策略

参考 `renderMarkdown` 每次渲染都重跑 `parseBlocks` + 正则。长会话里 Timeline 频繁 re-render 时,历史消息会重复解析。建议在设计里加一句:renderer 应对 `text` 做 `useMemo` 或在 Timeline 层记忆化,避免长线程滚动时的重复解析开销。非阻断,但值得写明。

### 3.5 【范围】应显式排除参考里的两个业务特性

参考 `markdown.tsx` 还带了 `ColorSwatch`/`PROSE_HEX_COLOR_RE`(色值色块)和 `::code-comment{}` 指令块(`CodeCommentBlock`)——这些是 Open Design 的设计系统业务特性。设计第 2.2 章的"不搬业务"是泛化表述,建议点名这两个,防止实施时顺手带入。

---

## 4. 正确性核对结果(设计对现状的描述属实)

以下设计断言经核对**属实**,无需修改:

1. 第 5.1 条:`renderMessageContent` 只返回 `<p>{item.text}</p>` —— 属实(`Timeline.tsx:225`)。
2. 第 5.1 条:`renderProcessStep` 对 `reasoning_summary`/`assistant_message` 用 `splitSummaryParagraphs` 后渲染普通 `<p>` —— 属实(267-278 行)。
3. 第 5.1 条:`diagnostic` 与失败 `done` 用 raw `<pre>` —— 属实(287-288 行)。
4. 第 5.2 条:`timeline-model.ts` 已保留 `text` 与 `content` 双字段 —— 属实(该模型 assistant/reasoning 有 `text`,并统一有 `content`=`safeStringify(payload)`)。
5. 第 5.4 条:`app.css` 无任何 `md-`/`markdown` 前缀样式 —— 属实(grep 命中 0)。
6. 第 5.4 条 / 背景:`package.json` 未引入 Markdown 依赖 —— 属实(deps 仅 `lucide-react`/`react`/`react-dom`/`vite`)。
7. 思考过程分流:`collectFinalAssistantMessageIds` 取"成功完成 run 的最后一个 assistant_message"为最终回复,其余进 process —— 与第 11 章一致。
8. 失败/取消默认展开:`shouldOpen = !complete || hasFailedOrCanceledDone` —— 与第 11.9 条一致。
9. clawee 现有代码无 `dangerouslySetInnerHTML` —— 属实(grep 命中 0),说明第 9 条约束是"保持现状不破坏",方向正确。

另外补充一条正向确认:因为 renderer 输出 React 文本节点,React 会自动转义 `<script>`、`<div>` 等标签为字面文本,所以设计目标第 10 条("原始 HTML 按文本显示")在方案 A 下**天然满足**,无需额外转义逻辑——这点设计没点破,可作为对安全策略的补充说明,增强说服力。

---

## 5. 建议的设计修订清单(供作者更新原文时对照)

- [ ] 第 2.1 章:对 `markdown.tsx` 的"可直接借鉴"加边界说明——链接协议校验缺失、图片默认远程加载、shiki 用 innerHTML 高亮,这三处**不可照搬**。
- [ ] 第 8 章 `markdown-inline.tsx`:明确新增 `isSafeHref` 白名单及不允许协议时的降级方式(纯文本/disabled 二选一)。
- [ ] 第 8 章 `MarkdownCodeBlock`:声明第一版不做语法高亮,禁止 shiki/innerHTML 路径。
- [ ] 第 8/9/10 章:聊天各 variant 下 `![]()` 不产出 `<img>`,仅 document + 白名单允许。
- [ ] 第 8/13/19 章:`FilePreview` 替换为真实组件(`DetailPanel`/`FileEditor`),明确 document variant 挂载点。
- [ ] 第 12.1 章:`tool_result` 标题如何拿可读工具名(关联 toolCallId)或接受显示 id。
- [ ] 第 5/19 章:补充"空态文案需区分运行中/完成并改写用词"为明确改动点。
- [ ] 第 2 条目标:澄清用户消息 Markdown 的解析范围(全量 vs 极简子集)。
- [ ] 第 9 章:写清嵌套/跨行强调的降级行为。
- [ ] 实施边界:补充需新增 clipboard 工具函数与复制失败态承接。
- [ ] 性能:补充 renderer/Timeline 层记忆化。
- [ ] 第 2.2 章:点名排除 ColorSwatch 与 `::code-comment` 指令块。

以上修订完成后,本设计可进入实施阶段。核心方案(方案 A + assistant_message 分流)无需改变,主要是把参考实现的安全缺口与不存在的组件映射补齐,避免"照着参考搬"反而破坏自己定的安全边界。
