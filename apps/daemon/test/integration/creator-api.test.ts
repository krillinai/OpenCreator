import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { buildServer } from '../../src/api/server.js';
import type { AgentRuntimeAdapter } from '../../src/creator/agent/runtime-adapter.js';
import type { CreatorExecutor } from '../../src/creator/executor.js';

let server: FastifyInstance | undefined;
let tempDir = '';
type TestResponse = { statusCode: number; json(): any };

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, {
    recursive: true,
    force: true,
    maxRetries: 30,
    retryDelay: 100
  });
  tempDir = '';
});

describe('creator api', () => {
  it.each(['source_subtitle', 'target_subtitle'])('imports %s and runs downstream workflow with the persisted input', async kind => {
    const calls: string[] = [];
    await setupServer({ llmConfigured: kind === 'source_subtitle', creatorExecutors: [{
      id: 'krillinai', async run(stage) {
        calls.push(stage.stageRun.stageId);
        const path = join(stage.workdir, 'output.srt');
        writeFileSync(path, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
        if (stage.stageRun.stageId === 'subtitle') {
          expect(stage.inputArtifacts.some(a => a.kind === kind && a.metadata.source === 'local-upload')).toBe(true);
          return { outputs: ['source_video', 'target_subtitle', 'vertical_subtitle'].map(kind => ({ kind, status: 'completed' as const, path })) };
        }
        return { outputs: [{ kind: stage.stageRun.stageId === 'tts' ? 'dubbed_audio' : stage.stageRun.stageId === 'render-horizontal' ? 'horizontal_video' : 'vertical_video', status: 'completed', path }] };
      }
    }] });
    const created = await request('POST', '/creator/jobs', { projectId: 'project_import', templateId: 'video-translation', state: {
      sourceUrl: 'https://www.youtube.com/watch?v=import', dubbing: true, ttsProvider: 'edge-tts', composeVideo: true, videoFormat: 'all'
    } });
    const job = created.json().job;
    const payload = { action: 'import-subtitle', expectedRevision: 0, input: { kind, language: 'en', fileName: 'captions.srt', contentBase64: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHello\n').toString('base64') } };
    const invalid = await request('POST', `/creator/jobs/${job.id}/actions`, {
      ...payload, input: { ...payload.input, contentBase64: Buffer.from([0xff, 0xfe, 0x41, 0x00]).toString('base64') }
    });
    expect(invalid.statusCode).toBe(400);
    expect((await request('GET', `/creator/jobs/${job.id}`)).json().job).toMatchObject({ revision: 0, artifacts: [] });
    const imported = await request('POST', `/creator/jobs/${job.id}/actions`, payload);
    expect(imported.statusCode).toBe(200);
    const artifact = imported.json().job.artifacts[0];
    expect(artifact).toMatchObject({ kind, metadata: { source: 'local-upload', language: 'en', cueCount: 1 } });
    expect(existsSync(artifact.path)).toBe(true);
    const started = await request('POST', `/creator/jobs/${job.id}/actions`, { action: 'run-stage', expectedRevision: imported.json().job.revision, input: { stageId: 'subtitle', workflow: true } });
    expect(started.statusCode).toBe(200);
    await waitForCreatorJob(job.id, job => job.artifacts.some((a: { kind: string }) => a.kind === 'vertical_video'));
    expect(calls).toEqual(['subtitle', 'tts', 'render-horizontal', 'render-vertical']);
    const old = await request('GET', `/creator/jobs/${job.id}/artifacts/${artifact.id}/content`);
    expect(old.statusCode).toBe(200);
  });
  it('serves built-in stickman visual asset previews in development', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const catalog = await request(
      'GET',
      '/creator/visual-assets?templateId=stickman-video'
    );
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().assets).toHaveLength(14);

    const preview = await server.inject({
      method: 'GET',
      url: '/creator/visual-assets/stickman.character.student/revisions/1/preview',
      headers: { authorization: 'Bearer secret' }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.rawPayload.byteLength).toBeGreaterThan(1_000);
  });

  it('uploads a persistent inline image for a WeChat article', async () => {
    await setupServer({});
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_article_image',
      templateId: 'wechat-article'
    });
    const job = created.json().job;
    const uploaded = await server!.inject({
      method: 'POST',
      url: `/creator/jobs/${job.id}/article-image?expectedRevision=${job.revision}&fileName=photo.png&mime=image%2Fpng&lastModified=123`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-reference-image'
      },
      payload: png('article-inline-image')
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      job: { state: { manualArticleImageArtifactIds: [expect.any(String)] } },
      artifact: {
        kind: 'article_image',
        metadata: { originalFileName: 'photo.png', source: 'local-upload' }
      }
    });
  });

  it('deletes an inactive creator job', async () => {
    await setupServer({});
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_delete',
      templateId: 'cover',
      state: { prompt: '待删除封面' }
    });
    const job = created.json().job;
    const keptJobRoot = join(tempDir, 'creator', 'jobs', job.id);
    mkdirSync(keptJobRoot, { recursive: true });
    writeFileSync(join(keptJobRoot, 'generated.png'), 'kept');

    const deleted = await request('DELETE', `/creator/jobs/${job.id}`);
    expect(deleted.statusCode).toBe(204);
    expect(existsSync(keptJobRoot)).toBe(true);
    expect((await request('GET', `/creator/jobs/${job.id}`)).statusCode).toBe(404);
    expect((await request('DELETE', `/creator/jobs/${job.id}`)).statusCode).toBe(404);

    const createdWithFiles = await request('POST', '/creator/jobs', {
      projectId: 'project_delete_files',
      templateId: 'cover',
      state: { prompt: '连同文件删除的封面' }
    });
    const jobWithFiles = createdWithFiles.json().job;
    const deletedJobRoot = join(tempDir, 'creator', 'jobs', jobWithFiles.id);
    mkdirSync(deletedJobRoot, { recursive: true });
    writeFileSync(join(deletedJobRoot, 'generated.png'), 'deleted');

    const deletedWithFiles = await request(
      'DELETE',
      `/creator/jobs/${jobWithFiles.id}?deleteFiles=true`
    );
    expect(deletedWithFiles.statusCode).toBe(204);
    expect(existsSync(deletedJobRoot)).toBe(false);
    expect((await request('GET', `/creator/jobs/${jobWithFiles.id}`)).statusCode).toBe(404);
  });

  it('stops an active translation stage and resumes the workflow from that stage', async () => {
    let subtitleRuns = 0;
    const executor: CreatorExecutor = {
      id: 'krillinai',
      async run({ stageRun, signal }) {
        if (stageRun.stageId === 'subtitle') {
          subtitleRuns += 1;
          if (subtitleRuns === 1) {
            await new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            return { outputs: [] };
          }
          return {
            outputs: [
              { kind: 'source_video', status: 'completed', path: null },
              { kind: 'target_subtitle', status: 'completed', path: null }
            ]
          };
        }
        return {
          outputs: [{
            kind: 'horizontal_video',
            status: 'completed',
            path: null
          }]
        };
      }
    };
    await setupServer({ creatorExecutors: [executor] });
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_job_control',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=job-control',
        targetLanguage: 'zh_cn',
        composeVideo: true,
        videoFormat: 'horizontal'
      }
    });
    const job = created.json().job;
    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: job.revision,
      idempotencyKey: 'start-job-control-workflow',
      input: { stageId: 'subtitle', workflow: true }
    });
    expect(started.statusCode).toBe(200);

    const running = await waitForCreatorJob(job.id, candidate => (
      candidate.stages.at(-1)?.status === 'running'
    ));
    const canceledStageId = running.stages.at(-1).id;
    const canceled = await request('POST', `/creator/jobs/${job.id}/cancel`);
    expect(canceled.statusCode).toBe(202);
    expect(canceled.json()).toMatchObject({
      control: 'canceling',
      stage: {
        id: canceledStageId,
        progress: { workflow: true, cancelRequested: true }
      }
    });

    const stopped = await waitForCreatorJob(job.id, candidate => (
      candidate.status === 'canceled'
      && candidate.stages.at(-1)?.status === 'canceled'
    ));
    expect(stopped.artifacts).toEqual([]);
    const repeatedCancel = await request('POST', `/creator/jobs/${job.id}/cancel`);
    expect(repeatedCancel.statusCode).toBe(200);
    expect(repeatedCancel.json()).toMatchObject({
      control: 'canceled',
      stage: { id: canceledStageId, status: 'canceled' }
    });

    const resumed = await request('POST', `/creator/jobs/${job.id}/resume`);
    expect(resumed.statusCode).toBe(202);
    expect(resumed.json()).toMatchObject({
      control: 'resumed',
      stage: {
        stageId: 'subtitle',
        progress: {
          workflow: true,
          resumedFromStageRunId: canceledStageId
        }
      }
    });

    const completed = await waitForCreatorJob(job.id, candidate => (
      candidate.status === 'completed'
      && candidate.stages.at(-1)?.stageId === 'render-horizontal'
      && candidate.stages.at(-1)?.status === 'succeeded'
    ));
    expect(completed.stages.map((stage: { stageId: string; status: string }) => (
      `${stage.stageId}:${stage.status}`
    ))).toEqual([
      'subtitle:canceled',
      'subtitle:succeeded',
      'render-horizontal:succeeded'
    ]);
    expect(completed.stages[1]).toMatchObject({
      progress: {
        workflow: true,
        resumedFromStageRunId: canceledStageId
      }
    });
  });

  it('replays creator job creation after the response is lost', async () => {
    await setupServer();
    const requestBody = {
      projectId: 'project_creation_recovery',
      templateId: 'cover',
      creationKey: 'creator-create-recovery-1'
    };

    const first = await request('POST', '/creator/jobs', requestBody);
    const replayed = await request('POST', '/creator/jobs', requestBody);

    expect(first.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json().job.id).toBe(first.json().job.id);
    const listed = await request(
      'GET',
      '/creator/jobs?projectId=project_creation_recovery'
    );
    expect(listed.json().jobs).toHaveLength(1);

    const conflicting = await request('POST', '/creator/jobs', {
      ...requestBody,
      templateId: 'video-translation'
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({
      error: { code: 'creator_idempotency_key_reused' }
    });
  });

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

  it('streams a local source into the job before starting subtitles', async () => {
    const sourceBytes = Buffer.from('test-video-content');
    await setupServer({
      creatorSourceMediaProbe: async path => {
        expect(readFileSync(path)).toEqual(sourceBytes);
        return {
          duration: 12.5,
          width: 1280,
          height: 720,
          hasVideo: true,
          hasAudio: true
        };
      }
    });
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_local_source',
      templateId: 'video-translation',
      state: {
        sourceType: 'file',
        targetLanguage: 'en'
      }
    });
    const job = created.json().job;
    const uploadUrl = `/creator/jobs/${job.id}/source-video?${new URLSearchParams({
      expectedRevision: '0',
      fileName: 'sample.webm',
      mime: 'video/webm',
      lastModified: '123'
    })}`;
    const uploaded = await server!.inject({
      method: 'POST',
      url: uploadUrl,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-source'
      },
      payload: sourceBytes
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      deduplicated: false,
      job: {
        revision: 1,
        state: {
          sourceType: 'file',
          sourceFileName: 'sample.webm'
        }
      },
      artifact: {
        kind: 'source_video',
        status: 'completed',
        metadata: {
          fileName: 'sample.webm',
          mimeType: 'video/webm',
          size: sourceBytes.length,
          source: 'local-upload'
        }
      }
    });

    const duplicate = await server!.inject({
      method: 'POST',
      url: uploadUrl.replace('expectedRevision=0', 'expectedRevision=1'),
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-source'
      },
      payload: sourceBytes
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ deduplicated: true, job: { revision: 1 } });

    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: 1,
      input: { stageId: 'subtitle' }
    });
    expect(started.statusCode).toBe(400);
    expect(started.json()).toMatchObject({
      error: { preflight: { canStart: false } }
    });
    expect((await request('GET', `/creator/jobs/${job.id}`)).json().job.stages).toEqual([]);
  });

  it('starts subtitles without requiring TTS configuration up front', async () => {
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
      error: { preflight: { canStart: false } }
    });
    expect((await request('GET', `/creator/jobs/${job.id}`)).json().job.stages).toEqual([]);
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

    const preflight = await request('GET', `/creator/jobs/${job.id}/preflight?stageId=subtitle`);
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      canStart: false,
      blocked: expect.arrayContaining([expect.objectContaining({
        id: 'llm',
        repair: expect.objectContaining({
          deepLink: '#/settings?tab=ai-services&section=text'
        })
      })])
    });

    const started = await request('POST', `/creator/jobs/${job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: 0,
      input: { stageId: 'subtitle' }
    });

    expect(started.statusCode).toBe(400);
    expect(started.json()).toMatchObject({
      error: {
        code: 'creator_llm_config_missing',
        preflight: { canStart: false }
      }
    });
    expect((await request('GET', `/creator/jobs/${job.id}`)).json().job.stages).toEqual([]);
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
  creatorSourceMediaProbe?(path: string): Promise<{
    duration: number;
    width?: number;
    height?: number;
    hasVideo: boolean;
    hasAudio: boolean;
  }>;
  creatorExecutors?: CreatorExecutor[];
} = {}): Promise<void> {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-api-'));
  const config = createDefaultCreatorServicesConfig();
  if (options.llmConfigured !== false) {
    config.llm.baseUrl = 'https://api.openai.com/v1';
    config.llm.apiKey = 'test-llm-key';
    config.llm.source = 'custom';
  }
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    codexHome: join(tempDir, 'codex-home'),
    creatorAgentRuntime: options.agentRuntime,
    ...(options.creatorExecutors === undefined
      ? {}
      : { creatorExecutors: options.creatorExecutors }),
    ...(options.creatorSourceMediaProbe === undefined
      ? {}
      : { creatorSourceMediaProbe: options.creatorSourceMediaProbe }),
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

async function waitForCreatorJob(
  jobId: string,
  predicate: (job: any) => boolean
): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request('GET', `/creator/jobs/${jobId}`);
    const job = response.json().job;
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for Creator job ${jobId}`);
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
  method: 'GET' | 'POST' | 'DELETE',
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

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ]);
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
