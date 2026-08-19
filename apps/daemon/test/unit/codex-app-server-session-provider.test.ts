import { describe, expect, it, vi } from 'vitest';
import {
  createCodexSessionProvider,
  type CodexConversationSearchPage,
  type CodexAppServerRequestClient
} from '../../src/codex/sessions/app-server-provider.js';
import { CodexAppServerResponseError } from '../../src/codex/app-server-client.js';

describe('Codex app-server session provider', () => {
  it('resumes a persisted thread before retrying history after an app-server restart', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new CodexAppServerResponseError(
        'thread not loaded: codex-thread-persisted',
        -32600
      ))
      .mockResolvedValueOnce({
        thread: codexThread({
          id: 'codex-thread-persisted',
          turns: []
        })
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: null,
        backwardsCursor: null
      });
    const provider = createCodexSessionProvider({
      client: fakeClient(request)
    });

    await expect(provider.listTurns({
      codexThreadId: 'codex-thread-persisted',
      limit: 50
    })).resolves.toEqual({ items: [], hasMore: false });

    expect(request.mock.calls).toEqual([
      ['thread/turns/list', {
        threadId: 'codex-thread-persisted',
        cursor: null,
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'summary'
      }],
      ['thread/resume', {
        threadId: 'codex-thread-persisted'
      }],
      ['thread/turns/list', {
        threadId: 'codex-thread-persisted',
        cursor: null,
        limit: 50,
        sortDirection: 'desc',
        itemsView: 'summary'
      }]
    ]);
  });

  it('maps summary turns in chronological order and reuses a short-lived page cache', async () => {
    const request = vi.fn(async () => ({
      data: [
        {
          id: 'turn-2',
          status: 'failed',
          startedAt: 1_784_080_800,
          completedAt: 1_784_080_860,
          itemsView: 'summary',
          items: [
            {
              type: 'userMessage',
              id: 'user-2',
              clientId: null,
              content: [{ type: 'text', text: '第二个问题', text_elements: [] }]
            },
            {
              type: 'agentMessage',
              id: 'assistant-2',
              text: '第二个回答',
              phase: 'final_answer',
              memoryCitation: null
            }
          ],
          error: { message: 'failed' },
          durationMs: 60_000
        },
        {
          id: 'turn-1',
          status: 'completed',
          startedAt: 1_784_073_600,
          completedAt: 1_784_073_660,
          itemsView: 'summary',
          items: [
            {
              type: 'userMessage',
              id: 'user-1',
              clientId: null,
              content: [{ type: 'text', text: '第一个问题', text_elements: [] }]
            },
            {
              type: 'agentMessage',
              id: 'assistant-1',
              text: '第一个回答',
              phase: 'final_answer',
              memoryCitation: null
            }
          ],
          error: null,
          durationMs: 60_000
        }
      ],
      nextCursor: 'older-turns',
      backwardsCursor: null
    }));
    const provider = createCodexSessionProvider({
      client: fakeClient(request)
    });

    const first = await provider.listTurns({
      codexThreadId: 'codex-thread-1',
      limit: 20,
      cursor: 'current-page'
    });
    const cached = await provider.listTurns({
      codexThreadId: 'codex-thread-1',
      limit: 20,
      cursor: 'current-page'
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('thread/turns/list', {
      threadId: 'codex-thread-1',
      cursor: 'current-page',
      limit: 20,
      sortDirection: 'desc',
      itemsView: 'summary'
    });
    expect(cached).toEqual(first);
    expect(first).toEqual({
      items: [
        {
          id: 'user-1',
          type: 'user_message',
          text: '第一个问题',
          createdAt: '2026-07-15T00:00:00.000Z',
          turnId: 'turn-1'
        },
        {
          id: 'assistant-1',
          type: 'assistant_message',
          text: '第一个回答',
          createdAt: '2026-07-15T00:01:00.000Z',
          turnId: 'turn-1'
        },
        {
          id: 'history_done_turn-1',
          type: 'done',
          status: 'succeeded',
          createdAt: '2026-07-15T00:01:00.000Z',
          turnId: 'turn-1'
        },
        {
          id: 'user-2',
          type: 'user_message',
          text: '第二个问题',
          createdAt: '2026-07-15T02:00:00.000Z',
          turnId: 'turn-2'
        },
        {
          id: 'assistant-2',
          type: 'assistant_message',
          text: '第二个回答',
          createdAt: '2026-07-15T02:01:00.000Z',
          turnId: 'turn-2'
        },
        {
          id: 'history_done_turn-2',
          type: 'done',
          status: 'failed',
          createdAt: '2026-07-15T02:01:00.000Z',
          turnId: 'turn-2'
        }
      ],
      hasMore: true,
      nextCursor: 'older-turns',
      oldestItemAt: '2026-07-15T00:00:00.000Z'
    });
  });

  it('filters injected context and preserves scheduled task triggers from summary turns', async () => {
    const request = vi.fn(async () => ({
      data: [{
        id: 'turn-schedule',
        status: 'completed',
        startedAt: 1_784_073_600,
        completedAt: 1_784_073_660,
        itemsView: 'summary',
        items: [
          {
            type: 'userMessage',
            id: 'user-injected',
            clientId: null,
            content: [{
              type: 'text',
              text: '# AGENTS.md instructions\n\n<INSTRUCTIONS>内部上下文</INSTRUCTIONS>',
              text_elements: []
            }]
          },
          {
            type: 'userMessage',
            id: 'user-schedule',
            clientId: null,
            content: [{
              type: 'text',
              text: [
                '这是 OpenCreator 已经触发的一次计划任务执行。',
                '',
                '执行规则：',
                '1. 立即完成本次任务，不要重新创建或修改计划任务。',
                '2. 只输出本次执行结果。',
                '',
                '任务名称：日报',
                '本次触发时间：2026-07-15T00:00:00.000Z',
                '任务内容：',
                '整理今日进展'
              ].join('\n'),
              text_elements: []
            }]
          }
        ],
        error: null,
        durationMs: 60_000
      }],
      nextCursor: null,
      backwardsCursor: null
    }));
    const provider = createCodexSessionProvider({
      client: fakeClient(request)
    });

    const page = await provider.listTurns({
      codexThreadId: 'codex-thread-schedule',
      limit: 20
    });

    expect(page.items).toEqual([
      {
        id: 'user-schedule',
        type: 'schedule_trigger',
        prompt: '整理今日进展',
        triggeredAt: '2026-07-15T00:00:00.000Z',
        createdAt: '2026-07-15T00:00:00.000Z',
        turnId: 'turn-schedule'
      },
      {
        id: 'history_done_turn-schedule',
        type: 'done',
        status: 'succeeded',
        createdAt: '2026-07-15T00:01:00.000Z',
        turnId: 'turn-schedule'
      }
    ]);
  });

  it('maps a OpenCreator-managed request wrapper to one public user message', async () => {
    const request = vi.fn(async () => ({
      data: [{
        id: 'turn-managed-context',
        status: 'completed',
        startedAt: 1_784_073_600,
        completedAt: 1_784_073_660,
        itemsView: 'summary',
        items: [
          {
            type: 'userMessage',
            id: 'user-managed-context',
            clientId: null,
            content: [{
              type: 'text',
              text: [
                '[OpenCreator 用户显式管理的上下文]',
                '- 会话摘要：不应显示在用户消息中',
                '[上下文结束]',
                '',
                '用户当前请求：',
                '修复重复请求'
              ].join('\n'),
              text_elements: []
            }]
          }
        ],
        error: null,
        durationMs: 60_000
      }],
      nextCursor: null,
      backwardsCursor: null
    }));
    const provider = createCodexSessionProvider({
      client: fakeClient(request)
    });

    const page = await provider.listTurns({
      codexThreadId: 'codex-thread-managed-context',
      limit: 20
    });

    expect(page.items).toEqual([
      {
        id: 'user-managed-context',
        type: 'user_message',
        text: '修复重复请求',
        createdAt: '2026-07-15T00:00:00.000Z',
        turnId: 'turn-managed-context'
      },
      {
        id: 'history_done_turn-managed-context',
        type: 'done',
        status: 'succeeded',
        createdAt: '2026-07-15T00:01:00.000Z',
        turnId: 'turn-managed-context'
      }
    ]);
    expect(JSON.stringify(page.items)).not.toContain('会话摘要');
  });

  it('searches through app-server and returns conversation-level results without item ids', async () => {
    const request = vi.fn(async () => ({
      data: [{
        thread: codexThread({
          id: 'codex-thread-search',
          name: null,
          preview: '页面卡住问题',
          createdAt: 1_784_073_600,
          updatedAt: 1_784_077_200,
          recencyAt: null
        }),
        snippet: '刷新后页面卡住，需要检查会话加载。'
      }],
      nextCursor: null,
      backwardsCursor: null
    }));
    const provider = createCodexSessionProvider({
      client: fakeClient(request)
    });

    const response: CodexConversationSearchPage = await provider.search({
      query: '页面卡住',
      limit: 20
    });

    expect(request).toHaveBeenCalledWith('thread/search', {
      searchTerm: '页面卡住',
      limit: 20,
      cursor: null,
      archived: false,
      sourceKinds: ['cli', 'vscode', 'exec', 'appServer'],
      sortKey: 'recency_at',
      sortDirection: 'desc'
    });
    expect(response).toEqual({
      results: [{
        codexThreadId: 'codex-thread-search',
        title: '页面卡住问题',
        cwd: '/workspace/project',
        itemType: 'title',
        createdAt: '2026-07-15T01:00:00.000Z',
        snippet: [
          { text: '刷新后', highlighted: false },
          { text: '页面卡住', highlighted: true },
          { text: ',需要检查会话加载。', highlighted: false }
        ]
      }],
      hasMore: false
    });
    expect(response.results[0]).not.toHaveProperty('itemId');
  });
});

function fakeClient(
  request: (method: string, params: unknown) => Promise<unknown>
): CodexAppServerRequestClient {
  return {
    request<Result>(method: string, params: unknown): Promise<Result> {
      return request(method, params) as Promise<Result>;
    },
    close: vi.fn(async () => undefined)
  };
}

function codexThread(overrides: Record<string, unknown>) {
  return {
    id: 'codex-thread',
    preview: '会话预览',
    name: null,
    createdAt: 1_783_987_200,
    updatedAt: 1_783_990_800,
    recencyAt: null,
    cwd: '/workspace/project',
    ...overrides
  };
}
