# OpenCreator UI Markdown Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use git worktree; all work happens in the current workspace.

**Goal:** 让 OpenCreator 对话、思考过程、工具/诊断详情和只读文件预览支持安全 Markdown 渲染，达到 `docs/superpowers/specs/2026-07-08-opencreator-ui-markdown-rendering-design.md` 的验收标准。

**Architecture:** 新增独立的 `components/markdown` 渲染层，输出 React typed elements，不使用 HTML 字符串和 `dangerouslySetInnerHTML`。`Timeline` 只负责消息分流、过程折叠、工具名关联和选择合适的渲染组件；`DetailPanel mode="file"` 负责只读文件预览，`FileEditor` 继续作为原始文本编辑器。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、lucide-react、现有 CSS token。第一版不新增 Markdown 依赖，不引入 shiki，不加载远程图片。

---

## Scope Rules

1. 不使用 `git worktree`。
2. 当前工作区可能已有其它未提交修改，执行每个任务提交时只能 `git add` 本任务列出的文件。
3. 不修改 Runtime API、SSE、thread/history 数据层。
4. 不把 `reasoning_item` 作为思考过程来源；思考过程继续基于 `assistant_message` 分流。
5. 不使用 `dangerouslySetInnerHTML`。
6. 不输出 `<img>`。
7. 不新增 `react-markdown`、`remark-gfm`、`micromark`、`shiki` 等依赖。

## File Structure

- Create: `apps/web/src/components/markdown/markdown-parser.ts`
  - 纯 TypeScript block parser，输入 string，输出 Markdown block AST。
- Create: `apps/web/src/components/markdown/markdown-inline.tsx`
  - 行内渲染、安全链接白名单、用户消息极简子集。
- Create: `apps/web/src/components/markdown/MarkdownCodeBlock.tsx`
  - 代码块、折叠、复制按钮、复制失败状态。
- Create: `apps/web/src/components/markdown/MarkdownRenderer.tsx`
  - 统一入口，按 variant 渲染 Markdown。
- Create: `apps/web/src/components/markdown/clipboard.ts`
  - clipboard 封装。
- Create: `apps/web/src/components/markdown/MarkdownRenderer.test.tsx`
  - renderer、安全和 variant 单测。
- Modify: `apps/web/src/components/timeline/Timeline.tsx`
  - 接入 MarkdownRenderer、工具名关联、工具/诊断详情代码块、空态文案。
- Modify: `apps/web/src/components/timeline/Timeline.test.tsx`
  - Markdown、思考过程、工具名、安全展示回归。
- Modify: `apps/web/src/features/details/DetailPanel.tsx`
  - `mode="file"` 根据文件后缀渲染 Markdown/JSON/HTML/text。
- Modify: `apps/web/src/features/details/DetailPanel.test.tsx`
  - 文件预览测试。
- Modify: `apps/web/src/components/editor/FileEditor.test.tsx`
  - 明确 FileEditor 仍显示原始文本。
- Modify: `apps/web/src/styles/app.css`
  - Markdown prose、代码块、表格、链接、过程卡片样式。

---

## Task 1: Markdown Renderer Core

**Files:**
- Create: `apps/web/src/components/markdown/markdown-parser.ts`
- Create: `apps/web/src/components/markdown/markdown-inline.tsx`
- Create: `apps/web/src/components/markdown/MarkdownCodeBlock.tsx`
- Create: `apps/web/src/components/markdown/MarkdownRenderer.tsx`
- Create: `apps/web/src/components/markdown/clipboard.ts`
- Create: `apps/web/src/components/markdown/MarkdownRenderer.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Create `apps/web/src/components/markdown/MarkdownRenderer.test.tsx` with tests covering required behavior:

```tsx
import type { MouseEvent } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer.js';

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders assistant markdown blocks and inline formatting', () => {
    render(
      <MarkdownRenderer
        variant="assistant"
        text={[
          '# 天气结论',
          '',
          '今天是 **29°C**，适合 `轻量户外活动`。',
          '',
          '- 带伞',
          '- [x] 查看空气质量',
          '',
          '> 下午可能转阴',
          '',
          '| 时间 | 温度 |',
          '| --- | ---: |',
          '| 上午 | 27 |',
          '| 下午 | 29 |',
        ].join('\n')}
      />
    );

    expect(screen.getByRole('heading', { name: '天气结论', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('轻量户外活动')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByText('带伞')).toBeInTheDocument();
    expect(screen.getByText('查看空气质量')).toBeInTheDocument();
    expect(screen.getByText('下午可能转阴')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders fenced code without syntax highlighting or innerHTML', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();

    render(<MarkdownRenderer variant="assistant" text={'```ts\nconst value = 1;\n```'} />);

    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
    expect(document.querySelector('.md-code-highlighted')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '复制代码' }));

    expect(writeText).toHaveBeenCalledWith('const value = 1;');
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('falls back when clipboard copy fails', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const user = userEvent.setup();

    render(<MarkdownRenderer variant="assistant" text={'```txt\nhello\n```'} />);

    await user.click(screen.getByRole('button', { name: '复制代码' }));

    expect(screen.getByRole('button', { name: '复制失败' })).toBeInTheDocument();
  });

  it('does not render unsafe links as anchors', () => {
    render(
      <MarkdownRenderer
        variant="assistant"
        text={'[bad](javascript:alert(1)) [data](data:text/html,x) [file](file:///tmp/a) [vb](vbscript:msgbox(1))'}
      />
    );

    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.getByText('data')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    expect(screen.getByText('vb')).toBeInTheDocument();
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('renders safe links and routes relative links through onLinkClick', async () => {
    const onLinkClick = vi.fn((href: string, event: MouseEvent<HTMLAnchorElement>) => {
      if (href === 'docs/readme.md') event.preventDefault();
    });
    const user = userEvent.setup();

    render(
      <MarkdownRenderer
        variant="assistant"
        text={'[OpenAI](https://openai.com) [local](docs/readme.md) https://example.com/path.'}
        onLinkClick={onLinkClick}
      />
    );

    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute('href', 'https://openai.com');
    expect(screen.getByRole('link', { name: 'local' })).toHaveAttribute('href', 'docs/readme.md');
    expect(screen.getByRole('link', { name: 'https://example.com/path' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'local' }));

    expect(onLinkClick).toHaveBeenCalledWith('docs/readme.md', expect.any(Object));
  });

  it('shows html and image syntax as text without creating DOM nodes or images', () => {
    render(<MarkdownRenderer variant="assistant" text={'<script>alert(1)</script>\n\n![alt text](https://example.com/a.png)'} />);

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getByText(/alt text/)).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('keeps user variant conservative', () => {
    render(<MarkdownRenderer variant="user" text={'# 不是标题\n1. 不是列表\n*不是斜体*\n`是代码`'} />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('# 不是标题')).toBeInTheDocument();
    expect(screen.getByText('1. 不是列表')).toBeInTheDocument();
    expect(screen.getByText('*不是斜体*')).toBeInTheDocument();
    expect(screen.getByText('是代码')).toHaveProperty('tagName', 'CODE');
  });

  it('does not throw on nested or multiline emphasis', () => {
    render(<MarkdownRenderer variant="assistant" text={'**a *b* c**\n\n**第一行\n第二行**'} />);

    expect(screen.getByText(/a/)).toBeInTheDocument();
    expect(screen.getByText(/第一行/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @opencreator/web test -- --run apps/web/src/components/markdown/MarkdownRenderer.test.tsx
```

Expected: FAIL because `MarkdownRenderer` does not exist.

- [ ] **Step 3: Implement parser types and block parsing**

Create `apps/web/src/components/markdown/markdown-parser.ts`.

Required exported types:

```ts
export type TableAlign = 'left' | 'right' | 'center' | null;

export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'unordered-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] }
  | { kind: 'blockquote'; text: string }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'table'; headers: string[]; aligns: TableAlign[]; rows: string[][] }
  | { kind: 'hr' };
```

Required functions:

```ts
export function parseMarkdownBlocks(input: string): MarkdownBlock[];
export function splitTableCells(line: string): string[];
export function parseTableAlignRow(line: string): TableAlign[] | null;
```

Implementation requirements:

1. Normalize `\r\n` to `\n`.
2. Support fenced code blocks with optional language using `^```([A-Za-z0-9_+-]+)?\\s*$`.
3. Treat an unclosed fenced code block as code until EOF.
4. Support headings `#` through `####`.
5. Support `---`, `***`, `___` horizontal rules.
6. Group consecutive blockquote lines after removing leading `>`.
7. Group consecutive unordered and ordered list lines.
8. Detect GFM pipe table only when a header row is followed by a valid alignment row.
9. Paragraphs greedily collect lines until blank line or next block starter.
10. Do not parse HTML into special nodes.

- [ ] **Step 4: Implement clipboard helper**

Create `apps/web/src/components/markdown/clipboard.ts`:

```ts
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Implement MarkdownCodeBlock**

Create `apps/web/src/components/markdown/MarkdownCodeBlock.tsx`.

Required behavior:

1. Render root `.md-code-block`.
2. Header shows language label or `text`.
3. Copy button uses lucide `Copy` icon, success uses `Check`, failure uses `AlertCircle`.
4. Button accessible labels:
   - Initial: `复制代码`
   - Success: `已复制`
   - Failure: `复制失败`
5. Long code blocks over 16 lines start collapsed and show expand/collapse button with labels `展开代码` / `收起代码`.
6. Render code with `<pre className="md-code"><code>{body}</code></pre>`.
7. Do not import shiki.
8. Do not use `dangerouslySetInnerHTML`.

- [ ] **Step 6: Implement inline renderer**

Create `apps/web/src/components/markdown/markdown-inline.tsx`.

Required exports:

```ts
import type { MouseEvent, ReactNode } from 'react';

export type MarkdownVariant = 'assistant' | 'user' | 'process' | 'tool' | 'diagnostic' | 'document';
export type MarkdownLinkClickHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

export function isSafeHref(href: string, allowRelative: boolean): boolean;
export function renderInlineMarkdown(
  text: string,
  options: { variant: MarkdownVariant; onLinkClick?: MarkdownLinkClickHandler }
): ReactNode;
```

Implementation requirements:

1. `isSafeHref` allows `http:`, `https:`, `mailto:`.
2. Relative paths are allowed only when `allowRelative === true`.
3. Reject `javascript:`, `data:`, `file:`, `vbscript:`, protocol-relative `//host/path`, and empty href.
4. Unsafe explicit Markdown links render their visible label as plain text.
5. Unsafe bare URL patterns should not happen because bare autolink only matches `http/https`; still never create anchors for unsafe hrefs.
6. `target="_blank"` and `rel="noreferrer noopener"` for links.
7. In `user` variant, only parse inline code, fenced code is handled at block level, safe links, and bare URL. Do not parse bold/italic.
8. In non-user variants, parse inline code before links, links before bare URLs, bold before italic.
9. Image syntax `![alt](url)` renders plain text `alt` if present, otherwise `[图片]`; never emits `<img>`.
10. Convert newlines inside paragraph text to `<br />`.

- [ ] **Step 7: Implement MarkdownRenderer**

Create `apps/web/src/components/markdown/MarkdownRenderer.tsx`.

Required behavior:

1. Export `MarkdownRenderer`, `MarkdownVariant`, and `MarkdownLinkClickHandler`.
2. Use `useMemo` to call `parseMarkdownBlocks(text)` based on `text`.
3. Render root `<div className="markdown-prose ...">` with `data-variant={variant}`.
4. Render paragraph, heading, list, task list, blockquote, hr, table, code block.
5. In `user` variant, render unsupported block types as paragraph text:
   - heading becomes literal `# text`
   - list item marker text remains literal
   - table lines remain literal paragraphs
6. Table wrapper class: `.md-table-wrap`, table class: `.md-table`.
7. Task list item class: `.md-task-item`, checkbox class: `.md-task-check`.

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @opencreator/web test -- --run apps/web/src/components/markdown/MarkdownRenderer.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer core**

```bash
git add \
  apps/web/src/components/markdown/markdown-parser.ts \
  apps/web/src/components/markdown/markdown-inline.tsx \
  apps/web/src/components/markdown/MarkdownCodeBlock.tsx \
  apps/web/src/components/markdown/MarkdownRenderer.tsx \
  apps/web/src/components/markdown/clipboard.ts \
  apps/web/src/components/markdown/MarkdownRenderer.test.tsx
git commit -m "feat(web): add safe markdown renderer"
```

---

## Task 2: Timeline Markdown, Process, and Tool Cards

**Files:**
- Modify: `apps/web/src/components/timeline/Timeline.tsx`
- Modify: `apps/web/src/components/timeline/Timeline.test.tsx`

- [ ] **Step 1: Add failing Timeline tests for markdown and process empty states**

Append tests to `apps/web/src/components/timeline/Timeline.test.tsx`:

```tsx
it('renders final assistant markdown without exposing syntax', () => {
  render(
    <Timeline
      items={[
        { kind: 'assistant_message', id: 'a1', text: '今天是 **29°C**。\n\n- 多喝水', source: 'runtime' }
      ]}
    />
  );

  expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
  expect(screen.getByText('多喝水')).toBeInTheDocument();
  expect(screen.queryByText('今天是 **29°C**。')).not.toBeInTheDocument();
});

it('keeps user messages conservative while still rendering code and safe links', () => {
  render(
    <Timeline
      items={[
        {
          kind: 'user_message',
          id: 'u1',
          text: '# 不要变标题\n1. 不要变列表\n`保留代码` [链接](https://example.com)',
          source: 'runtime'
        }
      ]}
    />
  );

  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByText('# 不要变标题')).toBeInTheDocument();
  expect(screen.getByText('保留代码')).toHaveProperty('tagName', 'CODE');
  expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('href', 'https://example.com');
});

it('renders markdown inside process assistant messages', () => {
  render(
    <Timeline
      items={[
        { kind: 'run_status', id: 's1', runId: 'run_1', label: 'running', source: 'runtime' },
        { kind: 'assistant_message', id: 'a1', runId: 'run_1', text: '正在检查 **日志**', source: 'runtime' }
      ]}
    />
  );

  expect(screen.getByText('日志')).toHaveProperty('tagName', 'STRONG');
});

it('uses different empty process copy for active and completed runs', () => {
  const active = render(
    <Timeline items={[{ kind: 'run_status', id: 's1', runId: 'run_1', label: 'running', source: 'runtime' }]} />
  );
  expect(screen.getByText('等待 OpenCreator 返回过程...')).toBeInTheDocument();
  active.unmount();

  render(
    <Timeline
      items={[
        { kind: 'run_status', id: 's1', runId: 'run_1', label: 'running', source: 'runtime' },
        { kind: 'assistant_message', id: 'a1', runId: 'run_1', text: 'OK', source: 'runtime' },
        { kind: 'done', id: 'd1', runId: 'run_1', status: 'succeeded', content: '{"type":"done","status":"succeeded"}', source: 'runtime' }
      ]}
    />
  );

  expect(screen.getByText('本次没有可展示的中间过程。')).toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing Timeline tests for tool result name mapping**

Modify the existing first Timeline test expectation:

```tsx
expect(screen.getByText('工具完成 exec_command')).toBeInTheDocument();
expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
```

Add fallback test:

```tsx
it('does not show opaque toolCallId in the main title when tool_use is missing', () => {
  render(
    <Timeline
      items={[
        {
          kind: 'tool_step',
          id: 'tool_result_only',
          runId: 'run_1',
          name: 'call_missing',
          content: '{"type":"tool_result","toolCallId":"call_missing","output":"done","isError":false}',
          source: 'runtime'
        }
      ]}
    />
  );

  expect(screen.getByText('工具完成')).toBeInTheDocument();
  expect(screen.queryByText('工具完成 call_missing')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run Timeline tests to verify failure**

Run:

```bash
pnpm --filter @opencreator/web test -- --run apps/web/src/components/timeline/Timeline.test.tsx
```

Expected: FAIL because Timeline still renders plain `<p>` and tool results use `call_1`.

- [ ] **Step 4: Import MarkdownRenderer and replace message rendering**

Modify `apps/web/src/components/timeline/Timeline.tsx`:

```ts
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
```

Replace `renderMessageContent` behavior:

```tsx
function renderMessageContent(item: Extract<TimelineItem, { kind: 'user_message' | 'assistant_message' }>) {
  return <MarkdownRenderer text={item.text} variant={item.kind === 'user_message' ? 'user' : 'assistant'} />;
}
```

- [ ] **Step 5: Add JSON formatting helpers and code payload component**

In `Timeline.tsx`, add helpers near `safeParseJson`:

```tsx
function formatPayload(content: string): string {
  const parsed = safeParseJson(content);
  if (parsed === null) return content;
  return JSON.stringify(parsed, null, 2);
}

function CodePayloadBlock(props: { content: string }) {
  return (
    <pre className="process-code-payload">
      <code>{formatPayload(props.content)}</code>
    </pre>
  );
}
```

Use `CodePayloadBlock` for diagnostic and failed/canceled done details.

- [ ] **Step 6: Add tool name resolver**

In `Timeline.tsx`, add:

```ts
function getToolCallId(item: ProcessTimelineItem): string | undefined {
  if (item.kind !== 'tool_step') return undefined;
  const payload = safeParseJson(item.content);
  if (typeof payload !== 'object' || payload === null || !('toolCallId' in payload)) return undefined;
  const toolCallId = (payload as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === 'string' && toolCallId.length > 0 ? toolCallId : undefined;
}

function buildToolNameByCallId(items: ProcessTimelineItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'tool_step') continue;
    if (getPayloadType(item) !== 'tool_use') continue;
    const toolCallId = getToolCallId(item);
    if (toolCallId) names.set(toolCallId, item.name);
  }
  return names;
}
```

Update process rendering so `renderProcessStep` receives the map:

```ts
function getProcessStepTitle(item: ProcessTimelineItem, toolNameByCallId = new Map<string, string>()): string
```

Tool title logic:

```ts
case 'tool_step': {
  if (getPayloadType(item) !== 'tool_result') return `使用工具 ${item.name}`;
  const readableName = getToolCallId(item) ? toolNameByCallId.get(getToolCallId(item)!) : undefined;
  return readableName ? `工具完成 ${readableName}` : '工具完成';
}
```

- [ ] **Step 7: Render process markdown and empty states**

Replace reasoning/assistant process rendering with:

```tsx
<div className="process-reasoning-text">
  <MarkdownRenderer text={item.text} variant="process" />
</div>
```

In `renderProcessBlock`, compute:

```ts
const emptyCopy = complete ? '本次没有可展示的中间过程。' : '等待 OpenCreator 返回过程...';
const toolNameByCallId = buildToolNameByCallId(process.items);
```

Use `emptyCopy` in `.process-waiting`.

- [ ] **Step 8: Run Timeline tests**

Run:

```bash
pnpm --filter @opencreator/web test -- --run apps/web/src/components/timeline/Timeline.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Timeline integration**

```bash
git add \
  apps/web/src/components/timeline/Timeline.tsx \
  apps/web/src/components/timeline/Timeline.test.tsx
git commit -m "feat(web): render markdown in timeline"
```

---

## Task 3: DetailPanel File Preview

**Files:**
- Modify: `apps/web/src/features/details/DetailPanel.tsx`
- Modify: `apps/web/src/features/details/DetailPanel.test.tsx`
- Modify: `apps/web/src/components/editor/FileEditor.test.tsx`

- [ ] **Step 1: Add failing DetailPanel tests**

Update `apps/web/src/features/details/DetailPanel.test.tsx`:

```tsx
it('renders markdown file content with document markdown renderer', () => {
  render(
    <DetailPanel
      mode="file"
      title="README.md"
      subtitle="apps/web/README.md"
      content={'# OpenCreator\n\n当前温度 **29°C**'}
      onClose={vi.fn()}
    />
  );

  expect(screen.getByRole('heading', { name: 'OpenCreator', level: 1 })).toBeInTheDocument();
  expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
  expect(screen.queryByText('# OpenCreator')).not.toBeInTheDocument();
});

it('renders html file content as source instead of executing markup', () => {
  render(
    <DetailPanel
      mode="file"
      title="preview.html"
      content={'<h1>Unsafe</h1><script>alert(1)</script>'}
      onClose={vi.fn()}
    />
  );

  expect(screen.getByText('<h1>Unsafe</h1><script>alert(1)</script>')).toBeInTheDocument();
  expect(document.querySelector('script')).not.toBeInTheDocument();
});

it('formats json file content when possible', () => {
  render(<DetailPanel mode="file" title="data.json" content={'{"a":1,"b":{"c":2}}'} onClose={vi.fn()} />);

  expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  expect(screen.getByText(/"c": 2/)).toBeInTheDocument();
});
```

Update the existing first test so it no longer expects Markdown files to be raw `<pre>`. Use a `.txt` file for raw `<pre>` behavior:

```tsx
render(
  <DetailPanel
    mode="file"
    title="notes.txt"
    subtitle="apps/web/notes.txt"
    content={'# OpenCreator\n\nDetail content'}
    onClose={vi.fn()}
  />
);
expect(screen.getByRole('region', { name: '详情内容' }).querySelector('pre')?.textContent).toBe(
  '# OpenCreator\n\nDetail content'
);
```

- [ ] **Step 2: Add FileEditor raw text assertion**

Add to `apps/web/src/components/editor/FileEditor.test.tsx`:

```tsx
it('keeps markdown content as raw editable text', () => {
  render(
    <FileEditor
      path="README.md"
      content={'# OpenCreator\n\n**raw**'}
      dirty={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
    />
  );

  expect(screen.getByRole('textbox', { name: 'README.md 编辑器' })).toHaveValue('# OpenCreator\n\n**raw**');
  expect(screen.queryByRole('heading', { name: 'OpenCreator' })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run DetailPanel and FileEditor tests to verify failure**

Run:

```bash
pnpm --filter @opencreator/web test -- --run \
  apps/web/src/features/details/DetailPanel.test.tsx \
  apps/web/src/components/editor/FileEditor.test.tsx
```

Expected: DetailPanel tests FAIL; FileEditor new test PASS or stays PASS.

- [ ] **Step 4: Implement file type detection and preview components**

Modify `apps/web/src/features/details/DetailPanel.tsx`:

```tsx
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer.js';
```

Add helpers:

```ts
function fileExtension(title: string, subtitle?: string): string {
  const path = subtitle ?? title;
  const last = path.split('/').pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
```

Add renderer:

```tsx
function DetailContent(props: Pick<DetailPanelProps, 'mode' | 'title' | 'subtitle' | 'content'>) {
  if (props.mode !== 'file') return <pre>{props.content}</pre>;
  const ext = fileExtension(props.title, props.subtitle);
  if (ext === 'md' || ext === 'markdown') {
    return <MarkdownRenderer text={props.content} variant="document" />;
  }
  if (ext === 'json') {
    return (
      <pre className="detail-code-block">
        <code>{formatJson(props.content)}</code>
      </pre>
    );
  }
  return (
    <pre className={ext === 'html' || ext === 'htm' ? 'detail-code-block detail-html-source' : 'detail-code-block'}>
      <code>{props.content}</code>
    </pre>
  );
}
```

Replace the body:

```tsx
<div className="detail-content" role="region" aria-label="详情内容">
  <DetailContent mode={props.mode} title={props.title} subtitle={props.subtitle} content={props.content} />
</div>
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter @opencreator/web test -- --run \
  apps/web/src/features/details/DetailPanel.test.tsx \
  apps/web/src/components/editor/FileEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit DetailPanel preview**

```bash
git add \
  apps/web/src/features/details/DetailPanel.tsx \
  apps/web/src/features/details/DetailPanel.test.tsx \
  apps/web/src/components/editor/FileEditor.test.tsx
git commit -m "feat(web): render markdown file previews"
```

---

## Task 4: Markdown Styling

**Files:**
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/src/components/markdown/MarkdownRenderer.test.tsx`
- Test: `apps/web/src/components/timeline/Timeline.test.tsx`
- Test: `apps/web/src/features/details/DetailPanel.test.tsx`

- [ ] **Step 1: Add CSS for markdown prose**

Append to `apps/web/src/styles/app.css`:

```css
.markdown-prose {
  min-width: 0;
  color: var(--text);
  font-size: 14px;
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.markdown-prose[data-variant="assistant"],
.markdown-prose[data-variant="document"] {
  font-size: 14.5px;
  line-height: 1.72;
}

.markdown-prose[data-variant="process"],
.markdown-prose[data-variant="tool"],
.markdown-prose[data-variant="diagnostic"] {
  font-size: 12.5px;
  line-height: 1.58;
  color: var(--muted);
}

.markdown-prose .md-p {
  margin: 0;
}

.markdown-prose .md-p + .md-p,
.markdown-prose .md-p + .md-code-block,
.markdown-prose .md-code-block + .md-p {
  margin-top: 12px;
}

.markdown-prose .md-h {
  margin: 18px 0 8px;
  color: var(--text);
  font-weight: 700;
  line-height: 1.3;
}

.markdown-prose .md-h:first-child {
  margin-top: 0;
}

.markdown-prose .md-h1 { font-size: 22px; }
.markdown-prose .md-h2 { font-size: 18px; }
.markdown-prose .md-h3 { font-size: 15px; }
.markdown-prose .md-h4 { font-size: 14px; }

.markdown-prose .md-ul,
.markdown-prose .md-ol {
  margin: 10px 0;
  padding-left: 22px;
}

.markdown-prose .md-ul li,
.markdown-prose .md-ol li {
  margin: 5px 0;
}

.markdown-prose .md-task-list {
  list-style: none;
  padding-left: 0;
}

.markdown-prose .md-task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.markdown-prose .md-task-check {
  width: 15px;
  height: 15px;
  margin-top: 3px;
  flex: 0 0 auto;
}

.markdown-prose .md-quote {
  margin: 12px 0;
  padding-left: 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--muted);
}

.markdown-prose .md-inline-code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text);
}

.markdown-prose .md-code-block,
.detail-code-block,
.process-code-payload {
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  overflow: hidden;
}

.markdown-prose .md-code-header {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px 6px 12px;
  border-bottom: 1px solid var(--border);
}

.markdown-prose .md-code-lang {
  color: var(--muted);
  font: 600 11px/1 var(--font-mono);
  text-transform: lowercase;
}

.markdown-prose .md-code-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.markdown-prose .md-code-action {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border-radius: 6px;
  color: var(--muted);
}

.markdown-prose .md-code-action:hover {
  background: var(--surface-3);
  color: var(--text);
}

.markdown-prose .md-code,
.detail-code-block,
.process-code-payload {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  font: 12.5px/1.62 var(--font-mono);
  white-space: pre;
}

.markdown-prose .md-code-block[data-collapsed="true"] .md-code-body {
  max-height: 168px;
  overflow: hidden;
}

.markdown-prose .md-link {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
}

.markdown-prose .md-link:hover {
  border-bottom-color: var(--accent);
}

.markdown-prose .md-hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}

.md-table-wrap {
  max-width: 100%;
  overflow-x: auto;
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.md-table th,
.md-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.md-table th {
  background: var(--surface-2);
  font-weight: 700;
}

.md-table tr:last-child td {
  border-bottom: 0;
}
```

- [ ] **Step 2: Ensure process/code existing styles do not conflict**

Scan existing CSS:

```bash
rg -n "process-code-payload|markdown-prose|md-code-block|md-table" apps/web/src/styles/app.css
```

Expected: only the new classes or intentional references.

- [ ] **Step 3: Run web component tests**

Run:

```bash
pnpm --filter @opencreator/web test -- --run \
  apps/web/src/components/markdown/MarkdownRenderer.test.tsx \
  apps/web/src/components/timeline/Timeline.test.tsx \
  apps/web/src/features/details/DetailPanel.test.tsx \
  apps/web/src/components/editor/FileEditor.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit styles**

```bash
git add apps/web/src/styles/app.css
git commit -m "style(web): add markdown prose styles"
```

---

## Task 5: App Regression and Safety Verification

**Files:**
- Modify if needed: `apps/web/src/app/App.test.tsx`
- Modify if needed: `apps/web/src/app/App.tsx`
- Test: all web tests

- [ ] **Step 1: Run full web test suite**

Run:

```bash
pnpm --filter @opencreator/web test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @opencreator/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm --filter @opencreator/web build
```

Expected: PASS.

- [ ] **Step 4: Fix only regressions caused by Markdown integration**

If App tests fail because they expect raw Markdown text, update assertions to expect rendered text and DOM role. Do not rewrite layout tests unrelated to Markdown.

Examples:

```tsx
expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
expect(screen.queryByText('**29°C**')).not.toBeInTheDocument();
```

- [ ] **Step 5: Grep for forbidden implementation paths**

Run:

```bash
rg -n "dangerouslySetInnerHTML|from 'shiki'|from \"shiki\"|react-markdown|remark-gfm|micromark|<img|document.createElement\\('img'\\)" apps/web/src
```

Expected:

1. No `dangerouslySetInnerHTML`.
2. No shiki imports.
3. No Markdown dependency imports.
4. No `<img>` output in Markdown components.

- [ ] **Step 6: Commit regression fixes if any**

If Step 4 required changes:

```bash
git add apps/web/src/app/App.test.tsx apps/web/src/app/App.tsx
git commit -m "test(web): cover markdown app regression"
```

If no changes were needed, do not create an empty commit.

---

## Task 6: Manual QA Checklist

**Files:**
- No required file changes.

- [ ] **Step 1: Start local web app**

Run:

```bash
pnpm --filter @opencreator/web dev -- --port 64100
```

Expected: Vite starts on `http://127.0.0.1:64100`.

- [ ] **Step 2: Open app and verify message rendering**

Manual checks:

1. Assistant reply with `**29°C**` shows bold `29°C`.
2. Assistant list renders as list.
3. Assistant code block renders in a bounded code panel with copy button.
4. Unsafe link `[bad](javascript:alert(1))` is not clickable.
5. Image syntax does not load an image.
6. User message `# 标题` remains literal text, not a heading.

- [ ] **Step 3: Verify process rendering**

Manual checks:

1. Run with intermediate `assistant_message` shows `正在思考` while active.
2. Completed run collapses process by default.
3. Expanding process shows Markdown-rendered intermediate text.
4. Completed run with no intermediate process shows `本次没有可展示的中间过程。`
5. Active run with no intermediate process shows `等待 OpenCreator 返回过程...`

- [ ] **Step 4: Verify DetailPanel preview**

Manual checks:

1. `.md` preview renders Markdown.
2. `.json` preview is formatted.
3. `.html` preview shows source and does not execute.
4. FileEditor still shows raw Markdown in textarea.

- [ ] **Step 5: Stop local dev server**

Stop the Vite process with Ctrl-C. Do not leave long-running sessions active.

---

## Final Verification

Run all checks before claiming implementation complete:

```bash
pnpm --filter @opencreator/web test
pnpm --filter @opencreator/web typecheck
pnpm --filter @opencreator/web build
rg -n "dangerouslySetInnerHTML|from 'shiki'|from \"shiki\"|react-markdown|remark-gfm|micromark|<img|document.createElement\\('img'\\)" apps/web/src
```

Expected:

1. Test PASS.
2. Typecheck PASS.
3. Build PASS.
4. Forbidden-path grep has no matches.

## Self-Review Checklist

- [ ] Spec coverage: renderer, Timeline, DetailPanel, FileEditor, styles, safety, tests are all covered by tasks.
- [ ] No placeholders: no implementation step says TBD, TODO, later, or "add appropriate handling" without exact behavior.
- [ ] Type consistency: `MarkdownVariant` is `assistant | user | process | tool | diagnostic | document` everywhere.
- [ ] Safety consistency: no task introduces HTML injection, shiki, remote image loading, or Markdown dependency.
- [ ] Data consistency: Runtime event payloads are not modified; tool name mapping is UI-only.
- [ ] Brand consistency: UI remains OpenCreator; no Codex product branding is introduced.

## Execution Choice

Plan complete. Recommended execution mode is subagent-driven task execution, one task at a time with review between tasks. Inline execution is also possible because the change is limited to `apps/web`.
