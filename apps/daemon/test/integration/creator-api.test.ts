import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { buildServer } from '../../src/api/server.js';
import type { AgentRuntimeAdapter } from '../../src/creator/agent/runtime-adapter.js';

let server: FastifyInstance | undefined;
let tempDir = '';
type TestResponse = { statusCode: number; json(): any };

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator api', () => {
  it('creates, lists, reads and mutates creator jobs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const templates = await request('GET', '/creator/templates');
    expect(templates.statusCode).toBe(200);
    expect(templates.json().templates).toContainEqual(expect.objectContaining({
      id: 'video-translation',
      version: 1
    }));

    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_1',
      templateId: 'video-translation',
      state: { targetLanguage: 'en' }
    });
    expect(created.statusCode).toBe(201);
    const job = created.json().job;
    expect(job).toMatchObject({ revision: 0, state: { targetLanguage: 'en' } });

    const updated = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'ja' } }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().job).toMatchObject({
      revision: 1,
      state: { targetLanguage: 'ja' }
    });

    const conflict = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'fr' } }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: {
        code: 'creator_revision_conflict',
        details: { latestRevision: 1 }
      }
    });

    const listed = await request('GET', '/creator/jobs?projectId=project_1');
    expect(listed.json().jobs).toHaveLength(1);
    const allJobs = await request('GET', '/creator/jobs');
    expect(allJobs.json().jobs).toContainEqual(expect.objectContaining({ id: job.id }));

    const missingArtifact = await request('GET', `/creator/jobs/${job.id}/artifacts/missing/content`);
    expect(missingArtifact.statusCode).toBe(404);
    expect(missingArtifact.json()).toMatchObject({ error: { code: 'creator_artifact_not_found' } });
  });

  it('rejects unsupported video sources before creating a stage run', async () => {
    await setupServer();
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_vt5',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://example.com/video/unsupported',
        targetLanguage: 'en'
      }
    });
    const job = created.json().job;

    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: 0,
      input: { stageId: 'subtitle' }
    });
    expect(started.statusCode).toBe(422);
    expect(started.json()).toMatchObject({ error: { code: 'unsupported_source' } });

    const restored = await request('GET', `/creator/jobs/${job.id}`);
    expect(restored.json().job).toMatchObject({ revision: 0, status: 'draft', stages: [] });
  });

  it('requires TTS configuration before creating a dubbing stage run', async () => {
    await setupServer();
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_vt6',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=vt6',
        targetLanguage: 'en',
        dubbing: true
      }
    });
    const job = created.json().job;

    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: 0,
      input: { stageId: 'subtitle' }
    });
    expect(started.statusCode).toBe(400);
    expect(started.json()).toMatchObject({
      error: { code: 'creator_tts_config_missing' }
    });

    const restored = await request('GET', `/creator/jobs/${job.id}`);
    expect(restored.json().job).toMatchObject({
      revision: 1,
      status: 'needs_input',
      stages: [],
      state: {
        needsInput: {
          code: 'creator_tts_config_missing',
          deepLink: '/settings/ai-services?section=tts'
        }
      }
    });
  });

  it('requires text translation configuration before starting subtitles', async () => {
    await setupServer({ llmConfigured: false });
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_llm',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=llm',
        targetLanguage: 'en'
      }
    });
    const job = created.json().job;

    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: 0,
      input: { stageId: 'subtitle' }
    });

    expect(started.statusCode).toBe(400);
    expect(started.json()).toMatchObject({
      error: { code: 'creator_llm_config_missing' }
    });
  });

  it('returns the persisted Agent timeline and resolves approvals by generation', async () => {
    let observedDecision = '';
    const agentRuntime: AgentRuntimeAdapter = {
      id: 'api-test',
      available: true,
      async runTurn(input) {
        input.onStarted?.({ pid: 301, generation: 8, reused: false });
        if (input.message === '需要审批') {
          observedDecision = await input.onApprovalRequest?.({
            id: 'request-api-approval',
            method: 'item/commandExecution/requestApproval',
            params: { itemId: 'item-api-approval', reason: '执行真实命令' }
          }) ?? '';
        }
        await input.onNotification?.({
          method: 'item/completed',
          params: {
            item: {
              id: `prompt-${input.runId}`,
              type: 'userMessage',
              content: [{
                type: 'inputText',
                text: '用户请求：测试\nOpenCreator Context Projection：{"private":true}'
              }]
            }
          }
        });
        await input.onNotification?.({
          method: 'item/completed',
          params: {
            item: {
              id: `item-${input.runId}`,
              type: 'agentMessage',
              text: '真实 Agent 回复'
            }
          }
        });
        return {
          content: '真实 Agent 回复',
          runtimeThreadId: 'runtime-thread-api',
          runtimeTurnId: `runtime-${input.runId}`,
          processGeneration: 8
        };
      }
    };
    await setupServer({ agentRuntime });
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_agent_api',
      templateId: 'video-translation'
    });
    const job = created.json().job;

    const emptyTimeline = await request('GET', `/creator/jobs/${job.id}/agent-timeline`);
    expect(emptyTimeline.json()).toMatchObject({ session: null, turns: [], items: [] });

    const invalidSandbox = await request('POST', `/creator/jobs/${job.id}/agent-turns`, {
      message: '无效权限请求',
      sandbox: 'read-only'
    });
    expect(invalidSandbox.statusCode).toBe(400);
    expect(invalidSandbox.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const first = await request('POST', `/creator/jobs/${job.id}/agent-turns`, {
      message: '开始处理',
      clientMessageId: 'client-api-1',
      sandbox: 'danger-full-access'
    });
    expect(first.statusCode).toBe(200);

    const approvalTurn = request('POST', `/creator/jobs/${job.id}/agent-turns`, {
      message: '需要审批',
      clientMessageId: 'client-api-2'
    });
    const approval = await waitForApiApproval(job.id);
    const approved = await request(
      'POST',
      `/creator/jobs/${job.id}/agent-approvals/${approval.id}`,
      { decision: 'approved', processGeneration: 8 }
    );
    expect(approved.statusCode).toBe(200);
    await approvalTurn;

    const timeline = await request('GET', `/creator/jobs/${job.id}/agent-history`);
    expect(timeline.json()).toMatchObject({
      session: { runtimeThreadId: 'runtime-thread-api', hostGeneration: 8 },
      approvals: [{ id: approval.id, status: 'approved' }]
    });
    expect(timeline.json().turns).toHaveLength(4);
    expect(timeline.json().turns.some((turn: { content?: string }) => turn.content === '真实 Agent 回复'))
      .toBe(true);
    expect(timeline.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant_message',
        text: expect.any(String)
      })
    ]));
    expect(JSON.stringify(timeline.json())).not.toContain('Context Projection');
    expect(JSON.stringify(timeline.json())).not.toContain('private');
    expect(observedDecision).toBe('approved');
  });

  it('replays stable Creator SSE events after a cursor', async () => {
    await setupServer();
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_sse',
      templateId: 'video-translation'
    });
    const job = created.json().job;
    await server!.listen({ host: '127.0.0.1', port: 0 });
    const address = server!.server.address();
    if (address === null || typeof address === 'string') throw new Error('Server address is unavailable');
    const origin = `http://127.0.0.1:${address.port}`;

    const initial = await readSseFrames(
      `${origin}/creator/jobs/${job.id}/events`,
      1
    );
    expect(initial[0]).toMatchObject({
      id: 'snapshot:0',
      event: 'snapshot_changed',
      data: { id: 'snapshot:0', revision: 0 }
    });

    await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'sse-action-1',
      input: { patch: { targetLanguage: 'ja' } }
    });
    const reset = await readSseFrames(
      `${origin}/creator/jobs/${job.id}/events?cursor=${encodeURIComponent('snapshot:0')}`,
      1
    );
    expect(reset[0]).toMatchObject({
      id: 'reset:1',
      data: { payload: { reset: true, revision: 1 } }
    });

    const firstUpdated = await request('GET', `/creator/jobs/${job.id}`);
    const firstActivityId = firstUpdated.json().job.activities[0].id;
    await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: 1,
      idempotencyKey: 'sse-action-2',
      input: { patch: { targetLanguage: 'fr' } }
    });
    const replayed = await readSseFrames(
      `${origin}/creator/jobs/${job.id}/events?cursor=${encodeURIComponent(`activity:${firstActivityId}`)}`,
      2
    );
    expect(replayed.map(frame => frame.id)).toContain('snapshot:2');
    expect(replayed.some(frame => frame.id.startsWith('activity:'))).toBe(true);
    expect(new Set(replayed.map(frame => frame.id)).size).toBe(replayed.length);
  });
});

async function setupServer(options: {
  llmConfigured?: boolean;
  agentRuntime?: AgentRuntimeAdapter;
} = {}): Promise<void> {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-api-'));
  const config = createDefaultCreatorServicesConfig();
  if (options.llmConfigured !== false) {
    config.llm.apiKey = 'test-llm-key';
    config.llm.source = 'custom';
  }
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    codexHome: join(tempDir, 'codex-home'),
    creatorAgentRuntime: options.agentRuntime,
    creatorServicesConfigStore: {
      async read() { return structuredClone(config); },
      async write(next) { return structuredClone(next); },
      async reset() { return structuredClone(config); }
    },
    codexProviderCredentialStore: {
      async readApiKey() { return undefined; },
      async writeApiKey() {}
    }
  });
}

async function waitForApiApproval(jobId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const timeline = await request('GET', `/creator/jobs/${jobId}/agent-timeline`);
    const approval = timeline.json().approvals?.[0];
    if (approval !== undefined) return approval;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('API approval was not persisted');
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: string | object
): Promise<TestResponse> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  }) as unknown as TestResponse;
}

async function readSseFrames(url: string, expected: number): Promise<Array<{
  id: string;
  event: string;
  data: Record<string, unknown>;
}>> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: { authorization: 'Bearer secret' },
    signal: controller.signal
  });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('SSE response has no body');
  const decoder = new TextDecoder();
  const frames: Array<{ id: string; event: string; data: Record<string, unknown> }> = [];
  let buffered = '';
  try {
    while (frames.length < expected) {
      const read = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error('Timed out waiting for SSE replay')),
          2_000
        ))
      ]);
      if (read.done) break;
      buffered += decoder.decode(read.value, { stream: true });
      let boundary = buffered.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const id = frame.split('\n').find(line => line.startsWith('id: '))?.slice(4);
        const event = frame.split('\n').find(line => line.startsWith('event: '))?.slice(7);
        const data = frame.split('\n').find(line => line.startsWith('data: '))?.slice(6);
        if (id !== undefined && event !== undefined && data !== undefined) {
          frames.push({ id, event, data: JSON.parse(data) as Record<string, unknown> });
        }
        boundary = buffered.indexOf('\n\n');
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return frames;
}
