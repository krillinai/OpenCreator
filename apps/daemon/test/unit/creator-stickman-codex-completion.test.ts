import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerResult } from '../../src/codex/app-server-host-2026-07-28.js';
import { createStickmanCodexJsonCompletion } from '../../src/creator/stickman/codex-json-completion.js';
import { createStickmanConfiguredCompletion } from '../../src/creator/stickman/content-executor.js';

describe('stickman Codex JSON completion', () => {
  it('parses the final agent JSON message and disables every tool', async () => {
    const startTurn = vi.fn((input: Record<string, unknown>) => {
      void (input.onNotification as (event: Record<string, unknown>) => void)({
        method: 'item/completed',
        params: {
          item: {
            id: 'final-1',
            type: 'agentMessage',
            phase: 'final_answer',
            text: '{"title":"ok"}'
          }
        }
      });
      return execution(Promise.resolve(result('completed')));
    });
    const complete = createStickmanCodexJsonCompletion({
      runtimeManager: { startTurn } as never
    });

    await expect(complete(request())).resolves.toEqual({ title: 'ok' });
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      scope: { kind: 'creator-job', id: 'job-1' },
      jobId: 'job-1',
      projectId: 'project-1',
      profile: 'default',
      sandbox: 'read-only',
      model: 'gpt-5.6-sol',
      runtimeInjection: {
        mcpServers: [],
        env: {},
        builtInTools: {
          shell: false,
          fileRead: false,
          fileWrite: false,
          applyPatch: false,
          webSearch: false
        },
        configurationFingerprint: 'stickman-json-completion-v1'
      }
    }));
  });

  it('parses fenced JSON assembled from agent message deltas', async () => {
    const startTurn = vi.fn((input: Record<string, unknown>) => {
      const notify = input.onNotification as (event: Record<string, unknown>) => void;
      notify({
        method: 'item/agentMessage/delta',
        params: { itemId: 'answer-1', delta: '```json\n{"segments":' }
      });
      notify({
        method: 'item/agentMessage/delta',
        params: { itemId: 'answer-1', delta: '[]}\n```' }
      });
      return execution(Promise.resolve(result('completed')));
    });
    const complete = createStickmanCodexJsonCompletion({
      runtimeManager: { startTurn } as never
    });

    await expect(complete(request())).resolves.toEqual({ segments: [] });
  });

  it('rejects a failed Codex turn as an LLM failure', async () => {
    const complete = createStickmanCodexJsonCompletion({
      runtimeManager: {
        startTurn: () => execution(Promise.resolve(result('failed')))
      } as never
    });

    await expect(complete(request())).rejects.toMatchObject({
      code: 'creator_llm_failed'
    });
  });

  it('cancels the active Codex turn when the stage is aborted', async () => {
    let finish!: (value: CodexAppServerResult) => void;
    const pending = new Promise<CodexAppServerResult>(resolve => { finish = resolve; });
    const cancel = vi.fn(() => finish(result('interrupted')));
    const controller = new AbortController();
    const complete = createStickmanCodexJsonCompletion({
      runtimeManager: {
        startTurn: () => execution(pending, cancel)
      } as never
    });

    const work = complete(request(controller.signal));
    controller.abort();
    await expect(work).rejects.toMatchObject({ code: 'creator_stage_canceled' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('stickman configured completion', () => {
  it('uses the Codex runtime without requiring a separate API key', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'codex';
    config.llm.apiKey = '';
    config.llm.model = 'gpt-5.6-sol';
    const codexCompleteJson = vi.fn(async () => ({ title: 'ok' }));
    const complete = createStickmanConfiguredCompletion({
      configStore: { read: async () => config },
      codexCompleteJson,
      context: { jobId: 'job-1', projectId: 'project-1', cwd: 'D:\\jobs\\job-1' }
    });

    await expect(complete({
      stageId: 'source-brief',
      prompt: 'return JSON',
      signal: new AbortController().signal
    })).resolves.toEqual({ title: 'ok' });
    expect(codexCompleteJson).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      projectId: 'project-1',
      model: 'gpt-5.6-sol'
    }));
  });

  it('still requires an API key for a custom HTTP model', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'custom';
    config.llm.apiKey = '';
    const complete = createStickmanConfiguredCompletion({
      configStore: { read: async () => config },
      context: { jobId: 'job-1', projectId: 'project-1', cwd: 'D:\\jobs\\job-1' }
    });

    await expect(complete({
      stageId: 'source-brief',
      prompt: 'return JSON',
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'creator_llm_config_missing' });
  });
});

function request(signal = new AbortController().signal) {
  return {
    stageId: 'source-brief',
    prompt: 'Return JSON',
    signal,
    jobId: 'job-1',
    projectId: 'project-1',
    cwd: process.cwd(),
    model: 'gpt-5.6-sol'
  };
}

function execution(
  work: Promise<CodexAppServerResult>,
  cancel = vi.fn()
) {
  return {
    cancel,
    started: Promise.resolve({ pid: 101, reused: false, generation: 1 }),
    result: work
  };
}

function result(turnStatus: CodexAppServerResult['turnStatus']): CodexAppServerResult {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    turnStatus,
    stderr: '',
    terminationReason: turnStatus === 'interrupted' ? 'canceled' : 'completed',
    outputTruncation: {
      stderr: { truncated: false, droppedBytes: 0, droppedItems: 0 },
      frames: { truncated: false, droppedBytes: 0, droppedItems: 0 }
    }
  };
}
