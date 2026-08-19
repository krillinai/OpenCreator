# Codex Runtime UI Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建第一版 `apps/web`，以 `index.html` 原型为目标形态，真实接入 Agent Runtime，并用 mock adapter 补齐项目、文件树、编辑器、审批和变更卡能力。

**Architecture:** 第一版采用 React/Vite Web App。Runtime 已支持能力通过 `RuntimeClient` 调用真实 HTTP/SSE API；Runtime 暂不支持能力通过 service adapter 接入 IndexedDB/localStorage mock store；桌面版能力通过 `HostBridge` 预留。daemon 需要补受限 CORS，前端 SSE 使用 fetch + ReadableStream，不使用原生 EventSource。

**Tech Stack:** pnpm workspace, TypeScript, React, Vite, Vitest, Testing Library, lucide-react, IndexedDB, Fastify, @fastify/cors, @opencreator/protocol.

---

## 0. 执行约束

1. 不创建 git worktree，所有开发在当前工作区完成。
2. 不回滚现有未提交改动。
3. 每个任务完成后运行该任务列出的验证命令。
4. 每个任务建议单独提交，只暂存该任务修改过的文件。
5. UI 文案使用中文；代码标识符使用英文。
6. mock 文件保存必须写成“本地草稿”，不得声称写入真实磁盘。

## 1. 目标文件结构

最终新增和修改的主要文件：

```text
apps/daemon/
  package.json
  src/api/server.ts
  test/integration/api.test.ts

apps/web/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  index.html
  src/main.tsx
  src/app/App.tsx
  src/app/app-state.ts
  src/app/routes.ts
  src/runtime/client.ts
  src/runtime/errors.ts
  src/runtime/sse.ts
  src/runtime/types.ts
  src/runtime/validators.ts
  src/host/bridge.ts
  src/host/browser-bridge.ts
  src/storage/browser-storage.ts
  src/storage/indexed-db.ts
  src/services/connection-service.ts
  src/services/thread-service.ts
  src/services/run-service.ts
  src/services/diagnostics-service.ts
  src/services/capability-service.ts
  src/services/schedule-service.ts
  src/services/settings-service.ts
  src/services/project-service.ts
  src/services/file-service.ts
  src/services/approval-service.ts
  src/services/change-service.ts
  src/components/layout/AppLayout.tsx
  src/components/timeline/Timeline.tsx
  src/components/editor/FileEditor.tsx
  src/components/editor/FileTree.tsx
  src/features/connection/ConnectionPanel.tsx
  src/features/threads/ThreadList.tsx
  src/features/runs/Composer.tsx
  src/features/runs/RunDetailPanel.tsx
  src/features/capabilities/CapabilitiesView.tsx
  src/features/schedules/SchedulesView.tsx
  src/features/settings/SettingsView.tsx
  src/styles/tokens.css
  src/styles/app.css
  src/test/setup.ts
```

## Task 1: daemon 受限 CORS

**Files:**
- Modify: `apps/daemon/package.json`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: 写 CORS preflight 失败测试**

在 `apps/daemon/test/integration/api.test.ts` 增加用例，验证允许 localhost origin、Authorization、Content-Type、Last-Event-ID：

```ts
it('allows web app CORS preflight from localhost origins', async () => {
  const response = await server.inject({
    method: 'OPTIONS',
    url: '/runs',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type,last-event-id'
    }
  });

  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
  expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain('last-event-id');
});

it('does not allow arbitrary web origins', async () => {
  const response = await server.inject({
    method: 'OPTIONS',
    url: '/runs',
    headers: {
      origin: 'https://example.com',
      'access-control-request-method': 'GET'
    }
  });

  expect(response.headers['access-control-allow-origin']).not.toBe('https://example.com');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts -t "CORS"
```

Expected: FAIL，原因是 daemon 尚未注册 CORS，OPTIONS 返回 404 或没有 CORS headers。

- [ ] **Step 3: 增加依赖**

修改 `apps/daemon/package.json`：

```json
"dependencies": {
  "@opencreator/protocol": "workspace:*",
  "@fastify/cors": "^11.0.1",
  "better-sqlite3": "^11.8.1",
  "cron-parser": "^5.6.1",
  "fastify": "^5.2.1",
  "nanoid": "^5.0.9",
  "toml": "^3.0.0"
}
```

- [ ] **Step 4: 注册受限 CORS**

修改 `apps/daemon/src/api/server.ts`：

```ts
import cors from '@fastify/cors';
```

在 `const server = Fastify({ logger: false });` 后注册：

```ts
await server.register(cors, {
  origin(origin, callback) {
    if (origin === undefined) return callback(null, false);
    if (isAllowedWebOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
  credentials: false,
  maxAge: 600
});
```

在文件底部增加：

```ts
function isAllowedWebOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false;
    return url.port === '5173' || url.port === '4173';
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: 安装依赖并验证**

Run:

```bash
pnpm install
pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts -t "CORS"
pnpm --filter @opencreator/daemon typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add pnpm-lock.yaml apps/daemon/package.json apps/daemon/src/api/server.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: allow local web cors for daemon"
```

## Task 2: `apps/web` 工程脚手架

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/test/setup.ts`
- Modify: `package.json`

- [ ] **Step 1: 创建 package manifest**

`apps/web/package.json`：

```json
{
  "name": "@opencreator/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -p tsconfig.json && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@opencreator/protocol": "workspace:*",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "vite": "^6.0.7"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^15.0.7",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.1",
    "vitest": "^3.2.4"
  }
}
```

说明：`apps/web` 显式依赖 Vite 6，根包当前 Vitest 2 绑定的是 Vite 5 类型；web 包需要声明局部 Vitest 3，避免 `vitest/config` 与 `@vitejs/plugin-react` 的 Vite 类型冲突。

- [ ] **Step 2: 创建 TypeScript 和 Vite 配置**

`apps/web/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`apps/web/vite.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});
```

`apps/web/vitest.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts']
  }
});
```

- [ ] **Step 3: 创建入口文件**

`apps/web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCreator Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

`apps/web/src/app/App.tsx`：

```tsx
export function App() {
  return (
    <main>
      <h1>OpenCreator Agent</h1>
    </main>
  );
}
```

`apps/web/src/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 4: 增加 root script**

修改根 `package.json` scripts：

```json
"web:dev": "pnpm --filter @opencreator/web dev"
```

- [ ] **Step 5: 安装并验证**

Run:

```bash
pnpm install
pnpm --filter @opencreator/web typecheck
pnpm --filter @opencreator/web build
pnpm --filter @opencreator/web test
```

Expected: all PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml apps/web
git commit -m "feat: scaffold web app"
```

## Task 3: RuntimeClient、错误解析和轻量校验

**Files:**
- Create: `apps/web/src/runtime/types.ts`
- Create: `apps/web/src/runtime/errors.ts`
- Create: `apps/web/src/runtime/validators.ts`
- Create: `apps/web/src/runtime/client.ts`
- Create: `apps/web/src/runtime/client.test.ts`

- [ ] **Step 1: 写 RuntimeClient 测试**

`apps/web/src/runtime/client.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, RuntimeClient } from './client.js';

describe('RuntimeClient', () => {
  it('sends authorization header for authenticated requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ codexVersion: 'test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    await client.get('/codex/status');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:60855/codex/status', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }));
  });

  it('does not send authorization header for healthz', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    await client.get('/healthz');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:60855/healthz', expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.any(String) })
    }));
  });

  it('throws ApiClientError for Runtime error responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'bad', fetchImpl: fetchMock });

    await expect(client.get('/runs')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @opencreator/web test -- src/runtime/client.test.ts
```

Expected: FAIL，RuntimeClient 尚不存在。

- [ ] **Step 3: 实现类型和错误解析**

`apps/web/src/runtime/types.ts`：

```ts
export type ConnectionConfig = {
  baseUrl: string;
  token: string;
};

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

`apps/web/src/runtime/errors.ts`：

```ts
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(input: { status: number; code: string; message: string; details?: Record<string, unknown> }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
  }
}
```

`apps/web/src/runtime/validators.ts`：

```ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

export function assertKnownEventType(type: string): boolean {
  return [
    'status',
    'assistant_message',
    'tool_use',
    'tool_result',
    'usage',
    'diagnostic',
    'error',
    'unknown_event',
    'done'
  ].includes(type);
}
```

- [ ] **Step 4: 实现 RuntimeClient**

`apps/web/src/runtime/client.ts`：

```ts
import { ApiClientError } from './errors.js';
import type { ApiErrorPayload, ConnectionConfig } from './types.js';
import { isRecord } from './validators.js';

export { ApiClientError };

export type RuntimeClientInput = ConnectionConfig & {
  fetchImpl?: typeof fetch;
};

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: RuntimeClientInput) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.token = input.token;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {};
    if (path !== '/healthz') headers.Authorization = `Bearer ${this.token}`;
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });

    const payload = await readJson(response);
    if (!response.ok) {
      const error = parseApiError(payload);
      throw new ApiClientError({
        status: response.status,
        code: error.error.code,
        message: error.error.message,
        details: error.error.details
      });
    }
    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  return JSON.parse(text) as unknown;
}

function parseApiError(payload: unknown): ApiErrorPayload {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { error: { code: 'HTTP_ERROR', message: 'Runtime request failed' } };
  }
  const code = typeof payload.error.code === 'string' ? payload.error.code : 'HTTP_ERROR';
  const message = typeof payload.error.message === 'string' ? payload.error.message : 'Runtime request failed';
  const details = isRecord(payload.error.details) ? payload.error.details : undefined;
  return { error: { code, message, details } };
}
```

- [ ] **Step 5: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/runtime/client.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/runtime
git commit -m "feat: add runtime http client"
```

## Task 4: fetch-based SSE parser

**Files:**
- Create: `apps/web/src/runtime/sse.ts`
- Create: `apps/web/src/runtime/sse.test.ts`
- Modify: `apps/web/src/runtime/client.ts`

- [ ] **Step 1: 写 SSE parser 测试**

`apps/web/src/runtime/sse.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseSseChunk, sseEventsToFrames } from './sse.js';

describe('sse parser', () => {
  it('parses id event and data frame', () => {
    const frames = sseEventsToFrames([
      'id: 4\n',
      'event: assistant_message\n',
      'data: {"type":"assistant_message","seq":4}\n',
      '\n'
    ]);

    expect(frames).toEqual([
      {
        id: '4',
        event: 'assistant_message',
        data: '{"type":"assistant_message","seq":4}'
      }
    ]);
  });

  it('ignores heartbeat comments', () => {
    expect(parseSseChunk(': heartbeat\n\n')).toEqual([]);
  });

  it('keeps incomplete frames buffered', () => {
    const result = parseSseChunk('id: 5\nevent: status\n');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @opencreator/web test -- src/runtime/sse.test.ts
```

Expected: FAIL，`sse.ts` 尚不存在。

- [ ] **Step 3: 实现 SSE parser 和 subscriber**

`apps/web/src/runtime/sse.ts`：

```ts
import type { AgentEventEnvelope } from '@opencreator/protocol';
import { assertKnownEventType, isRecord } from './validators.js';

export type SseFrame = {
  id?: string;
  event?: string;
  data: string;
};

export type SubscribeRunEventsInput = {
  baseUrl: string;
  token: string;
  runId: string;
  fromSeq?: number;
  fetchImpl?: typeof fetch;
  onEvent(event: AgentEventEnvelope): void;
  onError(error: Error): void;
  signal?: AbortSignal;
};

let parserBuffer = '';

export function parseSseChunk(chunk: string): SseFrame[] {
  parserBuffer += chunk;
  const frames: SseFrame[] = [];
  let boundary = parserBuffer.indexOf('\n\n');
  while (boundary >= 0) {
    const rawFrame = parserBuffer.slice(0, boundary);
    parserBuffer = parserBuffer.slice(boundary + 2);
    const frame = parseFrame(rawFrame);
    if (frame !== undefined) frames.push(frame);
    boundary = parserBuffer.indexOf('\n\n');
  }
  return frames;
}

export function sseEventsToFrames(lines: string[]): SseFrame[] {
  parserBuffer = '';
  const frames = parseSseChunk(lines.join(''));
  parserBuffer = '';
  return frames;
}

export async function subscribeRunEvents(input: SubscribeRunEventsInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(input.runId)}/events?fromSeq=${input.fromSeq ?? 0}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.token}` },
    signal: input.signal
  });
  if (!response.ok) throw new Error(`SSE request failed with ${response.status}`);
  if (response.body === null) throw new Error('SSE response body is empty');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      for (const frame of parseSseChunk(read.value)) {
        const event = parseAgentEvent(frame.data);
        if (event !== undefined) input.onEvent(event);
      }
    }
  } catch (error) {
    if (!input.signal?.aborted) input.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(rawFrame: string): SseFrame | undefined {
  const frame: Partial<SseFrame> = {};
  const data: string[] = [];
  for (const line of rawFrame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) frame.id = line.slice(3).trimStart();
    if (line.startsWith('event:')) frame.event = line.slice(6).trimStart();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { ...frame, data: data.join('\n') };
}

function parseAgentEvent(raw: string): AgentEventEnvelope | undefined {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
  if (!assertKnownEventType(parsed.type)) return undefined;
  return parsed as AgentEventEnvelope;
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/runtime/sse.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/runtime/sse.ts apps/web/src/runtime/sse.test.ts
git commit -m "feat: parse runtime sse streams"
```

## Task 5: HostBridge 和浏览器存储基础

**Files:**
- Create: `apps/web/src/host/bridge.ts`
- Create: `apps/web/src/host/browser-bridge.ts`
- Create: `apps/web/src/storage/browser-storage.ts`
- Create: `apps/web/src/storage/indexed-db.ts`
- Create: `apps/web/src/storage/indexed-db.test.ts`

- [ ] **Step 1: 写 IndexedDB 测试**

`apps/web/src/storage/indexed-db.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexed-db.js';

describe('IndexedDB store', () => {
  it('saves and loads mock file content', async () => {
    const store = createIndexedDbStore('opencreator.web.test');
    await store.saveFile({ path: 'docs/demo.md', content: '# Demo', updatedAt: '2026-07-06T00:00:00.000Z' });

    await expect(store.getFile('docs/demo.md')).resolves.toMatchObject({
      path: 'docs/demo.md',
      content: '# Demo'
    });
  });

  it('rejects files larger than 512KB', async () => {
    const store = createIndexedDbStore('opencreator.web.test.limit');
    const content = 'x'.repeat(512 * 1024 + 1);

    await expect(store.saveFile({ path: 'large.txt', content, updatedAt: '2026-07-06T00:00:00.000Z' }))
      .rejects.toThrow('MOCK_FILE_TOO_LARGE');
  });
});
```

- [ ] **Step 2: 实现 HostBridge 类型**

`apps/web/src/host/bridge.ts`：

```ts
import type { ConnectionConfig } from '../runtime/types.js';

export type HostBridgeResult = { ok: true } | { ok: false; code: 'UNSUPPORTED' | 'FAILED'; message: string };

export type HostNotification = {
  title: string;
  body: string;
};

export type HostBridge = {
  kind: 'browser' | 'desktop';
  readConnectionConfig(): Promise<ConnectionConfig | null>;
  writeConnectionConfig(config: ConnectionConfig): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<HostBridgeResult>;
  notify(message: HostNotification): Promise<void>;
};
```

`apps/web/src/storage/browser-storage.ts`：

```ts
export function readJsonFromStorage<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

export function writeJsonToStorage<T>(key: string, value: T): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}
```

`apps/web/src/host/browser-bridge.ts`：

```ts
import type { ConnectionConfig } from '../runtime/types.js';
import { readJsonFromStorage, writeJsonToStorage } from '../storage/browser-storage.js';
import type { HostBridge, HostBridgeResult, HostNotification } from './bridge.js';

const CONNECTION_KEY = 'opencreator.web.connection.v1';

export const browserBridge: HostBridge = {
  kind: 'browser',
  async readConnectionConfig(): Promise<ConnectionConfig | null> {
    return readJsonFromStorage<ConnectionConfig>(CONNECTION_KEY);
  },
  async writeConnectionConfig(config: ConnectionConfig): Promise<void> {
    writeJsonToStorage(CONNECTION_KEY, config);
  },
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async revealPath(_path: string): Promise<HostBridgeResult> {
    return { ok: false, code: 'UNSUPPORTED', message: '浏览器版不支持在系统文件管理器中显示路径' };
  },
  async notify(_message: HostNotification): Promise<void> {
    return;
  }
};
```

- [ ] **Step 3: 实现 IndexedDB store**

`apps/web/src/storage/indexed-db.ts`：

```ts
export type MockFileRecord = {
  path: string;
  content: string;
  updatedAt: string;
};

const DB_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;

export function createIndexedDbStore(databaseName = 'opencreator.web.v1') {
  return {
    async saveFile(file: MockFileRecord): Promise<void> {
      if (new Blob([file.content]).size > MAX_FILE_BYTES) {
        throw new Error('MOCK_FILE_TOO_LARGE');
      }
      const db = await openDb(databaseName);
      await requestToPromise(db.transaction('files', 'readwrite').objectStore('files').put(file));
      db.close();
    },
    async getFile(path: string): Promise<MockFileRecord | undefined> {
      const db = await openDb(databaseName);
      const value = await requestToPromise(db.transaction('files', 'readonly').objectStore('files').get(path));
      db.close();
      return value as MockFileRecord | undefined;
    }
  };
}

function openDb(databaseName: string): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
    if (!db.objectStoreNames.contains('mockTimeline')) db.createObjectStore('mockTimeline', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('mockApprovals')) db.createObjectStore('mockApprovals', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('mockChanges')) db.createObjectStore('mockChanges', { keyPath: 'id' });
  };
  return requestToPromise(request);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/storage/indexed-db.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/host apps/web/src/storage
git commit -m "feat: add browser host and storage adapters"
```

## Task 6: mock project/file/approval/change services

**Files:**
- Create: `apps/web/src/services/project-service.ts`
- Create: `apps/web/src/services/file-service.ts`
- Create: `apps/web/src/services/approval-service.ts`
- Create: `apps/web/src/services/change-service.ts`
- Create: `apps/web/src/services/mock-services.test.ts`

- [ ] **Step 1: 写 mock service 测试**

`apps/web/src/services/mock-services.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createMockFileService } from './file-service.js';
import { createMockProjectService } from './project-service.js';

describe('mock services', () => {
  it('loads default project and file tree', async () => {
    const service = createMockProjectService();
    await expect(service.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: 'default-project', source: 'mock' })
    ]);
  });

  it('opens edits and saves a mock file', async () => {
    const service = createMockFileService();
    const file = await service.openFile('docs/design/enterprise-agent-dashboard.md');
    expect(file.dirty).toBe(false);

    await service.saveFile(file.path, `${file.content}\nupdated`);
    const saved = await service.openFile(file.path);
    expect(saved.content).toContain('updated');
    expect(saved.dirty).toBe(false);
  });
});
```

- [ ] **Step 2: 实现 project service**

`apps/web/src/services/project-service.ts`：

```ts
export type DataSource = 'runtime' | 'mock';

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  source: DataSource;
};

const DEFAULT_PROJECT: Project = {
  id: 'default-project',
  name: 'OpenCreator Agent Demo',
  rootPath: '/mock/opencreator-agent',
  source: 'mock'
};

export function createMockProjectService() {
  return {
    async listProjects(): Promise<Project[]> {
      return [DEFAULT_PROJECT];
    },
    async getDefaultProject(): Promise<Project> {
      return DEFAULT_PROJECT;
    }
  };
}
```

- [ ] **Step 3: 实现 file service**

`apps/web/src/services/file-service.ts`：

```ts
import { createIndexedDbStore } from '../storage/indexed-db.js';
import type { DataSource } from './project-service.js';

export type WorkspaceFile = {
  path: string;
  name: string;
  language: 'markdown' | 'srt' | 'html' | 'text' | 'json' | 'unknown';
  content: string;
  saved: boolean;
  dirty: boolean;
  updatedAt: string;
  source: DataSource;
};

export type FileTreeNode = {
  type: 'folder' | 'file';
  name: string;
  path: string;
  depth: number;
  language?: WorkspaceFile['language'];
};

const seedFiles: WorkspaceFile[] = [
  {
    path: 'docs/design/enterprise-agent-dashboard.md',
    name: 'enterprise-agent-dashboard.md',
    language: 'markdown',
    content: '# 企业 Agent Dashboard UI 方案\n\n这是 mock workspace 中的 Markdown 文件。',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'transcripts/demo-agent-task.srt',
    name: 'demo-agent-task.srt',
    language: 'srt',
    content: '1\n00:00:00,000 --> 00:00:03,200\nWe need an agent UI.\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'screens/dashboard.html',
    name: 'dashboard.html',
    language: 'html',
    content: '<main class="dashboard">Agent 对话</main>\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'notes/release-notes.txt',
    name: 'release-notes.txt',
    language: 'text',
    content: 'Agent Dashboard v0.2\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  }
];

export function createMockFileService() {
  const store = createIndexedDbStore();

  async function openFile(path: string): Promise<WorkspaceFile> {
    const stored = await store.getFile(path);
    const seed = seedFiles.find(file => file.path === path) ?? seedFiles[0]!;
    if (stored !== undefined) {
      return { ...seed, content: stored.content, updatedAt: stored.updatedAt, dirty: false, saved: true };
    }
    return seed;
  }

  return {
    async listTree(): Promise<FileTreeNode[]> {
      return [
        { type: 'folder', name: 'docs', path: 'docs', depth: 0 },
        { type: 'folder', name: 'design', path: 'docs/design', depth: 1 },
        { type: 'file', name: 'enterprise-agent-dashboard.md', path: 'docs/design/enterprise-agent-dashboard.md', depth: 2, language: 'markdown' },
        { type: 'folder', name: 'transcripts', path: 'transcripts', depth: 0 },
        { type: 'file', name: 'demo-agent-task.srt', path: 'transcripts/demo-agent-task.srt', depth: 1, language: 'srt' },
        { type: 'folder', name: 'screens', path: 'screens', depth: 0 },
        { type: 'file', name: 'dashboard.html', path: 'screens/dashboard.html', depth: 1, language: 'html' },
        { type: 'folder', name: 'notes', path: 'notes', depth: 0 },
        { type: 'file', name: 'release-notes.txt', path: 'notes/release-notes.txt', depth: 1, language: 'text' }
      ];
    },
    openFile,
    async saveFile(path: string, content: string): Promise<WorkspaceFile> {
      const updatedAt = new Date().toISOString();
      await store.saveFile({ path, content, updatedAt });
      return openFile(path);
    }
  };
}
```

- [ ] **Step 4: 实现 approval/change services**

`apps/web/src/services/approval-service.ts`：

```ts
export type MockApproval = {
  id: string;
  title: string;
  risk: string;
  status: 'pending' | 'approved' | 'rejected';
  source: 'mock';
};

export function createMockApprovalService() {
  return {
    createFileWriteApproval(path: string): MockApproval {
      return {
        id: `approval_${Date.now()}`,
        title: `允许保存 ${path}`,
        risk: '当前为 mock 本地草稿保存，不会写入真实磁盘。',
        status: 'pending',
        source: 'mock'
      };
    }
  };
}
```

`apps/web/src/services/change-service.ts`：

```ts
export type MockChangeCard = {
  id: string;
  title: string;
  path: string;
  delta: string;
  source: 'mock';
};

export function createMockChangeService() {
  return {
    createPromptChange(prompt: string, path: string): MockChangeCard {
      return {
        id: `change_${Date.now()}`,
        title: prompt.length > 0 ? '根据本次输入生成 mock 文件变更' : 'mock 文件变更',
        path,
        delta: '+1 -0',
        source: 'mock'
      };
    }
  };
}
```

- [ ] **Step 5: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/services/mock-services.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/services
git commit -m "feat: add mock workspace services"
```

## Task 7: Runtime-backed services

**Files:**
- Create: `apps/web/src/services/connection-service.ts`
- Create: `apps/web/src/services/thread-service.ts`
- Create: `apps/web/src/services/run-service.ts`
- Create: `apps/web/src/services/diagnostics-service.ts`
- Create: `apps/web/src/services/capability-service.ts`
- Create: `apps/web/src/services/schedule-service.ts`
- Create: `apps/web/src/services/settings-service.ts`
- Create: `apps/web/src/services/run-service.test.ts`

- [ ] **Step 1: 写 RunService 防覆盖字段测试**

`apps/web/src/services/run-service.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRunService } from './run-service.js';

describe('RunService', () => {
  it('does not send immutable thread config overrides for thread runs', async () => {
    const client = { post: vi.fn(async () => ({ id: 'run_1', threadId: 'thread_1', status: 'running' })) };
    const service = createRunService(client);

    await service.startThreadRun({ threadId: 'thread_1', prompt: 'hello', resumeMode: 'auto' });

    expect(client.post).toHaveBeenCalledWith('/runs', {
      threadId: 'thread_1',
      prompt: 'hello',
      resumeMode: 'auto'
    });
  });
});
```

- [ ] **Step 2: 实现 connection/thread/run services**

`apps/web/src/services/connection-service.ts`：

```ts
import type { CodexStatusResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export type ConnectionState =
  | { status: 'disconnected'; message: string }
  | { status: 'connected'; codexStatus: CodexStatusResponse }
  | { status: 'invalid_token'; message: string };

export function createConnectionService(client: RuntimeClient) {
  return {
    async check(): Promise<ConnectionState> {
      await client.get('/healthz');
      const codexStatus = await client.get<CodexStatusResponse>('/codex/status');
      return { status: 'connected', codexStatus };
    }
  };
}
```

`apps/web/src/services/thread-service.ts`：

```ts
import type { CreateThreadRequest, ThreadListResponse, ThreadResponse, ThreadRunsResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createThreadService(client: RuntimeClient) {
  return {
    listActiveThreads(): Promise<ThreadListResponse> {
      return client.get('/threads?status=active&limit=50');
    },
    createThread(input: CreateThreadRequest = {}): Promise<{ thread: ThreadResponse }> {
      return client.post('/threads', input);
    },
    listThreadRuns(threadId: string): Promise<ThreadRunsResponse> {
      return client.get(`/threads/${encodeURIComponent(threadId)}/runs?limit=50`);
    }
  };
}
```

`apps/web/src/services/run-service.ts`：

```ts
import type { ResumeMode, RunResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'post' | 'get'>;

export function createRunService(client: ClientLike) {
  return {
    startThreadRun(input: { threadId: string; prompt: string; resumeMode?: ResumeMode }): Promise<RunResponse> {
      return client.post('/runs', {
        threadId: input.threadId,
        prompt: input.prompt,
        resumeMode: input.resumeMode ?? 'auto'
      });
    },
    startStandaloneRun(input: { prompt: string; cwd?: string; profile?: string }): Promise<RunResponse> {
      return client.post('/runs', input);
    },
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }> {
      return client.post(`/runs/${encodeURIComponent(id)}/cancel`);
    },
    getRun(id: string): Promise<unknown> {
      return client.get(`/runs/${encodeURIComponent(id)}`);
    }
  };
}
```

- [ ] **Step 3: 实现 diagnostics/capability/schedule/settings services**

创建文件并保持薄封装：

```ts
// apps/web/src/services/diagnostics-service.ts
import type { RunDiagnosticsResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createDiagnosticsService(client: RuntimeClient) {
  return {
    getRunDiagnostics(runId: string): Promise<RunDiagnosticsResponse> {
      return client.get(`/runs/${encodeURIComponent(runId)}/diagnostics`);
    }
  };
}
```

```ts
// apps/web/src/services/capability-service.ts
import type { CodexMcpListResponse, CodexSkillListResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export type CodexProfileListResponse = {
  codexHome: string;
  codexHomeMode: 'global' | 'isolated';
  writable: boolean;
  baseConfigValid: boolean;
  profiles: Array<{
    name: string;
    status: 'valid' | 'invalid';
    config: Record<string, unknown>;
    diagnostics: string[];
    source: string;
    codexHomeMode: 'global' | 'isolated';
    updatedAt?: string;
  }>;
  diagnostics: string[];
};

export function createCapabilityService(client: RuntimeClient) {
  return {
    listSkills(): Promise<CodexSkillListResponse> {
      return client.get('/codex/skills');
    },
    listMcp(): Promise<CodexMcpListResponse> {
      return client.get('/codex/mcp');
    },
    listProfiles(): Promise<CodexProfileListResponse> {
      return client.get('/codex/profiles');
    }
  };
}
```

```ts
// apps/web/src/services/schedule-service.ts
import type { CreateScheduleRequest, ScheduleListResponse, ScheduleResponse, UpdateScheduleRequest } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createScheduleService(client: RuntimeClient) {
  return {
    listSchedules(): Promise<ScheduleListResponse> {
      return client.get('/schedules');
    },
    createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse> {
      return client.post('/schedules', input);
    },
    updateSchedule(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse> {
      return client.patch(`/schedules/${encodeURIComponent(id)}`, input);
    },
    deleteSchedule(id: string): Promise<{ deleted: true }> {
      return client.delete(`/schedules/${encodeURIComponent(id)}`);
    },
    runNow(id: string): Promise<unknown> {
      return client.post(`/schedules/${encodeURIComponent(id)}/run-now`);
    }
  };
}
```

```ts
// apps/web/src/services/settings-service.ts
import type { CleanupDeleteResponse, CleanupPreviewResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createSettingsService(client: RuntimeClient) {
  return {
    previewCleanup(olderThanDays: number): Promise<CleanupPreviewResponse> {
      return client.get(`/runtime/cleanup/preview?olderThanDays=${olderThanDays}`);
    },
    deleteCleanup(olderThanDays: number): Promise<CleanupDeleteResponse> {
      return client.post('/runtime/cleanup', { olderThanDays, confirm: true });
    }
  };
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/services/run-service.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/services
git commit -m "feat: add runtime service adapters"
```

## Task 8: App state、路由和服务组合

**Files:**
- Create: `apps/web/src/app/routes.ts`
- Create: `apps/web/src/app/app-state.ts`
- Modify: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/app-state.test.ts`

- [ ] **Step 1: 写 activeRunByThreadId 测试**

`apps/web/src/app/app-state.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { reduceAppState, initialAppState } from './app-state.js';

describe('app state', () => {
  it('tracks active run by thread id and clears it on done', () => {
    const running = reduceAppState(initialAppState, {
      type: 'run_started',
      threadId: 'thread_1',
      runId: 'run_1',
      status: 'running'
    });
    expect(running.activeRunByThreadId.thread_1).toBe('run_1');

    const done = reduceAppState(running, {
      type: 'run_done',
      threadId: 'thread_1',
      runId: 'run_1'
    });
    expect(done.activeRunByThreadId.thread_1).toBeUndefined();
  });
});
```

- [ ] **Step 2: 实现 route helper**

`apps/web/src/app/routes.ts`：

```ts
export type AppRoute =
  | { view: 'home' }
  | { view: 'thread'; threadId: string }
  | { view: 'schedules' }
  | { view: 'capabilities' }
  | { view: 'settings' };

export function parseRoute(hash: string): AppRoute {
  if (hash.startsWith('#/thread/')) return { view: 'thread', threadId: decodeURIComponent(hash.slice('#/thread/'.length)) };
  if (hash === '#/schedules') return { view: 'schedules' };
  if (hash === '#/capabilities') return { view: 'capabilities' };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'home' };
}
```

- [ ] **Step 3: 实现 app reducer**

`apps/web/src/app/app-state.ts`：

```ts
import type { PublicRunStatus } from '@opencreator/protocol';

export type RightPanelMode = 'editor' | 'run_detail';

export type AppState = {
  selectedThreadId?: string;
  selectedRunId?: string;
  selectedFilePath: string;
  rightPanelMode: RightPanelMode;
  activeRunByThreadId: Record<string, string>;
  currentSseRunId?: string;
};

export type AppAction =
  | { type: 'select_thread'; threadId: string }
  | { type: 'select_file'; path: string }
  | { type: 'select_run_detail'; runId: string }
  | { type: 'run_started'; threadId: string; runId: string; status: PublicRunStatus }
  | { type: 'run_done'; threadId: string; runId: string };

export const initialAppState: AppState = {
  selectedFilePath: 'docs/design/enterprise-agent-dashboard.md',
  rightPanelMode: 'editor',
  activeRunByThreadId: {}
};

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'select_thread':
      return { ...state, selectedThreadId: action.threadId };
    case 'select_file':
      return { ...state, selectedFilePath: action.path, rightPanelMode: 'editor' };
    case 'select_run_detail':
      return { ...state, selectedRunId: action.runId, rightPanelMode: 'run_detail' };
    case 'run_started':
      if (action.status === 'succeeded' || action.status === 'failed' || action.status === 'canceled') return state;
      return { ...state, activeRunByThreadId: { ...state.activeRunByThreadId, [action.threadId]: action.runId } };
    case 'run_done': {
      const next = { ...state.activeRunByThreadId };
      if (next[action.threadId] === action.runId) delete next[action.threadId];
      return { ...state, activeRunByThreadId: next };
    }
  }
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/app/app-state.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app
git commit -m "feat: add web app state model"
```

## Task 9: 四区布局和基础样式

**Files:**
- Create: `apps/web/src/components/layout/AppLayout.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/app/App.tsx`

- [ ] **Step 1: 写布局 smoke 测试**

创建 `apps/web/src/components/layout/AppLayout.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLayout } from './AppLayout.js';

describe('AppLayout', () => {
  it('renders four dashboard regions', () => {
    render(
      <AppLayout
        sidebar={<div>左侧</div>}
        timeline={<div>中间</div>}
        rightPanel={<div>右侧</div>}
        fileTree={<div>最右</div>}
      />
    );

    expect(screen.getByLabelText('主导航和会话')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent 对话')).toBeInTheDocument();
    expect(screen.getByLabelText('文件和运行详情')).toBeInTheDocument();
    expect(screen.getByLabelText('项目文件树')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 实现布局组件**

`apps/web/src/components/layout/AppLayout.tsx`：

```tsx
import type { ReactNode } from 'react';

export function AppLayout(props: {
  sidebar: ReactNode;
  timeline: ReactNode;
  rightPanel: ReactNode;
  fileTree: ReactNode;
}) {
  return (
    <main className="dashboard-shell">
      <aside className="sidebar-pane" aria-label="主导航和会话">{props.sidebar}</aside>
      <section className="timeline-pane" aria-label="Agent 对话">{props.timeline}</section>
      <section className="right-pane" aria-label="文件和运行详情">{props.rightPanel}</section>
      <aside className="tree-pane" aria-label="项目文件树">{props.fileTree}</aside>
    </main>
  );
}
```

- [ ] **Step 3: 实现样式**

`apps/web/src/styles/tokens.css`：

```css
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #f1f4f7;
  --border: #d7dde5;
  --text: #17202a;
  --muted: #667085;
  --accent: #2563eb;
  --danger: #b42318;
  --warning: #b54708;
  --success: #067647;
  --radius: 8px;
  --font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

`apps/web/src/styles/app.css`：

```css
@import "./tokens.css";

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 1024px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
}

button,
input,
textarea,
select {
  font: inherit;
}

.dashboard-shell {
  display: grid;
  grid-template-columns: 260px minmax(360px, 1fr) minmax(360px, 520px) 280px;
  height: 100vh;
  overflow: hidden;
}

.sidebar-pane,
.timeline-pane,
.right-pane,
.tree-pane {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
}

.timeline-pane {
  background: #fbfcfd;
}

.panel-header {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}

.panel-scroll {
  height: calc(100vh - 48px);
  overflow: auto;
}
```

修改 `apps/web/src/main.tsx` 引入样式：

```ts
import './styles/app.css';
```

- [ ] **Step 4: 更新 App 使用布局**

`apps/web/src/app/App.tsx`：

```tsx
import { AppLayout } from '../components/layout/AppLayout.js';

export function App() {
  return (
    <AppLayout
      sidebar={<div className="panel-header">OpenCreator Agent</div>}
      timeline={<div className="panel-header">Agent 对话</div>}
      rightPanel={<div className="panel-header">文件</div>}
      fileTree={<div className="panel-header">项目文件</div>}
    />
  );
}
```

- [ ] **Step 5: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/components/layout/AppLayout.test.tsx
pnpm --filter @opencreator/web build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components apps/web/src/styles apps/web/src/app/App.tsx apps/web/src/main.tsx
git commit -m "feat: add web dashboard layout"
```

## Task 10: 连接状态、Thread 列表和发送 Run

**Files:**
- Create: `apps/web/src/features/connection/ConnectionPanel.tsx`
- Create: `apps/web/src/features/threads/ThreadList.tsx`
- Create: `apps/web/src/features/runs/Composer.tsx`
- Modify: `apps/web/src/app/App.tsx`

- [ ] **Step 1: 写 Composer 禁用测试**

`apps/web/src/features/runs/Composer.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('is disabled when current thread has an active run', () => {
    render(<Composer disabled onSubmit={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 实现 ConnectionPanel**

`apps/web/src/features/connection/ConnectionPanel.tsx`：

```tsx
import type { CodexStatusResponse } from '@opencreator/protocol';

export function ConnectionPanel(props: {
  status: 'connected' | 'disconnected' | 'invalid_token';
  codexStatus?: CodexStatusResponse;
}) {
  const text = props.status === 'connected'
    ? `已连接 ${props.codexStatus?.codexVersion ?? 'unknown'}`
    : props.status === 'invalid_token'
      ? 'Token 无效'
      : '未连接 Runtime';

  return (
    <div className="panel-header" aria-label="Runtime 连接状态">
      <span>{text}</span>
    </div>
  );
}
```

- [ ] **Step 3: 实现 ThreadList**

`apps/web/src/features/threads/ThreadList.tsx`：

```tsx
import type { ThreadResponse } from '@opencreator/protocol';

export function ThreadList(props: {
  threads: ThreadResponse[];
  selectedThreadId?: string;
  onSelect(threadId: string): void;
  onNewThread(): void;
}) {
  return (
    <div>
      <div className="panel-header">
        <button type="button" onClick={props.onNewThread}>新对话</button>
      </div>
      <div className="panel-scroll">
        {props.threads.length === 0 ? (
          <p className="empty-state">暂无真实会话</p>
        ) : props.threads.map(thread => (
          <button
            key={thread.id}
            type="button"
            className="session-row"
            aria-current={thread.id === props.selectedThreadId}
            onClick={() => props.onSelect(thread.id)}
          >
            <strong>{thread.title ?? thread.id}</strong>
            <span>{thread.profile} · {thread.sandbox}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 实现 Composer**

`apps/web/src/features/runs/Composer.tsx`：

```tsx
import { useState } from 'react';

export function Composer(props: {
  disabled?: boolean;
  onSubmit(prompt: string): void;
}) {
  const [prompt, setPrompt] = useState('');

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = prompt.trim();
        if (trimmed.length === 0) return;
        props.onSubmit(trimmed);
        setPrompt('');
      }}
    >
      <textarea
        aria-label="输入任务"
        value={prompt}
        disabled={props.disabled}
        onChange={event => setPrompt(event.target.value)}
        placeholder={props.disabled ? '当前会话有任务运行中' : '输入要交给 Agent 的任务...'}
      />
      <button type="submit" disabled={props.disabled || prompt.trim().length === 0}>发送</button>
    </form>
  );
}
```

- [ ] **Step 5: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/features/runs/Composer.test.tsx
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features apps/web/src/app/App.tsx
git commit -m "feat: add connection threads and composer ui"
```

## Task 11: Timeline、SSE 事件映射和 Run 详情

**Files:**
- Create: `apps/web/src/components/timeline/Timeline.tsx`
- Create: `apps/web/src/components/timeline/timeline-model.ts`
- Create: `apps/web/src/features/runs/RunDetailPanel.tsx`
- Create: `apps/web/src/components/timeline/timeline-model.test.ts`

- [ ] **Step 1: 写事件映射测试**

`apps/web/src/components/timeline/timeline-model.test.ts`：

```ts
import type { AgentEventEnvelope } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { eventToTimelineItem } from './timeline-model.js';

describe('timeline model', () => {
  it('maps assistant_message events', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'assistant_message',
      payload: { type: 'assistant_message', text: 'hello', format: 'plain_text', delivery: 'message' },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'assistant_message',
      text: 'hello',
      source: 'runtime'
    });
  });
});
```

- [ ] **Step 2: 实现 timeline model**

`apps/web/src/components/timeline/timeline-model.ts`：

```ts
import type { AgentEventEnvelope } from '@opencreator/protocol';

export type TimelineItem =
  | { kind: 'user_message'; id: string; text: string; source: 'runtime' | 'mock' }
  | { kind: 'assistant_message'; id: string; text: string; source: 'runtime' | 'mock' }
  | { kind: 'tool_step'; id: string; name: string; content: string; source: 'runtime' }
  | { kind: 'change_card'; id: string; title: string; path: string; delta: string; source: 'mock' }
  | { kind: 'diagnostic'; id: string; severity: 'info' | 'warning' | 'error'; message: string; source: 'runtime' }
  | { kind: 'run_status'; id: string; label: string; source: 'runtime' }
  | { kind: 'done'; id: string; status: string; source: 'runtime' };

export function eventToTimelineItem(event: AgentEventEnvelope): TimelineItem {
  switch (event.type) {
    case 'assistant_message':
      return { kind: 'assistant_message', id: event.id, text: event.payload.text, source: 'runtime' };
    case 'tool_use':
      return { kind: 'tool_step', id: event.id, name: event.payload.name, content: JSON.stringify(event.payload.input), source: 'runtime' };
    case 'tool_result':
      return { kind: 'tool_step', id: event.id, name: event.payload.toolCallId, content: event.payload.output, source: 'runtime' };
    case 'diagnostic':
      return { kind: 'diagnostic', id: event.id, severity: event.payload.severity, message: event.payload.message, source: 'runtime' };
    case 'error':
      return { kind: 'diagnostic', id: event.id, severity: 'error', message: event.payload.message, source: 'runtime' };
    case 'done':
      return { kind: 'done', id: event.id, status: event.payload.status, source: 'runtime' };
    default:
      return { kind: 'run_status', id: event.id, label: event.type, source: 'runtime' };
  }
}
```

- [ ] **Step 3: 实现 Timeline 和 RunDetailPanel**

`apps/web/src/components/timeline/Timeline.tsx`：

```tsx
import type { TimelineItem } from './timeline-model.js';

export function Timeline(props: { items: TimelineItem[] }) {
  return (
    <div className="panel-scroll timeline-list">
      {props.items.length === 0 ? <p className="empty-state">还没有任务记录</p> : props.items.map(item => (
        <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
          <strong>{item.kind}</strong>
          {'text' in item ? <p>{item.text}</p> : null}
          {'message' in item ? <p>{item.message}</p> : null}
          {'content' in item ? <pre>{item.content}</pre> : null}
          {item.kind === 'change_card' ? <p>{item.path} {item.delta}</p> : null}
        </article>
      ))}
    </div>
  );
}
```

`apps/web/src/features/runs/RunDetailPanel.tsx`：

```tsx
import type { RunDiagnosticsResponse } from '@opencreator/protocol';

export function RunDetailPanel(props: {
  runId?: string;
  diagnostics?: RunDiagnosticsResponse;
}) {
  if (props.runId === undefined) return <div className="panel-scroll"><p className="empty-state">选择 run 查看详情</p></div>;
  return (
    <div className="panel-scroll">
      <h2>Run {props.runId}</h2>
      <h3>Diagnostics</h3>
      {props.diagnostics?.files.map(file => (
        <details key={file.name}>
          <summary>{file.name}</summary>
          <pre>{file.content}</pre>
        </details>
      )) ?? <p>暂无诊断文件</p>}
    </div>
  );
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/components/timeline/timeline-model.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/timeline apps/web/src/features/runs/RunDetailPanel.tsx
git commit -m "feat: render runtime timeline and run details"
```

## Task 12: 文件树和文件编辑器

**Files:**
- Create: `apps/web/src/components/editor/FileTree.tsx`
- Create: `apps/web/src/components/editor/FileEditor.tsx`
- Create: `apps/web/src/components/editor/FileEditor.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

- [ ] **Step 1: 写 FileEditor 保存文案测试**

`apps/web/src/components/editor/FileEditor.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileEditor } from './FileEditor.js';

describe('FileEditor', () => {
  it('uses local draft wording when saving mock files', async () => {
    const onSave = vi.fn();
    render(<FileEditor path="notes/demo.txt" content="hello" dirty={false} onChange={vi.fn()} onSave={onSave} />);

    await userEvent.click(screen.getByRole('button', { name: '保存到本地草稿' }));

    expect(onSave).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 实现 FileTree**

`apps/web/src/components/editor/FileTree.tsx`：

```tsx
import type { FileTreeNode } from '../../services/file-service.js';

export function FileTree(props: {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect(path: string): void;
}) {
  return (
    <div className="panel-scroll">
      {props.nodes.map(node => node.type === 'folder' ? (
        <div key={node.path} className="tree-folder" style={{ paddingLeft: 8 + node.depth * 14 }}>{node.name}</div>
      ) : (
        <button
          key={node.path}
          type="button"
          className="tree-file"
          aria-current={node.path === props.selectedPath}
          style={{ paddingLeft: 8 + node.depth * 14 }}
          onClick={() => props.onSelect(node.path)}
        >
          {node.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 实现 FileEditor**

`apps/web/src/components/editor/FileEditor.tsx`：

```tsx
export function FileEditor(props: {
  path: string;
  content: string;
  dirty: boolean;
  onChange(content: string): void;
  onSave(): void;
}) {
  return (
    <div className="file-editor">
      <div className="panel-header">
        <strong>{props.path}</strong>
        <span>{props.dirty ? '未保存' : '已保存到本地草稿'}</span>
        <button type="button" onClick={props.onSave}>保存到本地草稿</button>
      </div>
      <textarea
        className="code-textarea"
        aria-label={`${props.path} 编辑器`}
        value={props.content}
        onChange={event => props.onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
```

- [ ] **Step 4: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/components/editor/FileEditor.test.tsx
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/components/editor apps/web/src/app/App.tsx
git commit -m "feat: add mock file tree and editor"
```

## Task 13: 能力页 Skills/MCP/Profiles

**Files:**
- Create: `apps/web/src/features/capabilities/CapabilitiesView.tsx`
- Create: `apps/web/src/features/capabilities/CapabilitiesView.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

- [ ] **Step 1: 写 disconnected 测试**

`apps/web/src/features/capabilities/CapabilitiesView.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapabilitiesView } from './CapabilitiesView.js';

describe('CapabilitiesView', () => {
  it('shows connection hint when disconnected', () => {
    render(<CapabilitiesView connected={false} />);
    expect(screen.getByText('连接 Runtime 后查看 Skills、MCP 和 Profiles')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 实现组件**

`apps/web/src/features/capabilities/CapabilitiesView.tsx`：

```tsx
import type { CodexMcpListResponse, CodexSkillListResponse } from '@opencreator/protocol';
import type { CodexProfileListResponse } from '../../services/capability-service.js';

export function CapabilitiesView(props: {
  connected: boolean;
  skills?: CodexSkillListResponse;
  mcp?: CodexMcpListResponse;
  profiles?: CodexProfileListResponse;
}) {
  if (!props.connected) {
    return <div className="panel-scroll"><p>连接 Runtime 后查看 Skills、MCP 和 Profiles</p></div>;
  }
  return (
    <div className="panel-scroll">
      <h2>能力</h2>
      <section>
        <h3>Skills</h3>
        <p>{props.skills?.skills.length ?? 0} 个 skills</p>
      </section>
      <section>
        <h3>MCP</h3>
        <p>{props.mcp?.servers.length ?? 0} 个 servers</p>
      </section>
      <section>
        <h3>Profiles</h3>
        <p>{props.profiles?.profiles.length ?? 0} 个 profiles</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/features/capabilities/CapabilitiesView.test.tsx
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/capabilities apps/web/src/app/App.tsx
git commit -m "feat: add runtime capabilities view"
```

## Task 14: Schedules 页面

**Files:**
- Create: `apps/web/src/features/schedules/SchedulesView.tsx`
- Create: `apps/web/src/features/schedules/SchedulesView.test.tsx`

- [ ] **Step 1: 写 sandbox 风险提示测试**

`apps/web/src/features/schedules/SchedulesView.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchedulesView } from './SchedulesView.js';

describe('SchedulesView', () => {
  it('shows workspace-write risk copy', () => {
    render(<SchedulesView connected schedules={[]} />);
    expect(screen.getByText('计划任务默认使用 workspace-write，可能在无人值守时修改工作区。')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 实现 SchedulesView**

`apps/web/src/features/schedules/SchedulesView.tsx`：

```tsx
import type { ScheduleResponse } from '@opencreator/protocol';

export function SchedulesView(props: {
  connected: boolean;
  schedules?: ScheduleResponse[];
}) {
  if (!props.connected) {
    return <div className="panel-scroll"><p>连接 Runtime 后管理计划任务</p></div>;
  }
  return (
    <div className="panel-scroll">
      <h2>计划任务</h2>
      <p>计划任务默认使用 workspace-write，可能在无人值守时修改工作区。</p>
      {(props.schedules ?? []).length === 0 ? <p>暂无计划任务</p> : null}
      {(props.schedules ?? []).map(schedule => (
        <article key={schedule.id}>
          <strong>{schedule.name}</strong>
          <span>{schedule.cron}</span>
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/features/schedules/SchedulesView.test.tsx
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/schedules
git commit -m "feat: add schedules view"
```

## Task 15: Settings/Cleanup 页面

**Files:**
- Create: `apps/web/src/features/settings/SettingsView.tsx`
- Create: `apps/web/src/features/settings/SettingsView.test.tsx`

- [ ] **Step 1: 写 cleanup preview-first 测试**

`apps/web/src/features/settings/SettingsView.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsView } from './SettingsView.js';

describe('SettingsView', () => {
  it('requires cleanup preview before delete', () => {
    render(<SettingsView connected cleanupPreviewed={false} />);
    expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 实现 SettingsView**

`apps/web/src/features/settings/SettingsView.tsx`：

```tsx
export function SettingsView(props: {
  connected: boolean;
  cleanupPreviewed: boolean;
}) {
  return (
    <div className="panel-scroll">
      <h2>设置</h2>
      <section>
        <h3>Runtime</h3>
        <p>{props.connected ? '已连接 Runtime' : '未连接 Runtime'}</p>
      </section>
      <section>
        <h3>清理</h3>
        <button type="button">预览清理</button>
        <button type="button" disabled={!props.cleanupPreviewed}>确认清理</button>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 验证**

Run:

```bash
pnpm --filter @opencreator/web test -- src/features/settings/SettingsView.test.tsx
pnpm --filter @opencreator/web typecheck
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/features/settings
git commit -m "feat: add settings cleanup view"
```

## Task 16: 组装 App 数据流

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 替换 App 为可运行 Dashboard**

`apps/web/src/app/App.tsx`：

```tsx
import { useEffect, useMemo, useReducer, useState } from 'react';
import { FileEditor } from '../components/editor/FileEditor.js';
import { FileTree } from '../components/editor/FileTree.js';
import { AppLayout } from '../components/layout/AppLayout.js';
import { Timeline } from '../components/timeline/Timeline.js';
import type { TimelineItem } from '../components/timeline/timeline-model.js';
import { ConnectionPanel } from '../features/connection/ConnectionPanel.js';
import { Composer } from '../features/runs/Composer.js';
import { RunDetailPanel } from '../features/runs/RunDetailPanel.js';
import { ThreadList } from '../features/threads/ThreadList.js';
import { createMockChangeService } from '../services/change-service.js';
import { createMockFileService, type FileTreeNode, type WorkspaceFile } from '../services/file-service.js';
import { createMockProjectService } from '../services/project-service.js';
import { initialAppState, reduceAppState } from './app-state.js';

export function App() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<WorkspaceFile | undefined>();
  const [editorContent, setEditorContent] = useState('');
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const projectService = useMemo(() => createMockProjectService(), []);
  const fileService = useMemo(() => createMockFileService(), []);
  const changeService = useMemo(() => createMockChangeService(), []);

  useEffect(() => {
    void projectService.getDefaultProject();
    void fileService.listTree().then(setFileTree);
  }, [fileService, projectService]);

  useEffect(() => {
    void fileService.openFile(state.selectedFilePath).then(file => {
      setCurrentFile(file);
      setEditorContent(file.content);
    });
  }, [fileService, state.selectedFilePath]);

  async function saveCurrentFile() {
    if (currentFile === undefined) return;
    const saved = await fileService.saveFile(currentFile.path, editorContent);
    setCurrentFile(saved);
  }

  function submitPrompt(prompt: string) {
    setTimelineItems(items => [
      ...items,
      { kind: 'user_message', id: `user_${Date.now()}`, text: prompt, source: 'mock' },
      { kind: 'assistant_message', id: `assistant_${Date.now()}`, text: '当前未连接 Runtime，已在 mock workspace 中记录本次任务。', source: 'mock' }
    ]);
    if (currentFile !== undefined) {
      const change = changeService.createPromptChange(prompt, currentFile.path);
      setTimelineItems(items => [
        ...items,
        { kind: 'change_card', id: change.id, title: change.title, path: change.path, delta: change.delta, source: 'mock' }
      ]);
    }
  }

  return (
    <AppLayout
      sidebar={
        <div>
          <ConnectionPanel status="disconnected" />
          <ThreadList threads={[]} onNewThread={() => undefined} onSelect={() => undefined} />
        </div>
      }
      timeline={
        <div className="timeline-shell">
          <Timeline items={timelineItems} />
          <Composer onSubmit={submitPrompt} />
        </div>
      }
      rightPanel={
        state.rightPanelMode === 'run_detail' ? (
          <RunDetailPanel runId={state.selectedRunId} />
        ) : currentFile === undefined ? (
          <div className="panel-scroll">正在加载文件...</div>
        ) : (
          <FileEditor
            path={currentFile.path}
            content={editorContent}
            dirty={editorContent !== currentFile.content}
            onChange={setEditorContent}
            onSave={saveCurrentFile}
          />
        )
      }
      fileTree={
        <FileTree
          nodes={fileTree}
          selectedPath={state.selectedFilePath}
          onSelect={path => dispatch({ type: 'select_file', path })}
        />
      }
    />
  );
}
```

- [ ] **Step 2: 补齐样式**

追加到 `apps/web/src/styles/app.css`：

```css
.empty-state {
  color: var(--muted);
  padding: 16px;
}

.session-row,
.tree-file,
.tree-folder {
  width: 100%;
  display: block;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  padding-top: 8px;
  padding-bottom: 8px;
}

.session-row[aria-current="true"],
.tree-file[aria-current="true"] {
  background: var(--surface-2);
}

.timeline-shell {
  display: grid;
  grid-template-rows: 1fr auto;
  height: 100vh;
}

.timeline-item {
  margin: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.composer {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.composer textarea {
  min-height: 64px;
  resize: vertical;
}

.file-editor {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100vh;
}

.code-textarea {
  width: 100%;
  height: 100%;
  border: 0;
  padding: 14px;
  resize: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
}
```

- [ ] **Step 3: 验证**

Run:

```bash
pnpm --filter @opencreator/web typecheck
pnpm --filter @opencreator/web build
pnpm --filter @opencreator/web test
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/app/App.tsx apps/web/src/styles/app.css
git commit -m "feat: wire web app data flow"
```

## Task 17: 真实 daemon 手动验收

**Files:**
- Modify: `docs/runtime-api-for-ui-v1.md` if behavior changed during implementation
- Modify: `docs/superpowers/specs/2026-07-06-codex-runtime-ui-web-app-design.md` only if implementation requires a documented design correction

- [ ] **Step 1: 启动 daemon**

Run:

```bash
pnpm daemon:dev
```

Expected: stdout 输出：

```json
{"address":"http://127.0.0.1:<port>","token":"<token>"}
```

- [ ] **Step 2: 启动 Web App**

Run in another terminal:

```bash
pnpm web:dev
```

Expected: Vite 输出本地 URL，例如 `http://127.0.0.1:5173/`。

- [ ] **Step 3: 浏览器手动验证**

1. 打开 Web App。
2. 输入 daemon address/token。
3. 顶部连接状态显示真实 Codex version。
4. 发送 prompt：`Reply with OK only.`。
5. timeline 显示 user message。
6. Runtime 返回 run 202 后显示 queued/running。
7. fetch-based SSE 收到 assistant/done。
8. 点击诊断卡或 run 状态，右侧切到 Run 详情。
9. 点击文件树，右侧切回编辑器。
10. 修改 mock 文件并保存到本地草稿。
11. 刷新页面，确认 mock 文件内容仍存在。

- [ ] **Step 4: 运行全量验证**

Run:

```bash
pnpm typecheck
pnpm test
pnpm --filter @opencreator/web build
git diff --check
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add docs/runtime-api-for-ui-v1.md docs/superpowers/specs/2026-07-06-codex-runtime-ui-web-app-design.md
git commit -m "docs: update ui runtime verification notes"
```

只在文档实际修改时执行提交；如果文档无需修改，跳过本步骤。

## 2. 计划自审

### Spec 覆盖

1. daemon CORS：Task 1。
2. `apps/web` scaffold：Task 2。
3. RuntimeClient、Authorization、ApiError、轻量校验：Task 3。
4. fetch-based SSE、heartbeat、fromSeq：Task 4。
5. HostBridge、localStorage connection、IndexedDB 文件存储：Task 5。
6. mock Project/File/Approval/Change services：Task 6。
7. Runtime-backed services：Task 7。
8. app state、activeRunByThreadId、router：Task 8。
9. 四区 Dashboard 布局：Task 9。
10. connection/thread/run composer：Task 10。
11. timeline 和右侧 Run detail/diagnostics：Task 11。
12. 文件树和文件编辑器：Task 12。
13. Skills/MCP/Profiles：Task 13。
14. Schedules sandbox 风险提示：Task 14。
15. Settings/Cleanup preview-first：Task 15。
16. 集成数据流：Task 16。
17. 真实 daemon 手动验收：Task 17。

### 已知执行注意

1. 任务 1 需要更新 lockfile。
2. 任务 2 需要安装 React/Vite 相关依赖。
3. 如果 React 19 与 Testing Library 在当前 pnpm 环境有 peer dependency 冲突，优先降到 React 18.3.x，并在同一任务内记录实际版本。
4. 计划中的组件代码是第一版最小实现，视觉 polish 可在 Task 16 后追加，但必须继续保持四区结构和 mock/runtime 边界。
5. 任务 17 的真实 Codex run 可能受认证、网络或额度影响；如果环境失败，需要记录为环境阻塞，不能宣称真实 run 通过。
