import type { ThreadHistoryItem } from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import {
  MemoryServiceError,
  createMemoryService
} from '../../src/memory/service.js';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function createService() {
  db = openRuntimeDatabase(':memory:');
  return createMemoryService({ db });
}

describe('memory service', () => {
  it('creates, searches, edits, disables, and deletes user-confirmed memories', () => {
    const service = createService();
    const globalMemory = service.createMemory({
      content: '所有回答使用中文',
      scope: 'global',
      source: 'user'
    });
    const projectMemory = service.createMemory({
      content: '这个项目使用 pnpm',
      scope: 'project',
      scopeKey: '/workspace/project',
      source: 'agent_suggestion'
    });

    expect(service.listMemories({ query: 'pnpm' }).memories).toEqual([
      expect.objectContaining({ id: projectMemory.id, enabled: true })
    ]);
    expect(service.updateMemory(projectMemory.id, {
      content: '这个项目使用 pnpm，并在提交前运行测试',
      enabled: false
    })).toMatchObject({
      content: '这个项目使用 pnpm，并在提交前运行测试',
      enabled: false
    });
    expect(service.disableAll()).toBe(1);
    expect(service.getMemory(globalMemory.id)?.enabled).toBe(false);
    expect(service.deleteMemory(projectMemory.id)).toBe(true);
    expect(service.getMemory(projectMemory.id)).toBeUndefined();
  });

  it('requires explicit acknowledgement before storing sensitive-looking content', () => {
    const service = createService();

    expect(() => service.createMemory({
      content: 'API token: sk-sensitive-value',
      scope: 'global',
      source: 'agent_suggestion'
    })).toThrowError(MemoryServiceError);
    expect(service.listMemories().memories).toEqual([]);

    expect(service.createMemory({
      content: 'API token: sk-sensitive-value',
      scope: 'global',
      source: 'agent_suggestion',
      acknowledgeSensitive: true
    })).toMatchObject({ sensitive: true });
  });

  it('selects scoped enabled memories within limits and records immutable run snapshots', () => {
    const service = createService();
    const globalMemory = service.createMemory({
      content: '全局偏好',
      scope: 'global',
      source: 'user'
    });
    const projectMemory = service.createMemory({
      content: '项目约定',
      scope: 'project',
      scopeKey: '/workspace/project',
      source: 'user'
    });
    service.createMemory({
      content: '其他项目',
      scope: 'project',
      scopeKey: '/workspace/other',
      source: 'user'
    });
    const threadMemory = service.createMemory({
      content: '当前会话要求',
      scope: 'thread',
      scopeKey: 'thread_1',
      source: 'user'
    });
    service.updateMemory(globalMemory.id, { enabled: false });

    const prepared = service.prepareRunContext({
      prompt: '继续完成任务',
      threadId: 'thread_1',
      projectKey: '/workspace/project'
    });

    expect(prepared.executionPrompt).toContain('项目约定');
    expect(prepared.executionPrompt).toContain('当前会话要求');
    expect(prepared.executionPrompt).not.toContain('全局偏好');
    expect(prepared.executionPrompt).not.toContain('其他项目');
    expect(prepared.executionPrompt).toContain('继续完成任务');
    expect(prepared.items.map(item => item.sourceId)).toEqual([
      threadMemory.id,
      projectMemory.id
    ]);

    db!.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, profile, cwd,
        canonical_cwd, workspace_mode, sandbox, codex_version, codex_bin,
        codex_home, normalizer_version
      ) VALUES (
        'run_1', 'running', 'running', 'api', 'default', '/workspace/project',
        '/workspace/project', 'managed', 'read-only', 'test', 'codex',
        '/tmp/codex-home', 1
      )
    `).run();
    service.recordRunContext('run_1', prepared.items);
    service.deleteMemory(projectMemory.id);
    expect(service.listRunContext('run_1').items).toEqual([
      expect.objectContaining({ content: '当前会话要求' }),
      expect.objectContaining({ content: '项目约定' })
    ]);
  });

  it('creates visible versioned summaries and leaves no record when source history is empty', () => {
    const service = createService();
    const items: ThreadHistoryItem[] = [
      {
        id: 'item_1',
        type: 'user_message',
        text: '请把发布流程拆成三个阶段。',
        createdAt: '2026-07-12T10:00:00.000Z'
      },
      {
        id: 'item_2',
        type: 'assistant_message',
        text: '第一阶段准备，第二阶段验证，第三阶段发布。',
        createdAt: '2026-07-12T10:01:00.000Z'
      }
    ];

    const first = service.createSummary({ threadId: 'thread_1', items });
    const second = service.createSummary({ threadId: 'thread_1', items });

    expect(first).toMatchObject({
      threadId: 'thread_1',
      version: 1,
      coveredFromCursor: 'item_1',
      coveredToCursor: 'item_2',
      itemCount: 2
    });
    expect(first.content).toContain('用户：请把发布流程拆成三个阶段');
    expect(second.version).toBe(2);
    expect(service.listSummaries({ threadId: 'thread_1' }).summaries).toHaveLength(2);

    expect(() => service.createSummary({ threadId: 'thread_2', items: [] }))
      .toThrowError(MemoryServiceError);
    expect(service.listSummaries({ threadId: 'thread_2' }).summaries).toEqual([]);
  });

  it('builds a redacted rotation prompt from the latest summary and current public input', () => {
    const service = createService();
    const summary = service.createSummary({
      threadId: 'thread_1',
      items: [{
        id: 'item_1',
        type: 'assistant_message',
        text: '上一轮结论已保存，TOKEN=sk-sensitive-value',
        createdAt: '2026-07-14T12:00:00.000Z'
      }]
    });

    const prepared = service.prepareThreadRotationContext({
      prompt: '继续生成公开日报，API_KEY=sk-current-value',
      threadId: 'thread_1'
    });

    expect(prepared.executionPrompt).toContain('执行上下文恢复摘要');
    expect(prepared.executionPrompt).toContain('上一轮结论已保存');
    expect(prepared.executionPrompt).toContain('继续生成公开日报');
    expect(prepared.executionPrompt).not.toContain('sk-sensitive-value');
    expect(prepared.executionPrompt).not.toContain('sk-current-value');
    expect(prepared.items).toEqual([
      expect.objectContaining({
        kind: 'summary',
        sourceId: summary.id,
        content: expect.stringContaining('[REDACTED]')
      })
    ]);
  });
});
