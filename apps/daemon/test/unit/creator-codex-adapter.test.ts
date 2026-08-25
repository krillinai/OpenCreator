import { describe, expect, it, vi } from 'vitest';
import type { AgentContextEnvelope } from '@opencreator/protocol';
import type { CodexAppServerResult } from '../../src/codex/app-server-host-2026-07-28.js';
import { createCodexCreatorAdapter } from '../../src/creator/agent/codex-adapter.js';
import type { RuntimeThread } from '../../src/threads/types.js';

describe('creator codex adapter', () => {
  it('uses the shared Runtime Manager with Skill, developer instructions and minimal context', async () => {
    const cancel = vi.fn();
    const startTurn = vi.fn((input: Record<string, unknown>) => {
      void (input.onThreadStarted as (id: string) => void)('codex-thread-1');
      void (input.onNotification as (event: Record<string, unknown>) => void)({
        method: 'item/completed',
        params: {
          item: {
            id: 'commentary-1',
            type: 'agentMessage',
            phase: 'commentary',
            text: '正在读取上下文并调用内部工具'
          }
        }
      });
      void (input.onNotification as (event: Record<string, unknown>) => void)({
        method: 'item/completed',
        params: {
          item: {
            id: 'final-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: '已完成真实处理'
          }
        }
      });
      return {
        cancel,
        started: Promise.resolve({ pid: 101, reused: false, generation: 7 }),
        result: Promise.resolve<CodexAppServerResult>({
          threadId: 'codex-thread-1',
          turnId: 'codex-turn-1',
          turnStatus: 'completed',
          stderr: '',
          terminationReason: 'completed',
          outputTruncation: {
            stderr: { truncated: false, droppedBytes: 0, droppedItems: 0 },
            frames: { truncated: false, droppedBytes: 0, droppedItems: 0 }
          }
        })
      };
    });
    const closeScope = vi.fn(async () => undefined);
    const setCodexThreadId = vi.fn();
    const adapter = createCodexCreatorAdapter({
      runtimeManager: {
        startTurn,
        closeScope
      } as never,
      threads: {
        getThread: () => thread(),
        setCodexThreadId
      },
      skillPath: 'D:\\runtime\\skills\\opencreator-runtime',
      guideVersion: 2,
      guideHash: 'guide-hash',
      available: true
    });
    const context = creatorContext();

    const execution = adapter.startTurn!({
      runId: 'creator-run-1',
      threadId: 'thread-1',
      message: '调整字幕，但不要把完整字幕放进上下文',
      selection: null,
      context,
      conflictAttempt: 0
    });
    const result = await execution.result;

    expect(result).toEqual({
      content: '已完成真实处理',
      runtimeThreadId: 'codex-thread-1',
      runtimeTurnId: 'codex-turn-1',
      processGeneration: 7
    });
    expect(result.content).not.toContain('正在读取上下文');
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'creator-job', id: 'job-1' },
      runId: 'creator-run-1',
      jobId: 'job-1',
      projectId: 'project-1',
      capabilityScopes: ['creator:context', 'creator:artifact:read', 'creator:action'],
      requiredSkillNames: ['opencreator-runtime'],
      readThreadBeforeResume: false,
      timeoutMs: 20 * 60_000,
      inactivityTimeoutMs: 5 * 60_000,
      spawnTimeoutMs: 15_000,
      skills: [{
        name: 'opencreator-runtime',
        path: 'D:\\runtime\\skills\\opencreator-runtime'
      }]
    }));
    const call = startTurn.mock.calls[0]![0];
    expect(call.developerInstructions).toContain('Creator Core');
    expect(call.developerInstructions).toContain('不得输出演示');
    expect(call.developerInstructions).toContain('不要向用户展示 revision');
    expect(call.developerInstructions).toContain('state.resultVersion 是项目快照版本');
    expect(call.developerInstructions).toContain('未变化的子项会跨项目版本复用同一个 Artifact');
    expect(call.developerInstructions).toContain('不要在回复中播报 Skill');
    expect(call.developerInstructions).toContain('input: { patch: { ... }, objectId?: string }');
    expect(call.developerInstructions).toContain('templateGuidance');
    expect(call.prompt).toContain(JSON.stringify(context));
    expect(call.prompt).not.toContain('完整字幕内容');
    expect(setCodexThreadId).toHaveBeenCalledWith('thread-1', 'codex-thread-1');

    const waiting = adapter.startTurn!({
      runId: 'creator-run-2',
      threadId: 'thread-1',
      message: '继续',
      selection: null,
      context,
      conflictAttempt: 0
    });
    expect(adapter.interrupt?.('creator-run-2')).toBe(true);
    expect(cancel).toHaveBeenCalled();
    await waiting.result;
    await adapter.closeScope?.('job-1');
    expect(closeScope).toHaveBeenCalledWith(
      { kind: 'creator-job', id: 'job-1' },
      'creator_scope_closed'
    );
  });
});

function creatorContext(): AgentContextEnvelope {
  return {
    contractVersion: 1,
    jobId: 'job-1',
    projectId: 'project-1',
    templateId: 'video-translation',
    templateVersion: 1,
    jobStatus: 'running',
    revision: 3,
    selectedResultVersion: null,
    latestResultVersion: null,
    selectedResultSnapshot: null,
    currentStage: 'subtitle',
    state: {
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      bilingual: true,
      composeVideo: true
    },
    stateTruncated: false,
    templateGuidance: '更新设置必须写入 input.patch。',
    availableStageIds: ['subtitle', 'tts', 'render-horizontal', 'render-vertical'],
    stages: [{
      stageId: 'subtitle',
      status: 'succeeded',
      dispatchStatus: 'finished',
      attempt: 1,
      progress: { percent: 100, providerStatus: 'succeeded', phase: null },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z'
    }],
    artifacts: [{
        id: 'artifact-1',
        kind: 'target_subtitle',
        version: 1,
        projectVersion: null,
        status: 'completed',
      fileName: 'target.srt',
      cueCount: 3,
      duration: null,
      width: null,
      height: null
    }],
    selection: null,
    recentChanges: [{
      revision: 3,
      actor: 'user',
      action: 'update-settings',
      summary: '修改目标语言',
      createdAt: '2026-08-21T00:00:00.000Z'
    }],
    allowedActions: ['update-settings', 'run-stage']
  };
}

function thread(): RuntimeThread {
  return {
    id: 'thread-1',
    title: 'Creator Agent',
    projectId: 'project-1',
    enterpriseSubjectId: null,
    origin: 'opencreator_created',
    codexThreadId: null,
    cwd: 'D:\\workspace',
    canonicalCwd: 'D:\\workspace',
    workspaceMode: 'external',
    profile: 'default',
    model: 'gpt-5',
    reasoning: 'high',
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'creator_agent',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  };
}
